'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useResumePreview } from '@/components/common/resume_previewer_context';
import type { ImprovedResult } from '@/components/common/resume_previewer_context';
import type { ResumeData } from '@/components/dashboard/resume-component';
import {
  uploadJobDescriptions,
  previewImproveResume,
  confirmImproveResume,
  fetchResumeList,
  fetchProjectsSuggestions,
  type ProjectSuggestion,
  type ResumeListItem,
} from '@/lib/api/resume';
import { fetchPromptConfig, type PromptOption } from '@/lib/api/config';
import { markScrapedJobApplied } from '@/lib/api/job-scraper';
import { Dropdown } from '@/components/ui/dropdown';
import { useStatusCache } from '@/lib/context/status-cache';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle';
import Settings from 'lucide-react/dist/esm/icons/settings';
import ArrowLeft from 'lucide-react/dist/esm/icons/arrow-left';
import { useTranslations } from '@/lib/i18n';
import { DiffPreviewModal } from '@/components/tailor/diff-preview-modal';
import { ProjectsPickerModal } from '@/components/tailor/projects-picker-modal';
import { ATSScoreCard } from '@/components/tailor/ats-score-card';
import { AIConnectionCard } from '@/components/tailor/ai-connection-card';
import { fetchShouldApply, type ShouldApplyResponse } from '@/lib/api/job-intel';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import SidebarNav from '@/components/common/SidebarNav';

