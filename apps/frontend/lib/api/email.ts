/**
 * API functions for the company outreach email feature
 * (SMTP sender settings + AI-generated outreach + sending).
 */

import { apiFetch, apiPost, apiPut } from './client';

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
}

export interface EmailConfigUpdate {
  smtp_host?: string;
  smtp_port?: number;
  sender_email?: string;
  sender_name?: string;
  use_tls?: boolean;
  password?: string;
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
}

export interface GenerateOutreachEmailResponse {
  subject: string;
  body: string;
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

export interface SentEmail {
  log_id: string;
  company_id?: string | null;
  company_name: string;
  recipient_email: string;
  subject: string;
  body: string;
  attachments: SentEmailAttachment[];
  sent_at: string;
}

export async function fetchEmailHistory(companyId?: string): Promise<SentEmail[]> {
  const query = companyId ? `?company_id=${encodeURIComponent(companyId)}` : '';
  const res = await apiFetch(`/email/history${query}`, { credentials: 'include' });
  return asJson<SentEmail[]>(res, 'Failed to load email history');
}

export async function sendCompanyEmail(form: FormData): Promise<SendEmailResponse> {
  const res = await apiFetch('/email/send', {
    method: 'POST',
    body: form,
  });
  return asJson<SendEmailResponse>(res, 'Failed to send email');
}