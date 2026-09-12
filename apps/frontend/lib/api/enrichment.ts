/**
 * API functions for AI-powered resume enrichment.
 */

import { apiFetch, apiPost } from './client';

// Types matching backend schemas

export interface EnrichmentItem {
  item_id: string;
  item_type: 'experience' | 'project';
  title: string;
  subtitle?: string;
  current_description: string[];
  weakness_reason: string;
}

export interface EnrichmentQuestion {
  question_id: string;
  item_id: string;
  question: string;
  placeholder: string;
}

export interface AnalysisResponse {
  items_to_enrich: EnrichmentItem[];
  questions: EnrichmentQuestion[];
  analysis_summary?: string;
}

export interface AnswerInput {
  question_id: string;
  answer: string;
}

export interface EnhancedDescription {
  item_id: string;
  item_type: 'experience' | 'project';
  title: string;
  original_description: string[];
  enhanced_description: string[];
}

export interface EnhancementPreview {
  enhancements: EnhancedDescription[];
}

/**
 * Analyze a resume to identify items that need enrichment.
 * Returns items with weak descriptions and clarifying questions.
 */
export async function analyzeResume(resumeId: string): Promise<AnalysisResponse> {
  const res = await apiFetch(`/enrichment/analyze/${resumeId}`, {
    method: 'POST',
    credentials: 'include',
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail || `Failed to analyze resume (status ${res.status}).`);
  }

  return res.json();
}

/**
 * Generate enhanced descriptions from user answers.
 */
export async function generateEnhancements(
  resumeId: string,
  answers: AnswerInput[]
): Promise<EnhancementPreview> {
  const res = await apiPost('/enrichment/enhance', {
    resume_id: resumeId,
    answers,
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail || `Failed to generate enhancements (status ${res.status}).`);
  }

  return res.json();
}

/**
 * Apply enhancements to the master resume.
 */
export async function applyEnhancements(
  resumeId: string,
  enhancements: EnhancedDescription[]
): Promise<{ message: string; updated_items: number }> {
  const res = await apiPost(`/enrichment/apply/${resumeId}`, {
    enhancements,
  });

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail || `Failed to apply enhancements (status ${res.status}).`);
  }

  return res.json();
}

// ============================================
// AI Regenerate Feature Types
// ============================================

export interface RegenerateItemInput {
  item_id: string;
  item_type: 'experience' | 'project' | 'skills' | 'summary';
  title: string;
  subtitle?: string;
  current_content: string[];
}

export interface RegenerateRequest {
  resume_id: string;
  items: RegenerateItemInput[];
  instruction: string;
  output_language?: string;
}

export interface RegeneratedItem {
  item_id: string;
  item_type: 'experience' | 'project' | 'skills' | 'summary';
  title: string;
  subtitle?: string;
  original_content: string[];
  new_content: string[];
  new_skill_groups?: { name: string; skills: string[] }[];
  diff_summary: string;
}

export interface RegenerateItemError {
  item_id: string;
  item_type: 'experience' | 'project' | 'skills' | 'summary';
  title: string;
  subtitle?: string;
  message: string;
}

export interface RegenerateResponse {
  regenerated_items: RegeneratedItem[];
  errors?: RegenerateItemError[];
}

/**
 * Regenerate selected resume items based on user feedback.
 * Uses AI to rewrite content addressing user's concerns.
 */
export async function regenerateItems(request: RegenerateRequest): Promise<RegenerateResponse> {
  const res = await apiPost('/enrichment/regenerate', request);

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail || `Failed to regenerate content (status ${res.status}).`);
  }

  return res.json();
}

/**
 * Apply regenerated items to the master resume.
 */
export async function applyRegeneratedItems(
  resumeId: string,
  regeneratedItems: RegeneratedItem[]
): Promise<{ message: string; updated_items: number }> {
  const res = await apiPost(`/enrichment/apply-regenerated/${resumeId}`, regeneratedItems);

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail || `Failed to apply changes (status ${res.status}).`);
  }

  return res.json();
}

// ============================================
// Project Bullet Generation Types
// ============================================

export interface GenerateProjectBulletsRequest {
  name: string;
  role?: string | null;
  years?: string | null;
  github?: string | null;
  website?: string | null;
  description?: string[];
  languages?: string[];
  readme?: string | null;
  prompt?: string;
  output_language?: string;
}

export interface GenerateProjectBulletsResponse {
  bullets: string[];
}

/**
 * Generate resume bullet points for a project from its README/description,
 * optionally guided by a user mini-prompt.
 */
export async function generateProjectBullets(
  request: GenerateProjectBulletsRequest
): Promise<GenerateProjectBulletsResponse> {
  const res = await apiPost('/enrichment/generate-project-bullets', request);

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail || `Failed to generate project bullets (status ${res.status}).`);
  }

  return res.json();
}

// ============================================
// Company Research Types
// ============================================

export interface ResearchCompanyRequest {
  company_name: string;
  website?: string | null;
  industry?: string | null;
  linkedin_url?: string | null;
}

export interface ResearchCompanyResponse {
  company_name: string;
  website_content: string;
  linkedin_content: string;
  hiring_signals: string;
  research_summary: string;
  sources: string[];
}

/**
 * Research a company by crawling its website, LinkedIn page, and checking hiring signals.
 * Returns structured research data to personalize outreach emails.
 */
export async function researchCompany(
  payload: ResearchCompanyRequest
): Promise<ResearchCompanyResponse> {
  const res = await apiPost('/enrichment/research-company', payload);

  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.detail || `Failed to research company (status ${res.status}).`);
  }

  return res.json();
}
