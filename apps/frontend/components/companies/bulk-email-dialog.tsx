'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
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
import {
  Check,
  ChevronDown,
  ChevronRight,
  FileText,
  Loader2,
  Mail,
  RotateCw,
  Search,
  Send,
  Sparkles,
  X,
} from 'lucide-react';
import type { Company } from '@/lib/api/companies';
import { updateCompany } from '@/lib/api/companies';
import {
  fetchEmailConfig,
  generateOutreachEmail,
  sendCompanyEmail,
  type OutreachPurpose,
} from '@/lib/api/email';
import {
  researchCompany,
  type ResearchCompanyResponse,
} from '@/lib/api/enrichment';
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
import { useToast } from '@/components/ui/toast';
import { useTranslations } from '@/lib/i18n';
import { useLanguage } from '@/lib/context/language-context';
import { cn } from '@/lib/utils';
import { MarkdownToolbar } from '@/components/common/markdown-toolbar';

// ============================================
// Types
// ============================================

type Step = 'configure' | 'researching' | 'generating' | 'preview' | 'sending' | 'done';

interface BulkEmailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companies: Company[];
  onSent?: () => void;
}

interface CompanyEmailResult {
  companyId: string;
  subject: string;
  body: string;
  skipped: boolean;
  error?: string;
}

interface CompanyResearchResult {
  companyId: string;
  research: ResearchCompanyResponse | null;
  status: 'pending' | 'loading' | 'done' | 'error';
  error?: string;
}

interface CompanyEmailGenResult {
  companyId: string;
  result: CompanyEmailResult | null;
  status: 'pending' | 'loading' | 'done' | 'error';
}

const PURPOSE_OPTIONS: { id: OutreachPurpose; labelKey: string }[] = [
  { id: 'internship', labelKey: 'companies.emailDialog.purpose.internship' },
  { id: 'job', labelKey: 'companies.emailDialog.purpose.job' },
  { id: 'cold', labelKey: 'companies.emailDialog.purpose.cold' },
  { id: 'custom', labelKey: 'companies.emailDialog.purpose.custom' },
];

// ============================================
// Component
// ============================================