export default function TailorPage() {
  const { t } = useTranslations();
  const [jobDescription, setJobDescription] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [masterResumeId, setMasterResumeId] = useState<string | null>(null);
  const [masterResumes, setMasterResumes] = useState<ResumeListItem[]>([]);
  const [mastersLoading, setMastersLoading] = useState(true);
  const [promptOptions, setPromptOptions] = useState<PromptOption[]>([]);
  const [selectedPromptId, setSelectedPromptId] = useState('keywords');
  const [promptLoading, setPromptLoading] = useState(false);
  const hasUserSelectedPrompt = useRef(false);
  const missingDiffConfirmInFlight = useRef(false);

  // Diff preview modal state
  const [showDiffModal, setShowDiffModal] = useState(false);
  const [pendingResult, setPendingResult] = useState<ImprovedResult | null>(null);
  const [diffConfirmError, setDiffConfirmError] = useState<string | null>(null);
  const [isConfirming, setIsConfirming] = useState(false);
  const [showRegenerateDialog, setShowRegenerateDialog] = useState(false);
  const [showMissingDiffDialog, setShowMissingDiffDialog] = useState(false);
  const [missingDiffResult, setMissingDiffResult] = useState<ImprovedResult | null>(null);
  const [missingDiffError, setMissingDiffError] = useState<string | null>(null);
  const [pendingScrapedJobId, setPendingScrapedJobId] = useState<string | null>(null);

  // Job Intel: track the uploaded job ID for intel panel
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [modalShouldApply, setModalShouldApply] = useState<ShouldApplyResponse | null>(null);

  // Project suggestions step (choose which career projects replace the
  // Projects section before tailoring).
  const [showProjectsPicker, setShowProjectsPicker] = useState(false);
  const [pickerSuggestions, setPickerSuggestions] = useState<ProjectSuggestion[]>([]);
  const [pickerFetching, setPickerFetching] = useState(false);
  const [pickerError, setPickerError] = useState<string | null>(null);
  const [pickerTailoring, setPickerTailoring] = useState(false);
  const pendingJobIdRef = useRef<string | null>(null);

  // Elapsed timer for long operations
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startTimer = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    setElapsed(0);
    timerRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);
  }, []);

  const stopTimer = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    setElapsed(0);
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  // Fetch should-apply analysis when diff modal opens
  useEffect(() => {
    if (!showDiffModal || !selectedJobId) {
      setModalShouldApply(null);
      return;
    }
    let cancelled = false;
    fetchShouldApply(selectedJobId)
      .then((data) => {
        if (!cancelled) setModalShouldApply(data);
      })
      .catch(() => {
        // Silently ignore — modal still works without it
      });
    return () => { cancelled = true; };
  }, [showDiffModal, selectedJobId]);

  const router = useRouter();
  const { setImprovedData } = useResumePreview();
  const {
    status: systemStatus,
    isLoading: statusLoading,
    incrementJobs,
    incrementImprovements,
    incrementResumes,
  } = useStatusCache();

  // Check if LLM is configured
  const isLlmConfigured = !statusLoading && systemStatus?.llm_configured;

  useEffect(() => {
    let cancelled = false;

    const loadMasters = async () => {
      setMastersLoading(true);
      try {
        const data = await fetchResumeList(true);
        if (cancelled) return;
        const masters = data.filter((r) => r.is_master);
        setMasterResumes(masters);

        if (masters.length === 0) {
          router.push('/dashboard');
          return;
        }

        const storedId = localStorage.getItem('master_resume_id');
        const selectedId = masters.some((m) => m.resume_id === storedId)
          ? storedId
          : (masters[0].resume_id ?? null);
        if (selectedId) {
          localStorage.setItem('master_resume_id', selectedId);
          setMasterResumeId(selectedId);
        }
      } catch (err) {
        console.error('Failed to load master resumes', err);
        if (!cancelled) router.push('/dashboard');
      } finally {
        if (!cancelled) setMastersLoading(false);
      }
    };

    loadMasters();

    // Auto-load job description from job scraper
    const pendingJD = localStorage.getItem('pending_job_description');
    if (pendingJD) {
      setJobDescription(pendingJD);
      localStorage.removeItem('pending_job_description');
    }

    // Read scraped job ID for marking as applied after tailoring
    const scrapedJobId = localStorage.getItem('pending_scraped_job_id');
    if (scrapedJobId) {
      setPendingScrapedJobId(scrapedJobId);
      localStorage.removeItem('pending_scraped_job_id');
    }

    return () => {
      cancelled = true;
    };
  }, [router]);

  useEffect(() => {
    let cancelled = false;

    const loadPromptConfig = async () => {
      setPromptLoading(true);
      try {
        const config = await fetchPromptConfig();
        if (!cancelled) {
          setPromptOptions(config.prompt_options || []);
          if (!hasUserSelectedPrompt.current) {
            setSelectedPromptId(config.default_prompt_id || 'keywords');
          }
        }
      } catch (err) {
        console.error('Failed to load prompt config', err);
      } finally {
        if (!cancelled) {
          setPromptLoading(false);
        }
      }
    };

    loadPromptConfig();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleTextareaKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter') e.stopPropagation();
  };

  const buildConfirmPayload = (result: ImprovedResult) => {
    if (!masterResumeId) {
      throw new Error('Master resume ID is missing.');
    }
    const resumePreview = result.data.resume_preview;
    if (!resumePreview || typeof resumePreview !== 'object' || Array.isArray(resumePreview)) {
      throw new Error('Resume preview data is invalid.');
    }
    const previewRecord = resumePreview as unknown as Record<string, unknown>;
    if (
      !previewRecord.personalInfo ||
      typeof previewRecord.personalInfo !== 'object' ||
      Array.isArray(previewRecord.personalInfo)
    ) {
      throw new Error('Resume preview data is invalid.');
    }
    return {
      resume_id: masterResumeId,
      job_id: result.data.job_id,
      improved_data: resumePreview as ResumeData,
      improvements:
        result.data.improvements?.map((item) => ({
          suggestion: item.suggestion,
          lineNumber: typeof item.lineNumber === 'number' ? item.lineNumber : null,
        })) ?? [],
    };
  };

  const confirmAndNavigate = async (result: ImprovedResult) => {
    const confirmed = await confirmImproveResume(buildConfirmPayload(result));
    incrementImprovements();
    incrementResumes();
    setImprovedData(confirmed);

    const newResumeId = confirmed?.data?.resume_id;

    // Mark the scraped job draft as applied if it came from job scraper
    if (pendingScrapedJobId && newResumeId) {
      try {
        await markScrapedJobApplied(pendingScrapedJobId, newResumeId);
      } catch (err) {
        console.error('Failed to mark scraped job as applied:', err);
      }
    }

    if (newResumeId) {
      router.push(`/resumes/${newResumeId}`);
    } else {
      router.push('/builder');
    }
  };

  const getGenerateValidationError = (trimmedDescription: string) => {
    if (!trimmedDescription) return null;
    if (trimmedDescription.length < 50) {
      return t('tailor.errors.jobDescriptionTooShort');
    }
    return null;
  };

  const runPreview = async (jobId: string, selectedProjects?: string[]) => {
    try {
      const result = await previewImproveResume(
        masterResumeId ?? '',
        jobId,
        selectedPromptId,
        selectedProjects
      );

      if (!result?.data?.diff_summary || !result?.data?.detailed_changes) {
        console.warn('Diff data missing for tailor preview; requesting user confirmation.');
        setDiffConfirmError(null);
        setPendingResult(null);
        setShowDiffModal(false);
        setMissingDiffError(null);
        setMissingDiffResult(result);
        setShowMissingDiffDialog(true);
        return;
      }

      // Show diff preview modal
      setDiffConfirmError(null);
      setMissingDiffError(null);
      setPendingResult(result);
      setShowDiffModal(true);
    } catch (err) {
      console.error(err);
      // Check for common error patterns
      const errorMessage = err instanceof Error ? err.message : '';
      if (
        errorMessage.toLowerCase().includes('api key') ||
        errorMessage.toLowerCase().includes('unauthorized') ||
        errorMessage.toLowerCase().includes('authentication') ||
        errorMessage.includes('401')
      ) {
        setError(t('tailor.errors.apiKeyError'));
      } else if (
        errorMessage.toLowerCase().includes('rate limit') ||
        errorMessage.includes('429')
      ) {
        setError(t('tailor.errors.rateLimit'));
      } else if (
        errorMessage.toLowerCase().includes('timed out') ||
        errorMessage.toLowerCase().includes('timeout')
      ) {
        setError(t('tailor.errors.timeout'));
      } else {
        setError(t('tailor.errors.failedToPreview'));
      }
    }
  };

  const runGenerate = async (resumeId: string, description: string) => {
    try {
      // 1. Upload Job Description
      // The API expects an array of strings
      const jobId = await uploadJobDescriptions([description], resumeId);
      incrementJobs(); // Update cached counter
      setSelectedJobId(jobId);

      // 2. Suggest JD-matched career projects to choose from before tailoring
      pendingJobIdRef.current = jobId;
      setPickerSuggestions([]);
      setPickerError(null);
      setPickerFetching(true);
      setShowProjectsPicker(true);
      let suggestions: ProjectSuggestion[] = [];
      try {
        const data = await fetchProjectsSuggestions(resumeId, jobId);
        suggestions = data.projects ?? [];
      } catch (suggestErr) {
        // Suggestions are optional — fall through to a plain preview.
        console.error('Failed to fetch project suggestions:', suggestErr);
      } finally {
        setPickerFetching(false);
      }

      if (suggestions.length > 0) {
        setPickerSuggestions(suggestions);
        return;
      }

      // 3. No suggestions (or fetch failed): preview directly
      setShowProjectsPicker(false);
      setPickerSuggestions([]);
      pendingJobIdRef.current = null;
      await runPreview(jobId);
    } catch (err) {
      console.error(err);
      setError(t('tailor.errors.failedToGenerate'));
    }
  };

  const runPreviewWithLoading = async (jobId: string, selectedProjects?: string[]) => {
    setIsLoading(true);
    setError(null);
    startTimer();
    try {
      await runPreview(jobId, selectedProjects);
    } finally {
      setIsLoading(false);
      stopTimer();
    }
  };

  const handleTailorWithSelection = async (selectedNames: string[]) => {
    const jobId = pendingJobIdRef.current;
    if (!jobId || pickerTailoring) return;
    setPickerTailoring(true);
    setPickerError(null);
    try {
      setShowProjectsPicker(false);
      await runPreviewWithLoading(jobId, selectedNames);
    } catch (err) {
      console.error(err);
      setPickerError(t('tailor.errors.failedToPreview'));
    } finally {
      setPickerTailoring(false);
      pendingJobIdRef.current = null;
    }
  };

  const handleSkipProjects = () => {
    const jobId = pendingJobIdRef.current;
    setShowProjectsPicker(false);
    setPickerSuggestions([]);
    pendingJobIdRef.current = null;
    if (jobId) {
      void runPreviewWithLoading(jobId);
    }
  };

  const handleCloseProjectsPicker = () => {
    if (pickerTailoring) return;
    setShowProjectsPicker(false);
    setPickerSuggestions([]);
    pendingJobIdRef.current = null;
  };

  const handleGenerate = async () => {
    const trimmedDescription = jobDescription.trim();
    if (!trimmedDescription || !masterResumeId) return;
    const validationError = getGenerateValidationError(trimmedDescription);
    if (validationError) {
      setError(validationError);
      return;
    }
    const resumeId = masterResumeId;
    setIsLoading(true);
    setError(null);
    startTimer();
    try {
      await runGenerate(resumeId, trimmedDescription);
    } finally {
      setIsLoading(false);
      stopTimer();
    }
  };

  // User confirms changes
  const handleConfirmChanges = async () => {
    if (!pendingResult || isConfirming) return;

    setIsConfirming(true);
    setError(null);
    setDiffConfirmError(null);

    try {
      await confirmAndNavigate(pendingResult);
      setShowDiffModal(false);
      setPendingResult(null);
    } catch (err) {
      console.error(err);
      const errorMessage = t('tailor.errors.failedToConfirm');
      setError(errorMessage);
      setDiffConfirmError(errorMessage);
    } finally {
      setIsConfirming(false);
    }
  };

  // User rejects changes
  const handleRejectChanges = () => {
    setShowDiffModal(false);
    setPendingResult(null);
    setDiffConfirmError(null);
    setShowRegenerateDialog(true);
  };

  const handleCloseDiffModal = () => {
    setShowDiffModal(false);
    setPendingResult(null);
    setDiffConfirmError(null);
  };

  const handleCloseMissingDiffDialog = () => {
    setShowMissingDiffDialog(false);
    setMissingDiffResult(null);
    setMissingDiffError(null);
    missingDiffConfirmInFlight.current = false;
  };

  const handleMissingDiffConfirm = async () => {
    if (!missingDiffResult || isLoading || missingDiffConfirmInFlight.current) return;
    missingDiffConfirmInFlight.current = true;
    setIsLoading(true);
    setError(null);
    setMissingDiffError(null);
    try {
      await confirmAndNavigate(missingDiffResult);
      handleCloseMissingDiffDialog();
    } catch (err) {
      console.error(err);
      const errorMessage = t('tailor.errors.failedToConfirm');
      setError(errorMessage);
      setMissingDiffError(errorMessage);
    } finally {
      missingDiffConfirmInFlight.current = false;
      setIsLoading(false);
    }
  };

  const handleRegenerateConfirm = async () => {
    setShowRegenerateDialog(false);
    const trimmedDescription = jobDescription.trim();
    if (!trimmedDescription || !masterResumeId) return;
    const validationError = getGenerateValidationError(trimmedDescription);
    if (validationError) {
      setError(validationError);
      return;
    }
    const resumeId = masterResumeId;
    setIsLoading(true);
    setError(null);
    startTimer();
    try {
      await runGenerate(resumeId, trimmedDescription);
    } finally {
      setIsLoading(false);
      stopTimer();
    }
  };

  return (
    <div className="min-h-screen bg-white pl-16">
      <SidebarNav currentPage="tailor" onNavigate={(page) => router.push(page)} />
      <main className="mx-auto max-w-6xl px-6 py-10">
        <Link
          href="/dashboard"
          className="mb-6 inline-flex shrink-0 items-center gap-1 self-start rounded-full border border-[#e6e3dc] bg-white px-3 py-1.5 text-xs uppercase text-ink-soft shadow-sw-xs transition-all hover:border-primary hover:text-primary"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {t('common.back')}
        </Link>

        {/* Heading */}
        <div className="mb-8">
          <p className="text-xs font-bold uppercase tracking-widest text-primary">
            {'// '}
            {t('tailor.pasteJobDescriptionBelow')}
          </p>
          <h1 className="mt-2 text-3xl font-bold uppercase tracking-tight md:text-4xl">
            {t('tailor.heroTitle')}
          </h1>
          <p className="mt-2 text-sm text-ink-soft">{t('tailor.subtitle')}</p>
        </div>

        {/* LLM Not Configured Warning */}
        {!statusLoading && !isLlmConfigured && (
          <div className="mb-6 rounded-2xl border-2 border-[#d9c9a3] bg-[#fbf6e9] p-5 shadow-sw-xs">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
              <div className="flex-1">
                <p className="text-sm font-bold uppercase tracking-wider text-amber-800">
                  {t('tailor.setupRequiredTitle')}
                </p>
                <p className="mt-1 text-xs text-amber-700">{t('tailor.noApiKeyMessage')}</p>
                <Link
                  href="/settings"
                  className="mt-3 inline-flex items-center gap-2 text-amber-700 transition-colors hover:text-amber-900"
                >
                  <Settings className="h-4 w-4" />
                  <span className="text-xs font-bold uppercase underline">
                    {t('tailor.configureApiKey')}
                  </span>
                </Link>
              </div>
            </div>
          </div>
        )}

        <div className="grid items-start gap-6 lg:grid-cols-[340px_minmax(0,1fr)]">
          {/* Left rail */}
          <div className="space-y-6">
            <div className="space-y-5 rounded-2xl border border-[#e6e3dc] bg-white p-6 shadow-sw-xs">
              {!mastersLoading && masterResumes.length > 0 && (
                <Dropdown
                  options={masterResumes.map((master) => ({
                    id: master.resume_id,
                    label: master.title || master.filename || t('dashboard.masterResume'),
                    description: master.filename || t('tailor.resumePromptDescription'),
                  }))}
                  value={masterResumeId ?? ''}
                  onChange={(value) => {
                    setMasterResumeId(value);
                    localStorage.setItem('master_resume_id', value);
                  }}
                  label={t('tailor.selectResume')}
                  description={t('tailor.resumePromptDescription')}
                  disabled={isLoading}
                />
              )}
            </div>

            <div className="space-y-5 rounded-2xl border border-[#e6e3dc] bg-white p-6 shadow-sw-xs">
              <Dropdown
                options={
                  promptOptions.length > 0
                    ? promptOptions.map((opt) => ({
                        id: opt.id,
                        label: t(`tailor.promptOptions.${opt.id}.label`),
                        description: t(`tailor.promptOptions.${opt.id}.description`),
                      }))
                    : [
                        {
                          id: 'nudge',
                          label: t('tailor.promptOptions.nudge.label'),
                          description: t('tailor.promptOptions.nudge.description'),
                        },
                        {
                          id: 'keywords',
                          label: t('tailor.promptOptions.keywords.label'),
                          description: t('tailor.promptOptions.keywords.description'),
                        },
                        {
                          id: 'full',
                          label: t('tailor.promptOptions.full.label'),
                          description: t('tailor.promptOptions.full.description'),
                        },
                      ]
                }
                value={selectedPromptId}
                onChange={(value) => {
                  hasUserSelectedPrompt.current = true;
                  setSelectedPromptId(value);
                }}
                label={t('tailor.promptLabel')}
                description={t('tailor.promptDescription')}
                disabled={isLoading || promptLoading}
              />
            </div>

            <AIConnectionCard configured={!statusLoading && !!systemStatus?.llm_configured} />
          </div>

          {/* Editor card */}
          <div className="rounded-2xl border border-[#e6e3dc] bg-white p-6 shadow-sw-xs">
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="text-xs font-bold uppercase tracking-widest text-ink-soft">
                {t('tailor.pasteJobDescription')}
              </p>
              <span className="shrink-0 text-xs text-steel-grey">
                {t('tailor.charactersCount', { count: jobDescription.length })}
              </span>
            </div>

            <Textarea
              placeholder={t('tailor.jobDescriptionPlaceholder')}
              className="min-h-[520px] w-full resize-none rounded-xl border border-[#c9c5bc] bg-white p-4 text-sm text-ink placeholder:text-steel-grey focus:border-primary focus:ring-0"
              value={jobDescription}
              onChange={(e) => setJobDescription(e.target.value)}
              onKeyDown={handleTextareaKeyDown}
              disabled={isLoading}
            />

            {error && (
              <div className="mt-4 flex items-start gap-2.5 rounded-xl border border-[#eec2c2] bg-[#fdf3f2] p-3.5 text-sm text-red-700">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
                {error}
              </div>
            )}

            <Button
              size="lg"
              onClick={handleGenerate}
              disabled={
                isLoading ||
                statusLoading ||
                mastersLoading ||
                !masterResumeId ||
                !jobDescription.trim() ||
                !isLlmConfigured
              }
              className="mt-6 w-full rounded-xl"
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" />
                  {t('common.processing')}
                  {elapsed > 0 && <span className="ml-2 text-xs opacity-70">{elapsed}s</span>}
                </>
              ) : statusLoading ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin" />
                  {t('common.checking')}
                </>
              ) : !isLlmConfigured ? (
                t('tailor.configureApiKeyFirst')
              ) : (
                t('tailor.generateTailored')
              )}
            </Button>
          </div>
        </div>
      </main>

      {/* ATS Score Breakdown — shown once a preview result is available */}
      {pendingResult?.data?.ats_score && (
        <div className="mx-auto mt-6 w-full max-w-6xl px-6">
          <ATSScoreCard atsScore={pendingResult.data.ats_score} />
        </div>
      )}

      {/* Diff preview modal */}
      {showDiffModal && pendingResult && (
        <DiffPreviewModal
          isOpen={showDiffModal}
          isConfirming={isConfirming}
          onClose={handleCloseDiffModal}
          onReject={handleRejectChanges}
          onConfirm={handleConfirmChanges}
          diffSummary={pendingResult?.data?.diff_summary}
          detailedChanges={pendingResult?.data?.detailed_changes}
          shouldApply={modalShouldApply ?? undefined}
          errorMessage={diffConfirmError ?? undefined}
        />
      )}

      {/* JD-matched career projects picker (before tailoring) */}
      <ProjectsPickerModal
        isOpen={showProjectsPicker}
        isFetching={pickerFetching}
        isTailoring={pickerTailoring}
        suggestions={pickerSuggestions}
        errorMessage={pickerError}
        jobId={selectedJobId}
        onClose={handleCloseProjectsPicker}
        onTailor={handleTailorWithSelection}
        onSkip={handleSkipProjects}
      />

      <ConfirmDialog
        open={showRegenerateDialog}
        onOpenChange={setShowRegenerateDialog}
        title={t('tailor.regenerateDialog.title')}
        description={t('tailor.regenerateDialog.description')}
        confirmLabel={t('tailor.regenerateDialog.confirmLabel')}
        cancelLabel={t('common.cancel')}
        variant="warning"
        onConfirm={handleRegenerateConfirm}
      />

      <ConfirmDialog
        open={showMissingDiffDialog}
        onOpenChange={(open) => {
          if (!open) {
            handleCloseMissingDiffDialog();
          }
        }}
        title={t('tailor.missingDiffDialog.title')}
        description={t('tailor.missingDiffDialog.description')}
        confirmLabel={t('tailor.missingDiffDialog.confirmLabel')}
        cancelLabel={t('common.cancel')}
        variant="warning"
        closeOnConfirm={false}
        onConfirm={handleMissingDiffConfirm}
        onCancel={handleCloseMissingDiffDialog}
        confirmDisabled={isLoading || !missingDiffResult}
        errorMessage={missingDiffError ?? undefined}
      />
    </div>
  );
}
