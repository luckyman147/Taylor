/**
 * Job Scraper API client.
 */

import { apiPost, apiFetch, apiPatch } from './client';

export interface JobSearchFilters {
  keywords: string;
  locations: string[];
  job_types: string[];
  experience_levels: string[];
  work_types: string[];
  date_posted: string;
  easy_apply_only: boolean;
  max_pages: number;
}

export interface JobListing {
  id: string;
  title: string;
  company: string;
  location: string;
  url: string;
  source: string;
  posted_date: string | null;
  description: string | null;
  relevance_score: number;
  easy_apply: boolean;
  remote: boolean;
  job_type: string | null;
  experience_level: string | null;
  salary: string | null;
  languages: string[];
}

export interface JobSearchResponse {
  search_id: string;
  results: JobListing[];
  total: number;
  mcp_status: Record<string, { status: string; count?: number; error?: string }>;
  cached: boolean;
}

export async function searchJobs(
  resumeId: string,
  filters: JobSearchFilters
): Promise<JobSearchResponse> {
  const res = await apiPost('/job-scraper/search', {
    resume_id: resumeId,
    filters,
  });
  if (!res.ok) throw new Error('Job search failed');
  return res.json();
}

export async function searchFreelanceJobs(keywords: string): Promise<JobSearchResponse> {
  const res = await apiPost('/job-scraper/freelance/search', { keywords });
  if (!res.ok) throw new Error('Freelance search failed');
  return res.json();
}

export interface ProfileKeywords {
  skills: string[];
  titles: string[];
  suggested_keywords: string;
}

export async function fetchProfileKeywords(resumeId: string): Promise<ProfileKeywords> {
  const res = await fetch(`/api/v1/job-scraper/profile-keywords/${resumeId}`);
  if (!res.ok) throw new Error('Failed to fetch profile keywords');
  return res.json();
}

export interface ScrapedJobDraft {
  job_id: string;
  search_id: string;
  title: string;
  company: string;
  location: string;
  url: string;
  source: string;
  description: string | null;
  posted_date: string | null;
  relevance_score: number;
  remote: boolean;
  easy_apply: boolean;
  job_type: string | null;
  experience_level: string | null;
  salary: string | null;
  languages: string[];
  applied: boolean;
  applied_resume_id: string | null;
  archived: boolean;
  created_at: string;
}

export async function saveScrapedJobs(
  searchId: string,
  resumeId: string,
  jobs: JobListing[]
): Promise<{ saved: number; total: number }> {
  const res = await apiPost('/job-scraper/save-drafts', {
    search_id: searchId,
    resume_id: resumeId,
    jobs,
  });
  if (!res.ok) throw new Error('Failed to save jobs');
  return res.json();
}

export async function fetchScrapedJobs(resumeId: string): Promise<ScrapedJobDraft[]> {
  const res = await apiFetch(`/job-scraper/drafts/${resumeId}`);
  if (!res.ok) throw new Error('Failed to fetch scraped jobs');
  return res.json();
}

export async function deleteScrapedJob(jobId: string): Promise<{ deleted: boolean }> {
  const res = await apiFetch(`/job-scraper/drafts/${jobId}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete job');
  return res.json();
}

export async function clearScrapedJobs(resumeId: string): Promise<{ cleared: number }> {
  const res = await apiFetch(`/job-scraper/drafts/all/${resumeId}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to clear jobs');
  return res.json();
}

export async function setScrapedJobArchived(
  jobId: string,
  archived: boolean
): Promise<{ job_id: string; archived: boolean }> {
  const res = await apiPatch(`/job-scraper/drafts/${jobId}/archive`, { archived });
  if (!res.ok) throw new Error('Failed to update job archive status');
  return res.json();
}

export async function markScrapedJobApplied(
  jobId: string,
  resumeId: string
): Promise<{ marked: boolean; job_id: string; resume_id: string }> {
  const res = await apiPost(`/job-scraper/drafts/${jobId}/apply`, { resume_id: resumeId });
  if (!res.ok) throw new Error('Failed to mark job as applied');
  return res.json();
}