export function BulkEmailDialog({
  open,
  onOpenChange,
  companies,
  onSent,
}: BulkEmailDialogProps) {
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

  // Research state
  const [researchState, setResearchState] = useState<CompanyResearchResult[]>([]);

  // Generation state
  const [genState, setGenState] = useState<CompanyEmailGenResult[]>([]);

  // Preview editing
  const [edits, setEdits] = useState<Record<string, { subject: string; body: string }>>({});
  const [skipIds, setSkipIds] = useState<Set<string>>(new Set());

  // Sending state
  const [sendProgress, setSendProgress] = useState({ sent: 0, total: 0 });
  const [sendResults, setSendResults] = useState<
    Record<string, { success: boolean; error?: string }>
  >({});

  // Expandable research sections
  const [expandedResearch, setExpandedResearch] = useState<Set<string>>(new Set());

  // Per-company regeneration
  const [regenOpenId, setRegenOpenId] = useState<string | null>(null);
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null);
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
      setResearchState([]);
      setGenState([]);
      setEdits({});
      setSkipIds(new Set());
      setSendProgress({ sent: 0, total: 0 });
      setSendResults({});
      setExpandedResearch(new Set());
      setRegenOpenId(null);
      setRegeneratingId(null);
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
        setSenderConfigured(
          Boolean(cfg.smtp_host && cfg.sender_email && cfg.has_password)
        );
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

  // ---- Step 2: Research ----
  const runResearch = useCallback(async () => {
    setStep('researching');
    const initial: CompanyResearchResult[] = companies.map((c) => ({
      companyId: c.company_id,
      research: null,
      status: 'pending' as const,
    }));
    setResearchState(initial);

    for (let i = 0; i < companies.length; i++) {
      if (abortRef.current) break;
      const company = companies[i];
      setResearchState((prev) =>
        prev.map((r) =>
          r.companyId === company.company_id ? { ...r, status: 'loading' } : r
        )
      );
      try {
        const research = await researchCompany({
          company_name: company.name,
          website: company.website,
          industry: company.industry,
          linkedin_url: company.linkedin_url,
        });
        setResearchState((prev) =>
          prev.map((r) =>
            r.companyId === company.company_id
              ? { ...r, research, status: 'done' }
              : r
          )
        );
      } catch {
        setResearchState((prev) =>
          prev.map((r) =>
            r.companyId === company.company_id
              ? { ...r, status: 'error', error: 'Research failed' }
              : r
          )
        );
      }
    }

    // Move to generating
    runGeneration();
  }, [companies]);

  // ---- Step 3: Generate emails ----
  const runGeneration = useCallback(async () => {
    setStep('generating');
    const initial: CompanyEmailGenResult[] = companies.map((c) => ({
      companyId: c.company_id,
      result: null,
      status: 'pending' as const,
    }));
    setGenState(initial);

    const researchMap = new Map<string, CompanyResearchResult>();
    setResearchState((prev) => {
      prev.forEach((r) => researchMap.set(r.companyId, r));
      return prev;
    });

    const results: CompanyEmailResult[] = [];

    for (let i = 0; i < companies.length; i++) {
      if (abortRef.current) break;
      const company = companies[i];

      // Skip companies without email
      if (!company.email) {
        results.push({
          companyId: company.company_id,
          subject: '',
          body: '',
          skipped: true,
          error: 'No email address',
        });
        setGenState((prev) =>
          prev.map((g) =>
            g.companyId === company.company_id
              ? { ...g, result: results[results.length - 1], status: 'done' }
              : g
          )
        );
        continue;
      }

      setGenState((prev) =>
        prev.map((g) =>
          g.companyId === company.company_id ? { ...g, status: 'loading' } : g
        )
      );

      // Build research context
      const researchResult = researchMap.get(company.company_id);
      let researchContext = '';
      if (researchResult?.research?.research_summary) {
        researchContext = researchResult.research.research_summary;
      }

      try {
        const genResult = await generateOutreachEmail({
          company_name: company.name,
          company_email: company.email ?? '',
          industry: company.industry,
          company_size: company.company_size,
          company_type: company.company_type,
          website: company.website,
          linkedin_url: company.linkedin_url,
          purpose,
          custom_purpose: purpose === 'custom' ? customPurpose.trim() : undefined,
          output_language: contentLanguage,
          resume_id: selectedResumeId || null,
          instruction: instruction.trim() || null,
          company_research: researchContext || null,
        });

        const emailResult: CompanyEmailResult = {
          companyId: company.company_id,
          subject: genResult.subject,
          body: genResult.body,
          skipped: false,
        };
        results.push(emailResult);
        setGenState((prev) =>
          prev.map((g) =>
            g.companyId === company.company_id
              ? { ...g, result: emailResult, status: 'done' }
              : g
          )
        );
      } catch {
        const errResult: CompanyEmailResult = {
          companyId: company.company_id,
          subject: '',
          body: '',
          skipped: true,
          error: 'Generation failed',
        };
        results.push(errResult);
        setGenState((prev) =>
          prev.map((g) =>
            g.companyId === company.company_id
              ? { ...g, result: errResult, status: 'done' }
              : g
          )
        );
      }
    }

    // Pre-fill edits
    const editsMap: Record<string, { subject: string; body: string }> = {};
    results.forEach((r) => {
      if (!r.skipped) {
        editsMap[r.companyId] = { subject: r.subject, body: r.body };
      }
    });
    setEdits(editsMap);

    // Auto-skip companies without email
    const skipSet = new Set(
      results.filter((r) => r.skipped).map((r) => r.companyId)
    );
    setSkipIds(skipSet);

    setStep('preview');
  }, [companies, purpose, customPurpose, instruction, selectedResumeId, contentLanguage]);

  // ---- Step 5: Send all ----
  const runSendAll = useCallback(async () => {
    setStep('sending');
    const toSend = companies.filter(
      (c) => !skipIds.has(c.company_id) && edits[c.company_id]
    );
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
      const company = toSend[i];
      const edit = edits[company.company_id];
      if (!edit) continue;

      try {
        const form = new FormData();
        form.append('company_email', company.email ?? '');
        form.append('company_name', company.name || '');
        form.append('company_id', company.company_id);
        form.append('subject', edit.subject.trim());
        form.append('body', edit.body);
        if (resumePdf) {
          form.append('attachments', resumePdf, resumePdfName);
        }
        await sendCompanyEmail(form);
        results[company.company_id] = { success: true };
        await updateCompany(company.company_id, { status: 'contacted' });
      } catch (e) {
        results[company.company_id] = {
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
    companies,
    skipIds,
    edits,
    includeResume,
    selectedResumeId,
    senderName,
    contentLanguage,
    onSent,
  ]);

  // ---- Per-company regeneration ----
  const handleRegenerate = useCallback(
    async (companyId: string) => {
      const company = companies.find((c) => c.company_id === companyId);
      if (!company || !edits[companyId]) return;

      setRegeneratingId(companyId);
      setRegenOpenId(null);
      try {
        // Build research context from existing research state
        const researchResult = researchState.find(
          (r) => r.companyId === companyId
        );
        let researchContext = '';
        if (researchResult?.research?.research_summary) {
          researchContext = researchResult.research.research_summary;
        }

        // Build a target-specific instruction
        const targetLabel =
          regenTarget === 'subject'
            ? 'SUBJECT LINE'
            : regenTarget === 'body'
              ? 'EMAIL BODY'
              : 'SUBJECT LINE and EMAIL BODY';
        const baseInstruction = regenInstruction.trim()
          ? regenInstruction.trim()
          : `Regenerate the ${targetLabel.toLowerCase()} with a different approach`;
        const fullInstruction = `Only regenerate the ${targetLabel}. ${baseInstruction}`;

        const genResult = await generateOutreachEmail({
          company_name: company.name,
          company_email: company.email ?? '',
          industry: company.industry,
          company_size: company.company_size,
          company_type: company.company_type,
          website: company.website,
          linkedin_url: company.linkedin_url,
          purpose,
          custom_purpose: purpose === 'custom' ? customPurpose.trim() : undefined,
          output_language: contentLanguage,
          resume_id: selectedResumeId || null,
          instruction: fullInstruction,
          company_research: researchContext || null,
        });

        setEdits((prev) => ({
          ...prev,
          [companyId]: {
            subject:
              regenTarget === 'body'
                ? prev[companyId].subject
                : genResult.subject,
            body:
              regenTarget === 'subject'
                ? prev[companyId].body
                : genResult.body,
          },
        }));
      } catch {
        // Regeneration failed — keep existing content
      } finally {
        setRegeneratingId(null);
        setRegenInstruction('');
        setRegenTarget('both');
      }
    },
    [
      companies,
      edits,
      researchState,
      purpose,
      customPurpose,
      selectedResumeId,
      contentLanguage,
      regenInstruction,
      regenTarget,
    ]
  );

  // Kick off the pipeline
  const handleStart = () => {
    if (companies.length === 0) return;
    runResearch();
  };

  const handleClose = () => {
    abortRef.current = true;
    onOpenChange(false);
  };

  // ---- Render helpers ----

  const companyById = (id: string) => companies.find((c) => c.company_id === id);

  const readyCount = companies.filter(
    (c) => !skipIds.has(c.company_id) && edits[c.company_id]
  ).length;
  const skippedCount = companies.filter(
    (c) => skipIds.has(c.company_id)
  ).length;

  const stepIndex: Record<Step, number> = {
    configure: 0,
    researching: 1,
    generating: 2,
    preview: 3,
    sending: 4,
    done: 5,
  };

  const STEPS = ['configure', 'researching', 'generating', 'preview', 'sending'] as const;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[720px] rounded-2xl p-0 gap-0 overflow-hidden max-h-[90vh] flex flex-col">
        <DialogHeader className="p-6 pb-4 border-b border-[#e6e3dc]">
          <DialogTitle className="flex items-center gap-2 font-sans text-xl font-bold uppercase tracking-tight">
            <Mail className="h-5 w-5 text-primary" />
            {t('companies.bulkEmail.title')}
          </DialogTitle>
          <DialogDescription className="mt-2 text-xs text-ink-soft">
            {t('companies.bulkEmail.description', {
              count: String(companies.length),
            })}
          </DialogDescription>
          {/* Step indicator */}
          <div className="mt-4 flex items-center gap-1">
            {STEPS.map((s, i) => (
              <React.Fragment key={s}>
                <div
                  className={cn(
                    'flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold',
                    stepIndex[step] >= i
                      ? 'bg-primary text-white'
                      : 'bg-[#e6e3dc] text-steel-grey'
                  )}
                >
                  {stepIndex[step] > i ? (
                    <Check className="h-3 w-3" />
                  ) : (
                    i + 1
                  )}
                </div>
                {i < STEPS.length - 1 && (
                  <div
                    className={cn(
                      'h-0.5 flex-1',
                      stepIndex[step] > i ? 'bg-primary' : 'bg-[#e6e3dc]'
                    )}
                  />
                )}
              </React.Fragment>
            ))}
          </div>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-6 space-y-4">
          {/* ---- Step 1: Configure ---- */}
          {step === 'configure' && (
            <>
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
                </div>
              )}

              {emailConfigLoaded && senderConfigured && (
                <div className="space-y-5">
                  {/* Resume selector */}
                  <div className="space-y-2">
                    <Label className="text-xs uppercase tracking-wider text-ink-soft">
                      {t('companies.emailDialog.resume')}
                    </Label>
                    <select
                      value={selectedResumeId}
                      onChange={(e) => setSelectedResumeId(e.target.value)}
                      disabled={resumesLoading || resumes.length === 0}
                      className="w-full rounded-lg border border-ink bg-white px-3 py-2 text-sm focus:border-primary focus:outline-none"
                    >
                      {resumes.map((r) => (
                        <option key={r.resume_id} value={r.resume_id}>
                          {r.title || r.filename || t('companies.emailDialog.resumeUntitled')}
                          {r.is_master ? ` (${t('dashboard.masterResume')})` : ''}
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Purpose */}
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

                  {/* Instruction */}
                  <div className="space-y-2">
                    <Label className="text-xs uppercase tracking-wider text-ink-soft">
                      {t('companies.bulkEmail.instructionLabel')}
                      <span className="ml-1 normal-case text-steel-grey">
                        ({t('common.optional')})
                      </span>
                    </Label>
                    <Textarea
                      value={instruction}
                      onChange={(e) => setInstruction(e.target.value)}
                      placeholder={t('companies.bulkEmail.instructionPlaceholder')}
                      className="min-h-[60px] rounded-lg border-ink bg-white focus-visible:border-primary"
                    />
                  </div>

                  {/* Include resume toggle */}
                  <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-[#e6e3dc] bg-paper-tint px-3 py-2">
                    <span className="flex min-w-0 items-center gap-2 text-sm text-ink">
                      <FileText className="h-4 w-4 shrink-0 text-primary" />
                      <span className="truncate">
                        {t('companies.emailDialog.includeResume')}
                      </span>
                    </span>
                    <input
                      type="checkbox"
                      checked={includeResume}
                      onChange={(e) => setIncludeResume(e.target.checked)}
                      className="h-4 w-4 shrink-0 cursor-pointer accent-primary"
                    />
                  </label>
                </div>
              )}
            </>
          )}

          {/* ---- Step 2: Researching ---- */}
          {step === 'researching' && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-ink">
                {t('companies.bulkEmail.researchingAll')}
              </p>
              {researchState.map((r) => {
                const company = companyById(r.companyId);
                return (
                  <div
                    key={r.companyId}
                    className="flex items-center gap-3 rounded-lg border border-[#e6e3dc] bg-white px-3 py-2"
                  >
                    {r.status === 'loading' && (
                      <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
                    )}
                    {r.status === 'done' && (
                      <Check className="h-4 w-4 shrink-0 text-emerald-500" />
                    )}
                    {r.status === 'error' && (
                      <X className="h-4 w-4 shrink-0 text-destructive" />
                    )}
                    {r.status === 'pending' && (
                      <div className="h-4 w-4 shrink-0 rounded-full border-2 border-[#e6e3dc]" />
                    )}
                    <span className="truncate text-sm text-ink">
                      {company?.name ?? r.companyId}
                    </span>
                    {r.research?.sources && r.research.sources.length > 0 && (
                      <span className="ml-auto shrink-0 text-[10px] text-steel-grey">
                        {r.research.sources.length} source(s)
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* ---- Step 3: Generating ---- */}
          {step === 'generating' && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-ink">
                {t('companies.bulkEmail.generating')}
              </p>
              {genState.map((g) => {
                const company = companyById(g.companyId);
                return (
                  <div
                    key={g.companyId}
                    className="flex items-center gap-3 rounded-lg border border-[#e6e3dc] bg-white px-3 py-2"
                  >
                    {g.status === 'loading' && (
                      <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
                    )}
                    {g.status === 'done' && g.result && !g.result.skipped && (
                      <Check className="h-4 w-4 shrink-0 text-emerald-500" />
                    )}
                    {g.status === 'done' && g.result?.skipped && (
                      <X className="h-4 w-4 shrink-0 text-steel-grey" />
                    )}
                    {g.status === 'pending' && (
                      <div className="h-4 w-4 shrink-0 rounded-full border-2 border-[#e6e3dc]" />
                    )}
                    <span className="truncate text-sm text-ink">
                      {company?.name ?? g.companyId}
                    </span>
                    {g.result?.skipped && (
                      <span className="ml-auto shrink-0 text-[10px] text-steel-grey">
                        {g.result.error}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* ---- Step 4: Preview ---- */}
          {step === 'preview' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-ink">
                  {t('companies.bulkEmail.ready', { count: String(readyCount) })}
                  {skippedCount > 0 &&
                    ` · ${t('companies.bulkEmail.skipped', { count: String(skippedCount) })}`}
                </p>
              </div>

              {companies.map((company) => {
                const isSkipped = skipIds.has(company.company_id);
                const edit = edits[company.company_id];
                const isExpanded = expandedResearch.has(company.company_id);
                const researchResult = researchState.find(
                  (r) => r.companyId === company.company_id
                );

                return (
                  <div
                    key={company.company_id}
                    className={cn(
                      'rounded-xl border bg-white overflow-hidden',
                      isSkipped
                        ? 'border-[#e6e3dc] opacity-60'
                        : 'border-[#e6e3dc]'
                    )}
                  >
                    {/* Header */}
                    <div className="flex items-center justify-between border-b border-[#e6e3dc] px-4 py-2.5">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="truncate text-sm font-semibold text-ink">
                          {company.name}
                        </span>
                        <span className="shrink-0 text-[10px] text-steel-grey">
                          {company.email ?? 'No email'}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {researchResult?.research && (
                          <button
                            type="button"
                            onClick={() => {
                              setExpandedResearch((prev) => {
                                const next = new Set(prev);
                                if (next.has(company.company_id)) {
                                  next.delete(company.company_id);
                                } else {
                                  next.add(company.company_id);
                                }
                                return next;
                              });
                            }}
                            className="flex items-center gap-1 rounded-full border border-[#e6e3dc] px-2 py-0.5 text-[10px] text-steel-grey hover:border-primary hover:text-primary"
                          >
                            <Search className="h-3 w-3" />
                            {t('companies.bulkEmail.research')}
                            {isExpanded ? (
                              <ChevronDown className="h-3 w-3" />
                            ) : (
                              <ChevronRight className="h-3 w-3" />
                            )}
                          </button>
                        )}
                        {!isSkipped && edit && (
                          <button
                            type="button"
                            disabled={regeneratingId === company.company_id}
                            onClick={() => {
                              if (regenOpenId === company.company_id) {
                                // Close the instruction form
                                setRegenOpenId(null);
                                setRegenInstruction('');
                                setRegenTarget('both');
                              } else {
                                // Open the instruction form
                                setRegenOpenId(company.company_id);
                                setRegenInstruction('');
                                setRegenTarget('both');
                              }
                            }}
                            className="flex items-center gap-1 rounded-full border border-[#e6e3dc] px-2 py-0.5 text-[10px] text-steel-grey hover:border-primary hover:text-primary disabled:opacity-50"
                          >
                            {regenOpenId === company.company_id ? (
                              <X className="h-3 w-3" />
                            ) : (
                              <RotateCw className="h-3 w-3" />
                            )}
                            {t('companies.bulkEmail.regen')}
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            setSkipIds((prev) => {
                              const next = new Set(prev);
                              if (next.has(company.company_id)) {
                                next.delete(company.company_id);
                              } else {
                                next.add(company.company_id);
                              }
                              return next;
                            });
                          }}
                          className={cn(
                            'rounded-full border px-2 py-0.5 text-[10px] font-medium transition-colors',
                            isSkipped
                              ? 'border-steel-grey bg-steel-grey text-white'
                              : 'border-[#e6e3dc] text-steel-grey hover:border-primary hover:text-primary'
                          )}
                        >
                          {isSkipped
                            ? t('companies.bulkEmail.skip')
                            : t('companies.bulkEmail.edit')}
                        </button>
                      </div>
                    </div>

                    {/* Research expandable */}
                    {isExpanded && researchResult?.research && (
                      <div className="border-b border-[#e6e3dc] bg-paper-tint px-4 py-3 space-y-2">
                        {researchResult.research.research_summary && (
                          <div>
                            <p className="text-[10px] font-semibold uppercase text-ink-soft mb-1">
                              {t('companies.bulkEmail.researchSummary')}
                            </p>
                            <p className="text-xs text-ink whitespace-pre-wrap">
                              {researchResult.research.research_summary}
                            </p>
                          </div>
                        )}
                        {researchResult.research.sources.length > 0 && (
                          <p className="text-[10px] text-steel-grey">
                            Sources: {researchResult.research.sources.join(', ')}
                          </p>
                        )}
                      </div>
                    )}

                    {/* Regeneration instruction input */}
                    {regenOpenId === company.company_id && !isSkipped && (
                      <div className="border-b border-[#e6e3dc] bg-paper-tint px-4 py-3 space-y-2">
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
                                handleRegenerate(company.company_id);
                              }
                            }}
                            autoFocus
                          />
                          <Button
                            size="sm"
                            onClick={() => handleRegenerate(company.company_id)}
                            className="shrink-0 rounded-lg bg-primary text-white hover:bg-primary/90"
                          >
                            <Sparkles className="h-3 w-3 mr-1" />
                            {t('companies.bulkEmail.regen')}
                          </Button>
                        </div>
                      </div>
                    )}

                    {/* Email content */}
                    {!isSkipped && edit && regeneratingId !== company.company_id && (
                      <div className="space-y-3 px-4 py-3">
                        <div className="space-y-1">
                          <Label className="text-[10px] uppercase tracking-wider text-ink-soft">
                            {t('companies.emailDialog.subject')}
                          </Label>
                          <input
                            value={edit.subject}
                            onChange={(e) =>
                              setEdits((prev) => ({
                                ...prev,
                                [company.company_id]: {
                                  ...prev[company.company_id],
                                  subject: e.target.value,
                                },
                              }))
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
                                  return bodyTextareaRefs.current.get(company.company_id) ?? null;
                                },
                              }}
                              value={edit.body}
                              onChange={(val) =>
                                setEdits((prev) => ({
                                  ...prev,
                                  [company.company_id]: {
                                    ...prev[company.company_id],
                                    body: val,
                                  },
                                }))
                              }
                            />
                          </div>
                          <Textarea
                            ref={(el) => {
                              if (el) {
                                bodyTextareaRefs.current.set(company.company_id, el);
                              } else {
                                bodyTextareaRefs.current.delete(company.company_id);
                              }
                            }}
                            value={edit.body}
                            onChange={(e) =>
                              setEdits((prev) => ({
                                ...prev,
                                [company.company_id]: {
                                  ...prev[company.company_id],
                                  body: e.target.value,
                                },
                              }))
                            }
                            className="min-h-[100px] rounded-lg border border-ink bg-white text-sm focus-visible:border-primary"
                          />
                        </div>
                      </div>
                    )}
                    {/* Regenerating spinner */}
                    {!isSkipped && regeneratingId === company.company_id && (
                      <div className="flex items-center justify-center gap-2 px-4 py-6 text-xs text-steel-grey">
                        <Loader2 className="h-4 w-4 animate-spin text-primary" />
                        {t('companies.bulkEmail.regenenerating')}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* ---- Step 5: Sending ---- */}
          {step === 'sending' && (
            <div className="space-y-4">
              <p className="text-xs font-semibold text-ink">
                {t('companies.bulkEmail.progress', {
                  sent: String(sendProgress.sent),
                  total: String(sendProgress.total),
                })}
              </p>
              <div className="h-2 w-full overflow-hidden rounded-full bg-[#e6e3dc]">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-300"
                  style={{
                    width: `${
                      sendProgress.total > 0
                        ? (sendProgress.sent / sendProgress.total) * 100
                        : 0
                    }%`,
                  }}
                />
              </div>
              {companies
                .filter((c) => !skipIds.has(c.company_id))
                .map((company) => {
                  const result = sendResults[company.company_id];
                  return (
                    <div
                      key={company.company_id}
                      className="flex items-center gap-3 rounded-lg border border-[#e6e3dc] bg-white px-3 py-2"
                    >
                      {result === undefined && (
                        <Loader2 className="h-4 w-4 shrink-0 animate-spin text-primary" />
                      )}
                      {result?.success && (
                        <Check className="h-4 w-4 shrink-0 text-emerald-500" />
                      )}
                      {result && !result.success && (
                        <X className="h-4 w-4 shrink-0 text-destructive" />
                      )}
                      <span className="truncate text-sm text-ink">
                        {company.name}
                      </span>
                      {result && !result.success && (
                        <span className="ml-auto shrink-0 text-[10px] text-destructive">
                          {result.error}
                        </span>
                      )}
                    </div>
                  );
                })}
            </div>
          )}

          {/* ---- Step 6: Done ---- */}
          {step === 'done' && (
            <div className="space-y-3 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100">
                <Check className="h-6 w-6 text-emerald-600" />
              </div>
              <p className="text-sm font-semibold text-ink">
                {t('companies.bulkEmail.done')}
              </p>
              <p className="text-xs text-steel-grey">
                {Object.values(sendResults).filter((r) => r.success).length} sent
                successfully,{' '}
                {Object.values(sendResults).filter((r) => !r.success).length} failed
              </p>
            </div>
          )}
        </div>

        <DialogFooter className="flex-row justify-between gap-3 border-t border-[#e6e3dc] bg-secondary p-4">
          <div className="flex-1" />
          {step === 'configure' && (
            <Button
              onClick={handleStart}
              disabled={!senderConfigured || companies.length === 0}
              className="rounded-full bg-primary text-white hover:bg-primary/90"
            >
              <Sparkles className="h-4 w-4 mr-2" />
              {t('companies.bulkEmail.generateAll')}
            </Button>
          )}
          {step === 'preview' && (
            <Button
              onClick={runSendAll}
              disabled={readyCount === 0}
              className="rounded-full bg-primary text-white hover:bg-primary/90"
            >
              <Send className="h-4 w-4 mr-2" />
              {t('companies.bulkEmail.sendAll')} ({readyCount})
            </Button>
          )}
          {(step === 'done' || step === 'sending') && (
            <Button
              onClick={handleClose}
              variant="outline"
              className="rounded-full"
            >
              {t('companies.bulkEmail.close')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
