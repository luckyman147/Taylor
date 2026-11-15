/**
 * API functions for the company outreach email feature
 * (SMTP sender settings + AI-generated outreach + sending).
 */

import { apiFetch, apiPatch, apiPost, apiPut } from './client';

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

export interface EmailConfig {
  smtp_host: string;
  smtp_port: number;
  sender_email: string;
  sender_name: string;
  use_tls: boolean;
  has_password: boolean;
  /** Mirrors career profile `email_signature` (HTML, sanitized server-side). */
  email_signature?: string;
}

export interface EmailConfigUpdate {
  smtp_host?: string;
  smtp_port?: number;
  sender_email?: string;
  sender_name?: string;
  use_tls?: boolean;
  password?: string;
  /** None/undefined = leave unchanged; empty string = clear. */
  email_signature?: string;
}

export async function fetchEmailConfig(): Promise<EmailConfig> {
  const res = await apiFetch('/config/email', { credentials: 'include' });
  return asJson<EmailConfig>(res, 'Failed to load email settings');
}

export async function updateEmailConfig(payload: EmailConfigUpdate): Promise<EmailConfig> {
  const res = await apiPut('/config/email', payload);
  return asJson<EmailConfig>(res, 'Failed to save email settings');
}

export type OutreachPurpose = 'internship' | 'job' | 'cold' | 'custom';

export interface GenerateOutreachEmailRequest {
  company_name: string;
  company_email: string;
  industry?: string | null;
  company_size?: string | null;
  company_type?: string | null;
  website?: string | null;
  linkedin_url?: string | null;
  recipient_name?: string | null;
  purpose: OutreachPurpose;
  custom_purpose?: string;
  output_language: string;
  resume_id?: string | null;
  instruction?: string | null;
  company_research?: string | null;
  temperature?: number;
}

export interface GenerateOutreachEmailResponse {
  subject: string;
  body: string;
  /** True when a custom HTML signature will be applied on send. */
  uses_html_signature?: boolean;
}

export async function generateOutreachEmail(
  payload: GenerateOutreachEmailRequest
): Promise<GenerateOutreachEmailResponse> {
  const res = await apiPost('/enrichment/generate-outreach-email', payload);
  return asJson<GenerateOutreachEmailResponse>(res, 'Failed to generate email');
}

export interface SendEmailResponse {
  success: boolean;
  message: string;
}

export interface SentEmailAttachment {
  name: string;
  content_type?: string | null;
  size?: number;
}

export type SentEmailOutcome = 'pending' | 'responded' | 'not_interested' | 'bounced';

export interface SentEmail {
  log_id: string;
  company_id?: string | null;
  contact_id?: string | null;
  company_name: string;
  recipient_email: string;
  subject: string;
  body: string;
  attachments: SentEmailAttachment[];
  purpose?: string | null;
  email_mode?: string | null;
  outcome: SentEmailOutcome;
  outcome_note?: string | null;
  outcome_at?: string | null;
  sent_at: string;
}

export const EMAIL_HISTORY_PAGE_SIZE = 25;

export interface EmailHistoryPage {
  emails: SentEmail[];
  total: number;
}

export async function fetchEmailHistory(
  options: { companyId?: string; limit?: number; offset?: number } = {}
): Promise<EmailHistoryPage> {
  const params = new URLSearchParams();
  if (options.companyId) params.set('company_id', options.companyId);
  if (options.limit !== undefined) params.set('limit', String(options.limit));
  if (options.offset !== undefined) params.set('offset', String(options.offset));
  const query = params.toString();
  const res = await apiFetch(`/email/history${query ? `?${query}` : ''}`, {
    credentials: 'include',
  });
  const emails = await asJson<SentEmail[]>(res, 'Failed to load email history');
  const totalHeader = Number(res.headers.get('X-Total-Count'));
  const total = Number.isFinite(totalHeader) ? totalHeader : emails.length;
  return { emails, total };
}

