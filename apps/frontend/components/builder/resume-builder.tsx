'use client';

import React, { useState, useEffect, useRef, Suspense, useCallback, useMemo } from 'react';
import Image from 'next/image';
import { useSearchParams, useRouter } from 'next/navigation';
import { type ResumeData } from '@/components/dashboard/resume-component';
import { ResumeForm } from './resume-form';
import { FormattingControls } from './formatting-controls';
import { CoverLetterEditor } from './cover-letter-editor';
import { OutreachEditor } from './outreach-editor';
import { CoverLetterPreview } from './cover-letter-preview';
import { OutreachPreview } from './outreach-preview';
import { GeneratePrompt } from './generate-prompt';
import { InterviewPrepView } from './interview-prep-view';
import { Button } from '@/components/ui/button';
import { RetroTabs } from '@/components/ui/retro-tabs';
import { ConfirmDialog, type ConfirmDialogProps } from '@/components/ui/confirm-dialog';
import { Textarea } from '@/components/ui/textarea';
import {
  Download,
  Save,
  AlertTriangle,
  ArrowLeft,
  RotateCcw,
  Copy,
  Check,
  Sparkles,
  Star,
  ChevronDown,
  Loader2,
} from 'lucide-react';
import {
  useResumePreview,
  type InterviewPrepData,
} from '@/components/common/resume_previewer_context';
import { PaginatedPreview } from '@/components/preview';
import {
  downloadResumePdf,
  downloadCoverLetterPdf,
  getResumePdfUrl,
  getCoverLetterPdfUrl,
  fetchResume,
  updateResume,
  updateResumeTemplateSettings,
  saveResumeAsMaster,
  updateCoverLetter,
  updateOutreachMessage,
  generateCoverLetter,
  generateOutreachMessage,
  generateInterviewPrep,
  fetchJobDescription,
} from '@/lib/api/resume';
import { JDComparisonView } from './jd-comparison-view';
import { RegenerateWizard } from './regenerate-wizard';
import { useRegenerateWizard } from '@/hooks/use-regenerate-wizard';
import { useTranslations } from '@/lib/i18n';
import {
  type TemplateSettings,
  DEFAULT_TEMPLATE_SETTINGS,
  normalizeTemplateSettings,
} from '@/lib/types/template-settings';
import { withLocalizedDefaultSections, ensureUniqueEntryIds } from '@/lib/utils/section-helpers';
import { useResumeAutosave } from '@/hooks/use-resume-autosave';
import { useLanguage } from '@/lib/context/language-context';
import { buildResumeFilename, downloadBlobAsFile, openUrlInNewTab } from '@/lib/utils/download';
import type { RegenerateItemInput } from '@/lib/api/enrichment';

type TabId = 'resume' | 'cover-letter' | 'outreach' | 'interview-prep' | 'jd-match';
type JobContextStatus = 'idle' | 'loading' | 'available' | 'missing';
type EditorMode = 'design' | 'content';

const STORAGE_KEY = 'resume_builder_draft';
const SETTINGS_STORAGE_KEY = 'resume_builder_settings';
const TAB_IDS: TabId[] = ['resume', 'cover-letter', 'outreach', 'interview-prep', 'jd-match'];
const AUTOSAVE_DELAY_MS = 1500;

type Translate = (key: string, params?: Record<string, string | number>) => string;

const getTabFromSearchParams = (searchParams: Pick<URLSearchParams, 'get'>): TabId => {
  const tab = searchParams.get('tab');
  return TAB_IDS.includes(tab as TabId) ? (tab as TabId) : 'resume';
};

const buildInitialData = (t: Translate): ResumeData => ({
  personalInfo: {
    name: t('builder.personalInfoForm.placeholders.name'),
    title: t('builder.personalInfoForm.placeholders.title'),
    email: t('builder.personalInfoForm.placeholders.email'),
    phone: t('builder.personalInfoForm.placeholders.phone'),
    location: t('builder.personalInfoForm.placeholders.location'),
    website: t('builder.personalInfoForm.placeholders.website'),
    linkedin: t('builder.personalInfoForm.placeholders.linkedin'),
    github: t('builder.personalInfoForm.placeholders.github'),
  },
  summary: t('builder.placeholders.summary'),
  workExperience: [],
  education: [],
  personalProjects: [],
  additional: {
    technicalSkills: [],
    languages: [],
    certificationsTraining: [],
    awards: [],
  },
});

/**
 * Renumber list entry ids by position. The builder targets entries by
 * `item.id`, so entries loaded without ids (old drafts, pre-validator
 * payloads) would all share id=0 and an edit would apply to every entry.
 */
const normalizeEntryIds = (data: ResumeData): ResumeData => {
  return {
    ...data,
    workExperience: ensureUniqueEntryIds(data.workExperience),
    education: ensureUniqueEntryIds(data.education),
    personalProjects: ensureUniqueEntryIds(data.personalProjects),
  };
};

