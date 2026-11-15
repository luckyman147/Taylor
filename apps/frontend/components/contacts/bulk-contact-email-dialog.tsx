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
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Loader2, Mail, RotateCw, Send, Sparkles, UserRound, Users, X } from 'lucide-react';
import { updateContact, type Contact } from '@/lib/api/contacts';
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
import {
  applyGreeting,
  composeSharedInstruction,
  summarizeNames,
  GREETING_TOKEN,
  type EmailMode,
} from '@/lib/email/shared-outreach';

type Step = 'configure' | 'generating' | 'preview' | 'sending' | 'done';

interface BulkContactEmailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contacts: Contact[];
  onSent?: () => void;
}

interface ContactEmailGenResult {
  contactId: string;
  result: { subject: string; body: string } | null;
  status: 'pending' | 'loading' | 'done' | 'error';
}

const PURPOSE_OPTIONS: { id: OutreachPurpose; labelKey: string }[] = [
  { id: 'internship', labelKey: 'companies.emailDialog.purpose.internship' },
  { id: 'job', labelKey: 'companies.emailDialog.purpose.job' },
  { id: 'cold', labelKey: 'companies.emailDialog.purpose.cold' },
  { id: 'custom', labelKey: 'companies.emailDialog.purpose.custom' },
];

export function BulkContactEmailDialog({
  open,
  onOpenChange,
  contacts,
  onSent,
}: BulkContactEmailDialogProps) {
  const { t } = useTranslations();
  const { contentLanguage } = useLanguage();
  const { showToast } = useToast();

  // Configure step
  const [purpose, setPurpose] = useState<OutreachPurpose>('internship');
  const [customPurpose, setCustomPurpose] = useState('');
  const [instruction, setInstruction] = useState('');
  const [includeResume, setIncludeResume] = useState(true);
  const [selectedResumeId, setSelectedResumeId] = useState('');
  const [resumes, setResumes] = useState<ResumeListItem[]>([]);
  const [resumesLoading, setResumesLoading] = useState(false);

  // Email config
  const [senderConfigured, setSenderConfigured] = useState(false);
  const [emailConfigLoaded, setEmailConfigLoaded] = useState(false);
  const [senderName, setSenderName] = useState('');

  // Step tracking
  const [step, setStep] = useState<Step>('configure');

  // Generation state
  const [genState, setGenState] = useState<ContactEmailGenResult[]>([]);

  // Preview editing
  const [edits, setEdits] = useState<Record<string, { subject: string; body: string }>>({});
  const [skipIds, setSkipIds] = useState<Set<string>>(new Set());

  // Sending state
  const [sendProgress, setSendProgress] = useState({ sent: 0, total: 0 });
  const [sendResults, setSendResults] = useState<
    Record<string, { success: boolean; error?: string }>
  >({});

  // Shared ("one email for all") mode
  const [mode, setMode] = useState<EmailMode>('personalized');
  const [personalizeGreeting, setPersonalizeGreeting] = useState(true);
  const [sharedDraft, setSharedDraft] = useState<{ subject: string; body: string } | null>(null);
  const [sharedError, setSharedError] = useState<string | null>(null);
  const [sharedRegenOpen, setSharedRegenOpen] = useState(false);
  const [sharedRegenerating, setSharedRegenerating] = useState(false);
  const [regenInstruction, setRegenInstruction] = useState('');
  const [regenTarget, setRegenTarget] = useState<'both' | 'subject' | 'body'>('both');

  // Refs for body textareas (for markdown toolbar)
  const bodyTextareaRefs = useRef<Map<string, HTMLTextAreaElement>>(new Map());
  const abortRef = useRef(false);

  // Reset on open
  useEffect(() => {
    if (open) {
      setStep('configure');
      setPurpose('internship');
      setCustomPurpose('');
      setInstruction('');
      setIncludeResume(true);
      setGenState([]);
      setEdits({});
      setSkipIds(new Set());
      setSendProgress({ sent: 0, total: 0 });
      setSendResults({});
      setMode('personalized');
      setPersonalizeGreeting(true);
      setSharedDraft(null);
      setSharedError(null);
      setSharedRegenOpen(false);
      setSharedRegenerating(false);
      setRegenInstruction('');
      setRegenTarget('both');
      abortRef.current = false;
    }
  }, [open]);

  // Load email config
  useEffect(() => {
    if (!open) return;
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
  }, [open]);

  // Load resumes
  useEffect(() => {
    if (!open) return;
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
        setSelectedResumeId(master?.resume_id ?? ready[0]?.resume_id ?? '');
      })
      .catch(() => {
        setResumes([]);
        setSelectedResumeId('');
      })
      .finally(() => setResumesLoading(false));
  }, [open]);

  // ---- Shared mode: generate one email for all recipients ----
  const generateSharedDraft = useCallback(
    async (options?: { extraInstruction?: string; target?: 'both' | 'subject' | 'body' }) => {
      const target = options?.target ?? 'both';
      const names = contacts.map((c) => c.company?.trim() || c.name).filter(Boolean);
      setSharedError(null);
      if (options?.extraInstruction) {
        setSharedRegenerating(true);
      } else {
        setStep('generating');
      }

      const userParts = [
        instruction.trim() || null,
        options?.extraInstruction?.trim() || null,
      ].filter((p): p is string => Boolean(p));

      try {
        const genResult = await generateOutreachEmail({
          company_name: summarizeNames(names) || 'multiple contacts',
          company_email: '',
          industry: null,
          company_size: null,
          company_type: null,
          website: null,
          linkedin_url: null,
          purpose,
          custom_purpose: purpose === 'custom' ? customPurpose.trim() : undefined,
          output_language: contentLanguage,
          resume_id: selectedResumeId || null,
          instruction: composeSharedInstruction({
            recipientNames: names,
            userInstruction: userParts.join('\n') || null,
            personalizeGreeting,
          }),
        });

        setSharedDraft((prev) => {
          const base = prev ?? { subject: '', body: '' };
          return {
            subject: target === 'body' ? base.subject : genResult.subject,
            body: target === 'subject' ? base.body : genResult.body,
          };
        });
        setStep('preview');
      } catch {
        setSharedError(
          options?.extraInstruction
            ? t('companies.bulkEmail.sharedRegenFailed')
            : t('companies.bulkEmail.sharedGenerateFailed')
        );
        // Still advance so the user sees the error and can retry from preview
        setStep('preview');
      } finally {
        setSharedRegenerating(false);
        setSharedRegenOpen(false);
        setRegenInstruction('');
        setRegenTarget('both');
      }
    },
    [
      contacts,
      purpose,
      customPurpose,
      instruction,
      personalizeGreeting,
      selectedResumeId,
      contentLanguage,
      t,
    ]
  );

  const handleSharedRegenerate = useCallback(async () => {
    if (!sharedDraft) return;
    const targetLabel =
      regenTarget === 'subject'
        ? 'SUBJECT LINE'
        : regenTarget === 'body'
          ? 'EMAIL BODY'
          : 'SUBJECT LINE and EMAIL BODY';
    const baseInstruction = regenInstruction.trim()
      ? regenInstruction.trim()
      : `Regenerate the ${targetLabel.toLowerCase()} with a different approach`;
    await generateSharedDraft({
      extraInstruction: `Only regenerate the ${targetLabel}. ${baseInstruction}`,
      target: regenTarget,
    });
  }, [sharedDraft, regenInstruction, regenTarget, generateSharedDraft]);

  // ---- Step 2: Generate emails ----
  const runGeneration = useCallback(async () => {
    if (mode === 'shared') {
      await generateSharedDraft();
      return;
    }
    setStep('generating');
    const initial: ContactEmailGenResult[] = contacts.map((c) => ({
      contactId: c.contact_id,
      result: null,
      status: 'pending' as const,
    }));
    setGenState(initial);

    const results: ContactEmailGenResult[] = [];

    for (let i = 0; i < contacts.length; i++) {
      if (abortRef.current) break;
      const contact = contacts[i];

      // Skip contacts without email
      if (!contact.email) {
        results.push({
          contactId: contact.contact_id,
          result: null,
          status: 'error',
        });
        setGenState((prev) =>
          prev.map((g) =>
            g.contactId === contact.contact_id ? { ...g, result: null, status: 'error' } : g
          )
        );
        continue;
      }

      setGenState((prev) =>
        prev.map((g) => (g.contactId === contact.contact_id ? { ...g, status: 'loading' } : g))
      );

      try {
        const companyContext = contact.company?.trim() || contact.name;
        const genResult = await generateOutreachEmail({
          company_name: companyContext,
          company_email: contact.email ?? '',
          industry: null,
          company_size: null,
          company_type: null,
          website: null,
          linkedin_url: null,
          recipient_name: contact.name || null,
          purpose,
          custom_purpose: purpose === 'custom' ? customPurpose.trim() : undefined,
          output_language: contentLanguage,
          resume_id: selectedResumeId || null,
          instruction: instruction.trim() || null,
        });

        const emailResult = {
          contactId: contact.contact_id,
          result: { subject: genResult.subject, body: genResult.body },
          status: 'done' as const,
        };
        results.push(emailResult);
        setGenState((prev) =>
          prev.map((g) => (g.contactId === contact.contact_id ? emailResult : g))
        );
      } catch {
        const errResult: ContactEmailGenResult = {
          contactId: contact.contact_id,
          result: null,
          status: 'error',
        };
        results.push(errResult);
        setGenState((prev) =>
          prev.map((g) => (g.contactId === contact.contact_id ? errResult : g))
        );
      }
    }

    // Pre-fill edits
    const editsMap: Record<string, { subject: string; body: string }> = {};
    results.forEach((r) => {
      if (r.result) {
        editsMap[r.contactId] = { subject: r.result.subject, body: r.result.body };
      }
    });
    setEdits(editsMap);

    // Auto-skip contacts without email / generation failures
    const skipSet = new Set(results.filter((r) => r.status === 'error').map((r) => r.contactId));
    setSkipIds(skipSet);

    setStep('preview');
  }, [
    contacts,
    purpose,
    customPurpose,
    instruction,
    selectedResumeId,
    contentLanguage,
    mode,
    generateSharedDraft,
  ]);

  // ---- Step 4: Send all ----
  const runSendAll = useCallback(async () => {
    setStep('sending');
    const toSend =
      mode === 'shared'
        ? contacts.filter((c) => Boolean(c.email) && sharedDraft)
        : contacts.filter((c) => !skipIds.has(c.contact_id) && edits[c.contact_id]);
    setSendProgress({ sent: 0, total: toSend.length });

    let resumePdf: Blob | null = null;
    let resumePdfName = `${senderName || 'Resume'} - Resume.pdf`;

    if (includeResume && selectedResumeId) {
      try {
        let settings: TemplateSettings | undefined;
        let fullName = senderName;
        const resumeData = await fetchResume(selectedResumeId);
        const personalName = resumeData.processed_resume?.personalInfo?.name?.trim();
        if (personalName) fullName = personalName;
        resumePdfName = `${fullName || 'Resume'} - Resume.pdf`;
        if (resumeData.template_settings) {
          settings = normalizeTemplateSettings(
            resumeData.template_settings as Partial<TemplateSettings>
          );
        }
        resumePdf = await downloadResumePdf(selectedResumeId, settings, contentLanguage);
      } catch {
        resumePdf = null;
      }
    }

    const results: Record<string, { success: boolean; error?: string }> = {};

    for (let i = 0; i < toSend.length; i++) {
      if (abortRef.current) break;
      const contact = toSend[i];
      const subject =
        mode === 'shared'
          ? (sharedDraft?.subject ?? '')
          : (edits[contact.contact_id]?.subject.trim() ?? '');
      const rawBody =
        mode === 'shared' ? (sharedDraft?.body ?? '') : (edits[contact.contact_id]?.body ?? '');
      if (!subject || !rawBody) continue;
      const body =
        mode === 'shared' && personalizeGreeting
          ? applyGreeting(rawBody, contact.name)
          : applyGreeting(rawBody, null);

      try {
        const form = new FormData();
        form.append('company_email', contact.email ?? '');
        form.append('company_name', contact.company?.trim() || contact.name || '');
        form.append('company_id', '');
        form.append('subject', subject);
        form.append('body', body);
        form.append('contact_id', contact.contact_id);
        form.append('purpose', purpose);
        form.append('email_mode', mode);
        if (resumePdf) {
          form.append('attachments', resumePdf, resumePdfName);
        }
        await sendCompanyEmail(form);
        results[contact.contact_id] = { success: true };
        await updateContact(contact.contact_id, { status: 'contacted' });
      } catch (e) {
        results[contact.contact_id] = {
          success: false,
          error: e instanceof Error ? e.message : 'Send failed',
        };
      }

      setSendProgress({ sent: i + 1, total: toSend.length });
      setSendResults({ ...results });
    }

    setStep('done');
    onSent?.();
  }, [
    contacts,
    skipIds,
    edits,
    includeResume,
    selectedResumeId,
    senderName,
    contentLanguage,
    onSent,
    mode,
    purpose,
    sharedDraft,
    personalizeGreeting,
  ]);

  const editBody = (contactId: string, value: string) => {
    setEdits((prev) => ({
      ...prev,
      [contactId]: { ...prev[contactId], body: value },
    }));
  };

  const editSubject = (contactId: string, value: string) => {
    setEdits((prev) => ({
      ...prev,
      [contactId]: { ...prev[contactId], subject: value },
    }));
  };

  const toggleSkip = (contactId: string) => {
    setSkipIds((prev) => {
      const next = new Set(prev);
      if (next.has(contactId)) {
        next.delete(contactId);
      } else {
        next.add(contactId);
      }
      return next;
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[92vh] flex flex-col rounded-2xl p-0 gap-0 overflow-hidden sm:max-w-[720px]">
        <DialogHeader className="border-b border-[#e6e3dc] p-6 pb-4">
          <DialogTitle className="flex items-center gap-2 font-sans text-xl font-bold uppercase tracking-tight">
            <Mail className="h-5 w-5 text-primary" />
            {t('contacts.bulkEmail.title')}
          </DialogTitle>
          <DialogDescription className="mt-2 text-xs text-ink-soft">
            {t('contacts.bulkEmail.description', { count: String(contacts.length) })}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-6">
          {/* Configure step */}
          {step === 'configure' && (
            <>
              {!emailConfigLoaded ? (
                <div className="flex items-center justify-center gap-3 py-8 text-sm text-steel-grey">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t('companies.emailDialog.loading')}
                </div>
              ) : !senderConfigured ? (
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
              ) : (
                <>
                  <div className="space-y-2">
                    <Label className="text-xs uppercase tracking-wider text-ink-soft">
                      {t('companies.bulkEmail.modeLabel')}
                    </Label>
                    <div className="grid grid-cols-2 gap-2">
                      {(
                        [
                          {
                            id: 'personalized',
                            labelKey: 'companies.bulkEmail.modePersonalized',
                            Icon: UserRound,
                          },
                          { id: 'shared', labelKey: 'companies.bulkEmail.modeShared', Icon: Users },
                        ] as const
                      ).map((opt) => (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => setMode(opt.id)}
                          className={cn(
                            'flex items-center justify-center gap-2 rounded-lg border px-4 py-2 text-xs font-medium transition-colors',
                            mode === opt.id
                              ? 'border-primary bg-primary text-white'
                              : 'border-[#e6e3dc] bg-white text-ink-soft hover:border-primary hover:text-primary'
                          )}
                        >
                          <opt.Icon className="h-3.5 w-3.5" />
                          {t(opt.labelKey)}
                        </button>
                      ))}
                    </div>
                    <p className="text-xs text-steel-grey">
                      {mode === 'shared'
                        ? t('companies.bulkEmail.modeSharedHint')
                        : t('companies.bulkEmail.modePersonalizedHint')}
                    </p>
                  </div>

                  {mode === 'shared' && (
                    <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-[#e6e3dc] bg-paper-tint px-3 py-2">
                      <span className="flex min-w-0 items-center gap-2 text-sm text-ink">
                        <UserRound className="h-4 w-4 shrink-0 text-primary" />
                        <span className="truncate">
                          {t('companies.bulkEmail.personalizeGreeting')}
                        </span>
                      </span>
                      <input
                        type="checkbox"
                        checked={personalizeGreeting}
                        onChange={(e) => setPersonalizeGreeting(e.target.checked)}
                        className="h-4 w-4 shrink-0 cursor-pointer accent-primary"
                      />
                    </label>
                  )}

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

                  <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-[#e6e3dc] bg-paper-tint px-3 py-2">
                    <span className="flex min-w-0 items-center gap-2 text-sm text-ink">
                      <Users className="h-4 w-4 shrink-0 text-primary" />
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
                </>
              )}
            </>
          )}

          {/* Generating step */}
          {step === 'generating' && (
            <div className="space-y-3">
              <div className="flex items-center justify-center gap-3 py-4 text-sm font-semibold text-ink">
                <Sparkles className="h-4 w-4 text-primary" />
                {mode === 'shared'
                  ? t('companies.bulkEmail.sharedGenerating')
                  : t('contacts.bulkEmail.generating')}
              </div>
              <div className={cn('space-y-2', mode === 'shared' && 'hidden')}>
                {genState.map((g) => {
                  const contact = contacts.find((c) => c.contact_id === g.contactId);
                  return (
                    <div
                      key={g.contactId}
                      className="flex items-center justify-between rounded-lg border border-[#e6e3dc] bg-white px-3 py-2"
                    >
                      <span className="flex min-w-0 items-center gap-2 text-sm text-ink">
                        <UserRound className="h-4 w-4 shrink-0 text-ink-soft" />
                        <span className="truncate">{contact?.name ?? '—'}</span>
                      </span>
                      <span className="shrink-0">
                        {g.status === 'loading' && (
                          <Loader2 className="h-4 w-4 animate-spin text-primary" />
                        )}
                        {g.status === 'pending' && (
                          <span className="h-2 w-2 rounded-full bg-[#e6e3dc]" />
                        )}
                        {g.status === 'done' && (
                          <span className="rounded-md bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                            {t('companies.bulkEmail.done')}
                          </span>
                        )}
                        {g.status === 'error' && (
                          <span className="rounded-md bg-destructive/10 px-2 py-0.5 text-[10px] font-semibold text-destructive">
                            {t('companies.bulkEmail.error')}
                          </span>
                        )}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Preview step */}
          {step === 'preview' && (
            <div className="space-y-3">
              <div className="rounded-lg border border-[#e6e3dc] bg-paper-tint px-3 py-2 text-xs text-ink-soft">
                {mode === 'shared'
                  ? t('companies.bulkEmail.sharedPreviewHint', {
                      count: String(contacts.filter((c) => Boolean(c.email)).length),
                    })
                  : t('contacts.bulkEmail.previewHint')}
              </div>

              {mode === 'shared' && sharedError && (
                <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-200 bg-[#fbf6e9] px-3 py-2">
                  <p className="text-xs text-amber-800">{sharedError}</p>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => generateSharedDraft()}
                    className="shrink-0 rounded-full text-xs"
                  >
                    <RotateCw className="h-3 w-3 mr-1" />
                    {t('companies.bulkEmail.retry')}
                  </Button>
                </div>
              )}

              {mode === 'shared' && !sharedDraft && !sharedError && (
                <div className="flex items-center justify-center rounded-lg border border-[#e6e3dc] bg-white py-8">
                  <Button
                    size="sm"
                    onClick={() => generateSharedDraft()}
                    className="rounded-full bg-primary text-white hover:bg-primary/90"
                  >
                    <Sparkles className="h-3 w-3 mr-1" />
                    {t('companies.bulkEmail.generateShared')}
                  </Button>
                </div>
              )}

              {mode === 'shared' && sharedDraft && (
                <div className="overflow-hidden rounded-xl border border-[#e6e3dc] bg-white">
                  <div className="flex items-center justify-between border-b border-[#e6e3dc] px-4 py-3">
                    <div className="flex min-w-0 items-center gap-2">
                      <Users className="h-4 w-4 shrink-0 text-primary" />
                      <span className="truncate text-sm font-semibold text-ink">
                        {t('companies.bulkEmail.modeShared')}
                      </span>
                    </div>
                    <button
                      type="button"
                      disabled={sharedRegenerating}
                      onClick={() => {
                        setSharedRegenOpen((prev) => !prev);
                        setRegenInstruction('');
                        setRegenTarget('both');
                      }}
                      className="flex shrink-0 items-center gap-1 rounded-full border border-[#e6e3dc] px-2 py-0.5 text-[10px] text-steel-grey hover:border-primary hover:text-primary disabled:opacity-50"
                    >
                      {sharedRegenOpen ? (
                        <X className="h-3 w-3" />
                      ) : (
                        <RotateCw className="h-3 w-3" />
                      )}
                      {t('companies.bulkEmail.regen')}
                    </button>
                  </div>

                  {sharedRegenOpen && (
                    <div className="space-y-2 border-b border-[#e6e3dc] bg-paper-tint px-4 py-3">
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
                      <Label className="text-[10px] uppercase tracking-wider text-ink-soft">
                        {t('companies.bulkEmail.regenInstruction')}
                      </Label>
                      <div className="flex gap-2">
                        <input
                          value={regenInstruction}
                          onChange={(e) => setRegenInstruction(e.target.value)}
                          placeholder={t('companies.bulkEmail.regenPlaceholder')}
                          className="flex-1 rounded-lg border border-ink bg-white px-3 py-1.5 text-sm focus:border-primary focus:outline-none"
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                              e.preventDefault();
                              handleSharedRegenerate();
                            }
                          }}
                          autoFocus
                        />
                        <Button
                          size="sm"
                          onClick={handleSharedRegenerate}
                          className="shrink-0 rounded-lg bg-primary text-white hover:bg-primary/90"
                        >
                          <Sparkles className="h-3 w-3 mr-1" />
                          {t('companies.bulkEmail.regen')}
                        </Button>
                      </div>
                    </div>
                  )}

                  {sharedRegenerating ? (
                    <div className="flex items-center justify-center gap-2 px-4 py-6 text-xs text-steel-grey">
                      <Loader2 className="h-4 w-4 animate-spin text-primary" />
                      {t('companies.bulkEmail.regenenerating')}
                    </div>
                  ) : (
                    <div className="space-y-3 px-4 py-3">
                      <div className="space-y-1">
                        <Label className="text-[10px] uppercase tracking-wider text-ink-soft">
                          {t('companies.emailDialog.subject')}
                        </Label>
                        <input
                          value={sharedDraft.subject}
                          onChange={(e) =>
                            setSharedDraft((prev) =>
                              prev ? { ...prev, subject: e.target.value } : prev
                            )
                          }
                          className="w-full rounded-lg border border-ink bg-white px-3 py-1.5 text-sm focus:border-primary focus:outline-none"
                        />
                      </div>
                      <div className="space-y-1">
                        <div className="flex items-center justify-between">
                          <Label className="text-[10px] uppercase tracking-wider text-ink-soft">
                            {t('companies.emailDialog.message')}
                          </Label>
                          <MarkdownToolbar
                            textareaRef={{
                              get current() {
                                return bodyTextareaRefs.current.get('__shared__') ?? null;
                              },
                            }}
                            value={sharedDraft.body}
                            onChange={(val) =>
                              setSharedDraft((prev) => (prev ? { ...prev, body: val } : prev))
                            }
                          />
                        </div>
                        <Textarea
                          ref={(el) => {
                            if (el) {
                              bodyTextareaRefs.current.set('__shared__', el);
                            } else {
                              bodyTextareaRefs.current.delete('__shared__');
                            }
                          }}
                          value={sharedDraft.body}
                          onChange={(e) =>
                            setSharedDraft((prev) =>
                              prev ? { ...prev, body: e.target.value } : prev
                            )
                          }
                          className="min-h-[100px] rounded-lg border border-ink bg-white text-sm focus-visible:border-primary"
                        />
                      </div>
                      {personalizeGreeting &&
                        sharedDraft.body.includes(GREETING_TOKEN) &&
                        contacts.filter((c) => Boolean(c.email)).length > 0 && (
                          <p className="text-[10px] text-steel-grey">
                            {t('companies.bulkEmail.greetingHint', {
                              example: `Hi ${contacts.find((c) => Boolean(c.email))?.name ?? ''},`,
                            })}
                          </p>
                        )}
                    </div>
                  )}
                </div>
              )}

              {mode === 'personalized' &&
                contacts.map((contact) => {
                  const edit = edits[contact.contact_id];
                  if (!edit) return null;
                  const isSkipped = skipIds.has(contact.contact_id);
                  return (
                    <div
                      key={contact.contact_id}
                      className={cn(
                        'rounded-xl border border-[#e6e3dc] bg-white',
                        isSkipped && 'opacity-60'
                      )}
                    >
                      <div className="flex items-center justify-between gap-2 border-b border-[#e6e3dc] px-4 py-3">
                        <div className="flex min-w-0 items-center gap-2">
                          <UserRound className="h-4 w-4 shrink-0 text-ink-soft" />
                          <span className="truncate text-sm font-semibold text-ink">
                            {contact.name}
                          </span>
                          <span className="truncate text-xs text-steel-grey">
                            {contact.email || t('contacts.bulkEmail.noEmail')}
                          </span>
                        </div>
                        <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-xs text-ink-soft">
                          <input
                            type="checkbox"
                            checked={isSkipped}
                            onChange={() => toggleSkip(contact.contact_id)}
                            className="h-3.5 w-3.5 cursor-pointer accent-primary"
                          />
                          {t('companies.bulkEmail.skip')}
                        </label>
                      </div>
                      {!isSkipped && (
                        <div className="space-y-3 px-4 py-3">
                          <div className="space-y-1">
                            <Label className="text-[10px] uppercase tracking-wider text-ink-soft">
                              {t('companies.emailDialog.subject')}
                            </Label>
                            <input
                              value={edit.subject}
                              onChange={(e) => editSubject(contact.contact_id, e.target.value)}
                              className="w-full rounded-lg border border-ink bg-white px-3 py-1.5 text-sm focus:border-primary focus:outline-none"
                            />
                          </div>
                          <div className="space-y-1">
                            <div className="flex items-center justify-between">
                              <Label className="text-[10px] uppercase tracking-wider text-ink-soft">
                                {t('companies.emailDialog.message')}
                              </Label>
                              <MarkdownToolbar
                                textareaRef={{
                                  get current() {
                                    return bodyTextareaRefs.current.get(contact.contact_id) ?? null;
                                  },
                                }}
                                value={edit.body}
                                onChange={(val) => editBody(contact.contact_id, val)}
                              />
                            </div>
                            <Textarea
                              ref={(el) => {
                                if (el) {
                                  bodyTextareaRefs.current.set(contact.contact_id, el);
                                } else {
                                  bodyTextareaRefs.current.delete(contact.contact_id);
                                }
                              }}
                              value={edit.body}
                              onChange={(e) => editBody(contact.contact_id, e.target.value)}
                              className="min-h-[100px] rounded-lg border border-ink bg-white text-sm focus-visible:border-primary"
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          )}

          {/* Sending step */}
          {step === 'sending' && (
            <div className="space-y-4 py-4">
              <div className="flex items-center justify-center gap-3 text-sm font-semibold text-ink">
                <Send className="h-4 w-4 text-primary" />
                {t('contacts.bulkEmail.sending')}
              </div>
              <div className="mx-auto h-2 w-full max-w-md overflow-hidden rounded-full bg-[#e6e3dc]">
                <div
                  className="h-full bg-primary transition-all duration-300"
                  style={{
                    width:
                      sendProgress.total === 0
                        ? '0%'
                        : `${(sendProgress.sent / sendProgress.total) * 100}%`,
                  }}
                />
              </div>
              <p className="text-center text-xs text-ink-soft">
                {t('contacts.bulkEmail.progress', {
                  sent: String(sendProgress.sent),
                  total: String(sendProgress.total),
                })}
              </p>
            </div>
          )}

          {/* Done step */}
          {step === 'done' && (
            <div className="space-y-3 py-4">
              <div className="flex items-center justify-center gap-2 text-sm font-semibold text-emerald-700">
                <Send className="h-4 w-4" />
                {t('contacts.bulkEmail.done')}
              </div>
              <div className="max-h-48 space-y-2 overflow-y-auto">
                {Object.entries(sendResults).map(([contactId, res]) => {
                  const contact = contacts.find((c) => c.contact_id === contactId);
                  return (
                    <div
                      key={contactId}
                      className="flex items-center justify-between rounded-lg border border-[#e6e3dc] bg-white px-3 py-2 text-xs"
                    >
                      <span className="min-w-0 truncate font-medium text-ink">
                        {contact?.name ?? '—'}
                      </span>
                      <span
                        className={cn(
                          'shrink-0 rounded-md px-2 py-0.5 font-semibold',
                          res.success
                            ? 'bg-emerald-100 text-emerald-700'
                            : 'bg-destructive/10 text-destructive'
                        )}
                      >
                        {res.success
                          ? t('contacts.bulkEmail.sentOk')
                          : (res.error ?? t('companies.bulkEmail.error'))}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="flex-row justify-end gap-3 border-t border-[#e6e3dc] bg-secondary p-4">
          {emailConfigLoaded && senderConfigured && step === 'configure' && (
            <Button
              onClick={runGeneration}
              className="rounded-full bg-primary text-white hover:bg-primary/90"
            >
              <Sparkles className="h-4 w-4 mr-2" />
              {mode === 'shared'
                ? t('companies.bulkEmail.generateShared')
                : t('contacts.bulkEmail.generate')}
            </Button>
          )}
          {step === 'preview' && (
            <>
              <Button
                variant="outline"
                onClick={() => setStep('configure')}
                className="rounded-full text-xs"
              >
                {t('companies.bulkEmail.back')}
              </Button>
              <Button
                onClick={runSendAll}
                disabled={mode === 'shared' && !sharedDraft}
                className="rounded-full bg-primary text-white hover:bg-primary/90"
              >
                <Send className="h-4 w-4 mr-2" />
                {t('contacts.bulkEmail.sendAll')}
              </Button>
            </>
          )}
          {(step === 'generating' || step === 'sending') && (
            <Button
              variant="outline"
              onClick={() => (abortRef.current = true)}
              className="rounded-full text-xs"
            >
              {t('companies.bulkEmail.cancel')}
            </Button>
          )}
          {step === 'done' && (
            <Button
              onClick={() => {
                onOpenChange(false);
                showToast(t('contacts.bulkEmail.doneToast'), 'success');
              }}
              className="rounded-full bg-primary text-white hover:bg-primary/90"
            >
              {t('companies.bulkEmail.close')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
