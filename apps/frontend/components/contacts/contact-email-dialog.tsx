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
import { FileText, Loader2, Mail, Paperclip, Save, Send, Sparkles, X } from 'lucide-react';
import type { Contact } from '@/lib/api/contacts';
import { updateContact } from '@/lib/api/contacts';
import {
  fetchEmailConfig,
  generateOutreachEmail,
  sendCompanyEmail,
  type OutreachPurpose,
} from '@/lib/api/email';
import {
  fetchResumeList,
  fetchResume,
  downloadResumePdf,
  type ResumeListItem,
} from '@/lib/api/resume';
import { normalizeTemplateSettings, type TemplateSettings } from '@/lib/types/template-settings';
import { Dropdown } from '@/components/ui/dropdown';
import { useToast } from '@/components/ui/toast';
import { useTranslations } from '@/lib/i18n';
import { useLanguage } from '@/lib/context/language-context';
import { cn } from '@/lib/utils';
import { MarkdownToolbar } from '@/components/common/markdown-toolbar';

interface ContactEmailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contact: Contact | null;
  onSent?: () => void;
}

const PURPOSE_OPTIONS: { id: OutreachPurpose; labelKey: string }[] = [
  { id: 'internship', labelKey: 'companies.emailDialog.purpose.internship' },
  { id: 'job', labelKey: 'companies.emailDialog.purpose.job' },
  { id: 'cold', labelKey: 'companies.emailDialog.purpose.cold' },
  { id: 'custom', labelKey: 'companies.emailDialog.purpose.custom' },
];

function draftKey(contactId: string): string {
  return `contact-email-draft:${contactId}`;
}

interface ContactEmailDraft {
  purpose: OutreachPurpose;
  customPurpose: string;
  recipientName: string;
  subject: string;
  body: string;
  selectedResumeId: string;
  instruction: string;
}

