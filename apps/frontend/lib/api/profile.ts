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

export interface CareerEducation {
  education_id: string;
  institution: string;
  degree: string | null;
  years: string | null;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export interface CareerProject {
  project_id: string;
  name: string;
  role: string | null;
  years: string | null;
  github: string | null;
  website: string | null;
  description: string[];
  languages: string[];
  readme: string | null;
  created_at: string;
  updated_at: string;
}

export interface CareerAchievement {
  achievement_id: string;
  title: string;
  description: string | null;
  date: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProfileBundle {
  profile: CareerProfile;
  skills: CareerSkill[];
  certifications: CareerCertification[];
  education: CareerEducation[];
  projects: CareerProject[];
  achievements: CareerAchievement[];
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
  education: Array<{
    institution: string | null;
    degree: string | null;
    years: string | null;
    description: string | null;
  }>;
  projects: Array<{
    name: string | null;
    role: string | null;
    years: string | null;
    github: string | null;
    website: string | null;
    description: string[];
    skills: string[];
  }>;
  achievements: Array<{
    title: string | null;
    date: string | null;
    description: string | null;
  }>;
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
  action: 'learn' | 'strengthen' | 'monitor';
  in_profile: boolean;
}

export interface CareerRoiRequest {
  skills?: string[];
  include_advice?: boolean;
}

export interface CareerRoiResponse {
  results: SkillRoiRow[];
  advice: string | null;
  note: string | null;
  gaps: SkillRoiRow[];
  strengthen: SkillRoiRow[];
  rest: SkillRoiRow[];
}

export interface SkillResource {
  title: string;
  url: string;
  source: string;
}

export interface SkillResourcesRequest {
  skills: string[];
  refresh?: boolean;
}

export interface SkillResourcesResponse {
  resources: Record<string, SkillResource[]>;
  note: string | null;
}

export interface SkillPosition {
  skill: string;
  percentile: number;
  level: 'beginner' | 'intermediate' | 'advanced' | 'expert';
}

export interface DomainPosition {
  domain: string;
  percentile: number;
  seniority: 'junior' | 'mid' | 'senior';
  readiness: 'strong' | 'adequate' | 'underqualified';
}

export interface RolePosition {
  role: string;
  domain: string;
  seniority: 'junior' | 'mid' | 'senior';
  match_score: number;
  reason: string;
}

export interface MarketPositionResponse {
  skills: SkillPosition[];
  domains: DomainPosition[];
  current_role: string | null;
  specialization: string[];
  recommended_roles: RolePosition[];
  verdict: string;
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
// Career graph: education / projects / achievements
// ---------------------------------------------------------------------------

export interface EducationCreate {
  institution: string;
  degree?: string | null;
  years?: string | null;
  description?: string | null;
}

export interface EducationUpdate {
  institution?: string;
  degree?: string | null;
  years?: string | null;
  description?: string | null;
}

export async function createEducation(payload: EducationCreate): Promise<CareerEducation> {
  const res = await apiPost('/profile/education', payload);
  return asJson<CareerEducation>(res, 'Failed to add education');
}

export async function importEducationFromMaster(): Promise<CareerEducation[]> {
  const res = await apiPost('/profile/education/import-from-master', {});
  return asJson<CareerEducation[]>(res, 'Failed to import education from resume');
}

export async function updateEducation(
  educationId: string,
  payload: EducationUpdate
): Promise<CareerEducation> {
  const res = await apiPatch(`/profile/education/${educationId}`, payload);
  return asJson<CareerEducation>(res, 'Failed to update education');
}

export async function deleteEducation(educationId: string): Promise<void> {
  const res = await apiDelete(`/profile/education/${educationId}`);
  await asJson<CareerActionResponse>(res, 'Failed to delete education');
}

export interface ProjectCreate {
  name: string;
  role?: string | null;
  years?: string | null;
  github?: string | null;
  website?: string | null;
  description?: string[];
  languages?: string[];
  readme?: string | null;
}

export interface ProjectUpdate {
  name?: string;
  role?: string | null;
  years?: string | null;
  github?: string | null;
  website?: string | null;
  description?: string[];
  languages?: string[];
  readme?: string | null;
}

export interface GitHubImportResult {
  imported: number;
  updated: number;
  total: number;
}

export async function createProject(payload: ProjectCreate): Promise<CareerProject> {
  const res = await apiPost('/profile/projects', payload);
  return asJson<CareerProject>(res, 'Failed to add project');
}

export async function updateProject(
  projectId: string,
  payload: ProjectUpdate
): Promise<CareerProject> {
  const res = await apiPatch(`/profile/projects/${projectId}`, payload);
  return asJson<CareerProject>(res, 'Failed to update project');
}

export async function deleteProject(projectId: string): Promise<void> {
  const res = await apiDelete(`/profile/projects/${projectId}`);
  await asJson<CareerActionResponse>(res, 'Failed to delete project');
}

export async function importProjectsFromGithub(
  payload: { repo_urls?: string[] } = {}
): Promise<GitHubImportResult> {
  const res = await apiPost('/profile/projects/import-from-github', payload);
  return asJson<GitHubImportResult>(res, 'Failed to import projects from GitHub');
}

export interface AchievementCreate {
  title: string;
  description?: string | null;
  date?: string | null;
}

export interface AchievementUpdate {
  title?: string;
  description?: string | null;
  date?: string | null;
}

export async function createAchievement(payload: AchievementCreate): Promise<CareerAchievement> {
  const res = await apiPost('/profile/achievements', payload);
  return asJson<CareerAchievement>(res, 'Failed to add achievement');
}

export async function updateAchievement(
  achievementId: string,
  payload: AchievementUpdate
): Promise<CareerAchievement> {
  const res = await apiPatch(`/profile/achievements/${achievementId}`, payload);
  return asJson<CareerAchievement>(res, 'Failed to update achievement');
}

export async function deleteAchievement(achievementId: string): Promise<void> {
  const res = await apiDelete(`/profile/achievements/${achievementId}`);
  await asJson<CareerActionResponse>(res, 'Failed to delete achievement');
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

export async function getSkillResources(
  payload: SkillResourcesRequest
): Promise<SkillResourcesResponse> {
  const res = await apiPost('/profile/skill-resources', payload, 300_000);
  return asJson<SkillResourcesResponse>(res, 'Failed to load learning resources');
}

export async function getMarketPosition(): Promise<MarketPositionResponse> {
  const res = await apiPost('/profile/market-position', {});
  return asJson<MarketPositionResponse>(res, 'Failed to compute market position');
}

export interface SkillSuggestion {
  name: string;
  reason: string;
  kind: 'remembered' | 'learn_next';
}

export interface SkillSuggestionsResponse {
  skills: SkillSuggestion[];
  note: string | null;
}

export async function getSkillSuggestions(): Promise<SkillSuggestionsResponse> {
  const res = await apiPost('/profile/skill-suggestions', {}, 300_000);
  return asJson<SkillSuggestionsResponse>(res, 'Failed to load skill suggestions');
}

export type ProfileSuggestionField = 'career_goals' | 'target_roles' | 'target_locations';

export async function getProfileSuggestions(
  field: ProfileSuggestionField
): Promise<{ suggestions: string[] }> {
  const res = await apiFetch(`/profile/suggestions?field=${field}`, { credentials: 'include' });
  return asJson<{ suggestions: string[] }>(res, 'Failed to load suggestions');
}
