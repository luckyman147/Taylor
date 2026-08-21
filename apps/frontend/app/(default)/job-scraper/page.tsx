'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import SidebarNav from '@/components/common/SidebarNav';
import {
  Search,
  ArrowLeft,
  Loader,
  MapPin,
  Briefcase,
  Clock,
  ExternalLink,
  Trash2,
  Save,
  X,
  RefreshCw,
  Archive,
  ChevronDown,
  Smartphone,
  Sparkles,
} from 'lucide-react/dist/esm/icons';
import { Button } from '@/components/ui/button';
import {
  searchJobs,
  saveScrapedJobs,
  fetchScrapedJobs,
  deleteScrapedJob,
  clearScrapedJobs,
  setScrapedJobArchived,
  type JobListing,
  type JobSearchResponse,
  type ScrapedJobDraft,
} from '@/lib/api/job-scraper';
import { fetchJobs, deleteJob, type MobileJob } from '@/lib/api/jobs';
import { classifyJobs, type ClassifiedJob, type DupKind } from '@/lib/utils/dedup';
import { fetchMCPStatus, restartMCPs, type MCPServerStatus } from '@/lib/api/mcp';
import { HiringProbabilityPanel } from '@/components/tailor/hiring-probability-panel';
import { JobDnaPanel } from '@/components/tailor/job-dna-panel';
import { RedFlagsPanel } from '@/components/tailor/red-flags-panel';

const LOCATION_OPTIONS = [
  { value: 'global', label: 'Global' },
  { value: 'remote', label: 'Remote' },
  { value: 'uae', label: 'UAE' },
  { value: 'saudi_arabia', label: 'Saudi Arabia' },
  { value: 'qatar', label: 'Qatar' },
  { value: 'egypt', label: 'Egypt' },
  { value: 'bahrain', label: 'Bahrain' },
  { value: 'oman', label: 'Oman' },
  { value: 'kuwait', label: 'Kuwait' },
  { value: 'jordan', label: 'Jordan' },
  { value: 'us', label: 'USA' },
  { value: 'uk', label: 'UK' },
  { value: 'canada', label: 'Canada' },
  { value: 'germany', label: 'Germany' },
  { value: 'france', label: 'France' },
  { value: 'netherlands', label: 'Netherlands' },
  { value: 'india', label: 'India' },
  { value: 'turkey', label: 'Turkey' },
  { value: 'australia', label: 'Australia' },
  { value: 'singapore', label: 'Singapore' },
  { value: 'tunisia', label: 'Tunisia' },
];

const JOB_TYPE_OPTIONS = [
  { value: 'full_time', label: 'Full-time' },
  { value: 'part_time', label: 'Part-time' },
  { value: 'contract', label: 'Contract' },
  { value: 'internship', label: 'Internship' },
  { value: 'freelance', label: 'Freelance' },
];

const DATE_OPTIONS = [
  { value: 'past_24_hours', label: 'Past 24 hours' },
  { value: 'past_week', label: 'Past week' },
  { value: 'past_month', label: 'Past month' },
];

const SOURCE_META: Record<string, { label: string; color: string; bg: string }> = {
  linkedin: { label: 'LinkedIn', color: 'border-blue-600 text-blue-600', bg: 'bg-primary/5' },
  weworkremotely: {
    label: 'We Work Remotely',
    color: 'border-orange-600 text-orange-600',
    bg: 'bg-[#fdf5ec]',
  },
  exa: { label: 'Exa', color: 'border-cyan-600 text-cyan-600', bg: 'bg-cyan-50' },
  dice: { label: 'Dice', color: 'border-red-600 text-red-600', bg: 'bg-[#fdf3f2]' },
  arbeitnow: { label: 'Arbeitnow', color: 'border-teal-600 text-teal-600', bg: 'bg-teal-50' },
  tunisian: { label: 'Tunisian', color: 'border-red-600 text-red-600', bg: 'bg-[#fdf3f2]' },
  remoteok: { label: 'RemoteOK', color: 'border-green-600 text-green-600', bg: 'bg-green-50' },
  himalayas: { label: 'Himalayas', color: 'border-blue-600 text-blue-600', bg: 'bg-primary/5' },
  jobicy: { label: 'Jobicy', color: 'border-orange-600 text-orange-600', bg: 'bg-[#fdf5ec]' },
  keejob: { label: 'Keejob', color: 'border-purple-600 text-purple-600', bg: 'bg-purple-50' },
};

