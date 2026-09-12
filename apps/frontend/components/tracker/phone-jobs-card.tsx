'use client';

import { useState, useEffect, useCallback } from 'react';
import { Smartphone, RefreshCw, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { fetchJobs, deleteJob, type MobileJob } from '@/lib/api/jobs';

const MOBILE_SOURCE_META: Record<string, { label: string; color: string; bg: string }> = {
  linkedin: { label: 'LinkedIn', color: 'border-blue-600 text-blue-600', bg: 'bg-primary/5' },
  gmail: { label: 'Gmail', color: 'border-red-600 text-red-600', bg: 'bg-[#fdf3f2]' },
  manual: { label: 'Manual', color: 'border-gray-600 text-gray-600', bg: 'bg-gray-50' },
};

export function PhoneJobsCard() {
  const [jobs, setJobs] = useState<MobileJob[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const pageSize = 10;
  const pageCount = Math.max(1, Math.ceil(jobs.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageJobs = jobs.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const loadJobs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchJobs({ limit: 50 });
      setJobs(data);
    } catch {
      setError('Could not load jobs from the server.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadJobs();
  }, [loadJobs]);

  useEffect(() => {
    setPage(1);
  }, [jobs.length]);

  const handleDelete = async (jobId: string) => {
    try {
      await deleteJob(jobId);
      setJobs((prev) => prev.filter((j) => j.job_id !== jobId));
    } catch {
      // silently fail
    }
  };

  const handleTailor = (job: MobileJob) => {
    const jdText = `[${job.title ?? 'Untitled'}] ${job.company ?? 'Unknown Company'}\n\nLocation: ${job.location ?? 'Remote'}`;
    localStorage.setItem('pending_job_description', jdText);
    window.open('/tailor', '_blank');
  };

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
          onClick={loadJobs}
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
            ? 'Loading jobs...'
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
                    <td className="py-2.5 pr-3 text-ink-soft line-clamp-1">{job.company ?? '---'}</td>
                    <td className="py-2.5 pr-3 text-ink-soft line-clamp-1 hidden md:table-cell">
                      {job.location ?? '---'}
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
                          onClick={() => handleTailor(job)}
                          className="rounded-full px-3 text-xs"
                        >
                          Tailor CV
                        </Button>
                        <button
                          type="button"
                          onClick={() => handleDelete(job.job_id)}
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
