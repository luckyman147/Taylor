import { apiFetch, apiPost } from './client';

export interface RedFlag {
  flag: string;
  severity: 'info' | 'warning' | 'danger';
  concern: string;
}

export interface RedFlagsResponse {
  red_flags: RedFlag[];
  ghost_risk_percent: number;
}

export interface DnaSkill {
  skill: string;
  weight?: number;
  level?: string;
}

export interface DnaDomain {
  domain: string;
  level: string;
}

export interface JobDnaResponse {
  job_dna: {
    technical: DnaSkill[];
    experience: DnaDomain[];
    company: string[];
  };
  career_dna: {
    technical: DnaSkill[];
    experience: DnaDomain[];
    company: string[];
  };
  comparison: {
    technical: {
      matched: Array<{ skill: string; jobWeight: number; careerLevel: string }>;
      missing: Array<{ skill: string; weight: number }>;
      extra: Array<{ skill: string; level: string }>;
      score: number;
    };
    experience: {
      matched: string[];
      missing: string[];
      score: number;
    };
    company: {
      matched: string[];
      missing: string[];
      score: number;
    };
    dna_match: number;
  };
}

export interface ShouldApplyResponse {
  match_percent: number;
  career_relevance: number;
  salary_potential: number | null;
  competition: string;
  company_quality: number | null;
  ghost_risk_percent: number;
  verdict: 'yes' | 'no' | 'conditional';
  verdict_reason: string;
  main_weakness: string;
  recommendation: string;
  red_flags: RedFlag[];
  job_dna: JobDnaResponse['job_dna'];
  career_dna: JobDnaResponse['career_dna'];
  comparison: JobDnaResponse['comparison'];
}

export interface HiringFactor {
  score: number;
  detail: string;
}

export interface HiringProbabilityResponse {
  skills: HiringFactor;
  experience: HiringFactor;
  seniority: HiringFactor;
  hiring_probability: number;
  assessment: string;
  summary: string;
  gaps: string[];
}

export async function fetchJobDna(jobId: string): Promise<JobDnaResponse> {
  const res = await apiFetch(`/jobs/${jobId}/dna`);
  if (!res.ok) {
    throw new Error(`Failed to fetch job DNA (status ${res.status})`);
  }
  return res.json();
}

export async function fetchRedFlags(jobId: string): Promise<RedFlagsResponse> {
  const res = await apiFetch(`/jobs/${jobId}/red-flags`);
  if (!res.ok) {
    throw new Error(`Failed to fetch red flags (status ${res.status})`);
  }
  return res.json();
}

export async function fetchHiringProbability(jobId: string): Promise<HiringProbabilityResponse> {
  const res = await apiFetch(`/jobs/${jobId}/hiring-probability`);
  if (!res.ok) {
    throw new Error(`Failed to fetch hiring probability (status ${res.status})`);
  }
  return res.json();
}

export async function fetchShouldApply(jobId: string): Promise<ShouldApplyResponse> {
  const res = await apiPost(`/jobs/${jobId}/should-apply`, {});
  if (!res.ok) {
    throw new Error(`Failed to fetch should-apply analysis (status ${res.status})`);
  }
  return res.json();
}