const ResumeBuilderContent = () => {
  const { t } = useTranslations();
  const { uiLanguage, contentLanguage } = useLanguage();
  const [notificationDialog, setNotificationDialog] = useState<{
    title: string;
    description: string;
    variant: NonNullable<ConfirmDialogProps['variant']>;
  } | null>(null);

  const showNotification = useCallback(
    (
      description: string,
      variant: NonNullable<ConfirmDialogProps['variant']> = 'default',
      title?: string
    ) => {
      const fallbackTitle = variant === 'success' ? t('common.success') : t('common.error');
      setNotificationDialog({
        title: title ?? fallbackTitle,
        description,
        variant,
      });
    },
    [t]
  );

  const initialData = useMemo(() => buildInitialData(t), [t]);
  const [resumeData, setResumeData] = useState<ResumeData>(() => initialData);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [lastSavedData, setLastSavedData] = useState<ResumeData>(() => initialData);
  const [isDownloading, setIsDownloading] = useState(false);
  const [loadingState, setLoadingState] = useState<'idle' | 'loading' | 'loaded' | 'error'>('idle');
  const [templateSettings, setTemplateSettings] =
    useState<TemplateSettings>(DEFAULT_TEMPLATE_SETTINGS);
  const { improvedData } = useResumePreview();
  const improvedPreview = improvedData?.data?.resume_preview;
  const improvedCoverLetter = improvedData?.data?.cover_letter;
  const improvedOutreach = improvedData?.data?.outreach_message;
  const improvedInterviewPrep = improvedData?.data?.interview_prep ?? null;
  const searchParams = useSearchParams();
  const router = useRouter();
  const resumeId = searchParams.get('id');

  useEffect(() => {
    if (resumeId || hasUnsavedChanges || improvedPreview) {
      return;
    }
    const savedDraft = localStorage.getItem(STORAGE_KEY);
    if (savedDraft) {
      return;
    }
    setResumeData(initialData);
    setLastSavedData(initialData);
  }, [initialData, resumeId, hasUnsavedChanges, improvedPreview]);

  // Tab state
  const [activeTab, setActiveTab] = useState<TabId>(() => getTabFromSearchParams(searchParams));

  // Editor panel mode (resume tab only)
  const [editorMode, setEditorMode] = useState<EditorMode>('content');

  useEffect(() => {
    setActiveTab(getTabFromSearchParams(searchParams));
  }, [searchParams]);

  // Cover letter & outreach state
  const [coverLetter, setCoverLetter] = useState('');
  const [outreachMessage, setOutreachMessage] = useState('');
  const [interviewPrep, setInterviewPrep] = useState<InterviewPrepData | null>(null);
  const [isCoverLetterSaving, setIsCoverLetterSaving] = useState(false);
  const [isOutreachSaving, setIsOutreachSaving] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const [resumeTitle, setResumeTitle] = useState<string | null>(null);

  // On-demand generation state
  const [isTailoredResume, setIsTailoredResume] = useState(false);
  const [isMaster, setIsMaster] = useState(false);
  const [showSaveAsMasterDialog, setShowSaveAsMasterDialog] = useState(false);
  const [isSavingAsMaster, setIsSavingAsMaster] = useState(false);
  const [saveMenuOpen, setSaveMenuOpen] = useState(false);
  const saveMenuRef = useRef<HTMLDivElement>(null);
  const [isGeneratingCoverLetter, setIsGeneratingCoverLetter] = useState(false);
  const [isGeneratingOutreach, setIsGeneratingOutreach] = useState(false);
  const [isGeneratingInterviewPrep, setIsGeneratingInterviewPrep] = useState(false);
  const [interviewPrepError, setInterviewPrepError] = useState<string | null>(null);
  const [showRegenerateDialog, setShowRegenerateDialog] = useState<
    'cover-letter' | 'outreach' | 'interview-prep' | null
  >(null);
  const [regenerateInstruction, setRegenerateInstruction] = useState('');

  useEffect(() => {
    if (!showRegenerateDialog) {
      setRegenerateInstruction('');
    }
  }, [showRegenerateDialog]);

  // JD comparison state
  const [jobDescription, setJobDescription] = useState<string | null>(null);
  const [jobContextStatus, setJobContextStatus] = useState<JobContextStatus>('idle');

  // AI Regenerate wizard
  const regenerateWizard = useRegenerateWizard({
    resumeId: resumeId || '',
    outputLanguage: contentLanguage,
    onSuccess: async () => {
      // Reload resume data after applying changes
      if (!resumeId) {
        return;
      }

      try {
        const data = await fetchResume(resumeId);
        // Update resume title for downloads
        setResumeTitle(data.title ?? null);
        if (data.processed_resume) {
          setResumeData(data.processed_resume as ResumeData);
          setLastSavedData(data.processed_resume as ResumeData);
          setHasUnsavedChanges(false);
        }
      } catch (error) {
        console.error('Failed to reload resume after applying regenerated changes:', error);
        showNotification(t('builder.alerts.reloadFailed'), 'danger');
        throw error;
      }
    },
    onError: (errorMessage) => {
      console.error('Error during regeneration or applying regenerated changes:', errorMessage);

      if (/network|fetch/i.test(errorMessage) || errorMessage.includes('Failed to fetch')) {
        showNotification(t('builder.regenerate.errors.networkError'), 'danger');
        return;
      }

      if (/resume content changed|uniquely matched|please regenerate/i.test(errorMessage)) {
        showNotification(t('builder.regenerate.errors.resumeChanged'), 'danger');
        return;
      }

      if (/generate/i.test(errorMessage)) {
        showNotification(t('builder.regenerate.errors.generationFailed'), 'danger');
        return;
      }

      showNotification(t('builder.regenerate.errors.applyFailed'), 'danger');
    },
  });

  // Build regenerate items from resume data
  const experienceItemsForRegenerate: RegenerateItemInput[] = useMemo(() => {
    return (resumeData.workExperience || []).map((exp, idx) => ({
      item_id: `exp_${idx}`,
      item_type: 'experience' as const,
      title: exp.title ?? '',
      subtitle: exp.company || undefined,
      current_content: Array.isArray(exp.description) ? exp.description : [],
    }));
  }, [resumeData.workExperience]);

  const projectItemsForRegenerate: RegenerateItemInput[] = useMemo(() => {
    return (resumeData.personalProjects || []).map((proj, idx) => ({
      item_id: `proj_${idx}`,
      item_type: 'project' as const,
      title: proj.name ?? '',
      subtitle: proj.role || undefined,
      current_content: Array.isArray(proj.description) ? proj.description : [],
    }));
  }, [resumeData.personalProjects]);

  const skillsItemForRegenerate: RegenerateItemInput | null = useMemo(() => {
    const skills = resumeData.additional?.technicalSkills;
    if (skills && skills.length > 0) {
      return {
        item_id: 'skills',
        item_type: 'skills' as const,
        title: t('builder.regenerate.selectDialog.skills'),
        current_content: skills,
      };
    }
    return null;
  }, [resumeData.additional?.technicalSkills, t]);

  const localizedResumeDataForPreview = useMemo(
    () => withLocalizedDefaultSections(resumeData, t),
    [resumeData, t]
  );

  // Load saved template settings after hydration (a lazy useState initializer
  // would read localStorage during hydration and mismatch the SSR'd defaults).
  useEffect(() => {
    try {
      const saved = localStorage.getItem(SETTINGS_STORAGE_KEY);
      if (saved) {
        setTemplateSettings(normalizeTemplateSettings(JSON.parse(saved)));
      }
    } catch {
      // fall through to defaults
    }
  }, []);

  // Save template settings to localStorage when they change
  useEffect(() => {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(templateSettings));
  }, [templateSettings]);

  // Debounced per-resume persistence of template/design settings so each
  // resume keeps its own design when reopened from the builder.
  const templateSettingsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!resumeId || loadingState !== 'loaded') {
      return;
    }
    if (templateSettingsTimerRef.current) {
      clearTimeout(templateSettingsTimerRef.current);
    }
    templateSettingsTimerRef.current = setTimeout(() => {
      updateResumeTemplateSettings(
        resumeId,
        templateSettings as unknown as Record<string, unknown>
      ).catch((error) => {
        console.error('Failed to save template settings:', error);
      });
    }, 600);
    return () => {
      if (templateSettingsTimerRef.current) {
        clearTimeout(templateSettingsTimerRef.current);
        templateSettingsTimerRef.current = null;
      }
    };
  }, [resumeId, loadingState, templateSettings]);

  // Warn user before leaving with unsaved changes
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasUnsavedChanges) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasUnsavedChanges]);

  // Close the Save dropdown on outside click or Escape
  useEffect(() => {
    if (!saveMenuOpen) {
      return;
    }
    const handleClickOutside = (event: MouseEvent) => {
      if (saveMenuRef.current && !saveMenuRef.current.contains(event.target as Node)) {
        setSaveMenuOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSaveMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [saveMenuOpen]);

  useEffect(() => {
    const loadResumeData = async () => {
      setLoadingState('loading');
      setIsMaster(false);

      // Priority 1: Fetch from API if ID is in URL (most reliable)
      if (resumeId) {
        try {
          const data = await fetchResume(resumeId);
          // Track if this is a tailored resume (has parent_id)
          setIsTailoredResume(Boolean(data.parent_id));
          setIsMaster(Boolean(data.is_master));
          // Per-resume template/design settings (fall back to the global
          // localStorage settings already applied on mount when unset).
          if (data.template_settings) {
            setTemplateSettings(
              normalizeTemplateSettings(data.template_settings as Partial<TemplateSettings>)
            );
          }
          // Store resume title for downloads
          setResumeTitle(data.title ?? null);
          // Load cover letter and outreach message if available
          if (data.cover_letter) {
            setCoverLetter(data.cover_letter);
          }
          if (data.outreach_message) {
            setOutreachMessage(data.outreach_message);
          }
          setInterviewPrep(data.interview_prep ?? null);
          setInterviewPrepError(null);
          // Prefer processed_resume if available
          if (data.processed_resume) {
            const processed = normalizeEntryIds(data.processed_resume as ResumeData);
            setResumeData(processed);
            setLastSavedData(processed);
            setLoadingState('loaded');
            return;
          }
          // Fallback to parsing raw content
          if (data.raw_resume?.content) {
            try {
              const parsed = normalizeEntryIds(JSON.parse(data.raw_resume.content) as ResumeData);
              setResumeData(parsed);
              setLastSavedData(parsed);
              setLoadingState('loaded');
              return;
            } catch {
              // Raw content is markdown, not JSON
            }
          }
        } catch (err) {
          console.error('Failed to load resume from API:', err);
        }
      }

      // Priority 2: Improved Data from Context (Tailor Flow)
      if (improvedPreview) {
        setIsTailoredResume(Boolean(improvedData?.data?.resume_id && improvedData.data.job_id));
        const previewData = normalizeEntryIds(improvedPreview as ResumeData);
        setResumeData(previewData);
        setLastSavedData(previewData);
        // Also load cover letter and outreach if present
        if (improvedCoverLetter) {
          setCoverLetter(improvedCoverLetter);
        }
        if (improvedOutreach) {
          setOutreachMessage(improvedOutreach);
        }
        setInterviewPrep(improvedInterviewPrep);
        setInterviewPrepError(null);
        // Persist to localStorage as backup
        localStorage.setItem(STORAGE_KEY, JSON.stringify(previewData));
        setLoadingState('loaded');
        return;
      }

      // Priority 3: Restore from localStorage (browser refresh recovery)
      const savedDraft = localStorage.getItem(STORAGE_KEY);
      if (savedDraft) {
        try {
          const parsed = normalizeEntryIds(JSON.parse(savedDraft) as ResumeData);
          setResumeData(parsed);
          setLastSavedData(parsed);
          setHasUnsavedChanges(true); // Mark as unsaved since it's a draft
          setLoadingState('loaded');
          return;
        } catch {
          localStorage.removeItem(STORAGE_KEY);
        }
      }

      // Fallback: Use initial data
      setLoadingState('loaded');
    };

    loadResumeData();
  }, [
    improvedData?.data?.job_id,
    improvedData?.data?.resume_id,
    improvedPreview,
    improvedCoverLetter,
    improvedOutreach,
    improvedInterviewPrep,
    resumeId,
  ]);

  // Fetch job description when we have a tailored resume
  useEffect(() => {
    let cancelled = false;

    const loadJobDescription = async () => {
      if (isTailoredResume && resumeId) {
        setJobDescription(null);
        setJobContextStatus('loading');
        try {
          const data = await fetchJobDescription(resumeId);
          if (!cancelled) {
            setJobDescription(data.content);
            setJobContextStatus('available');
          }
        } catch (err) {
          // JD might not be available for older resumes
          if (!cancelled) {
            console.warn('Could not fetch job description:', err);
            setJobDescription(null);
            setJobContextStatus('missing');
          }
        }
      } else {
        // Clear job description when switching to non-tailored resume
        setJobDescription(null);
        setJobContextStatus('idle');
      }
    };

    loadJobDescription();
    return () => {
      cancelled = true;
    };
  }, [isTailoredResume, resumeId]);

  const handleUpdate = useCallback((newData: ResumeData) => {
    setResumeData(newData);
    setHasUnsavedChanges(true);
    // Auto-save draft to localStorage
    localStorage.setItem(STORAGE_KEY, JSON.stringify(newData));
  }, []);

  const handleSettingsChange = useCallback((newSettings: TemplateSettings) => {
    setTemplateSettings(newSettings);
  }, []);

  // --- Auto-save to the backend -----------------------------------------
  // Debounced on resumeData changes; PATCHes are serialized (latest-wins
  // queue) so rapid typing can't reorder writes on the server.
  const persistResume = useCallback(
    async (data: ResumeData) => {
      const updated = await updateResume(resumeId!, data);
      return (updated.processed_resume || data) as ResumeData;
    },
    [resumeId]
  );

  const handlePersisted = useCallback((nextData: ResumeData) => {
    setResumeData(nextData);
    setLastSavedData(nextData);
    setHasUnsavedChanges(false);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nextData));
  }, []);

  const {
    status: autosaveStatus,
    flush: saveResume,
    cancelPending: cancelPendingAutosave,
  } = useResumeAutosave({
    enabled: Boolean(resumeId),
    loaded: loadingState === 'loaded',
    current: resumeData,
    lastSaved: lastSavedData,
    delayMs: AUTOSAVE_DELAY_MS,
    save: persistResume,
    onPersisted: handlePersisted,
  });

  const isSaving = autosaveStatus === 'saving';

  const handleSave = async () => {
    if (!resumeId) {
      showNotification(t('builder.alerts.saveNotAvailable'), 'warning');
      return;
    }
    cancelPendingAutosave();
    try {
      await saveResume(resumeData);
    } catch {
      showNotification(t('builder.alerts.saveFailed'), 'danger');
    }
  };

  const handleSaveAsMaster = async () => {
    if (!resumeId) {
      return;
    }
    setIsSavingAsMaster(true);
    try {
      // Flush any pending edits first so the promoted master holds the latest content.
      cancelPendingAutosave();
      if (JSON.stringify(resumeData) !== JSON.stringify(lastSavedData)) {
        await saveResume(resumeData);
      }
      const result = await saveResumeAsMaster(resumeId);
      setIsMaster(result.is_master);
      setShowSaveAsMasterDialog(false);
      showNotification(t('builder.alerts.saveAsMasterSuccess'), 'success');
    } catch {
      showNotification(t('builder.alerts.saveAsMasterFailed'), 'danger');
    } finally {
      setIsSavingAsMaster(false);
    }
  };

  const handleReset = () => {
    cancelPendingAutosave();
    setResumeData(lastSavedData);
    setHasUnsavedChanges(false);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(lastSavedData));
  };

  const getCompanyFromTitle = (title: string | null | undefined): string | null => {
    if (!title) return null;
    const atIdx = title.lastIndexOf(' @ ');
    return atIdx !== -1 ? title.substring(atIdx + 3).trim() : null;
  };

  const handleDownload = async () => {
    if (!resumeId) {
      showNotification(t('builder.alerts.downloadNotAvailable'), 'warning');
      return;
    }
    try {
      setIsDownloading(true);
      const blob = await downloadResumePdf(resumeId, templateSettings, uiLanguage);
      const company = getCompanyFromTitle(resumeTitle);
      const userName = resumeData.personalInfo?.name?.trim() || null;
      const filename = buildResumeFilename(userName, company, resumeId, 'resume');
      downloadBlobAsFile(blob, filename);
      showNotification(t('builder.alerts.downloadSuccess'), 'success');
    } catch (error) {
      console.error('Failed to download resume:', error);
      if (error instanceof TypeError && error.message.includes('Failed to fetch')) {
        const fallbackUrl = getResumePdfUrl(resumeId, templateSettings, uiLanguage);
        const didOpen = openUrlInNewTab(fallbackUrl);
        if (!didOpen) {
          showNotification(t('common.popupBlocked', { url: fallbackUrl }), 'warning');
        }
        return;
      }
      let errorMessage = t('builder.alerts.downloadFailed');
      if (error instanceof Error && error.message) {
        errorMessage = `${t('builder.alerts.downloadFailed')}: ${error.message}`;
      }
      showNotification(errorMessage, 'danger');
    } finally {
      setIsDownloading(false);
    }
  };

  // Cover letter handlers
  const handleSaveCoverLetter = async () => {
    if (!resumeId) return;
    try {
      setIsCoverLetterSaving(true);
      await updateCoverLetter(resumeId, coverLetter);
      showNotification(t('builder.alerts.coverLetterSaveSuccess'), 'success');
    } catch (error) {
      console.error('Failed to save cover letter:', error);
      showNotification(t('builder.alerts.coverLetterSaveFailed'), 'danger');
    } finally {
      setIsCoverLetterSaving(false);
    }
  };

  const handleDownloadCoverLetter = async () => {
    if (!resumeId) {
      showNotification(t('builder.alerts.coverLetterDownloadRequiresResume'), 'warning');
      return;
    }
    if (!coverLetter) {
      showNotification(t('builder.alerts.coverLetterMissing'), 'warning');
      return;
    }
    try {
      setIsDownloading(true);
      const blob = await downloadCoverLetterPdf(resumeId, templateSettings.pageSize, uiLanguage);
      const company = getCompanyFromTitle(resumeTitle);
      const userName = resumeData.personalInfo?.name?.trim() || null;
      const filename = buildResumeFilename(userName, company, resumeId, 'cover-letter');
      downloadBlobAsFile(blob, filename);
    } catch (error) {
      console.error('Failed to download cover letter:', error);
      if (error instanceof TypeError && error.message.includes('Failed to fetch')) {
        const fallbackUrl = getCoverLetterPdfUrl(resumeId, templateSettings.pageSize, uiLanguage);
        const didOpen = openUrlInNewTab(fallbackUrl);
        if (!didOpen) {
          showNotification(t('common.popupBlocked', { url: fallbackUrl }), 'warning');
        }
        return;
      }
      const errorMessage = error instanceof Error ? error.message : t('common.unknown');
      showNotification(
        t('builder.alerts.coverLetterDownloadFailed', { error: errorMessage }),
        'danger'
      );
    } finally {
      setIsDownloading(false);
    }
  };

  // Outreach handlers
  const handleSaveOutreach = async () => {
    if (!resumeId) return;
    try {
      setIsOutreachSaving(true);
      await updateOutreachMessage(resumeId, outreachMessage);
      showNotification(t('builder.alerts.outreachSaveSuccess'), 'success');
    } catch (error) {
      console.error('Failed to save outreach message:', error);
      showNotification(t('builder.alerts.outreachSaveFailed'), 'danger');
    } finally {
      setIsOutreachSaving(false);
    }
  };

  const handleCopyOutreach = async () => {
    try {
      await navigator.clipboard.writeText(outreachMessage);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy:', error);
    }
  };

  // On-demand generation handlers
  const doGenerateCoverLetter = async (instruction = '') => {
    if (!resumeId) return;
    setIsGeneratingCoverLetter(true);
    setShowRegenerateDialog(null);
    try {
      const content = await generateCoverLetter(resumeId, instruction);
      setCoverLetter(content);
    } catch (error) {
      console.error('Failed to generate cover letter:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      showNotification(
        t('builder.alerts.coverLetterGenerateFailed', { error: errorMessage }),
        'danger'
      );
    } finally {
      setIsGeneratingCoverLetter(false);
    }
  };

  const handleGenerateCoverLetter = () => {
    if (!resumeId) return;
    // If content exists, show confirmation dialog
    if (coverLetter) {
      setShowRegenerateDialog('cover-letter');
      return;
    }
    doGenerateCoverLetter();
  };

  const doGenerateOutreach = async (instruction = '') => {
    if (!resumeId) return;
    setIsGeneratingOutreach(true);
    setShowRegenerateDialog(null);
    try {
      const content = await generateOutreachMessage(resumeId, instruction);
      setOutreachMessage(content);
    } catch (error) {
      console.error('Failed to generate outreach message:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      showNotification(
        t('builder.alerts.outreachGenerateFailed', { error: errorMessage }),
        'danger'
      );
    } finally {
      setIsGeneratingOutreach(false);
    }
  };

  const handleGenerateOutreach = () => {
    if (!resumeId) return;
    // If content exists, show confirmation dialog
    if (outreachMessage) {
      setShowRegenerateDialog('outreach');
      return;
    }
    doGenerateOutreach();
  };

  const canGenerateInterviewPrep =
    Boolean(resumeId) && isTailoredResume && jobContextStatus === 'available';

  const interviewPrepUnavailableMessage = !resumeId
    ? t('interviewPrep.saveRequiredDescription')
    : jobContextStatus === 'loading'
      ? t('interviewPrep.loadingContextDescription')
      : jobContextStatus === 'missing'
        ? t('interviewPrep.missingContextDescription')
        : null;

  const doGenerateInterviewPrep = async (instruction = '') => {
    if (!canGenerateInterviewPrep || !resumeId) return;
    setIsGeneratingInterviewPrep(true);
    setInterviewPrepError(null);
    setShowRegenerateDialog(null);
    try {
      const content = await generateInterviewPrep(resumeId, instruction);
      setInterviewPrep(content);
    } catch (error) {
      console.error('Failed to generate interview preparation:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      setInterviewPrepError(
        t('builder.alerts.interviewPrepGenerateFailed', { error: errorMessage })
      );
      showNotification(
        t('builder.alerts.interviewPrepGenerateFailed', { error: errorMessage }),
        'danger'
      );
    } finally {
      setIsGeneratingInterviewPrep(false);
    }
  };

  const handleGenerateInterviewPrep = () => {
    if (!canGenerateInterviewPrep) return;
    if (interviewPrep) {
      setShowRegenerateDialog('interview-prep');
      return;
    }
    doGenerateInterviewPrep();
  };

  const regenerateDialogContentTitle =
    showRegenerateDialog === 'cover-letter'
      ? t('coverLetter.title')
      : showRegenerateDialog === 'outreach'
        ? t('outreach.title')
        : t('interviewPrep.title');

  const regenerateDialogConfirmLabel =
    showRegenerateDialog === 'cover-letter'
      ? t('coverLetter.regenerate')
      : showRegenerateDialog === 'outreach'
        ? t('outreach.regenerate')
        : t('interviewPrep.regenerate');

  const handleConfirmRegenerate = () => {
    if (showRegenerateDialog === 'cover-letter') {
      doGenerateCoverLetter(regenerateInstruction);
    } else if (showRegenerateDialog === 'outreach') {
      doGenerateOutreach(regenerateInstruction);
    } else if (showRegenerateDialog === 'interview-prep') {
      doGenerateInterviewPrep(regenerateInstruction);
    }
  };

  return (
    <div className="flex min-h-screen w-full justify-center bg-secondary px-4 py-4 md:px-8 md:py-8">
      {/* Main Container (Card) */}
      <div className="flex w-full max-w-[90%] flex-col overflow-hidden rounded-2xl border border-border bg-white shadow-sw-lg md:max-w-[95%] xl:max-w-[1800px]">
        {/* Header Section */}
        <div className="no-print border-b border-[#e6e3dc] bg-white p-6 md:p-8">
          {/* Top Row: Back button and Actions */}
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6">
            <div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => router.push('/dashboard')}
                className="mb-3 -ml-1 rounded-full px-3 text-ink-soft hover:text-primary"
              >
                <ArrowLeft className="w-4 h-4" />
                {t('nav.backToDashboard')}
              </Button>
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-3xl font-bold uppercase tracking-tight text-ink md:text-4xl">
                  {t('nav.builder')}
                </h1>
                {hasUnsavedChanges && (
                  <span className="flex items-center gap-1.5 rounded-full border border-amber-200 bg-[#fbf6e9] px-2.5 py-1 text-[11px] font-semibold text-amber-700">
                    <AlertTriangle className="w-3 h-3" />
                    {t('builder.unsavedDraft')}
                  </span>
                )}
                {autosaveStatus === 'saving' && (
                  <span className="flex items-center gap-1.5 rounded-full border border-[#c9c5bc] bg-white px-2.5 py-1 text-[11px] font-semibold text-steel-grey">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    {t('common.saving')}
                  </span>
                )}
                {autosaveStatus === 'saved' && (
                  <span className="flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
                    <Check className="w-3 h-3" />
                    {t('common.autosaved')}
                  </span>
                )}
                {autosaveStatus === 'error' && (
                  <span className="flex items-center gap-1.5 rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-[11px] font-semibold text-red-700">
                    <AlertTriangle className="w-3 h-3" />
                    {t('builder.alerts.saveFailed')}
                  </span>
                )}
              </div>
              <p className="mt-2 text-xs font-bold uppercase tracking-wide text-primary">
                {'// '}
                {resumeId ? t('builder.editMode') : t('builder.createAndPreview')}
              </p>
            </div>

            <div className="flex gap-3 mt-4 md:mt-0">
              {/* Resume tab actions */}
              {activeTab === 'resume' && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => regenerateWizard.startRegenerate()}
                    disabled={!resumeId}
                  >
                    <Sparkles className="w-4 h-4" />
                    {t('builder.regenerate.buttonLabel')}
                  </Button>
                  <Button
                    variant="warning"
                    size="sm"
                    onClick={handleReset}
                    disabled={!hasUnsavedChanges}
                  >
                    <RotateCcw className="w-4 h-4" />
                    {t('common.reset')}
                  </Button>
                  <div className="relative flex items-stretch" ref={saveMenuRef}>
                    <Button
                      size="sm"
                      onClick={handleSave}
                      disabled={!resumeId || isSaving}
                      className="rounded-r-none border-r-0"
                    >
                      <Save className="w-4 h-4" />
                      {isSaving ? t('common.saving') : t('common.save')}
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => setSaveMenuOpen((open) => !open)}
                      disabled={!resumeId || isSaving}
                      aria-haspopup="menu"
                      aria-expanded={saveMenuOpen}
                      aria-label={t('builder.actions.saveMoreOptions')}
                      className="rounded-l-none border-l-0 px-2"
                    >
                      <ChevronDown
                        className={`w-4 h-4 transition-transform duration-200 ${
                          saveMenuOpen ? 'rotate-180' : ''
                        }`}
                      />
                    </Button>
                    {saveMenuOpen && (
                      <div
                        role="menu"
                        aria-label={t('common.save')}
                        className="absolute right-0 top-full z-50 mt-1 min-w-56 rounded-xl border border-[#e6e3dc] bg-white p-1.5 shadow-sw-lg"
                      >
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setSaveMenuOpen(false);
                            void handleSave();
                          }}
                          disabled={!resumeId || isSaving}
                          className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm font-semibold text-ink transition-colors duration-150 hover:bg-paper-tint disabled:pointer-events-none disabled:opacity-50"
                        >
                          <Save className="h-4 w-4 shrink-0" />
                          {isSaving ? t('common.saving') : t('common.save')}
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setSaveMenuOpen(false);
                            setShowSaveAsMasterDialog(true);
                          }}
                          disabled={!resumeId || isMaster || loadingState !== 'loaded'}
                          title={isMaster ? t('builder.actions.alreadyMaster') : undefined}
                          className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm font-semibold text-ink transition-colors duration-150 hover:bg-paper-tint disabled:pointer-events-none disabled:opacity-50"
                        >
                          <Star className="h-4 w-4 shrink-0" />
                          {t('builder.actions.saveAsMaster')}
                        </button>
                      </div>
                    )}
                  </div>
                  <Button
                    variant="success"
                    size="sm"
                    onClick={handleDownload}
                    disabled={!resumeId || isDownloading}
                  >
                    <Download className="w-4 h-4" />
                    {isDownloading ? t('common.generating') : t('common.download')}
                  </Button>
                </>
              )}

              {/* Cover letter tab actions */}
              {activeTab === 'cover-letter' && coverLetter && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleGenerateCoverLetter}
                    disabled={isGeneratingCoverLetter}
                  >
                    {isGeneratingCoverLetter ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Sparkles className="w-4 h-4" />
                    )}
                    {t('coverLetter.regenerate')}
                  </Button>
                  <Button
                    variant="success"
                    size="sm"
                    onClick={handleDownloadCoverLetter}
                    disabled={!resumeId || isDownloading}
                  >
                    <Download className="w-4 h-4" />
                    {isDownloading ? t('common.generating') : t('common.download')}
                  </Button>
                </>
              )}

              {/* Outreach tab actions */}
              {activeTab === 'outreach' && outreachMessage && (
                <>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleGenerateOutreach}
                    disabled={isGeneratingOutreach}
                  >
                    {isGeneratingOutreach ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Sparkles className="w-4 h-4" />
                    )}
                    {t('outreach.regenerate')}
                  </Button>
                  <Button variant="success" size="sm" onClick={handleCopyOutreach}>
                    {isCopied ? (
                      <>
                        <Check className="w-4 h-4" />
                        {t('outreach.copied')}
                      </>
                    ) : (
                      <>
                        <Copy className="w-4 h-4" />
                        {t('outreach.copyToClipboard')}
                      </>
                    )}
                  </Button>
                </>
              )}

              {/* Interview prep tab actions */}
              {activeTab === 'interview-prep' && interviewPrep && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleGenerateInterviewPrep}
                  disabled={!canGenerateInterviewPrep || isGeneratingInterviewPrep}
                >
                  {isGeneratingInterviewPrep ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : (
                    <Sparkles className="w-4 h-4" />
                  )}
                  {t('interviewPrep.regenerate')}
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* Content Grid */}
        <div className="grid grid-cols-1 gap-px bg-[#e6e3dc] lg:h-[900px] lg:grid-cols-2">
          {/* Left Panel: Editor */}
          <div className="no-print overflow-y-auto bg-white p-6 md:p-8">
            <div className="mx-auto max-w-3xl space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e6e3dc] pb-3">
                <div className="flex items-center gap-2">
                  <div className="h-2.5 w-2.5 rounded-sm bg-primary"></div>
                  <h2 className="text-base font-bold uppercase tracking-wider text-ink">
                    {activeTab === 'resume' && t('builder.leftPanel.editorPanel')}
                    {activeTab === 'cover-letter' && t('builder.leftPanel.coverLetterEditor')}
                    {activeTab === 'outreach' && t('builder.leftPanel.outreachEditor')}
                    {activeTab === 'interview-prep' && t('builder.leftPanel.interviewPrep')}
                    {activeTab === 'jd-match' && t('builder.leftPanel.jdMatchAnalysis')}
                  </h2>
                </div>

                {/* Editor Mode Switch (resume only) */}
                {activeTab === 'resume' && (
                  <RetroTabs
                    activeTab={editorMode}
                    onTabChange={(mode) => setEditorMode(mode as EditorMode)}
                    tabs={[
                      { id: 'design', label: t('builder.editorModes.design') },
                      { id: 'content', label: t('builder.editorModes.content') },
                    ]}
                  />
                )}
              </div>

              {/* Resume Editor */}
              {activeTab === 'resume' && (
                <>
                  <div className={editorMode === 'design' ? '' : 'hidden'}>
                    <FormattingControls
                      settings={templateSettings}
                      onChange={handleSettingsChange}
                      resumeData={resumeData}
                      onResumeDataUpdate={handleUpdate}
                    />
                  </div>
                  <div className={editorMode === 'content' ? '' : 'hidden'}>
                    <ResumeForm
                      resumeData={resumeData}
                      onUpdate={handleUpdate}
                      outputLanguage={contentLanguage}
                    />
                  </div>
                </>
              )}

              {/* Cover Letter Editor */}
              {activeTab === 'cover-letter' &&
                (coverLetter ? (
                  <CoverLetterEditor
                    content={coverLetter}
                    onChange={setCoverLetter}
                    onSave={handleSaveCoverLetter}
                    isSaving={isCoverLetterSaving}
                  />
                ) : (
                  <GeneratePrompt
                    type="cover-letter"
                    isGenerating={isGeneratingCoverLetter}
                    onGenerate={handleGenerateCoverLetter}
                    isTailoredResume={isTailoredResume}
                  />
                ))}

              {/* Outreach Editor */}
              {activeTab === 'outreach' &&
                (outreachMessage ? (
                  <OutreachEditor
                    content={outreachMessage}
                    onChange={setOutreachMessage}
                    onSave={handleSaveOutreach}
                    isSaving={isOutreachSaving}
                  />
                ) : (
                  <GeneratePrompt
                    type="outreach"
                    isGenerating={isGeneratingOutreach}
                    onGenerate={handleGenerateOutreach}
                    isTailoredResume={isTailoredResume}
                  />
                ))}

              {/* Interview Prep Read-Only View */}
              {activeTab === 'interview-prep' && (
                <InterviewPrepView
                  interviewPrep={interviewPrep}
                  isGenerating={isGeneratingInterviewPrep}
                  error={interviewPrepError}
                  onGenerate={handleGenerateInterviewPrep}
                  isTailoredResume={isTailoredResume}
                  canGenerate={canGenerateInterviewPrep}
                  unavailableMessage={interviewPrepUnavailableMessage}
                  className="p-0"
                />
              )}

              {/* JD Match Info Panel */}
              {activeTab === 'jd-match' && (
                <div className="space-y-4">
                  <div className="rounded-2xl border border-[#e6e3dc] bg-white p-5 shadow-sw-xs">
                    <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-ink">
                      {t('builder.jdMatch.aboutTitle')}
                    </h3>
                    <p className="text-sm leading-relaxed text-ink-soft">
                      {t('builder.jdMatch.aboutDescription')}
                    </p>
                  </div>

                  <div className="rounded-2xl border border-[#e6e3dc] bg-white p-5 shadow-sw-xs">
                    <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-ink">
                      {t('builder.jdMatch.highlightedKeywordsTitle')}
                    </h3>
                    <p className="text-sm leading-relaxed text-ink-soft">
                      {(() => {
                        const template = t(
                          'builder.jdMatch.highlightedKeywordsDescriptionTemplate'
                        );
                        const parts = template.split('__COLOR__');
                        if (parts.length < 2) return template;
                        return (
                          <>
                            {parts[0]}
                            <mark className="bg-yellow-200 px-1">
                              {t('builder.jdMatch.highlightColor')}
                            </mark>
                            {parts.slice(1).join('__COLOR__')}
                          </>
                        );
                      })()}
                    </p>
                  </div>

                  <div className="rounded-2xl border border-[#e6e3dc] bg-white p-5 shadow-sw-xs">
                    <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-ink">
                      {t('builder.jdMatch.tipsTitle')}
                    </h3>
                    <ul className="space-y-1 text-sm text-ink-soft list-disc list-inside">
                      <li>{t('builder.jdMatch.tips.items.addMissingKeywords')}</li>
                      <li>{t('builder.jdMatch.tips.items.focusTechnicalSkills')}</li>
                      <li>{t('builder.jdMatch.tips.items.matchActionVerbs')}</li>
                    </ul>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Right Panel: Preview with Tabs */}
          <div className="no-print flex min-h-0 flex-col bg-white p-4 md:p-6">
            {/* Preview Card */}
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-[#e6e3dc] bg-white shadow-sw-sm">
              {/* Tabs Header */}
              <div className="shrink-0 border-b border-[#e6e3dc] bg-white px-4 pt-4 pb-3">
                <RetroTabs
                  tabs={[
                    { id: 'resume', label: t('builder.previewTabs.resume') },
                    {
                      id: 'cover-letter',
                      label: t('builder.previewTabs.coverLetter'),
                      disabled: !coverLetter,
                    },
                    {
                      id: 'outreach',
                      label: t('builder.previewTabs.outreach'),
                      disabled: !outreachMessage,
                    },
                    {
                      id: 'interview-prep',
                      label: t('builder.previewTabs.interviewPrep'),
                      disabled: !isTailoredResume,
                    },
                    {
                      id: 'jd-match',
                      label: t('builder.previewTabs.jdMatch'),
                      disabled: !jobDescription,
                    },
                  ]}
                  activeTab={activeTab}
                  onTabChange={(id) => setActiveTab(id as TabId)}
                />
              </div>

              {/* Preview Content */}
              <div className="flex-1 overflow-y-auto">
                {/* Resume Preview */}
                {activeTab === 'resume' && (
                  <PaginatedPreview
                    resumeData={localizedResumeDataForPreview}
                    settings={templateSettings}
                  />
                )}

                {/* Cover Letter Preview */}
                {activeTab === 'cover-letter' &&
                  (coverLetter && resumeData.personalInfo ? (
                    <div className="p-6">
                      <CoverLetterPreview
                        content={coverLetter}
                        personalInfo={resumeData.personalInfo}
                        pageSize={templateSettings.pageSize}
                      />
                    </div>
                  ) : (
                    <GeneratePrompt
                      type="cover-letter"
                      isGenerating={isGeneratingCoverLetter}
                      onGenerate={handleGenerateCoverLetter}
                      isTailoredResume={isTailoredResume}
                    />
                  ))}

                {/* Outreach Preview */}
                {activeTab === 'outreach' &&
                  (outreachMessage ? (
                    <div className="p-6">
                      <OutreachPreview content={outreachMessage} />
                    </div>
                  ) : (
                    <GeneratePrompt
                      type="outreach"
                      isGenerating={isGeneratingOutreach}
                      onGenerate={handleGenerateOutreach}
                      isTailoredResume={isTailoredResume}
                    />
                  ))}

                {/* Interview Prep Preview */}
                {activeTab === 'interview-prep' && (
                  <InterviewPrepView
                    interviewPrep={interviewPrep}
                    isGenerating={isGeneratingInterviewPrep}
                    error={interviewPrepError}
                    onGenerate={handleGenerateInterviewPrep}
                    isTailoredResume={isTailoredResume}
                    canGenerate={canGenerateInterviewPrep}
                    unavailableMessage={interviewPrepUnavailableMessage}
                  />
                )}

                {/* JD Match Comparison */}
                {activeTab === 'jd-match' && jobDescription && (
                  <JDComparisonView jobDescription={jobDescription} resumeData={resumeData} />
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="no-print flex shrink-0 items-center justify-between border-t border-border bg-white px-6 py-3 text-xs font-bold uppercase tracking-wide text-primary">
          <span className="flex items-center gap-2">
            <Image src="/logo.svg" alt="Taylor" width={20} height={20} className="h-5 w-5" />
            {t('builder.footer.moduleLabel')}
          </span>
          <div className="flex items-center gap-4 text-ink-soft">
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-success"></div>
              <span className="uppercase">
                {templateSettings.template === 'swiss-single' ||
                templateSettings.template === 'modern' ||
                templateSettings.template === 'latex' ||
                templateSettings.template === 'clean'
                  ? t('builder.footer.singleColumn')
                  : t('builder.footer.twoColumn')}
              </span>
            </div>
            <span className="text-steel-grey">|</span>
            <span className="uppercase">
              {templateSettings.pageSize === 'A4' ? 'A4' : t('builder.pageSize.usLetter')}
            </span>
          </div>
        </div>
      </div>

      {/* Regenerate Confirmation Dialog */}
      <ConfirmDialog
        open={showRegenerateDialog !== null}
        onOpenChange={(open) => !open && setShowRegenerateDialog(null)}
        title={t('builder.regenerateDialog.title', {
          title: regenerateDialogContentTitle,
        })}
        description={t('builder.regenerateDialog.description', {
          title: regenerateDialogContentTitle,
        })}
        confirmLabel={regenerateDialogConfirmLabel}
        cancelLabel={t('common.cancel')}
        variant="warning"
        onConfirm={handleConfirmRegenerate}
      >
        <div className="space-y-1.5">
          <label
            htmlFor="regenerate-instruction"
            className="block text-[11px] font-bold uppercase tracking-wider text-ink-soft"
          >
            {t('builder.regenerateDialog.instructionLabel')}
          </label>
          <Textarea
            id="regenerate-instruction"
            value={regenerateInstruction}
            onChange={(e) => setRegenerateInstruction(e.target.value)}
            placeholder={t('builder.regenerateDialog.instructionPlaceholder')}
            rows={3}
            className="resize-none"
          />
        </div>
      </ConfirmDialog>

      {/* Save as Master Confirmation Dialog */}
      <ConfirmDialog
        open={showSaveAsMasterDialog}
        onOpenChange={(open) => !open && setShowSaveAsMasterDialog(false)}
        title={t('builder.actions.saveAsMasterConfirmTitle')}
        description={t('builder.actions.saveAsMasterConfirmDescription')}
        confirmLabel={t('builder.actions.saveAsMasterConfirmLabel')}
        cancelLabel={t('common.cancel')}
        variant="success"
        confirmDisabled={isSavingAsMaster}
        onConfirm={handleSaveAsMaster}
      />

      {/* Notification Dialog (replaces native alert()) */}
      <ConfirmDialog
        open={notificationDialog !== null}
        onOpenChange={(open) => !open && setNotificationDialog(null)}
        title={notificationDialog?.title ?? ''}
        description={notificationDialog?.description ?? ''}
        confirmLabel={t('common.ok')}
        showCancelButton={false}
        variant={notificationDialog?.variant ?? 'default'}
        onConfirm={() => setNotificationDialog(null)}
      />

      {/* AI Regenerate Wizard */}
      <RegenerateWizard
        step={regenerateWizard.step}
        onStepChange={regenerateWizard.setStep}
        experienceItems={experienceItemsForRegenerate}
        projectItems={projectItemsForRegenerate}
        skillsItem={skillsItemForRegenerate}
        selectedItems={regenerateWizard.selectedItems}
        onSelectionChange={regenerateWizard.setSelectedItems}
        instruction={regenerateWizard.instruction}
        onInstructionChange={regenerateWizard.setInstruction}
        regeneratedItems={regenerateWizard.regeneratedItems}
        regenerateErrors={regenerateWizard.regenerateErrors}
        isGenerating={regenerateWizard.isGenerating}
        isApplying={regenerateWizard.isApplying}
        error={regenerateWizard.error}
        onGenerate={regenerateWizard.generate}
        onAccept={regenerateWizard.acceptChanges}
        onReject={regenerateWizard.rejectAndRegenerate}
        onClose={regenerateWizard.reset}
      />
    </div>
  );
};

export const ResumeBuilder = () => {
  const { t } = useTranslations();
  return (
    <Suspense fallback={<div>{t('common.loading')}</div>}>
      <ResumeBuilderContent />
    </Suspense>
  );
};
