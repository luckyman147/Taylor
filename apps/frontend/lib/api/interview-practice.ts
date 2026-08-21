/**
 * API functions for the Interview Practice Hub
 * (scenario practice, AI feedback, and practice history).
 */

import { apiFetch, apiPost } from './client';

function extractDetail(data: unknown): string | null {
  if (data && typeof data === 'object' && 'detail' in data) {
    const detail = (data as { detail: unknown }).detail;
    if (typeof detail === 'string') return detail;
    if (Array.isArray(detail) && typeof detail[0]?.msg === 'string') {
      return detail[0].msg;
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

export type PracticeLevel = 'strong' | 'good' | 'needs_work';

export interface PracticeFeedbackRequest {
  scenario_id?: string | null;
  scenario_title: string;
  scenario_description?: string | null;
  duration_minutes?: number | null;
  answer: string;
  resume_id?: string | null;
  output_language?: string;
}

export interface PracticeFeedbackResponse {
  session_id: string;
  scenario_id?: string | null;
  scenario_title: string;
  scenario_description?: string | null;
  duration_minutes?: number | null;
  answer: string;
  score: number;
  level: PracticeLevel;
  strengths: string[];
  improvements: string[];
  recommended_answer_points: string[];
  follow_ups: string[];
  created_at: string;
}

export interface PracticeSessionSummary {
  session_id: string;
  scenario_id?: string | null;
  scenario_title: string;
  scenario_description?: string | null;
  duration_minutes?: number | null;
  answer: string;
  score?: number | null;
  level?: PracticeLevel | null;
  feedback: {
    strengths?: string[];
    improvements?: string[];
    recommended_answer_points?: string[];
    follow_ups?: string[];
  };
  created_at: string;
}

export async function generatePracticeFeedback(
  payload: PracticeFeedbackRequest
): Promise<PracticeFeedbackResponse> {
  const body: PracticeFeedbackRequest = { output_language: 'en', ...payload };
  const res = await apiPost('/interview-practice/feedback', body);
  return asJson<PracticeFeedbackResponse>(res, 'Failed to generate practice feedback');
}

export async function fetchPracticeSessions(): Promise<PracticeSessionSummary[]> {
  const res = await apiFetch('/interview-practice/sessions', { credentials: 'include' });
  return asJson<PracticeSessionSummary[]>(res, 'Failed to load practice history');
}