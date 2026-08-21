'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ChevronDown, FileText, History, Loader2, Mail, Paperclip, Save, Send, Sparkles, X } from 'lucide-react';
import type { Company } from '@/lib/api/companies';
import { updateCompany } from '@/lib/api/companies';
import {
  fetchEmailConfig,
  fetchEmailHistory,
  generateOutreachEmail,
  sendCompanyEmail,
  type OutreachPurpose,
  type SentEmail,
} from '@/lib/api/email';
import {
  fetchResumeList,
  fetchResume,
  downloadResumePdf,
  type ResumeListItem,
} from '@/lib/api/resume';
import {
  normalizeTemplateSettings,
  type TemplateSettings,
} from '@/lib/types/template-settings';
import { Dropdown, type DropdownOption } from '@/components/ui/dropdown';
import { useToast } from '@/components/ui/toast';
import { useTranslations } from '@/lib/i18n';
import { useLanguage } from '@/lib/context/language-context';
import { cn } from '@/lib/utils';

interface CompanyEmailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  company: Company | null;
  onSent?: () => void;
}

const PURPOSE_OPTIONS: { id: OutreachPurpose; labelKey: string }[] = [
  { id: 'internship', labelKey: 'companies.emailDialog.purpose.internship' },
  { id: 'job', labelKey: 'companies.emailDialog.purpose.job' },
  { id: 'cold', labelKey: 'companies.emailDialog.purpose.cold' },
  { id: 'custom', labelKey: 'companies.emailDialog.purpose.custom' },
];

interface EmailDraft {
  purpose: OutreachPurpose;
  customPurpose: string;
  recipientName: string;
  subject: string;
  body: string;
  selectedResumeId: string;
  instruction: string;
  savedAt: string;
}

function draftKey(companyId: string): string {
  return `company-email-draft:${companyId}`;
}

