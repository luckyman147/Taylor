'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
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
} from 'lucide-react/dist/esm/icons';
import { Button } from '@/components/ui/button';
import {
  searchJobs,
  saveScrapedJobs,
  fetchScrapedJobs,
  deleteScrapedJob,
  clearScrapedJobs,
  type JobListing,
  type JobSearchResponse,
  type ScrapedJobDraft,
} from '@/lib/api/job-scraper';
import { fetchMCPStatus, restartMCPs, type MCPServerStatus } from '@/lib/api/mcp';

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
  const [restarting, setRestarting] = useState(false);
  const [sortBy, setSortBy] = useState<'relevance' | 'date'>('relevance');
  const [draftSortBy, setDraftSortBy] = useState<'relevance' | 'date'>('date');
  const [hiddenSources, setHiddenSources] = useState<Set<string>>(new Set());

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
      if (!groupedResults[job.source]) {
        groupedResults[job.source] = [];
      }
      groupedResults[job.source].push(job);
    }
  }

  // Group drafts by source with sorting
  const groupedDrafts: Record<string, ScrapedJobDraft[]> = {};
  const sortedDrafts = [...drafts].sort((a, b) => {
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

  // Filter out hidden sources for display
  const visibleGroupedDrafts = Object.fromEntries(
    Object.entries(groupedDrafts).filter(([source]) => !hiddenSources.has(source))
  );
  const visibleDraftsCount = Object.values(visibleGroupedDrafts).reduce(
    (sum, jobs) => sum + jobs.length,
    0
  );

  return (
    <div className="min-h-screen bg-[#F0F0E8]">
      <div className="max-w-6xl mx-auto p-8 space-y-8">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={() => router.back()}>
              <ArrowLeft className="w-4 h-4" />
            </Button>
            <div>
              <h1 className="font-serif text-3xl font-bold">Scrape Jobs</h1>
              <p className="text-sm text-ink-soft mt-1">
                Search multiple job sites in parallel using MCP integrations
              </p>
            </div>
          </div>
          {drafts.length > 0 && (
            <Button
              variant="ghost"
              onClick={() => setShowDrafts(!showDrafts)}
              className="flex items-center gap-2"
            >
              <Save className="w-4 h-4" />
              <span className=" text-sm">Drafts ({drafts.length})</span>
            </Button>
          )}
        </div>

        {/* MCP Status */}
        <div className="border border-ink p-4 shadow-sw-sm">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <div
                className={`w-2 h-2 rounded-full ${mcpCount > 0 ? 'bg-green-500' : 'bg-[#fdf3f2]0'}`}
              />
              <span className=" text-sm font-bold">
                {mcpCount} of {Object.keys(mcpStatus).length || '?'} MCPs active
              </span>
            </div>
            <Button
              variant="ghost"
              onClick={handleRestartMCPs}
              disabled={restarting}
              className="text-xs flex items-center gap-1"
            >
              <RefreshCw className={`w-3 h-3 ${restarting ? 'animate-spin' : ''}`} />
              {restarting ? 'Restarting...' : 'Restart MCPs'}
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            {Object.entries(mcpStatus).map(([name, status]) => (
              <span
                key={name}
                className={`text-xs px-2 py-1 border ${
                  status.available && status.enabled
                    ? 'border-green-500 text-green-600'
                    : 'border-gray-400 text-gray-400'
                }`}
              >
                {name}
              </span>
            ))}
          </div>
        </div>

        {/* Search Form */}
        <div className="border border-ink p-6 shadow-sw-sm space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <Search className="w-4 h-4" />
            <h2 className=" text-sm font-bold uppercase tracking-wider">Search Filters</h2>
          </div>

          {/* Keywords */}
          <div>
            <label className=" text-xs font-bold uppercase tracking-wider block mb-1">
              Keywords
            </label>
            <input
              type="text"
              value={keywords}
              onChange={(e) => setKeywords(e.target.value)}
              placeholder="e.g. software engineer, python, react..."
              className="w-full border border-ink px-3 py-2 text-sm  focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          {/* Locations */}
          <div>
            <label className=" text-xs font-bold uppercase tracking-wider block mb-1">
              <MapPin className="w-3 h-3 inline mr-1" />
              Locations
            </label>
            <div className="flex flex-wrap gap-2">
              {LOCATION_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => toggleLocation(opt.value)}
                  className={`text-xs px-3 py-1 border ${
                    selectedLocations.includes(opt.value)
                      ? 'border-ink bg-primary text-white'
                      : 'border-ink hover:bg-paper-tint'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Job Types */}
          <div>
            <label className=" text-xs font-bold uppercase tracking-wider block mb-1">
              <Briefcase className="w-3 h-3 inline mr-1" />
              Job Type
            </label>
            <div className="flex flex-wrap gap-2">
              {JOB_TYPE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => toggleJobType(opt.value)}
                  className={`text-xs px-3 py-1 border ${
                    selectedJobTypes.includes(opt.value)
                      ? 'border-ink bg-primary text-white'
                      : 'border-ink hover:bg-paper-tint'
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
              <label className=" text-xs font-bold uppercase tracking-wider block mb-1">
                <Clock className="w-3 h-3 inline mr-1" />
                Date Posted
              </label>
              <select
                value={datePosted}
                onChange={(e) => setDatePosted(e.target.value)}
                className="w-full border border-ink px-3 py-2 text-sm "
              >
                {DATE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={easyApply}
                  onChange={(e) => setEasyApply(e.target.checked)}
                  className="w-4 h-4"
                />
                <span className="text-sm ">Easy Apply only</span>
              </label>
            </div>
          </div>

          {/* Search Button */}
          <Button onClick={handleSearch} disabled={loading} className="w-full">
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
            <p className="text-xs text-ink-soft  text-center">
              Saving results to drafts...
            </p>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="border border-red-500 bg-[#fdf3f2] p-4 text-red-700 text-sm">{error}</div>
        )}

        {/* Saved Drafts */}
        {showDrafts && drafts.length > 0 && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className=" text-sm font-bold uppercase tracking-wider">
                Saved Drafts ({visibleDraftsCount}/{drafts.length})
              </h2>
              <div className="flex items-center gap-2">
                <div className="flex border border-ink">
                  <button
                    onClick={() => setDraftSortBy('relevance')}
                    className={`text-xs px-3 py-1  ${
                      draftSortBy === 'relevance' ? 'bg-primary text-white' : 'hover:bg-paper-tint'
                    }`}
                  >
                    Relevance
                  </button>
                  <button
                    onClick={() => setDraftSortBy('date')}
                    className={`text-xs px-3 py-1  border-l border-ink ${
                      draftSortBy === 'date' ? 'bg-primary text-white' : 'hover:bg-paper-tint'
                    }`}
                  >
                    Date
                  </button>
                </div>
                <Button
                  variant="ghost"
                  onClick={handleClearDrafts}
                  className="text-xs text-red-600 border border-red-600 hover:bg-[#fdf3f2]"
                >
                  <Trash2 className="w-3 h-3 mr-1" />
                  Clear All
                </Button>
                <Button variant="ghost" onClick={() => setShowDrafts(false)} className="text-xs">
                  <X className="w-3 h-3 mr-1" />
                  Close
                </Button>
              </div>
            </div>
            {hiddenSources.size > 0 && (
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs  text-ink-soft">Hidden:</span>
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
                      className={`text-xs px-2 py-0.5 border line-through opacity-50 hover:opacity-100 transition-opacity ${meta.bg} ${meta.color}`}
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
                    className={` text-xs font-bold uppercase tracking-wider px-3 py-1 inline-block border transition-opacity ${
                      meta.bg
                    } ${meta.color} hover:opacity-80`}
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
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Results */}
        {results && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className=" text-sm font-bold uppercase tracking-wider">
                {results.total} jobs found
              </h2>
              <div className="flex items-center gap-2">
                {results.cached && (
                  <span className="text-xs text-ink-soft border border-gray-400 px-2 py-0.5">
                    cached
                  </span>
                )}
                <div className="flex border border-ink">
                  <button
                    onClick={() => setSortBy('relevance')}
                    className={`text-xs px-3 py-1  ${
                      sortBy === 'relevance' ? 'bg-primary text-white' : 'hover:bg-paper-tint'
                    }`}
                  >
                    Relevance
                  </button>
                  <button
                    onClick={() => setSortBy('date')}
                    className={`text-xs px-3 py-1  border-l border-ink ${
                      sortBy === 'date' ? 'bg-primary text-white' : 'hover:bg-paper-tint'
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
                  className={`px-2 py-1 border ${
                    status.status === 'ok'
                      ? 'border-green-500 text-green-600'
                      : 'border-red-500 text-red-600'
                  }`}
                >
                  {name}: {status.status} {status.count ? `(${status.count})` : ''}
                </span>
              ))}
            </div>

            {/* Grouped Job Cards */}
            {Object.entries(groupedResults).map(([source, sourceJobs]) => {
              const meta = SOURCE_META[source] || {
                label: source,
                color: 'border-gray-400 text-gray-400',
                bg: 'bg-gray-50',
              };
              return (
                <div key={source} className="space-y-2">
                  <h3
                    className={` text-xs font-bold uppercase tracking-wider px-3 py-1 inline-block ${meta.bg} border ${meta.color}`}
                  >
                    {meta.label} ({sourceJobs.length})
                  </h3>
                  <div className="space-y-2">
                    {sourceJobs.map((job) => (
                      <JobCard key={job.id} job={job} meta={meta} />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function JobCard({
  job,
  meta,
}: {
  job: JobListing;
  meta: { label: string; color: string; bg: string };
}) {
  const handleTailor = () => {
    const jdText = `[${job.title}] ${job.company || 'Unknown Company'}\n\n${job.description || 'No description available'}\n\nLocation: ${job.location || 'Remote'}`;
    localStorage.setItem('pending_job_description', jdText);
    window.open('/tailor', '_blank');
  };

  return (
    <div
      className={`border-2 border-primary p-4 shadow-sw-sm hover:shadow-sw-md transition-shadow ${meta.bg}/30`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className=" text-sm font-bold truncate">{job.title}</h3>
            <span className={`text-xs px-2 py-0.5 border ${meta.color}`}>{meta.label}</span>
            {job.remote && (
              <span className="text-xs px-2 py-0.5 border border-green-500 text-green-600">
                Remote
              </span>
            )}
            {job.easy_apply && (
              <span className="text-xs px-2 py-0.5 border border-blue-500 text-blue-600">
                Easy Apply
              </span>
            )}
          </div>
          <p className="text-sm text-ink-soft mt-1">
            {job.company || 'Unknown company'}
            {job.location && ` · ${job.location}`}
          </p>
          {job.description && (
            <p className="text-xs text-ink-soft mt-2 line-clamp-2">{job.description}</p>
          )}
          <div className="flex items-center gap-4 mt-2 text-xs text-ink-soft ">
            {job.posted_date && <span>{new Date(job.posted_date).toLocaleDateString()}</span>}
            <span>Relevance: {Math.round(job.relevance_score * 100)}%</span>
            <span className="text-success">via {meta.label}</span>
          </div>
        </div>
        <div className="flex flex-col gap-2 shrink-0">
          <Button
            onClick={handleTailor}
            className="text-xs border border-primary bg-primary text-white px-3 py-1 hover:bg-primary transition-colors text-center"
          >
            Tailor CV
          </Button>
          <a
            href={job.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs border border-ink px-3 py-1 hover:bg-primary hover:text-white transition-colors text-center flex items-center justify-center gap-1"
          >
            Apply
            <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </div>
    </div>
  );
}

function DraftCard({
  draft,
  meta,
  onDelete,
}: {
  draft: ScrapedJobDraft;
  meta: { label: string; color: string; bg: string };
  onDelete: (id: string) => void;
}) {
  const handleTailor = () => {
    const jdText = `[${draft.title}] ${draft.company || 'Unknown Company'}\n\n${draft.description || 'No description available'}\n\nLocation: ${draft.location || 'Remote'}`;
    localStorage.setItem('pending_job_description', jdText);
    localStorage.setItem('pending_scraped_job_id', draft.job_id);
    window.open('/tailor', '_blank');
  };

  return (
    <div className={`border border-purple-300 p-3 ${meta.bg}/20`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className=" text-sm font-bold truncate">{draft.title}</h3>
            <span className={`text-xs px-2 py-0.5 border ${meta.color}`}>{meta.label}</span>
            {draft.remote && (
              <span className="text-xs px-2 py-0.5 border border-green-500 text-green-600">
                Remote
              </span>
            )}
            {draft.applied && (
              <span className="text-xs px-2 py-0.5 border border-green-600 bg-green-50 text-green-700 font-bold">
                Applied
              </span>
            )}
          </div>
          <p className="text-sm text-ink-soft mt-1">
            {draft.company || 'Unknown company'}
            {draft.location && ` · ${draft.location}`}
          </p>
          <div className="flex items-center gap-4 mt-1 text-xs text-ink-soft ">
            <span>Relevance: {Math.round(draft.relevance_score * 100)}%</span>
            <span>Saved: {new Date(draft.created_at).toLocaleDateString()}</span>
          </div>
        </div>
        <div className="flex flex-col gap-1 shrink-0">
          {draft.applied && draft.applied_resume_id ? (
            <a
              href={`/resumes/${draft.applied_resume_id}`}
              className="text-xs border border-green-600 bg-green-50 text-green-700 px-3 py-1 hover:bg-green-100 transition-colors text-center"
            >
              View Resume
            </a>
          ) : (
            <Button
              onClick={handleTailor}
              className="text-xs border border-primary bg-primary text-white px-3 py-1 hover:bg-primary transition-colors text-center"
            >
              Tailor CV
            </Button>
          )}
          <a
            href={draft.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs border border-ink px-3 py-1 hover:bg-primary hover:text-white transition-colors text-center flex items-center justify-center gap-1"
          >
            Apply
            <ExternalLink className="w-3 h-3" />
          </a>
          <button
            onClick={() => onDelete(draft.job_id)}
            className="text-xs border border-red-400 text-red-600 px-3 py-1 hover:bg-[#fdf3f2] transition-colors text-center"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