function loadDraft(contactId: string): ContactEmailDraft | null {
  try {
    const raw = window.localStorage.getItem(draftKey(contactId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ContactEmailDraft;
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveDraft(contactId: string, draft: ContactEmailDraft): void {
  try {
    window.localStorage.setItem(draftKey(contactId), JSON.stringify(draft));
  } catch {
    // Storage full or private mode — drafts are best-effort.
  }
}

function clearDraft(contactId: string): void {
  try {
    window.localStorage.removeItem(draftKey(contactId));
  } catch {
    // Ignore — nothing to do.
  }
}

export function ContactEmailDialog({
  open,
  onOpenChange,
  contact,
  onSent,
}: ContactEmailDialogProps) {
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
  const bodyTextareaRef = useRef<HTMLTextAreaElement>(null);

  const [resumes, setResumes] = useState<ResumeListItem[]>([]);
  const [selectedResumeId, setSelectedResumeId] = useState('');
  const [resumesLoading, setResumesLoading] = useState(false);

  const [emailConfigLoaded, setEmailConfigLoaded] = useState(false);
  const [senderConfigured, setSenderConfigured] = useState(false);
  const [senderName, setSenderName] = useState('');

  const [generating, setGenerating] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [regenTarget, setRegenTarget] = useState<'both' | 'subject' | 'body'>('both');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [instruction, setInstruction] = useState('');
  const [includeResume, setIncludeResume] = useState(true);

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
    setRegenerating(false);
    setRegenTarget('both');
    setSending(false);
  }, []);

  useEffect(() => {
    if (open) {
      reset();
      setEmailConfigLoaded(false);
      fetchEmailConfig()
        .then((cfg) => {
          setSenderName(cfg.sender_name ?? '');
          setSenderConfigured(Boolean(cfg.smtp_host && cfg.sender_email && cfg.has_password));
        })
        .catch(() => {
          setSenderName('');
          setSenderConfigured(false);
        })
        .finally(() => setEmailConfigLoaded(true));
    }
  }, [open, reset]);

  useEffect(() => {
    if (!open || !contact) return;
    const draft = loadDraft(contact.contact_id);
    if (!draft) return;
    if (PURPOSE_OPTIONS.some((p) => p.id === draft.purpose)) {
      setPurpose(draft.purpose);
    }
    setCustomPurpose(draft.customPurpose ?? '');
    setRecipientName(draft.recipientName ?? '');
    setSubject(draft.subject ?? '');
    setBody(draft.body ?? '');
    setInstruction(draft.instruction ?? '');
    if (draft.selectedResumeId) setSelectedResumeId(draft.selectedResumeId);
  }, [open, contact]);

  useEffect(() => {
    if (!open || !contact) return;
    setResumesLoading(true);
    fetchResumeList(true)
      .then((list) => {
        const ready = list.filter((r) => r.processing_status === 'ready');
        ready.sort((a, b) => {
          if (a.is_master !== b.is_master) return a.is_master ? -1 : 1;
          return (b.updated_at ?? '').localeCompare(a.updated_at ?? '');
        });
        setResumes(ready);
        const master = ready.find((r) => r.is_master);
        setSelectedResumeId((prev) => {
          if (prev && ready.some((r) => r.resume_id === prev)) return prev;
          return master?.resume_id ?? ready[0]?.resume_id ?? '';
        });
      })
      .catch(() => {
        setResumes([]);
        setSelectedResumeId('');
      })
      .finally(() => setResumesLoading(false));
  }, [open, contact]);

  const handleGenerate = async () => {
    if (!contact || generating) return;
    setGenerating(true);
    setError(null);
    try {
      const companyContext = contact.company?.trim() || contact.name;
      const result = await generateOutreachEmail({
        company_name: companyContext,
        company_email: contact.email ?? '',
        industry: null,
        company_size: null,
        company_type: null,
        website: null,
        linkedin_url: null,
        recipient_name: recipientName.trim() || contact.name || null,
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

  const handleRegenerate = async () => {
    if (!contact || regenerating) return;
    setRegenerating(true);
    setError(null);
    try {
      const targetLabel =
        regenTarget === 'subject'
          ? 'SUBJECT LINE'
          : regenTarget === 'body'
            ? 'EMAIL BODY'
            : 'SUBJECT LINE and EMAIL BODY';
      const baseInstruction =
        instruction.trim() ||
        `Regenerate the ${targetLabel.toLowerCase()} with a different approach`;
      const fullInstruction = `Only regenerate the ${targetLabel}. ${baseInstruction}`;

      const companyContext = contact.company?.trim() || contact.name;
      const result = await generateOutreachEmail({
        company_name: companyContext,
        company_email: contact.email ?? '',
        industry: null,
        company_size: null,
        company_type: null,
        website: null,
        linkedin_url: null,
        recipient_name: recipientName.trim() || contact.name || null,
        purpose,
        custom_purpose: purpose === 'custom' ? customPurpose.trim() : undefined,
        output_language: contentLanguage,
        resume_id: selectedResumeId || null,
        instruction: fullInstruction,
      });
      if (regenTarget !== 'body' && result.subject) setSubject(result.subject);
      if (regenTarget !== 'subject' && result.body) setBody(result.body);
    } catch {
      setError(t('companies.emailDialog.errors.generateFailed'));
    } finally {
      setRegenerating(false);
    }
  };

  const handleSend = async () => {
    if (!contact || sending) return;
    const target = contact.email?.trim();
    if (!target) {
      const msg = t('contacts.emailDialog.noEmail');
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
      form.append('company_name', contact.company?.trim() || contact.name || '');
      form.append('company_id', '');
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
            const personalName = resumeData.processed_resume?.personalInfo?.name?.trim();
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
      clearDraft(contact.contact_id);
      try {
        await updateContact(contact.contact_id, { status: 'contacted' });
        showToast(t('contacts.emailDialog.statusUpdated'), 'success');
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
    if (!contact) return;
    const draft: ContactEmailDraft = {
      purpose,
      customPurpose,
      recipientName,
      subject,
      body,
      selectedResumeId,
      instruction,
    };
    saveDraft(contact.contact_id, draft);
    showToast(t('companies.emailDialog.draftSaved'), 'success');
  };

  const clearAttachment = () => {
    setAttachment(null);
    setAttachmentName('');
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] flex flex-col rounded-2xl p-0 gap-0 overflow-hidden sm:max-w-[640px]">
        <DialogHeader className="border-b border-[#e6e3dc] p-6 pb-4">
          <DialogTitle className="flex items-center gap-2 font-sans text-xl font-bold uppercase tracking-tight">
            <Mail className="h-5 w-5 text-primary" />
            {t('contacts.emailDialog.title')}
          </DialogTitle>
          <DialogDescription className="mt-2 text-xs text-ink-soft">
            {contact?.name
              ? t('contacts.emailDialog.toContact', { name: contact.name })
              : t('contacts.emailDialog.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 space-y-6 overflow-y-auto p-6">
          {!emailConfigLoaded && (
            <div className="flex items-center justify-center gap-3 py-8 text-sm text-steel-grey">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t('companies.emailDialog.loading')}
            </div>
          )}

          {emailConfigLoaded && !senderConfigured && (
            <div className="space-y-2 rounded-2xl border border-amber-200 bg-[#fbf6e9] p-4">
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
                    label: r.title || r.filename || t('companies.emailDialog.resumeUntitled'),
                    description: r.is_master ? t('dashboard.masterResume') : undefined,
                  }))}
                  value={selectedResumeId}
                  onChange={setSelectedResumeId}
                  disabled={resumesLoading || resumes.length === 0}
                  className="w-full"
                />
                <p className="text-xs text-steel-grey">{t('companies.emailDialog.resumeHint')}</p>
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
                  {t('contacts.emailDialog.recipientEmail')}
                </Label>
                <Input
                  value={contact?.email ?? ''}
                  disabled
                  className="rounded-lg border-ink bg-paper-tint text-ink focus-visible:border-primary"
                />
              </div>

              <div className="space-y-2">
                <Label className="text-xs uppercase tracking-wider text-ink-soft">
                  {t('companies.emailDialog.recipientName')}
                </Label>
                <Input
                  value={recipientName || contact?.name || ''}
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
                    disabled={generating || regenerating}
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
                <div className="flex items-center justify-between">
                  <Label className="text-xs uppercase tracking-wider text-ink-soft">
                    {t('companies.emailDialog.message')}
                  </Label>
                  <MarkdownToolbar textareaRef={bodyTextareaRef} value={body} onChange={setBody} />
                </div>
                <Textarea
                  ref={bodyTextareaRef}
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder={t('companies.emailDialog.messagePlaceholder')}
                  className="min-h-[160px] rounded-lg border-ink bg-white focus-visible:border-primary"
                />
              </div>

              {/* Regenerate section — visible after first generation */}
              {(subject || body) && (
                <div className="rounded-xl border border-[#e6e3dc] bg-paper-tint p-3 space-y-2">
                  <Label className="text-[10px] uppercase tracking-wider text-ink-soft">
                    {t('companies.bulkEmail.regenTarget')}
                  </Label>
                  <div className="flex gap-1.5">
                    {(
                      [
                        { id: 'both', labelKey: 'companies.bulkEmail.regenBoth' },
                        { id: 'subject', labelKey: 'companies.bulkEmail.regenSubject' },
                        { id: 'body', labelKey: 'companies.bulkEmail.regenBody' },
                      ] as const
                    ).map((opt) => (
                      <button
                        key={opt.id}
                        type="button"
                        onClick={() => setRegenTarget(opt.id)}
                        className={cn(
                          'rounded-full border px-3 py-1 text-[10px] font-medium transition-colors',
                          regenTarget === opt.id
                            ? 'border-primary bg-primary text-white'
                            : 'border-[#e6e3dc] bg-white text-ink-soft hover:border-primary hover:text-primary'
                        )}
                      >
                        {t(opt.labelKey)}
                      </button>
                    ))}
                  </div>
                  <div className="flex gap-2">
                    <Input
                      value={instruction}
                      onChange={(e) => setInstruction(e.target.value)}
                      placeholder={t('companies.bulkEmail.regenPlaceholder')}
                      disabled={regenerating}
                      className="rounded-lg border-ink bg-white focus-visible:border-primary"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                          e.preventDefault();
                          handleRegenerate();
                        }
                      }}
                    />
                    <Button
                      variant="outline"
                      onClick={handleRegenerate}
                      disabled={regenerating || generating}
                      className="shrink-0 rounded-lg border-primary text-primary hover:bg-primary hover:text-white"
                    >
                      {regenerating ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      ) : (
                        <Sparkles className="h-4 w-4 mr-2" />
                      )}
                      {t('companies.bulkEmail.regen')}
                    </Button>
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <Label className="text-xs uppercase tracking-wider text-ink-soft">
                  {t('companies.emailDialog.attachment')}
                  <span className="ml-1 normal-case text-steel-grey">({t('common.optional')})</span>
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
                  <span className="truncate">{t('companies.emailDialog.includeResume')}</span>
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
                disabled={sending || !contact?.email}
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
