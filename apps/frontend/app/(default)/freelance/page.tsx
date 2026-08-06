'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Loader, ExternalLink } from 'lucide-react/dist/esm/icons';
import { Button } from '@/components/ui/button';
import {
  searchFreelanceJobs,
  saveScrapedJobs,
  fetchProfileKeywords,
  type JobListing,
  type JobSearchResponse,
} from '@/lib/api/job-scraper';

const SOURCE_META: Record<string, { label: string; color: string; bg: string }> = {
  tunisian: { label: 'Tunisian', color: 'border-red-600 text-red-600', bg: 'bg-[#fdf3f2]' },
  remoteok: { label: 'RemoteOK', color: 'border-green-600 text-green-600', bg: 'bg-green-50' },
  himalayas: { label: 'Himalayas', color: 'border-blue-600 text-blue-600', bg: 'bg-primary/5' },
  jobicy: { label: 'Jobicy', color: 'border-orange-600 text-orange-600', bg: 'bg-[#fdf5ec]' },
};

export default function FreelancePage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<JobSearchResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<'relevance' | 'date'>('relevance');

  const handleFetch = useCallback(async () => {
    const stored = localStorage.getItem('master_resume_id');
    if (!stored) {
      setError('No master resume found. Please upload a resume first.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const profile = await fetchProfileKeywords(stored);
      const keywords = profile.suggested_keywords || 'software engineer';

      const res = await searchFreelanceJobs(keywords);
      setResults(res);

      if (res.results.length > 0) {
        try {
          await saveScrapedJobs(res.search_id, stored, res.results);
        } catch {
          // ignore
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setLoading(false);
    }
  }, []);

  // Group results by source
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

  return (
    <div className="min-h-screen bg-[#F0F0E8]">
      <div className="max-w-6xl mx-auto p-8 space-y-8">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => router.back()}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <div>
            <h1 className="font-serif text-3xl font-bold">Freelance Opportunities</h1>
            <p className="text-sm text-ink-soft mt-1">Search Tunisian + global freelance sites</p>
          </div>
        </div>

        <Button onClick={handleFetch} disabled={loading} className="w-full">
          {loading ? (
            <>
              <Loader className="w-4 h-4 mr-2 animate-spin" />
              Fetching freelance opportunities...
            </>
          ) : (
            'Fetch Freelance'
          )}
        </Button>

        {error && (
          <div className="border border-red-500 bg-[#fdf3f2] p-4 text-red-700 text-sm">{error}</div>
        )}

        {results && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className=" text-sm font-bold uppercase tracking-wider">
                {results.total} jobs found
              </h2>
              <div className="flex border border-ink">
                <button
                  onClick={() => setSortBy('relevance')}
                  className={`text-xs px-3 py-1  ${sortBy === 'relevance' ? 'bg-primary text-white' : 'hover:bg-paper-tint'}`}
                >
                  Relevance
                </button>
                <button
                  onClick={() => setSortBy('date')}
                  className={`text-xs px-3 py-1  border-l border-ink ${sortBy === 'date' ? 'bg-primary text-white' : 'hover:bg-paper-tint'}`}
                >
                  Date
                </button>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 text-xs">
              {Object.entries(results.mcp_status).map(([name, status]) => (
                <span
                  key={name}
                  className={`px-2 py-1 border ${status.status === 'ok' ? 'border-green-500 text-green-600' : 'border-red-500 text-red-600'}`}
                >
                  {name}: {status.status} {status.count ? `(${status.count})` : ''}
                </span>
              ))}
            </div>

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

            {results.total === 0 && (
              <div className="text-center py-12 text-ink-soft">
                <p className=" text-sm">No freelance jobs found.</p>
              </div>
            )}
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
            Apply <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </div>
    </div>
  );
}