function loadDraft(companyId: string): EmailDraft | null {
  try {
    const raw = window.localStorage.getItem(draftKey(companyId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as EmailDraft;
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveDraft(companyId: string, draft: EmailDraft): void {
  try {
    window.localStorage.setItem(draftKey(companyId), JSON.stringify(draft));
  } catch {
    // Storage full or private mode — drafts are best-effort.
  }
}

function clearDraft(companyId: string): void {
  try {
    window.localStorage.removeItem(draftKey(companyId));
  } catch {
    // Ignore — nothing to do.
  }
}

function formatSentAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function CompanyEmailDialog({ open, onOpenChange, company, onSent }: CompanyEmailDialogProps) {
  const { t } = useTranslations();
  const { contentLanguage } = useLanguage();
  const { showToast } = useToast();

  const [purpose, setPurpose] = useState<OutreachPurpose>('internship');
  const [customPurpose, setCustomPurpose] = useState('');
  const [recipientName, setRecipientName] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [attachment, setAttachment] = useState<File | null>(null);
  const [attachmentName, setAttachmentName] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [resumes, setResumes] = useState<ResumeListItem[]>([]);
  const [selectedResumeId, setSelectedResumeId] = useState('');
  const [resumesLoading, setResumesLoading] = useState(false);

  const [emailConfigLoaded, setEmailConfigLoaded] = useState(false);
  const [senderConfigured, setSenderConfigured] = useState(false);
  const [senderName, setSenderName] = useState('');

  const [generating, setGenerating] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [instruction, setInstruction] = useState('');
  const [includeResume, setIncludeResume] = useState(true);

  const [history, setHistory] = useState<SentEmail[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);

  const reset = useCallback(() => {
    setPurpose('internship');
    setCustomPurpose('');
    setRecipientName('');
    setSubject('');
    setBody('');
    setAttachment(null);
    setAttachmentName('');
    setInstruction('');
    setIncludeResume(true);
    setError(null);
    setSuccess(false);
    setGenerating(false);
    setSending(false);
  }, []);

  useEffect(() => {
    if (open) {
      reset();
      setEmailConfigLoaded(false);
      fetchEmailConfig()
        .then((cfg) => {
          setSenderName(cfg.sender_name ?? '');
          setSenderConfigured(
            Boolean(cfg.smtp_host && cfg.sender_email && cfg.has_password)
          );
        })
        .catch(() => {
          setSenderName('');
          setSenderConfigured(false);
        })
        .finally(() => setEmailConfigLoaded(true));
    }
  }, [open, reset]);

  useEffect(() => {
    if (!open || !company) return;
    const draft = loadDraft(company.company_id);
    if (!draft) return;
    if (PURPOSE_OPTIONS.some((p) => p.id === draft.purpose)) {
      setPurpose(draft.purpose);
    }
    setCustomPurpose(draft.customPurpose ?? '');
    setRecipientName(draft.recipientName ?? '');
    setSubject(draft.subject ?? '');
    setBody(draft.body ?? '');
    setInstruction(draft.instruction ?? '');
  }, [open, company]);

  useEffect(() => {
    if (!open || !company) return;
    setHistoryLoading(true);
    setExpandedLogId(null);
    fetchEmailHistory(company.company_id)
      .then(setHistory)
      .catch(() => setHistory([]))
      .finally(() => setHistoryLoading(false));
  }, [open, company]);

  useEffect(() => {
    if (!open || !company) return;
    setResumesLoading(true);
    fetchResumeList(true)
      .then((list) => {
        const ready = list.filter((r) => r.processing_status === 'ready');
        ready.sort((a, b) => {
          if (a.is_master !== b.is_master) return a.is_master ? -1 : 1;
          return (b.updated_at ?? '').localeCompare(a.updated_at ?? '');
        });
        setResumes(ready);
        const draftResumeId = loadDraft(company.company_id)?.selectedResumeId;
        const draftResume = draftResumeId
          ? ready.find((r) => r.resume_id === draftResumeId)
          : undefined;
        const master = ready.find((r) => r.is_master);
        setSelectedResumeId(
          draftResume?.resume_id ?? master?.resume_id ?? ready[0]?.resume_id ?? ''
        );
      })
      .catch(() => {
        setResumes([]);
        setSelectedResumeId('');
      })
      .finally(() => setResumesLoading(false));
  }, [open, company]);

  const handleGenerate = async () => {
    if (!company || generating) return;
    if (!company.name) {
      setError(t('companies.emailDialog.errors.nameRequired'));
      return;
    }
    setGenerating(true);
    setError(null);
    try {
      const result = await generateOutreachEmail({
        company_name: company.name,
        company_email: company.email ?? '',
        industry: company.industry,
        company_size: company.company_size,
        company_type: company.company_type,
        website: company.website,
        linkedin_url: company.linkedin_url,
        recipient_name: recipientName.trim() || null,
        purpose,
        custom_purpose: purpose === 'custom' ? customPurpose.trim() : undefined,
        output_language: contentLanguage,
        resume_id: selectedResumeId || null,
        instruction: instruction.trim() || null,
      });
      if (result.subject) setSubject(result.subject);
      if (result.body) setBody(result.body);
    } catch {
      setError(t('companies.emailDialog.errors.generateFailed'));
    } finally {
      setGenerating(false);
    }
  };

  const handleSend = async () => {
    if (!company || sending) return;
    const target = company.email?.trim();
    if (!target) {
      const msg = t('companies.emailDialog.errors.noEmail');
      setError(msg);
      showToast(msg, 'error');
      return;
    }
    if (!subject.trim() || !body.trim()) {
      const msg = t('companies.emailDialog.errors.missingFields');
      setError(msg);
      showToast(msg, 'error');
      return;
    }
    setSending(true);
    setError(null);
    try {
      const form = new FormData();
      form.append('company_email', target);
      form.append('company_name', company.name || '');
      form.append('company_id', company.company_id);
      form.append('subject', subject.trim());
      form.append('body', body);
      if (attachment) {
        form.append('attachments', attachment, attachment.name);
      }
      if (includeResume) {
        let resumeId = selectedResumeId;
        if (!resumeId) {
          try {
            const list = await fetchResumeList(true);
            const ready = list.filter((r) => r.processing_status === 'ready');
            const fallback = ready.find((r) => r.is_master) ?? ready[0];
            resumeId = fallback?.resume_id ?? '';
          } catch {
            resumeId = '';
          }
        }
        if (resumeId) {
          let settings: TemplateSettings | undefined;
          let fullName = senderName;
          try {
            const resumeData = await fetchResume(resumeId);
            const personalName =
              resumeData.processed_resume?.personalInfo?.name?.trim();
            if (personalName) fullName = personalName;
            if (resumeData.template_settings) {
              settings = normalizeTemplateSettings(
                resumeData.template_settings as Partial<TemplateSettings>
              );
            }
          } catch {
            settings = undefined;
          }
          const pdf = await downloadResumePdf(resumeId, settings, contentLanguage);
          const pdfName = `${fullName || 'Resume'} - Resume.pdf`;
          form.append('attachments', pdf, pdfName);
        }
      }
      await sendCompanyEmail(form);
      setSuccess(true);
      clearDraft(company.company_id);
      try {
        await updateCompany(company.company_id, { status: 'contacted' });
        showToast(t('companies.emailDialog.statusUpdated'), 'success');
      } catch {
        showToast(t('companies.emailDialog.errors.statusUpdateFailed'), 'error');
      }
      onSent?.();
      onOpenChange(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : t('companies.emailDialog.errors.sendFailed');
      setError(msg);
      showToast(msg, 'error');
    } finally {
      setSending(false);
    }
  };

  const handleSaveDraft = () => {
    if (!company) return;
    const draft: EmailDraft = {
      purpose,
      customPurpose,
      recipientName,
      subject,
      body,
      selectedResumeId,
      instruction,
      savedAt: new Date().toISOString(),
    };
    saveDraft(company.company_id, draft);
    showToast(t('companies.emailDialog.draftSaved'), 'success');
  };

  const clearAttachment = () => {
    setAttachment(null);
    setAttachmentName('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[640px] rounded-2xl p-0 gap-0 overflow-hidden max-h-[90vh] flex flex-col">
        <DialogHeader className="p-6 pb-4 border-b border-[#e6e3dc]">
          <DialogTitle className="flex items-center gap-2 font-sans text-xl font-bold uppercase tracking-tight">
            <Mail className="h-5 w-5 text-primary" />
            {t('companies.emailDialog.title')}
          </DialogTitle>
          <DialogDescription className="mt-2 text-xs text-ink-soft">
            {company?.name
              ? t('companies.emailDialog.toCompany', { name: company.name })
              : t('companies.emailDialog.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          <div className="rounded-2xl border border-[#e6e3dc] bg-white">
            <div className="flex items-center justify-between border-b border-[#e6e3dc] px-4 py-3">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
                <History className="h-4 w-4 text-primary" />
                {t('companies.emailDialog.historyTitle')}
                {history.length > 0 && (
                  <span className="text-xs font-normal text-steel-grey">
                    ({history.length})
                  </span>
                )}
              </h3>
            </div>
            {historyLoading ? (
              <div className="flex items-center justify-center gap-2 py-6 text-xs text-steel-grey">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {t('companies.emailDialog.loading')}
              </div>
            ) : history.length === 0 ? (
              <p className="px-4 py-6 text-xs text-steel-grey">
                {t('companies.emailDialog.historyEmpty')}
              </p>
            ) : (
              <ul className="divide-y divide-[#e6e3dc]">
                {history.map((entry) => (
                  <li key={entry.log_id}>
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedLogId(expandedLogId === entry.log_id ? null : entry.log_id)
                      }
                      className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left transition-colors hover:bg-paper-tint"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-xs font-semibold text-ink">
                          {entry.subject}
                        </span>
                        <span className="block truncate text-[11px] text-steel-grey">
                          {formatSentAt(entry.sent_at)}
                          {entry.attachments.length > 0 && (
                            <>
                              {' · '}
                              {entry.attachments.map((a) => a.name).join(', ')}
                            </>
                          )}
                        </span>
                      </span>
                      <ChevronDown
                        className={cn(
                          'h-4 w-4 shrink-0 text-steel-grey transition-transform',
                          expandedLogId === entry.log_id && 'rotate-180'
                        )}
                      />
                    </button>
                    {expandedLogId === entry.log_id && (
                      <div className="px-4 pb-3">
                        <p className="whitespace-pre-wrap rounded-lg bg-paper-tint p-3 text-xs text-ink">
                          {entry.body}
                        </p>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {!emailConfigLoaded && (
            <div className="flex items-center justify-center gap-3 py-8 text-sm text-steel-grey">
              <Loader2 className="w-4 h-4 animate-spin" />
              {t('companies.emailDialog.loading')}
            </div>
          )}

          {emailConfigLoaded && !senderConfigured && (
            <div className="rounded-2xl border border-amber-200 bg-[#fbf6e9] p-4 space-y-2">
              <p className="text-sm font-semibold text-amber-800">
                {t('companies.emailDialog.notConfigured')}
              </p>
              <p className="text-xs text-amber-700">
                {t('companies.emailDialog.notConfiguredHint')}
              </p>
              <Link
                href="/settings?section=email"
                className="inline-flex items-center rounded-full bg-amber-800 px-4 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-amber-900"
              >
                {t('companies.emailDialog.goToSettings')}
              </Link>
            </div>
          )}

          {emailConfigLoaded && senderConfigured && (
            <>
              <div className="space-y-2">
                <Label className="text-xs uppercase tracking-wider text-ink-soft">
                  {t('companies.emailDialog.resume')}
                </Label>
                <Dropdown
                  options={resumes.map((r) => ({
                    id: r.resume_id,
                    label:
                      r.title ||
                      r.filename ||
                      t('companies.emailDialog.resumeUntitled'),
                    description: r.is_master
                      ? t('dashboard.masterResume')
                      : undefined,
                  }))}
                  value={selectedResumeId}
                  onChange={setSelectedResumeId}
                  disabled={resumesLoading || resumes.length === 0}
                  className="w-full"
                />
                <p className="text-xs text-steel-grey">
                  {t('companies.emailDialog.resumeHint')}
                </p>
              </div>

              <div className="space-y-2">
                <Label className="text-xs uppercase tracking-wider text-ink-soft">
                  {t('companies.emailDialog.purpose.label')}
                </Label>
                <div className="flex flex-wrap gap-2">
                  {PURPOSE_OPTIONS.map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setPurpose(opt.id)}
                      className={cn(
                        'rounded-full border px-4 py-1.5 text-xs font-medium transition-colors',
                        purpose === opt.id
                          ? 'border-primary bg-primary text-white'
                          : 'border-[#e6e3dc] bg-white text-ink-soft hover:border-primary hover:text-primary'
                      )}
                    >
                      {t(opt.labelKey)}
                    </button>
                  ))}
                </div>
              </div>

              {purpose === 'custom' && (
                <div className="space-y-2">
                  <Label className="text-xs uppercase tracking-wider text-ink-soft">
                    {t('companies.emailDialog.purpose.customSubject')}
                  </Label>
                  <Textarea
                    value={customPurpose}
                    onChange={(e) => setCustomPurpose(e.target.value)}
                    placeholder={t('companies.emailDialog.purpose.customPlaceholder')}
                    className="min-h-[60px] rounded-lg border-ink bg-white focus-visible:border-primary"
                  />
                </div>
              )}

              <div className="space-y-2">
                <Label className="text-xs uppercase tracking-wider text-ink-soft">
                  {t('companies.emailDialog.recipientName')}
                  <span className="ml-1 normal-case text-steel-grey">
                    ({t('common.optional')})
                  </span>
                </Label>
                <Input
                  value={recipientName}
                  onChange={(e) => setRecipientName(e.target.value)}
                  placeholder={t('companies.emailDialog.recipientPlaceholder')}
                  className="rounded-lg border-ink bg-white focus-visible:border-primary"
                />
              </div>

              <div className="space-y-2">
                <Label className="text-xs uppercase tracking-wider text-ink-soft">
                  {t('companies.emailDialog.subject')}
                </Label>
                <div className="flex gap-2">
                  <Input
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    placeholder={t('companies.emailDialog.subjectPlaceholder')}
                    className="rounded-lg border-ink bg-white focus-visible:border-primary"
                  />
                  <Button
                    variant="outline"
                    onClick={handleGenerate}
                    disabled={generating || !company?.name}
                    className="shrink-0 rounded-lg border-primary text-primary hover:bg-primary hover:text-white"
                  >
                    {generating ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    ) : (
                      <Sparkles className="h-4 w-4 mr-2" />
                    )}
                    {t('companies.emailDialog.generate')}
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <Label className="text-xs uppercase tracking-wider text-ink-soft">
                  {t('companies.emailDialog.message')}
                </Label>
                <Textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder={t('companies.emailDialog.messagePlaceholder')}
                  className="min-h-[160px] rounded-lg border-ink bg-white focus-visible:border-primary"
                />
              </div>

              <div className="space-y-2">
                <Label className="text-xs uppercase tracking-wider text-ink-soft">
                  {t('companies.emailDialog.additionalInstructions')}
                  <span className="ml-1 normal-case text-steel-grey">
                    ({t('common.optional')})
                  </span>
                </Label>
                <Textarea
                  value={instruction}
                  onChange={(e) => setInstruction(e.target.value)}
                  placeholder={t('companies.emailDialog.additionalInstructionsPlaceholder')}
                  className="min-h-[60px] rounded-lg border-ink bg-white focus-visible:border-primary"
                />
              </div>

              <div className="space-y-2">
                <Label className="text-xs uppercase tracking-wider text-ink-soft">
                  {t('companies.emailDialog.attachment')}
                  <span className="ml-1 normal-case text-steel-grey">
                    ({t('common.optional')})
                  </span>
                </Label>
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    setAttachment(file ?? null);
                    setAttachmentName(file?.name ?? '');
                  }}
                />
                {attachmentName ? (
                  <div className="flex items-center justify-between rounded-lg border border-[#e6e3dc] bg-paper-tint px-3 py-2">
                    <span className="flex items-center gap-2 truncate text-sm text-ink">
                      <Paperclip className="h-4 w-4 shrink-0 text-ink-soft" />
                      <span className="truncate">{attachmentName}</span>
                    </span>
                    <button
                      type="button"
                      onClick={clearAttachment}
                      aria-label={t('companies.emailDialog.removeAttachment')}
                      className="flex h-6 w-6 items-center justify-center rounded-md text-ink-soft hover:text-destructive"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                ) : (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full rounded-lg border-dashed border-[#c9c5bc] text-steel-grey hover:border-primary hover:text-primary"
                  >
                    <Paperclip className="h-4 w-4 mr-2" />
                    {t('companies.emailDialog.chooseFile')}
                  </Button>
                )}
              </div>
              <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-[#e6e3dc] bg-paper-tint px-3 py-2">
                <span className="flex min-w-0 items-center gap-2 text-sm text-ink">
                  <FileText className="h-4 w-4 shrink-0 text-primary" />
                  <span className="truncate">
                    {t('companies.emailDialog.includeResume')}
                  </span>
                  {includeResume && (
                    <span className="truncate text-xs text-steel-grey">
                      {senderName || 'Resume'} - Resume.pdf
                    </span>
                  )}
                </span>
                <input
                  type="checkbox"
                  checked={includeResume}
                  onChange={(e) => setIncludeResume(e.target.checked)}
                  className="h-4 w-4 shrink-0 cursor-pointer accent-primary"
                />
              </label>

              {error && (
                <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  {error}
                </p>
              )}

              {success && (
                <p className="rounded-lg bg-emerald-100 px-3 py-2 text-xs font-semibold text-emerald-700">
                  {t('companies.emailDialog.sent')}
                </p>
              )}
            </>
          )}
        </div>

        <DialogFooter className="flex-row justify-between gap-3 border-t border-[#e6e3dc] bg-secondary p-4">
          <div className="flex-1" />
          {emailConfigLoaded && senderConfigured && (
            <>
              <Button
                type="button"
                variant="outline"
                onClick={handleSaveDraft}
                disabled={sending}
                className="rounded-full text-xs"
              >
                <Save className="h-4 w-4 mr-1.5" />
                {t('companies.emailDialog.saveDraft')}
              </Button>
              <Button
                onClick={handleSend}
                disabled={sending || !company?.email}
                className="rounded-full bg-primary text-white hover:bg-primary/90"
              >
                {sending ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Send className="h-4 w-4 mr-2" />
                )}
                {t('companies.emailDialog.send')}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}