export default function JobScraperPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<JobSearchResponse | null>(null);
  const [mcpStatus, setMcpStatus] = useState<Record<string, MCPServerStatus>>({});
  const [keywords, setKeywords] = useState('');
  const [selectedLocations, setSelectedLocations] = useState<string[]>(['global']);
  const [selectedJobTypes, setSelectedJobTypes] = useState<string[]>([]);
  const [datePosted, setDatePosted] = useState('past_24_hours');
  const [easyApply, setEasyApply] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [masterResumeId, setMasterResumeId] = useState<string>('');
  const [drafts, setDrafts] = useState<ScrapedJobDraft[]>([]);
  const [saving, setSaving] = useState(false);
  const [showDrafts, setShowDrafts] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [sortBy, setSortBy] = useState<'relevance' | 'date'>('relevance');
  const [draftSortBy, setDraftSortBy] = useState<'relevance' | 'date'>('date');
  const [hiddenSources, setHiddenSources] = useState<Set<string>>(new Set());
  const [mobileJobs, setMobileJobs] = useState<MobileJob[]>([]);
  const [mobileJobsLoading, setMobileJobsLoading] = useState(false);
  const [mobileJobsError, setMobileJobsError] = useState<string | null>(null);
  const [dupByResultUrl, setDupByResultUrl] = useState<Map<string, ClassifiedJob>>(new Map());
  const [newResultsCount, setNewResultsCount] = useState(0);

  const loadMobileJobs = useCallback(async () => {
    setMobileJobsLoading(true);
    setMobileJobsError(null);
    try {
      const jobs = await fetchJobs({ limit: 50 });
      setMobileJobs(jobs);
    } catch {
      setMobileJobsError('Could not load jobs from the server.');
    } finally {
      setMobileJobsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadMobileJobs();
  }, [loadMobileJobs]);

  const handleTailorMobile = useCallback(async (job: MobileJob) => {
    try {
      const res = await fetch(`/api/v1/jobs/${job.job_id}`);
      if (!res.ok) throw new Error('Failed to load job description');
      const full = await res.json();
      const jdText = `[${job.title ?? 'Untitled'}] ${job.company ?? 'Unknown Company'}\n\n${full.content || 'No description available'}\n\nLocation: ${job.location ?? 'Remote'}`;
      localStorage.setItem('pending_job_description', jdText);
      window.open('/tailor', '_blank');
    } catch {
      window.open('/tailor', '_blank');
    }
  }, []);

  const handleDeleteMobile = useCallback(async (jobId: string) => {
    try {
      await deleteJob(jobId);
      setMobileJobs((prev) => prev.filter((j) => j.job_id !== jobId));
    } catch {
      setMobileJobsError('Could not delete job from the server.');
    }
  }, []);

  const handleRestartMCPs = useCallback(async () => {
    setRestarting(true);
    try {
      await restartMCPs();
      const res = await fetchMCPStatus();
      setMcpStatus(res.mcp_servers);
    } catch {
      // ignore
    } finally {
      setRestarting(false);
    }
  }, []);

  useEffect(() => {
    const stored = localStorage.getItem('master_resume_id');
    if (stored) {
      setMasterResumeId(stored);
      import('@/lib/api/job-scraper').then(({ fetchProfileKeywords }) => {
        fetchProfileKeywords(stored)
          .then((profile) => {
            if (profile.suggested_keywords) {
              setKeywords(profile.suggested_keywords);
            }
          })
          .catch(() => {});
      });
    } else {
      import('@/lib/api/resume').then(({ fetchResumeList }) => {
        fetchResumeList()
          .then((resumes) => {
            if (resumes.length > 0) {
              const firstId = resumes[0].resume_id;
              setMasterResumeId(firstId);
              localStorage.setItem('master_resume_id', firstId);
              import('@/lib/api/job-scraper').then(({ fetchProfileKeywords }) => {
                fetchProfileKeywords(firstId)
                  .then((profile) => {
                    if (profile.suggested_keywords) {
                      setKeywords(profile.suggested_keywords);
                    }
                  })
                  .catch(() => {});
              });
            }
          })
          .catch(() => {});
      });
    }

    fetchMCPStatus()
      .then((res) => setMcpStatus(res.mcp_servers))
      .catch(() => {});
  }, []);

  const loadDrafts = useCallback(async () => {
    if (!masterResumeId) return;
    try {
      const d = await fetchScrapedJobs(masterResumeId);
      setDrafts(d);
    } catch {
      // ignore
    }
  }, [masterResumeId]);

  useEffect(() => {
    loadDrafts();
  }, [loadDrafts]);

  useEffect(() => {
    const onFocus = () => {
      loadDrafts();
      loadMobileJobs();
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [loadDrafts, loadMobileJobs]);

  useEffect(() => {
    try {
      const stored = localStorage.getItem('job_scraper_hidden_sources');
      if (stored) {
        setHiddenSources(new Set<string>(JSON.parse(stored)));
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem('job_scraper_hidden_sources', JSON.stringify(Array.from(hiddenSources)));
    } catch {
      // ignore
    }
  }, [hiddenSources]);

  const handleSearch = useCallback(async () => {
    if (!masterResumeId) {
      setError('No master resume found. Please upload a resume first.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await searchJobs(masterResumeId, {
        keywords,
        locations: selectedLocations,
        job_types: selectedJobTypes,
        experience_levels: [],
        work_types: [],
        date_posted: datePosted,
        easy_apply_only: easyApply,
        max_pages: 3,
      });
      setResults(res);

      // Dedup classification (same deterministic algorithm as the mobile app):
      // results are checked against phone jobs, existing drafts, and each
      // other (URL -> SHA-256 fingerprint -> candidate similarity).
      const known: ClassifiedJob['job'][] = [
        ...mobileJobs.map((j) => ({
          url: j.url ?? undefined,
          web_url: j.web_url ?? undefined,
          title: j.title,
          company: j.company,
          location: j.location,
        })),
        ...drafts.map((d) => ({
          url: d.url,
          title: d.title,
          company: d.company,
          location: d.location,
        })),
      ];
      const classified = await classifyJobs(res.results, known);
      const byUrl = new Map<string, ClassifiedJob>();
      let fresh = 0;
      for (const entry of classified) {
        byUrl.set(entry.job.url ?? '', entry);
        if (entry.kind === 'new' || entry.kind === 'similar') {
          fresh += 1;
        }
      }
      setDupByResultUrl(byUrl);
      setNewResultsCount(fresh);

      // Auto-save results to drafts
      if (res.results.length > 0) {
        setSaving(true);
        try {
          await saveScrapedJobs(res.search_id, masterResumeId, res.results);
          await loadDrafts();
        } catch {
          // ignore save errors
        } finally {
          setSaving(false);
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setLoading(false);
    }
  }, [
    masterResumeId,
    keywords,
    selectedLocations,
    selectedJobTypes,
    datePosted,
    easyApply,
    loadDrafts,
  ]);

  const handleDeleteDraft = async (jobId: string) => {
    try {
      await deleteScrapedJob(jobId);
      setDrafts((prev) => prev.filter((d) => d.job_id !== jobId));
    } catch {
      // ignore
    }
  };

  const handleDeleteJob = async (jobId: string, url: string) => {
    try {
      await deleteScrapedJob(jobId);
      setDrafts((prev) => prev.filter((d) => d.job_id !== jobId));
      setResults((prev) =>
        prev
          ? {
              ...prev,
              results: prev.results.filter((j) => j.url !== url),
              total: Math.max(0, prev.total - 1),
            }
          : prev
      );
    } catch {
      // ignore
    }
  };

  const handleSetArchived = async (jobId: string, archived: boolean) => {
    try {
      await setScrapedJobArchived(jobId, archived);
      setDrafts((prev) => prev.map((d) => (d.job_id === jobId ? { ...d, archived } : d)));
    } catch {
      // ignore
    }
  };

  const handleClearDrafts = async () => {
    if (!masterResumeId) return;
    try {
      await clearScrapedJobs(masterResumeId);
      setDrafts([]);
    } catch {
      // ignore
    }
  };

  const toggleLocation = (loc: string) => {
    setSelectedLocations((prev) =>
      prev.includes(loc) ? prev.filter((l) => l !== loc) : [...prev, loc]
    );
  };

  const toggleJobType = (jt: string) => {
    setSelectedJobTypes((prev) =>
      prev.includes(jt) ? prev.filter((j) => j !== jt) : [...prev, jt]
    );
  };

  const toggleSourceVisibility = (source: string) => {
    setHiddenSources((prev) => {
      const next = new Set(prev);
      if (next.has(source)) next.delete(source);
      else next.add(source);
      return next;
    });
  };

  const mcpCount = Object.values(mcpStatus).filter((s) => s.available && s.enabled).length;

  const activeDrafts = drafts.filter((d) => !d.archived);
  const archivedDrafts = drafts.filter((d) => d.archived);
  const draftByUrl = new Map<string, ScrapedJobDraft>(drafts.map((d) => [d.url, d]));

  // Counts of all raw results per source (used for hidden-section chips)
  const groupedResultsAll: Record<string, number> = {};
  if (results) {
    for (const job of results.results) {
      groupedResultsAll[job.source] = (groupedResultsAll[job.source] || 0) + 1;
    }
  }

  // Group results by source with sorting
  const groupedResults: Record<string, JobListing[]> = {};
  if (results) {
    const sorted = [...results.results].sort((a, b) => {
      if (sortBy === 'date') {
        const dateA = a.posted_date ? new Date(a.posted_date).getTime() : 0;
        const dateB = b.posted_date ? new Date(b.posted_date).getTime() : 0;
        return dateB - dateA;
      }
      return b.relevance_score - a.relevance_score;
    });
    for (const job of sorted) {
      if (hiddenSources.has(job.source)) continue;
      const draft = draftByUrl.get(job.url);
      if (draft && draft.archived) continue;
      if (!groupedResults[job.source]) {
        groupedResults[job.source] = [];
      }
      groupedResults[job.source].push(job);
    }
  }

  // Group active drafts by source with sorting
  const groupedDrafts: Record<string, ScrapedJobDraft[]> = {};
  const sortedDrafts = [...activeDrafts].sort((a, b) => {
    if (draftSortBy === 'date') {
      const dateA = a.created_at ? new Date(a.created_at).getTime() : 0;
      const dateB = b.created_at ? new Date(b.created_at).getTime() : 0;
      return dateB - dateA;
    }
    return b.relevance_score - a.relevance_score;
  });
  for (const draft of sortedDrafts) {
    if (!groupedDrafts[draft.source]) {
      groupedDrafts[draft.source] = [];
    }
    groupedDrafts[draft.source].push(draft);
  }

  // Group archived drafts by source
  const groupedArchived: Record<string, ScrapedJobDraft[]> = {};
  for (const draft of archivedDrafts) {
    if (!groupedArchived[draft.source]) {
      groupedArchived[draft.source] = [];
    }
    groupedArchived[draft.source].push(draft);
  }

  // Filter out hidden sources for display
  const visibleGroupedDrafts = Object.fromEntries(
    Object.entries(groupedDrafts).filter(([source]) => !hiddenSources.has(source))
  );
  const visibleDraftsCount = Object.values(visibleGroupedDrafts).reduce(
    (sum, jobs) => sum + jobs.length,
    0
  );

  // Nothing to show yet (drafts not open, no phone jobs, no search results):
  // the MCP status + search filters take the full width.
  const emptyState =
    !results && mobileJobs.length === 0 && !mobileJobsLoading && !showDrafts;

  return (
    <div className="min-h-screen bg-white pl-16">
      <SidebarNav currentPage="job-scraper" onNavigate={(page) => router.push(page)} />
      <div className="max-w-7xl mx-auto p-8 space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => router.back()}
              className="rounded-full border border-[#e6e3dc] bg-white text-ink shadow-sw-xs hover:border-primary hover:text-primary"
            >
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <div>
              <h1 className="text-3xl font-bold tracking-tight">Scrape Jobs</h1>
              <p className="mt-1 text-xs uppercase tracking-wide text-ink-soft">
                Search multiple job sites in parallel using MCP integrations
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowDrafts(!showDrafts)}
              className="flex items-center gap-2 rounded-full px-4"
            >
              <Save className="w-4 h-4" />
              <span className="text-xs">Drafts ({activeDrafts.length})</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setShowDrafts(true);
                setShowArchived(true);
              }}
              className="flex items-center gap-2 rounded-full px-4"
            >
              <Archive className="w-4 h-4" />
              <span className="text-xs">Archived ({archivedDrafts.length})</span>
            </Button>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="rounded-xl border border-red-500 bg-[#fdf3f2] p-4 text-sm text-red-700">
            {error}
          </div>
        )}

        <div
          className={`grid gap-6 items-start ${
            showDrafts || emptyState ? 'lg:grid-cols-1' : 'lg:grid-cols-[minmax(0,3fr),minmax(0,1fr)]'
          }`}
        >
          {/* RIGHT column — MCP status + search filters (sticky, hidden while drafts are open) */}
          {!showDrafts && (
          <div
            className={`space-y-6 ${
              emptyState
                ? 'max-w-3xl'
                : 'lg:col-start-2 lg:row-start-1 lg:row-span-2 lg:sticky lg:top-6'
            }`}
          >
            {/* MCP Status */}
            <div className="rounded-2xl border border-[#e6e3dc] bg-white p-5 shadow-sw-xs">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2.5">
                  <div
                    className={`h-2.5 w-2.5 rounded-full ${
                      mcpCount > 0 ? 'bg-green-500' : 'bg-red-500'
                    }`}
                  />
                  <span className="text-xs font-bold uppercase tracking-wide text-ink">
                    {mcpCount} of {Object.keys(mcpStatus).length || '?'} MCPs active
                  </span>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleRestartMCPs}
                  disabled={restarting}
                  className="rounded-full text-xs text-primary hover:text-primary"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${restarting ? 'animate-spin' : ''}`} />
                  {restarting ? 'Restarting...' : 'Restart MCPs'}
                </Button>
              </div>
              <div className="flex flex-wrap gap-2">
                {Object.entries(mcpStatus).map(([name, status]) => (
                  <span
                    key={name}
                    className={`rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${
                      status.available && status.enabled
                        ? 'border-green-200 bg-green-50 text-green-600'
                        : 'border-[#e7e5df] bg-paper-tint text-steel-grey'
                    }`}
                  >
                    {name}
                  </span>
                ))}
              </div>
            </div>

            {/* Search Form */}
            <div className="space-y-5 rounded-2xl border border-[#e6e3dc] bg-white p-6 shadow-sw-xs">
              <div className="flex items-center gap-2">
                <Search className="h-4 w-4 text-primary" />
                <h2 className="text-xs font-bold uppercase tracking-wider text-ink">
                  Search Filters
                </h2>
              </div>

              {/* Keywords */}
              <div>
                <label className=" mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-ink-soft">
                  Keywords
                </label>
                <input
                  type="text"
                  value={keywords}
                  onChange={(e) => setKeywords(e.target.value)}
                  placeholder="e.g. software engineer, python, react..."
                  className="w-full rounded-xl border border-[#c9c5bc] bg-white px-3 py-2 text-sm text-ink placeholder:text-steel-grey focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>

              {/* Locations */}
              <div>
                <label className=" mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-ink-soft">
                  <MapPin className="h-3 w-3 inline mr-1" />
                  Locations
                </label>
                <div className="flex flex-wrap gap-2">
                  {LOCATION_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => toggleLocation(opt.value)}
                      className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-all ${
                        selectedLocations.includes(opt.value)
                          ? 'border-primary bg-primary text-white shadow-sw-xs'
                          : 'border-[#e7e6df] bg-white text-ink hover:border-primary hover:text-primary'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Job Types */}
              <div>
                <label className=" mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-ink-soft">
                  <Briefcase className="h-3 w-3 inline mr-1" />
                  Job Type
                </label>
                <div className="flex flex-wrap gap-2">
                  {JOB_TYPE_OPTIONS.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => toggleJobType(opt.value)}
                      className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-all ${
                        selectedJobTypes.includes(opt.value)
                          ? 'border-primary bg-primary text-white shadow-sw-xs'
                          : 'border-[#e7e6df] bg-white text-ink hover:border-primary hover:text-primary'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Date Posted + Easy Apply */}
              <div className="flex gap-4">
                <div className="flex-1">
                  <label className=" mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-ink-soft">
                    <Clock className="h-3 w-3 inline mr-1" />
                    Date Posted
                  </label>
                  <select
                    value={datePosted}
                    onChange={(e) => setDatePosted(e.target.value)}
                    className="w-full rounded-xl border border-[#c9c5bc] bg-white px-3 py-2 text-sm text-ink focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                  >
                    {DATE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex items-end">
                  <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-[#e7e6df] bg-white px-4 py-2.5">
                    <input
                      type="checkbox"
                      checked={easyApply}
                      onChange={(e) => setEasyApply(e.target.checked)}
                      className="h-4 w-4 rounded-md border-ink accent-primary"
                    />
                    <span className="text-xs font-semibold uppercase tracking-wide text-ink">
                      Easy Apply only
                    </span>
                  </label>
                </div>
              </div>

              {/* Search Button */}
              <Button onClick={handleSearch} disabled={loading} className="w-full rounded-xl">
                {loading ? (
                  <>
                    <Loader className="w-4 h-4 mr-2 animate-spin" />
                    Searching...
                  </>
                ) : (
                  <>
                    <Search className="w-4 h-4 mr-2" />
                    Search Jobs
                  </>
                )}
              </Button>
              {saving && (
                <p className=" text-center text-xs text-ink-soft">Saving results to drafts...</p>
              )}
            </div>
          </div>
          )}

          {/* LEFT column — phone jobs, results + drafts (drafts above mobile jobs) */}
          <div
            className={`min-w-0 flex flex-col gap-6 ${
              emptyState ? 'lg:row-start-2' : 'lg:col-start-1 lg:row-start-1'
            }`}
          >
            {/* Saved Drafts */}
            {showDrafts && drafts.length > 0 && (
              <div className="order-2 space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-xs font-bold uppercase tracking-wider text-ink">
                    Saved Drafts ({visibleDraftsCount}/{activeDrafts.length})
                  </h2>
                  <div className="flex items-center gap-2">
                    <div className="flex rounded-full border border-[#e7e6df] bg-white p-1">
                      <button
                        onClick={() => setDraftSortBy('relevance')}
                        className={`rounded-full px-4 py-1.5 text-xs font-bold uppercase tracking-wide transition-colors ${
                          draftSortBy === 'relevance'
                            ? 'bg-primary text-white'
                            : 'text-ink-soft hover:text-primary'
                        }`}
                      >
                        Relevance
                      </button>
                      <button
                        onClick={() => setDraftSortBy('date')}
                        className={`rounded-full px-4 py-1.5 text-xs font-bold uppercase tracking-wide transition-colors ${
                          draftSortBy === 'date'
                            ? 'bg-primary text-white'
                            : 'text-ink-soft hover:text-primary'
                        }`}
                      >
                        Date
                      </button>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleClearDrafts}
                      className="rounded-full border border-red-400/50 bg-red-50 px-4 text-red-600 hover:border-red-500 hover:bg-red-500 hover:text-white"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      Clear All
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowArchived(!showArchived)}
                      className={`rounded-full border px-4 text-xs ${
                        showArchived
                          ? 'border-primary bg-primary text-white'
                          : 'border-[#e7e6df] text-ink-soft hover:text-primary'
                      }`}
                    >
                      <Archive className="w-3.5 h-3.5" />
                      Archived ({archivedDrafts.length})
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowDrafts(false)}
                      className="text-xs"
                    >
                      <X className="w-3.5 h-3.5" />
                      Close
                    </Button>
                  </div>
                </div>
                {hiddenSources.size > 0 && (
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-ink-soft">Hidden:</span>
                    {Array.from(hiddenSources).map((source) => {
                      const meta = SOURCE_META[source] || {
                        label: source,
                        color: 'border-gray-400 text-gray-400',
                        bg: 'bg-gray-50',
                      };
                      const count = groupedDrafts[source]?.length || 0;
                      return (
                        <button
                          key={source}
                          onClick={() => toggleSourceVisibility(source)}
                          className={`rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide line-through opacity-50 hover:opacity-100 transition-opacity ${meta.bg} ${meta.color}`}
                        >
                          {meta.label} ({count})
                        </button>
                      );
                    })}
                  </div>
                )}
                {Object.entries(visibleGroupedDrafts).map(([source, sourceJobs]) => {
                  const meta = SOURCE_META[source] || {
                    label: source,
                    color: 'border-gray-400 text-gray-400',
                    bg: 'bg-gray-50',
                  };
                  return (
                    <div key={source} className="space-y-2">
                      <button
                        onClick={() => toggleSourceVisibility(source)}
                        className={`inline-block rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-wider transition-opacity ${meta.bg} ${meta.color} hover:opacity-80`}
                      >
                        {meta.label} ({sourceJobs.length})
                      </button>
                      <div className="space-y-2">
                        {sourceJobs.map((draft) => (
                          <DraftCard
                            key={draft.job_id}
                            draft={draft}
                            meta={meta}
                            onDelete={handleDeleteDraft}
                            onArchive={handleSetArchived}
                          />
                        ))}
                      </div>
                    </div>
                  );
                })}
                {showArchived && archivedDrafts.length > 0 && (
                  <div className="space-y-3 border-t border-[#e7e6df] pt-4">
                    <h3 className="text-xs font-bold uppercase tracking-wider text-ink-soft">
                      Archived
                    </h3>
                    {Object.entries(groupedArchived).map(([source, sourceJobs]) => {
                      const meta = SOURCE_META[source] || {
                        label: source,
                        color: 'border-gray-400 text-gray-400',
                        bg: 'bg-gray-50',
                      };
                      return (
                        <div key={source} className="space-y-2">
                          <span
                            className={`inline-block rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-wider ${meta.bg} ${meta.color}`}
                          >
                            {meta.label} ({sourceJobs.length})
                          </span>
                          <div className="space-y-2">
                            {sourceJobs.map((draft) => (
                              <DraftCard
                                key={draft.job_id}
                                draft={draft}
                                meta={meta}
                                onDelete={handleDeleteDraft}
                                onArchive={handleSetArchived}
                              />
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Results */}
            {results && (
              <div className="order-1 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <h2 className="text-xs font-bold uppercase tracking-wider text-ink">
                      {results.total} relevant of {results.total_found ?? results.total} found
                    </h2>
                    <span className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/5 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-primary">
                      <Sparkles className="h-3 w-3" />
                      New {newResultsCount}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {results.cached && (
                      <span className="rounded-full border border-[#e7e6df] bg-paper-tint px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-ink-soft">
                        cached
                      </span>
                    )}
                    <div className="flex rounded-full border border-[#e7e6df] bg-white p-1">
                      <button
                        onClick={() => setSortBy('relevance')}
                        className={`rounded-full px-4 py-1.5 text-xs font-bold uppercase tracking-wide transition-colors ${
                          sortBy === 'relevance'
                            ? 'bg-primary text-white'
                            : 'text-ink-soft hover:text-primary'
                        }`}
                      >
                        Relevance
                      </button>
                      <button
                        onClick={() => setSortBy('date')}
                        className={`rounded-full px-4 py-1.5 text-xs font-bold uppercase tracking-wide transition-colors ${
                          sortBy === 'date'
                            ? 'bg-primary text-white'
                            : 'text-ink-soft hover:text-primary'
                        }`}
                      >
                        Date
                      </button>
                    </div>
                  </div>
                </div>

                {/* MCP Status Summary */}
                <div className="flex flex-wrap gap-2 text-xs">
                  {Object.entries(results.mcp_status).map(([name, status]) => (
                    <span
                      key={name}
                      className={`rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${
                        status.status === 'ok'
                          ? 'border-green-200 bg-green-50 text-green-600'
                          : 'border-red-200 bg-red-50 text-red-600'
                      }`}
                    >
                      {name}: {status.status} {status.count ? `(${status.count})` : ''}
                    </span>
                  ))}
                </div>

                {/* Hidden sources */}
                {hiddenSources.size > 0 && (
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-ink-soft">Hidden:</span>
                    {Array.from(hiddenSources).map((source) => {
                      const meta = SOURCE_META[source] || {
                        label: source,
                        color: 'border-gray-400 text-gray-400',
                        bg: 'bg-gray-50',
                      };
                      const count = groupedResultsAll[source] || 0;
                      return (
                        <button
                          key={source}
                          onClick={() => toggleSourceVisibility(source)}
                          className={`rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide line-through opacity-50 hover:opacity-100 transition-opacity ${meta.bg} ${meta.color}`}
                        >
                          {meta.label} ({count})
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Grouped Job Cards */}
                {Object.keys(groupedResults).length === 0 ? (
                  <p className="rounded-xl border border-[#e7e6df] bg-paper-tint p-6 text-center text-sm text-ink-soft">
                    No visible jobs. Deleted, archived, or all sections are hidden above.
                  </p>
                ) : (
                  Object.entries(groupedResults).map(([source, sourceJobs]) => {
                    const meta = SOURCE_META[source] || {
                      label: source,
                      color: 'border-gray-400 text-gray-400',
                      bg: 'bg-gray-50',
                    };
                    return (
                      <div key={source} className="space-y-2">
                        <button
                          onClick={() => toggleSourceVisibility(source)}
                          className={`inline-block rounded-full border px-3 py-1 text-[10px] font-bold uppercase tracking-wider transition-opacity ${meta.bg} ${meta.color} hover:opacity-80`}
                        >
                          {meta.label} ({sourceJobs.length})
                        </button>
                        <div className="space-y-2">
                          {sourceJobs.map((job) => {
                            const draft = draftByUrl.get(job.url);
                            return (
                              <JobCard
                                key={job.id}
                                job={job}
                                meta={meta}
                                jobId={draft?.job_id ?? null}
                                archived={draft?.archived ?? false}
                                dupKind={dupByResultUrl.get(job.url)?.kind ?? null}
                                onArchive={handleSetArchived}
                                onDelete={handleDeleteJob}
                              />
                            );
                          })}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>
          <div className="order-3">
            <PhoneJobsCard
              jobs={mobileJobs}
              loading={mobileJobsLoading}
              error={mobileJobsError}
              onRefresh={loadMobileJobs}
              onTailor={handleTailorMobile}
              onDelete={handleDeleteMobile}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function JobIntelSection({ jobId }: { jobId: string | null }) {
  const [open, setOpen] = useState(false);
  if (!jobId) return null;
  return (
    <div className="mt-3 border-t border-[#e7e6df] pt-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-full border border-[#c9c5bc] bg-white px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-ink-soft transition-colors hover:border-primary hover:text-primary"
      >
        {open ? 'Hide job intelligence' : 'Job intelligence'}
        <ChevronDown className={`h-3 w-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="mt-3">
          <HiringProbabilityPanel jobId={jobId} />
          <JobDnaPanel jobId={jobId} />
          <RedFlagsPanel jobId={jobId} />
        </div>
      )}
    </div>
  );
}

