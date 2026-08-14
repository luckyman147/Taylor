import { apiDelete, apiFetch, apiPatch, apiPost, apiPut } from './client';

// ---------------------------------------------------------------------------
// Types (mirror backend app/schemas/profile.py)
// ---------------------------------------------------------------------------

export interface WorkExperienceItem {
  role: string;
  company: string | null;
  location: string | null;
  years: string | null;
  description: string[];
}

export interface CareerProfile {
  profile_id: string;
  name: string | null;
  title: string | null;
  email: string | null;
  phone: string | null;
  location: string | null;
  website: string | null;
  linkedin: string | null;
  github: string | null;
  summary: string | null;
  career_goals: string[];
  target_roles: string[];
  target_locations: string[];
  target_salary_min: number | null;
  target_salary_max: number | null;
  work_experience: WorkExperienceItem[];
  languages: string[];
  awards: string[];
  source_resume_id: string | null;
  source_resume_title: string | null;
  created_at: string;
  updated_at: string;
}

export interface CareerSkill {
  skill_id: string;
  name: string;
  category: string | null;
  proficiency: number | null;
  years_experience: number | null;
  last_used: string | null;
  created_at: string;
  updated_at: string;
}

export interface CareerCertification {
  certification_id: string;
  name: string;
  issuer: string | null;
  date_obtained: string | null;
  url: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProfileBundle {
  profile: CareerProfile;
  skills: CareerSkill[];
  certifications: CareerCertification[];
}

export interface ProfileUpdate {
  name?: string | null;
  title?: string | null;
  email?: string | null;
  phone?: string | null;
  location?: string | null;
  website?: string | null;
  linkedin?: string | null;
  github?: string | null;
  summary?: string | null;
  career_goals?: string[];
  target_roles?: string[];
  target_locations?: string[];
  target_salary_min?: number | null;
  target_salary_max?: number | null;
  work_experience?: WorkExperienceItem[];
  languages?: string[];
  awards?: string[];
}

export interface SkillCreate {
  name: string;
  category?: string | null;
  proficiency?: number | null;
  years_experience?: number | null;
  last_used?: string | null;
}

export interface SkillUpdate {
  name?: string;
  category?: string | null;
  proficiency?: number | null;
  years_experience?: number | null;
  last_used?: string | null;
}

export interface CertificationCreate {
  name: string;
  issuer?: string | null;
  date_obtained?: string | null;
  url?: string | null;
}

export interface CertificationUpdate {
  name?: string;
  issuer?: string | null;
  date_obtained?: string | null;
  url?: string | null;
}

export interface CareerActionResponse {
  message: string;
  affected: number;
}

export interface FunnelStats {
  total: number;
  by_status: Record<string, number>;
  rejected: number;
  interviewed: number;
  accepted: number;
  rejection_rate: number | null;
  applied_to_interview_rate: number | null;
  interview_to_accepted_rate: number | null;
  median_days_to_interview: number | null;
  top_companies: Array<{ company: string; count: number }>;
  rejection_reasons: Array<{ reason: string; count: number }>;
}

export interface CareerMemory {
  profile: CareerProfile | null;
  master_resume: { resume_id: string; title: string | null; content: string } | null;
  skills: CareerSkill[];
  certifications: CareerCertification[];
  funnel: FunnelStats;
  rejected_applications: Array<{
    company: string | null;
    role: string | null;
    rejection_reason: string | null;
  }>;
  scraped_jobs: Array<{
    title: string;
    company: string;
    location: string | null;
    url: string | null;
  }>;
  contacts: Array<{
    name: string;
    company: string | null;
    relationship: string | null;
    status: string | null;
  }>;
  github_repos: Array<{
    name: string;
    description: string | null;
    language: string | null;
    stars: number;
  }>;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface CareerAskRequest {
  question: string;
  history: ChatMessage[];
}

export interface CareerAskResponse {
  answer: string;
}

export interface CareerInsightsResponse {
  stats: FunnelStats;
  narrative: string | null;
}

export interface SkillRoiRow {
  skill: string;
  jobs_unlocked_pct: number;
  matching_jobs: number;
  salary_impact_pct: number | null;
  learning_effort: 'low' | 'medium' | 'high';
  existing_knowledge: number;
  roi_score: number;
}

export interface CareerRoiRequest {
  skills?: string[];
  include_advice?: boolean;
}

export interface CareerRoiResponse {
  results: SkillRoiRow[];
  advice: string | null;
  note: string | null;
}

function extractDetail(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const detail = (data as { detail?: unknown }).detail;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    const messages = detail
      .map((d) =>
        d && typeof d === 'object' && 'msg' in d ? String((d as { msg: unknown }).msg) : null
      )
      .filter((m): m is string => Boolean(m));
    if (messages.length > 0) return messages.join('; ');
  }
  if (detail && typeof detail === 'object' && !Array.isArray(detail)) {
    try {
      return JSON.stringify(detail);
    } catch {
      return null;
    }
  }
  return null;
}

async function asJson<T>(res: Response, fallback: string): Promise<T> {
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(extractDetail(data) || `${fallback} (status ${res.status}).`);
  }
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Profile CRUD
// ---------------------------------------------------------------------------

export async function getProfile(): Promise<ProfileBundle> {
  const res = await apiFetch('/profile', { credentials: 'include' });
  return asJson<ProfileBundle>(res, 'Failed to load career profile');
}

export async function updateProfile(payload: ProfileUpdate): Promise<CareerProfile> {
  const res = await apiPut('/profile', payload);
  return asJson<CareerProfile>(res, 'Failed to save career profile');
}

export async function seedProfileFromMaster(resumeId?: string | null): Promise<CareerProfile> {
  const res = await apiPost('/profile/seed-from-master', { resume_id: resumeId ?? null });
  return asJson<CareerProfile>(res, 'Failed to seed profile from resume');
}

// ---------------------------------------------------------------------------
// Skills
// ---------------------------------------------------------------------------

export async function createSkill(payload: SkillCreate): Promise<CareerSkill> {
  const res = await apiPost('/profile/skills', payload);
  return asJson<CareerSkill>(res, 'Failed to add skill');
}

export async function updateSkill(skillId: string, payload: SkillUpdate): Promise<CareerSkill> {
  const res = await apiPatch(`/profile/skills/${skillId}`, payload);
  return asJson<CareerSkill>(res, 'Failed to update skill');
}

export async function deleteSkill(skillId: string): Promise<void> {
  const res = await apiDelete(`/profile/skills/${skillId}`);
  await asJson<CareerActionResponse>(res, 'Failed to delete skill');
}

// ---------------------------------------------------------------------------
// Certifications
// ---------------------------------------------------------------------------

export async function createCertification(
  payload: CertificationCreate
): Promise<CareerCertification> {
  const res = await apiPost('/profile/certifications', payload);
  return asJson<CareerCertification>(res, 'Failed to add certification');
}

export async function updateCertification(
  certificationId: string,
  payload: CertificationUpdate
): Promise<CareerCertification> {
  const res = await apiPatch(`/profile/certifications/${certificationId}`, payload);
  return asJson<CareerCertification>(res, 'Failed to update certification');
}

export async function deleteCertification(certificationId: string): Promise<void> {
  const res = await apiDelete(`/profile/certifications/${certificationId}`);
  await asJson<CareerActionResponse>(res, 'Failed to delete certification');
}

// ---------------------------------------------------------------------------
// Career LLM
// ---------------------------------------------------------------------------

export async function getCareerMemory(): Promise<CareerMemory> {
  const res = await apiFetch('/profile/memory', { credentials: 'include' });
  return asJson<CareerMemory>(res, 'Failed to load career memory');
}

export async function askCareerQuestion(payload: CareerAskRequest): Promise<CareerAskResponse> {
  const res = await apiPost('/profile/ask', payload, 300_000);
  return asJson<CareerAskResponse>(res, 'Failed to get career advice');
}

export async function getCareerInsights(): Promise<CareerInsightsResponse> {
  const res = await apiFetch('/profile/insights', { credentials: 'include' });
  return asJson<CareerInsightsResponse>(res, 'Failed to load career insights');
}

export async function getSkillRoi(payload: CareerRoiRequest): Promise<CareerRoiResponse> {
  const res = await apiPost('/profile/skill-roi', payload, 300_000);
  return asJson<CareerRoiResponse>(res, 'Failed to compute skill ROI');
}

export type ProfileSuggestionField = 'career_goals' | 'target_roles' | 'target_locations';

export async function getProfileSuggestions(
  field: ProfileSuggestionField
): Promise<{ suggestions: string[] }> {
  const res = await apiFetch(`/profile/suggestions?field=${field}`, { credentials: 'include' });
  return asJson<{ suggestions: string[] }>(res, 'Failed to load suggestions');
}