export async function sendCompanyEmail(form: FormData): Promise<SendEmailResponse> {
  const res = await apiFetch('/email/send', {
    method: 'POST',
    body: form,
  });
  return asJson<SendEmailResponse>(res, 'Failed to send email');
}

export interface SentEmailOutcomeResponse {
  updated: boolean;
  email: SentEmail | null;
}

export async function updateSentEmailOutcome(
  logId: string,
  outcome: SentEmailOutcome,
  note?: string
): Promise<SentEmailOutcomeResponse> {
  const res = await apiPatch(`/email/history/${encodeURIComponent(logId)}/outcome`, {
    outcome,
    note: note ?? null,
  });
  return asJson<SentEmailOutcomeResponse>(res, 'Failed to update outcome');
}

export interface BulkSentEmailOutcomeResponse {
  updated: number;
}

export async function bulkUpdateSentEmailOutcomes(
  logIds: string[],
  outcome: SentEmailOutcome,
  note?: string
): Promise<BulkSentEmailOutcomeResponse> {
  const res = await apiPost('/email/history/bulk-outcome', {
    log_ids: logIds,
    outcome,
    note: note ?? null,
  });
  return asJson<BulkSentEmailOutcomeResponse>(res, 'Failed to update outcomes');
}

export interface ReplyCandidateMatch {
  uid: string;
  subject: string;
  sender: string;
  date: string;
  snippet: string;
}

export interface ReplyCandidate {
  log_id: string;
  recipient_email: string;
  company_name: string;
  sent_subject: string;
  sent_at: string;
  matched: ReplyCandidateMatch;
}

export interface CheckRepliesResponse {
  checked: number;
  candidates: ReplyCandidate[];
  unavailable_reason: string | null;
}

export async function checkEmailReplies(): Promise<CheckRepliesResponse> {
  const res = await apiPost('/email/check-replies', {});
  return asJson<CheckRepliesResponse>(res, 'Failed to check for replies');
}

export interface SegmentStat {
  key: string;
  sent: number;
  responded: number;
  response_rate: number;
}

export interface EmailTimelinePoint {
  date: string;
  sent: number;
  responded: number;
}

export interface EmailStatsResponse {
  total_sent: number;
  pending: number;
  responded: number;
  not_interested: number;
  bounced: number;
  response_rate: number;
  avg_body_length_responded: number | null;
  avg_body_length_not_responded: number | null;
  by_recipient_type: SegmentStat[];
  by_mode: SegmentStat[];
  by_purpose: SegmentStat[];
  top_subjects: Array<{ subject: string; sent: number; responded: number; response_rate: number }>;
  timeline: EmailTimelinePoint[];
}

export async function fetchEmailStats(): Promise<EmailStatsResponse> {
  const res = await apiFetch('/email/stats', { credentials: 'include' });
  return asJson<EmailStatsResponse>(res, 'Failed to load email stats');
}

export interface OutreachAnalysisReport {
  summary: string;
  what_works: string[];
  what_fails: string[];
  subject_tips: string[];
  body_tips: string[];
  cta_tips: string[];
  example_subject: string;
  example_body: string;
}

export interface OutreachAnalysisResponse {
  report: OutreachAnalysisReport;
  emails_analyzed: number;
  message: string;
  created_at?: string | null;
}

export async function analyzeOutreachHistory(): Promise<OutreachAnalysisResponse> {
  const res = await apiPost('/email/analyze', {});
  return asJson<OutreachAnalysisResponse>(res, 'Failed to analyze outreach');
}

export async function fetchLatestOutreachAnalysis(): Promise<OutreachAnalysisResponse | null> {
  const res = await apiFetch('/email/analysis/latest', { credentials: 'include' });
  if (res.status === 404) return null;
  return asJson<OutreachAnalysisResponse>(res, 'Failed to load saved analysis');
}