function JobCard({
  job,
  meta,
  jobId,
  archived,
  dupKind,
  onArchive,
  onDelete,
}: {
  job: JobListing;
  meta: { label: string; color: string; bg: string };
  jobId: string | null;
  archived: boolean;
  dupKind: DupKind | null;
  onArchive: (id: string, archived: boolean) => void;
  onDelete: (id: string, url: string) => void;
}) {
  const handleTailor = () => {
    const jdText = `[${job.title}] ${job.company || 'Unknown Company'}\n\n${job.description || 'No description available'}\n\nLocation: ${job.location || 'Remote'}`;
    localStorage.setItem('pending_job_description', jdText);
    // Correlate the draft so a successful tailoring marks it as tailored
    if (jobId) localStorage.setItem('pending_scraped_job_id', jobId);
    window.open('/tailor', '_blank');
  };

  const dupBadge =
    dupKind === 'dup_url' || dupKind === 'dup_fingerprint'
      ? {
          label: 'Duplicate · already known',
          className: 'border-red-300 bg-red-50 text-red-600',
        }
      : dupKind === 'similar'
        ? {
            label: 'Similar to saved',
            className: 'border-amber-300 bg-amber-50 text-amber-700',
          }
        : null;

  return (
    <div className="rounded-2xl border border-[#e6e3dc] bg-white p-4 shadow-sw-xs transition-shadow hover:shadow-sw-md">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-bold truncate text-ink">{job.title}</h3>
            {dupBadge && (
              <span
                className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${dupBadge.className}`}
              >
                {dupBadge.label}
              </span>
            )}
            <span
              className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${meta.bg} ${meta.color}`}
            >
              {meta.label}
            </span>
            {job.remote && (
              <span className="rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-green-600">
                Remote
              </span>
            )}
            {job.easy_apply && (
              <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-blue-600">
                Easy Apply
              </span>
            )}
          </div>
          <p className="mt-1.5 text-sm text-ink-soft">
            {job.company || 'Unknown company'}
            {job.location && ` · ${job.location}`}
          </p>
          {job.description && (
            <p className="mt-2 text-xs text-ink-soft line-clamp-2">{job.description}</p>
          )}
          <div className="mt-3 flex items-center gap-4 text-[11px] text-ink-soft">
            {job.posted_date && <span>{new Date(job.posted_date).toLocaleDateString()}</span>}
            <span>Relevance: {Math.round(job.relevance_score * 100)}%</span>
            {job.is_stretch && (
              <span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-700">
                Stretch
              </span>
            )}
            <span className="text-success">via {meta.label}</span>
          </div>
          <JobIntelSection jobId={jobId} />
        </div>
        <div className="flex flex-col gap-2 shrink-0">
          <Button size="sm" onClick={handleTailor} className="rounded-full px-4">
            Tailor CV
          </Button>
          <a
            href={job.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-1 rounded-full border border-[#c9c5bc] bg-white px-4 py-1.5 text-xs font-bold uppercase tracking-wide text-ink transition-colors hover:border-primary hover:bg-primary hover:text-white"
          >
            Apply
            <ExternalLink className="w-3 h-3" />
          </a>
          {jobId && (
            <>
              <button
                onClick={() => onArchive(jobId, !archived)}
                className="inline-flex items-center justify-center gap-1 rounded-full border border-[#e7e6df] bg-white px-4 py-1.5 text-xs font-bold uppercase tracking-wide text-ink-soft transition-colors hover:border-primary hover:text-primary"
              >
                <Archive className="w-3 h-3" />
                {archived ? 'Unarchive' : 'Archive'}
              </button>
              <button
                onClick={() => onDelete(jobId, job.url)}
                className="inline-flex items-center justify-center gap-1 rounded-full border border-red-400/50 bg-red-50 px-4 py-1.5 text-xs font-bold uppercase tracking-wide text-red-600 transition-colors hover:border-red-500 hover:bg-red-500 hover:text-white"
              >
                <Trash2 className="w-3 h-3" />
                Delete
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function DraftCard({
  draft,
  meta,
  onDelete,
  onArchive,
}: {
  draft: ScrapedJobDraft;
  meta: { label: string; color: string; bg: string };
  onDelete: (id: string) => void;
  onArchive: (id: string, archived: boolean) => void;
}) {
  const handleTailor = () => {
    const jdText = `[${draft.title}] ${draft.company || 'Unknown Company'}\n\n${draft.description || 'No description available'}\n\nLocation: ${draft.location || 'Remote'}`;
    localStorage.setItem('pending_job_description', jdText);
    localStorage.setItem('pending_scraped_job_id', draft.job_id);
    window.open('/tailor', '_blank');
  };

  return (
    <div className="rounded-2xl border border-[#e6e3dc] bg-white p-4 shadow-sw-xs transition-shadow hover:shadow-sw-md">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-bold truncate text-ink">{draft.title}</h3>
            <span
              className={`rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${meta.bg} ${meta.color}`}
            >
              {meta.label}
            </span>
            {draft.remote && (
              <span className="rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-green-600">
                Remote
              </span>
            )}
            {draft.applied && (
              <span className="rounded-full border border-green-600 bg-green-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-green-700">
                Tailored
              </span>
            )}
          </div>
          <p className="mt-1.5 text-sm text-ink-soft">
            {draft.company || 'Unknown company'}
            {draft.location && ` · ${draft.location}`}
          </p>
          <div className="mt-3 flex items-center gap-4 text-[11px] text-ink-soft">
            <span>Relevance: {Math.round(draft.relevance_score * 100)}%</span>
            <span>Saved: {new Date(draft.created_at).toLocaleDateString()}</span>
          </div>
          <JobIntelSection jobId={draft.job_id} />
        </div>
        <div className="flex flex-col gap-1.5 shrink-0">
          {draft.applied && draft.applied_resume_id ? (
            <a
              href={`/resumes/${draft.applied_resume_id}`}
              className="rounded-full border border-green-600 bg-green-50 px-4 py-1.5 text-xs font-bold uppercase tracking-wide text-green-700 text-center hover:bg-green-100 transition-colors"
            >
              View Resume
            </a>
          ) : (
            <Button size="sm" onClick={handleTailor} className="rounded-full px-4">
              Tailor CV
            </Button>
          )}
          <a
            href={draft.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center gap-1 rounded-full border border-[#c9c5bc] bg-white px-4 py-1.5 text-xs font-bold uppercase tracking-wide text-ink transition-colors hover:border-primary hover:bg-primary hover:text-white"
          >
            Apply
            <ExternalLink className="w-3 h-3" />
          </a>
          <button
            onClick={() => onArchive(draft.job_id, !draft.archived)}
            className="inline-flex items-center justify-center gap-1 rounded-full border border-[#e7e6df] bg-white px-4 py-1.5 text-xs font-bold uppercase tracking-wide text-ink-soft transition-colors hover:border-primary hover:text-primary"
          >
            <Archive className="w-3 h-3" />
            {draft.archived ? 'Unarchive' : 'Archive'}
          </button>
          <button
            onClick={() => onDelete(draft.job_id)}
            className="rounded-full border border-red-400/50 bg-red-50 px-4 py-1.5 text-xs font-bold uppercase tracking-wide text-red-600 transition-colors hover:border-red-500 hover:bg-red-500 hover:text-white"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

const MOBILE_SOURCE_META: Record<string, { label: string; color: string; bg: string }> = {
  linkedin: { label: 'LinkedIn', color: 'border-blue-600 text-blue-600', bg: 'bg-primary/5' },
  gmail: { label: 'Gmail', color: 'border-red-600 text-red-600', bg: 'bg-[#fdf3f2]' },
  manual: { label: 'Manual', color: 'border-gray-600 text-gray-600', bg: 'bg-gray-50' },
};

function PhoneJobsCard({
  jobs,
  loading,
  error,
  onRefresh,
  onTailor,
  onDelete,
}: {
  jobs: MobileJob[];
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  onTailor: (job: MobileJob) => void;
  onDelete: (jobId: string) => void;
}) {
  const [page, setPage] = useState(1);
  const pageSize = 10;
  const pageCount = Math.max(1, Math.ceil(jobs.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageJobs = jobs.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  useEffect(() => {
    setPage(1);
  }, [jobs.length]);

  return (
    <div className="rounded-2xl border border-[#e6e3dc] bg-white p-5 shadow-sw-xs">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <Smartphone className="h-4 w-4 text-primary" />
          <h2 className="text-xs font-bold uppercase tracking-wider text-ink">
            From your phone {jobs.length > 0 && `(${jobs.length})`}
          </h2>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="inline-flex items-center gap-1.5 rounded-full border border-[#e7e6df] bg-white px-3 py-1 text-[10px] font-bold uppercase tracking-wide text-ink-soft transition-colors hover:border-primary hover:text-primary disabled:opacity-50"
        >
          <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {error && (
        <p className="rounded-xl border border-red-500 bg-[#fdf3f2] p-3 text-xs text-red-700">
          {error}
        </p>
      )}

      {!error && jobs.length === 0 && (
        <p className="rounded-xl border border-[#e7e6df] bg-paper-tint p-4 text-center text-xs text-ink-soft">
          {loading
            ? 'Loading jobs…'
            : 'No jobs from your phone yet. Jobs captured in the TAYLOR mobile app appear here.'}
        </p>
      )}

      {jobs.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-[#e7e6df] text-[10px] font-bold uppercase tracking-wider text-ink-soft">
                <th className="py-2 pr-3">Title</th>
                <th className="py-2 pr-3">Company</th>
                <th className="py-2 pr-3 hidden md:table-cell">Location</th>
                <th className="py-2 pr-3 hidden sm:table-cell">Source</th>
                <th className="py-2 pr-3 hidden lg:table-cell">Received</th>
                <th className="py-2 text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {pageJobs.map((job) => {
                const meta = MOBILE_SOURCE_META[job.source ?? ''] ?? {
                  label: job.source ?? 'unknown',
                  color: 'border-gray-400 text-gray-400',
                  bg: 'bg-gray-50',
                };
                return (
                  <tr
                    key={job.job_id}
                    className="border-b border-[#f0eee8] last:border-0 hover:bg-paper-tint/50"
                  >
                    <td className="py-2.5 pr-3">
                      <span className="font-bold text-ink line-clamp-1">
                        {job.title ?? 'Untitled'}
                      </span>
                    </td>
                    <td className="py-2.5 pr-3 text-ink-soft line-clamp-1">{job.company ?? '—'}</td>
                    <td className="py-2.5 pr-3 text-ink-soft line-clamp-1 hidden md:table-cell">
                      {job.location ?? '—'}
                    </td>
                    <td className="py-2.5 pr-3 hidden sm:table-cell">
                      <span
                        className={`inline-block rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${meta.bg} ${meta.color}`}
                      >
                        {meta.label}
                      </span>
                    </td>
                    <td className="py-2.5 pr-3 text-[11px] text-ink-soft hidden lg:table-cell">
                      {new Date(job.created_at).toLocaleDateString()}
                    </td>
                    <td className="py-2.5 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <Button
                          size="sm"
                          onClick={() => onTailor(job)}
                          className="rounded-full px-3 text-xs"
                        >
                          Tailor CV
                        </Button>
                        <button
                          type="button"
                          onClick={() => onDelete(job.job_id)}
                          title="Delete job"
                          className="inline-flex items-center justify-center rounded-full border border-red-400/50 bg-red-50 p-1.5 text-red-600 transition-colors hover:border-red-500 hover:bg-red-500 hover:text-white"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {jobs.length > pageSize && (
        <div className="mt-3 flex items-center justify-between border-t border-[#f0eee8] pt-3">
          <span className="text-xs text-ink-soft">
            Page {currentPage} of {pageCount}
          </span>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setPage(currentPage - 1)}
              disabled={currentPage <= 1}
              className="rounded-full px-3 text-xs"
            >
              Previous
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setPage(currentPage + 1)}
              disabled={currentPage >= pageCount}
              className="rounded-full px-3 text-xs"
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
