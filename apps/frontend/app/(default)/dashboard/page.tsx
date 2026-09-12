'use client';

import { ResumeUploadDialog } from '@/components/dashboard/resume-upload-dialog';
import { MasterResumeChoiceDialog } from '@/components/dashboard/master-resume-choice-dialog';
import { useState, useEffect, useCallback, useRef, type KeyboardEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import Link from 'next/link';
import Image from 'next/image';
import { useTranslations } from '@/lib/i18n';

import Loader2 from 'lucide-react/dist/esm/icons/loader-2';
import AlertCircle from 'lucide-react/dist/esm/icons/alert-circle';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw';
import Settings from 'lucide-react/dist/esm/icons/settings';
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle';
import Search from 'lucide-react/dist/esm/icons/search';
import Plus from 'lucide-react/dist/esm/icons/plus';
import FileText from 'lucide-react/dist/esm/icons/file-text';
import Building2 from 'lucide-react/dist/esm/icons/building-2';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right';
import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2';
import Copy from 'lucide-react/dist/esm/icons/copy';
import UserRound from 'lucide-react/dist/esm/icons/user-round';
import Users from 'lucide-react/dist/esm/icons/users';
import Sparkles from 'lucide-react/dist/esm/icons/sparkles';
import Smartphone from 'lucide-react/dist/esm/icons/smartphone';
import GraduationCap from 'lucide-react/dist/esm/icons/graduation-cap';

import {
  fetchResume,
  fetchResumeList,
  deleteResume,
  retryProcessing,
  copyResume,
  fetchJobDescription,
  type ResumeListItem,
} from '@/lib/api/resume';
import { fetchJobs, type MobileJob } from '@/lib/api/jobs';
import { useStatusCache } from '@/lib/context/status-cache';

type ProcessingStatus = 'pending' | 'processing' | 'ready' | 'failed' | 'loading';

export default function DashboardPage() {
  const { t, locale } = useTranslations();
  const [masterResumeId, setMasterResumeId] = useState<string | null>(null);
  const [masters, setMasters] = useState<ResumeListItem[]>([]);
  const [processingStatus, setProcessingStatus] = useState<ProcessingStatus>('loading');
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [tailoredResumes, setTailoredResumes] = useState<ResumeListItem[]>([]);
  const [phoneJobs, setPhoneJobs] = useState<MobileJob[]>([]);
  const [isRetrying, setIsRetrying] = useState(false);
  const [copyingId, setCopyingId] = useState<string | null>(null);
  const tailoredSectionRef = useRef<HTMLDivElement>(null);
  const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false);
  const [isMasterChoiceDialogOpen, setIsMasterChoiceDialogOpen] = useState(false);
  const router = useRouter();

  const {
    status: systemStatus,
    isLoading: statusLoading,
    incrementResumes,
    decrementResumes,
    setHasMasterResume,
  } = useStatusCache();

  const loadRequestIdRef = useRef(0);
  const jobSnippetCacheRef = useRef<Record<string, string>>({});
  const [currentPage, setCurrentPage] = useState(1);
  const ITEMS_PER_PAGE = 4;

  const isLlmConfigured = !statusLoading && systemStatus?.llm_configured;

  const anyMasterReady = masters.some((m) => m.processing_status === 'ready');

  const isTailorEnabled = anyMasterReady && isLlmConfigured;

  const formatDate = (value: string) => {
    if (!value) return t('common.unknown');
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return t('common.unknown');
    const dateLocale =
      locale === 'es' ? 'es-ES' : locale === 'zh' ? 'zh-CN' : locale === 'ja' ? 'ja-JP' : 'en-US';
    return date.toLocaleDateString(dateLocale, { month: 'short', day: '2-digit', year: 'numeric' });
  };

  const checkResumeStatus = useCallback(async (resumeId: string) => {
    try {
      setProcessingStatus('loading');
      const data = await fetchResume(resumeId);
      const status = data.raw_resume?.processing_status || 'pending';
      setProcessingStatus(status as ProcessingStatus);
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes('404')) {
        localStorage.removeItem('master_resume_id');
        setMasterResumeId(null);
        return;
      }
      setProcessingStatus('failed');
    }
  }, []);

  useEffect(() => {
    const storedId = localStorage.getItem('master_resume_id');
    if (storedId) {
      setMasterResumeId(storedId);
      checkResumeStatus(storedId);
    }
  }, [checkResumeStatus]);

  const loadTailoredResumes = useCallback(async () => {
    try {
      const data = await fetchResumeList(true);
      const mastersList = data.filter((r) => r.is_master);
      setMasters(mastersList);

      const storedId = localStorage.getItem('master_resume_id');
      const resolvedMasterId = mastersList.some((r) => r.resume_id === storedId)
        ? storedId
        : (mastersList[0]?.resume_id ?? null);

      if (resolvedMasterId) {
        localStorage.setItem('master_resume_id', resolvedMasterId);
        setMasterResumeId(resolvedMasterId);
        checkResumeStatus(resolvedMasterId);
      } else {
        localStorage.removeItem('master_resume_id');
        setMasterResumeId(null);
        setProcessingStatus('loading');
      }

      const filtered = data.filter((r) => !r.is_master);
      setTailoredResumes(filtered);

      const tailoredWithParent = filtered.filter((r) => r.parent_id);
      const requestId = ++loadRequestIdRef.current;
      const jobSnippets: Record<string, string> = {};

      await Promise.all(
        tailoredWithParent.map(async (r) => {
          if (jobSnippetCacheRef.current[r.resume_id]) {
            jobSnippets[r.resume_id] = jobSnippetCacheRef.current[r.resume_id];
            return;
          }
          try {
            const jd = await fetchJobDescription(r.resume_id);
            const snippet = (jd?.content || '').slice(0, 80);
            jobSnippetCacheRef.current[r.resume_id] = snippet;
            jobSnippets[r.resume_id] = snippet;
          } catch {
            jobSnippetCacheRef.current[r.resume_id] = '';
            jobSnippets[r.resume_id] = '';
          }
        })
      );

      if (requestId === loadRequestIdRef.current) {
        setTailoredResumes((prev) =>
          prev.map((r) => ({ ...r, jobSnippet: jobSnippets[r.resume_id] || '' }))
        );
      }
    } catch (err) {
      console.error('Failed to load tailored resumes:', err);
    }
  }, [checkResumeStatus]);

  useEffect(() => {
    loadTailoredResumes();
  }, [loadTailoredResumes]);

  const loadPhoneJobs = useCallback(async () => {
    try {
      const jobs = await fetchJobs({ limit: 50 });
      setPhoneJobs(jobs);
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    loadPhoneJobs();
  }, [loadPhoneJobs]);

  useEffect(() => {
    const handleFocus = () => {
      loadTailoredResumes();
      loadPhoneJobs();
    };
    window.addEventListener('focus', handleFocus);
    return () => window.removeEventListener('focus', handleFocus);
  }, [loadTailoredResumes, loadPhoneJobs, checkResumeStatus]);

  const handleUploadComplete = (resumeId: string) => {
    localStorage.setItem('master_resume_id', resumeId);
    setMasterResumeId(resumeId);
    checkResumeStatus(resumeId);
    incrementResumes();
    setHasMasterResume(true);
    loadTailoredResumes();
  };

  const handleChooseUpload = () => {
    setIsMasterChoiceDialogOpen(false);
    setIsUploadDialogOpen(true);
  };

  const handleChooseWizard = () => {
    setIsMasterChoiceDialogOpen(false);
    router.push('/resume-wizard');
  };

  const handleInitializeMasterKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setIsMasterChoiceDialogOpen(true);
    }
  };

  const handleRetryProcessing = async (e: React.MouseEvent, resumeId: string) => {
    e.stopPropagation();
    setIsRetrying(true);
    try {
      const result = await retryProcessing(resumeId);
      await loadTailoredResumes();
      if (resumeId === masterResumeId) {
        setProcessingStatus(result.processing_status as ProcessingStatus);
      }
    } catch (err) {
      console.error('Retry processing failed:', err);
      if (resumeId === masterResumeId) setProcessingStatus('failed');
    } finally {
      setIsRetrying(false);
    }
  };

  const handleDeleteAndReupload = (e: React.MouseEvent, resumeId: string) => {
    e.stopPropagation();
    setDeleteTargetId(resumeId);
    setShowDeleteDialog(true);
  };
  const colors = [
    'bg-red-500',
    'bg-blue-500',
    'bg-green-500',
    'bg-yellow-500',
    'bg-purple-500',
    'bg-pink-500',
  ];
  const confirmDeleteAndReupload = async () => {
    const resumeId = deleteTargetId ?? masterResumeId;
    if (!resumeId) return;
    try {
      await deleteResume(resumeId);
      decrementResumes();
      if (resumeId === masterResumeId) {
        localStorage.removeItem('master_resume_id');
        setMasterResumeId(null);
        setProcessingStatus('loading');
      }
      setIsUploadDialogOpen(true);
      await loadTailoredResumes();
    } catch (err) {
      console.error('Failed to delete resume:', err);
    } finally {
      setDeleteTargetId(null);
    }
  };

  const handleCopyMaster = async (e: React.MouseEvent, resumeId: string) => {
    e.stopPropagation();
    setCopyingId(resumeId);
    try {
      await copyResume(resumeId);
      await loadTailoredResumes();
      tailoredSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (err) {
      console.error('Failed to copy resume:', err);
    } finally {
      setCopyingId(null);
    }
  };

  const handleDeleteTailored = async (e: React.MouseEvent, resumeId: string) => {
    e.stopPropagation();
    try {
      await deleteResume(resumeId);
      await loadTailoredResumes();
      setCurrentPage((prev) => {
        const maxPage = Math.max(1, Math.ceil((tailoredResumes.length - 1) / ITEMS_PER_PAGE));
        return Math.min(prev, maxPage);
      });
    } catch (err) {
      console.error('Failed to delete resume:', err);
    }
  };

  const getStatusBadge = (status: ProcessingStatus = processingStatus) => {
    switch (status) {
      case 'loading':
        return (
          <span className="inline-flex items-center gap-1.5 text-xs  text-steel-grey uppercase">
            <Loader2 className="w-3 h-3 animate-spin" />
            Checking
          </span>
        );
      case 'processing':
        return (
          <span className="inline-flex items-center gap-1.5 text-xs  text-primary uppercase">
            <Loader2 className="w-3 h-3 animate-spin" />
            Processing
          </span>
        );
      case 'ready':
        return (
          <span className="inline-flex items-center gap-1.5 text-xs  text-green-700 uppercase">
            <div className="w-1.5 h-1.5 bg-green-700" />
            Ready
          </span>
        );
      case 'failed':
        return (
          <span className="inline-flex items-center gap-1.5 text-xs  text-red-600 uppercase">
            <AlertCircle className="w-3 h-3" />
            Failed
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 text-xs  text-steel-grey uppercase">
            Pending
          </span>
        );
    }
  };

  return (
    <div className="min-h-screen ">
      <div className="max-w-7xl mx-auto px-6 py-10">
        {/* LLM Config Warning */}
        {masters.length > 0 && !isLlmConfigured && !statusLoading && (
          <div className="border border-ink bg-[#fbf6e9] p-4 mb-8 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <AlertTriangle className="w-4 h-4 text-warning" />
              <div>
                <p className=" text-xs font-bold uppercase tracking-wider text-amber-800">
                  {t('dashboard.llmNotConfiguredTitle')}
                </p>
                <p className=" text-xs text-amber-700 mt-0.5">
                  {t('dashboard.llmNotConfiguredMessage')}
                </p>
              </div>
            </div>
            <Link href="/settings">
              <Button variant="outline" size="sm" className="border-warning text-amber-700 text-xs">
                <Settings className="w-3 h-3 mr-1" />
                Settings
              </Button>
            </Link>
          </div>
        )}

        {/* Header */}
        <div className="mb-10 flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link href="/" className="shrink-0">
              <Image src="/logo.png" alt="Taylor" width={40} height={40} className="w-10 h-10" />
            </Link>
            <div>
              <h1 className="text-4xl md:text-5xl font-bold uppercase tracking-tight">Dashboard</h1>
              <p className="mt-2  text-xs text-ink-soft uppercase tracking-wide">
                {t('dashboard.subtitle')}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Link href="/profile">
              <Button variant="outline" size="sm" className="border-ink text-xs uppercase">
                <UserRound className="w-3.5 h-3.5 mr-1" />
                {t('nav.profile')}
              </Button>
            </Link>
            <Link href="/settings">
              <Button variant="outline" size="sm" className="border-ink text-xs uppercase">
                <Settings className="w-3.5 h-3.5 mr-1" />
                {t('nav.settings')}
              </Button>
            </Link>
          </div>
        </div>

        {/* Master Resume Section */}
        <div className="mb-10">
          <div className="flex items-center justify-between mb-4">
            <h2 className=" text-xs font-bold uppercase tracking-widest text-ink-soft">
              {t('dashboard.masters')}
            </h2>
            {masters.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                className="border-ink  text-xs uppercase"
                onClick={() => setIsUploadDialogOpen(true)}
              >
                <Plus className="w-3.5 h-3.5 mr-1" />
                {t('dashboard.addAnotherResume')}
              </Button>
            )}
          </div>
          {masters.length === 0 ? (
            !isLlmConfigured && !statusLoading ? (
              <Link href="/settings" className="block">
                <div className="border border-dashed border-warning bg-[#fbf6e9] p-8 hover:shadow-sw-sm transition-shadow">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 border-2 border-warning bg-white flex items-center justify-center shrink-0">
                      <AlertTriangle className="w-6 h-6 text-warning" />
                    </div>
                    <div>
                      <p className=" text-sm font-bold uppercase text-amber-800">
                        {t('dashboard.setupRequiredTitle')}
                      </p>
                      <p className=" text-xs text-amber-700 mt-1">
                        {t('dashboard.setupRequiredMessage')}
                      </p>
                    </div>
                  </div>
                </div>
              </Link>
            ) : (
              <div
                className="border border-dashed border-ink p-8 hover:bg-primary hover:text-white cursor-pointer transition-all group"
                role="button"
                tabIndex={0}
                onClick={() => setIsMasterChoiceDialogOpen(true)}
                onKeyDown={handleInitializeMasterKeyDown}
              >
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 border-2 border-current flex items-center justify-center shrink-0">
                    <Plus className="w-6 h-6" />
                  </div>
                  <div>
                    <p className=" text-sm font-bold uppercase">
                      {t('dashboard.initializeMasterResume')}
                    </p>
                    <p className=" text-xs opacity-60 mt-1">{t('dashboard.initializeSequence')}</p>
                  </div>
                </div>
              </div>
            )
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {masters.map((master) => (
                <div
                  key={master.resume_id}
                  className="border border-ink p-6 hover:shadow-sw-sm transition-shadow cursor-pointer rounded-xl"
                  onClick={() => router.push(`/resumes/${master.resume_id}`)}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-4">
                      <div
                        className={`w-12 h-12 border   text-white flex items-center justify-center shrink-0 rounded-xl ${colors[master.filename?.charCodeAt(0) ? master.filename.charCodeAt(0) % colors.length : 1]}`}
                      >
                        <span className=" font-bold text-sm uppercase">
                          {master.filename?.charAt(0) || 'M'}
                        </span>
                      </div>
                      <div>
                        <p className=" text-sm font-bold uppercase truncate max-w-75">
                          {master.title || master.filename || t('dashboard.masterResume')}
                        </p>
                        <div className="flex items-center gap-3 mt-1">
                          {getStatusBadge(master.processing_status as ProcessingStatus)}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      {(master.processing_status === 'failed' ||
                        master.processing_status === 'processing') && (
                        <>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={(e) => handleRetryProcessing(e, master.resume_id)}
                            disabled={isRetrying}
                          >
                            {isRetrying ? (
                              <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                              <RefreshCw className="w-4 h-4" />
                            )}
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-red-600 hover:text-red-700 hover:bg-[#fdf3f2]"
                            onClick={(e) => handleDeleteAndReupload(e, master.resume_id)}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </>
                      )}
                      <ChevronRight className="w-4 h-4 text-ink-soft" />
                    </div>
                  </div>
                  {master.processing_status === 'ready' && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-4 w-full border-ink text-xs uppercase"
                      onClick={(e) => handleCopyMaster(e, master.resume_id)}
                      disabled={copyingId !== null}
                    >
                      {copyingId === master.resume_id ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                          Copying...
                        </>
                      ) : (
                        <>
                          <Copy className="w-3.5 h-3.5 mr-1" />
                          Make a copy
                        </>
                      )}
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Quick Actions */}
        <div className="mb-10">
          <h2 className=" text-xs font-bold uppercase tracking-widest text-ink-soft mb-4">
            Quick Actions
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <Link href="/tailor" className={!isTailorEnabled ? 'pointer-events-none' : ''}>
              <div
                className={`h-24 rounded-xl border border-ink bg-white p-5 flex items-center gap-4 shadow-sw-sm transition-all ${
                  isTailorEnabled
                    ? 'hover:translate-y-[2px] hover:translate-x-[2px] hover:shadow-none'
                    : 'opacity-40 cursor-not-allowed'
                }`}
              >
                <Plus className="w-5 h-5 shrink-0 text-primary" />
                <div>
                  <p className="text-sm font-bold uppercase text-ink">
                    {t('dashboard.createResume')}
                  </p>
                  <p className="text-xs text-steel-grey mt-0.5">AI-tailored for a job</p>
                </div>
              </div>
            </Link>
            <Link href="/job-scraper">
              <div className="h-24 rounded-xl border border-ink bg-white p-5 flex items-center gap-4 shadow-sw-sm hover:translate-y-[2px] hover:translate-x-[2px] hover:shadow-none transition-all">
                <Search className="w-5 h-5 shrink-0 text-primary" />
                <div>
                  <p className="text-sm font-bold uppercase text-ink">Scrape Jobs</p>
                  <p className="text-xs text-steel-grey mt-0.5">Find opportunities</p>
                </div>
              </div>
            </Link>
            <Link href="/companies">
              <div className="h-24 rounded-xl border border-ink bg-white p-5 flex items-center gap-4 shadow-sw-sm hover:translate-y-[2px] hover:translate-x-[2px] hover:shadow-none transition-all">
                <Building2 className="w-5 h-5 shrink-0 text-primary" />
                <div>
                  <p className="text-sm font-bold uppercase text-ink">Company Tracker</p>
                  <p className="text-xs text-steel-grey mt-0.5">Track companies</p>
                </div>
              </div>
            </Link>
            <Link href="/contacts">
              <div className="h-24 rounded-xl border border-ink bg-white p-5 flex items-center gap-4 shadow-sw-sm hover:translate-y-[2px] hover:translate-x-[2px] hover:shadow-none transition-all">
                <Users className="w-5 h-5 shrink-0 text-primary" />
                <div>
                  <p className="text-sm font-bold uppercase text-ink">{t('nav.contacts')}</p>
                  <p className="text-xs text-steel-grey mt-0.5">Manage your contacts</p>
                </div>
              </div>
            </Link>
            <Link href="/interview-practice">
              <div className="h-24 rounded-xl border border-ink bg-white p-5 flex items-center gap-4 shadow-sw-sm hover:translate-y-[2px] hover:translate-x-[2px] hover:shadow-none transition-all">
                <GraduationCap className="w-5 h-5 shrink-0 text-primary" />
                <div>
                  <p className="text-sm font-bold uppercase text-ink">
                    {t('nav.interviewPractice')}
                  </p>
                  <p className="text-xs text-steel-grey mt-0.5">Practice interviews</p>
                </div>
              </div>
            </Link>
          </div>
        </div>

        {/* Phone Jobs */}
        {phoneJobs.length > 0 && (
          <div className="mb-10">
            <div className="flex items-center justify-between mb-4">
              <h2 className=" text-xs font-bold uppercase tracking-widest text-ink-soft">
                From your phone ({phoneJobs.length})
              </h2>
              <Link
                href="/job-scraper"
                className=" text-xs text-primary hover:text-blue-800 uppercase tracking-wide flex items-center gap-1"
              >
                Job Scraper
                <ChevronRight className="w-3 h-3" />
              </Link>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {phoneJobs.slice(0, 6).map((job) => (
                <div
                  key={job.job_id}
                  className="border border-ink p-4 hover:shadow-sw-sm transition-shadow rounded-xl"
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="w-10 h-10 border border-ink bg-paper-tint flex items-center justify-center shrink-0 rounded-xl">
                      <Smartphone className="w-4 h-4 text-ink-soft" />
                    </div>
                  </div>
                  <p className=" text-sm font-bold truncate">{job.title ?? t('common.unknown')}</p>
                  <p className=" text-xs text-ink-soft mt-1 truncate">
                    {job.company ?? 'Unknown company'}
                    {job.location && ` · ${job.location}`}
                  </p>
                  <p className=" text-xs text-steel-grey mt-1">
                    {t('dashboard.edited', { date: formatDate(job.created_at) })}
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tailored Resumes */}
        <div ref={tailoredSectionRef}>
          <div className="flex items-center justify-between mb-4">
            <h2 className=" text-xs font-bold uppercase tracking-widest text-ink-soft">
              Tailored Resumes ({tailoredResumes.length})
            </h2>
            <Link
              href="/tracker"
              className=" text-xs text-primary hover:text-blue-800 uppercase tracking-wide flex items-center gap-1"
            >
              Application Tracker
              <ChevronRight className="w-3 h-3" />
            </Link>
          </div>

          {tailoredResumes.length === 0 ? (
            <div className="border border-dashed border-ink/20 p-8 text-center">
              <FileText className="w-8 h-8 text-steel-grey mx-auto mb-3" />
              <p className=" text-sm text-ink-soft">No tailored resumes yet</p>
              <p className=" text-xs text-steel-grey mt-1">
                Click &quot;AI-Tailored for a Job&quot; above to create one
              </p>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-3">
                {tailoredResumes
                  .slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE)
                  .map((resume) => {
                    const title =
                      resume.title ||
                      resume.jobSnippet ||
                      resume.filename ||
                      t('dashboard.tailoredResume');
                    return (
                      <div
                        key={resume.resume_id}
                        className="border border-ink p-4 hover:shadow-sw-sm transition-shadow cursor-pointer group rounded-xl"
                        onClick={() => router.push(`/resumes/${resume.resume_id}`)}
                      >
                        <div className="flex items-start justify-between mb-3">
                          <div className="w-10 h-10 border border-ink bg-paper-tint flex items-center justify-center shrink-0 rounded-xl">
                            <FileText className="w-4 h-4 text-ink-soft" />
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity text-red-600 hover:text-red-700 hover:bg-[#fdf3f2]"
                            onClick={(e) => handleDeleteTailored(e, resume.resume_id)}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                        <p className=" text-sm font-bold truncate">{title}</p>
                        <p className=" text-xs text-ink-soft mt-1">
                          {t('dashboard.edited', {
                            date: formatDate(resume.updated_at || resume.created_at),
                          })}
                        </p>
                      </div>
                    );
                  })}
              </div>

              {/* Pagination */}
              {tailoredResumes.length > ITEMS_PER_PAGE && (
                <div className="flex items-center justify-center gap-4 mt-4">
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-ink  text-xs uppercase"
                    disabled={currentPage === 1}
                    onClick={() => setCurrentPage((p) => p - 1)}
                  >
                    <ChevronLeft className="w-3 h-3 mr-1" />
                    Prev
                  </Button>
                  <span className=" text-xs text-ink-soft">
                    {currentPage} / {Math.ceil(tailoredResumes.length / ITEMS_PER_PAGE)}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    className="border-ink  text-xs uppercase"
                    disabled={currentPage * ITEMS_PER_PAGE >= tailoredResumes.length}
                    onClick={() => setCurrentPage((p) => p + 1)}
                  >
                    Next
                    <ChevronRight className="w-3 h-3 ml-1" />
                  </Button>
                </div>
              )}
            </>
          )}
        </div>

        {/* Dialogs */}
        <MasterResumeChoiceDialog
          open={isMasterChoiceDialogOpen}
          onOpenChange={setIsMasterChoiceDialogOpen}
          onChooseUpload={handleChooseUpload}
          onChooseWizard={handleChooseWizard}
        />
        <ResumeUploadDialog
          open={isUploadDialogOpen}
          onOpenChange={setIsUploadDialogOpen}
          onUploadComplete={handleUploadComplete}
          defaultAsMaster={masters.length > 0}
          trigger={<button type="button" className="hidden" tabIndex={-1} aria-hidden="true" />}
        />
        <ConfirmDialog
          open={showDeleteDialog}
          onOpenChange={setShowDeleteDialog}
          title={t('confirmations.deleteMasterResumeTitle')}
          description={t('confirmations.deleteMasterResumeDescription')}
          confirmLabel={t('dashboard.deleteAndReupload')}
          cancelLabel={t('confirmations.keepResumeCancelLabel')}
          onConfirm={confirmDeleteAndReupload}
          variant="danger"
        />

        {/* Floating AI Chat */}
        <Link
          href="/chat"
          className="fixed bottom-6 right-6 z-50 inline-flex items-center gap-2 rounded-full bg-primary text-white px-5 py-3.5 shadow-sw-sm hover:translate-y-[2px] hover:translate-x-[2px] hover:shadow-none transition-all"
        >
          <Sparkles className="w-5 h-5" />
          <span className="text-xs font-bold uppercase">{t('nav.chat')}</span>
        </Link>
      </div>
    </div>
  );
}
