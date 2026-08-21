/**
 * Mobile jobs API client (GET /api/v1/jobs).
 *
 * Lists jobs pushed from the TAYLOR mobile app, newest first, with
 * structured fields (title, company, location, url, source) flattened
 * from the backend job metadata.
 */

import { apiFetch } from './client';

export interface MobileJob {
  job_id: string;
  title: string | null;
  company: string | null;
  location: string | null;
  url: string | null;
  web_url: string | null;
  source: string | null;
  posted_at: string | null;
  created_at: string;
  content_preview: string;
}

export interface FetchJobsParams {
  source?: string;
  limit?: number;
}

export async function fetchJobs(params: FetchJobsParams = {}): Promise<MobileJob[]> {
  const query = new URLSearchParams();
  if (params.source) query.set('source', params.source);
  if (params.limit) query.set('limit', String(params.limit));
  const res = await apiFetch(`/jobs${query.size ? `?${query.toString()}` : ''}`);
  if (!res.ok) throw new Error('Failed to fetch mobile jobs');
  return res.json();
}

export async function deleteJob(jobId: string): Promise<{ deleted: boolean; job_id: string }> {
  const res = await apiFetch(`/jobs/${encodeURIComponent(jobId)}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete job');
  return res.json();
}
