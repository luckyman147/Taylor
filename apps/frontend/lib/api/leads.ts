import { apiFetch, apiPost, apiPut, apiPatch, apiDelete, BACKEND_URL } from './client';

export type LeadType = 'person' | 'company' | 'agency';
export type SuggestedType = 'contact' | 'company' | 'agency' | 'unsure';
export type CategorySource = 'heuristic' | 'ai' | 'user' | 'unsure';
export type LeadStatus = 'new' | 'saved' | 'contacted' | 'dismissed';

export interface Lead {
  lead_id: string;
  search_id: string;
  lead_type: LeadType;
  name: string;
  title: string | null;
  company: string | null;
  email: string | null;
  phone: string | null;
  linkedin_url: string | null;
  website: string | null;
  location: string | null;
  industry: string | null;
  company_size: string | null;
  description: string | null;
  source: string;
  sources: string[];
  suggested_type: SuggestedType;
  category_source: CategorySource;
  category_confidence: number;
  status: LeadStatus;
  contact_id: string | null;
  company_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface DedupStats {
  raw: number;
  after_exact: number;
  after_fuzzy: number;
  merged: number;
  already_in_db: number;
  new_inserted: number;
}

export interface LeadSearchRequest {
  keywords: string;
  target?: string;
  purpose?: string;
  locations?: string[];
  lead_types?: LeadType[];
  sources?: string[];
  max_results?: number;
  enrich_contacts?: boolean;
}

export interface LeadSearchResponse {
  search_id: string;
  leads: Lead[];
  dedup_stats: DedupStats;
  mcp_status: Record<string, { available: boolean; details: string }>;
}

export interface LeadProgressEvent {
  phase:
    | 'searching'
    | 'profiles'
    | 'companies'
    | 'filtering'
    | 'categorize'
    | 'dedupe'
    | 'persisted'
    | 'enrich'
    | 'done'
    | 'error';
  detail?: string | null;
  done?: number | null;
  total?: number | null;
  source?: string | null;
  result?: LeadSearchResponse | null;
}

export interface LeadListResponse {
  leads: Lead[];
}

export interface LeadUpdate {
  status?: LeadStatus;
  suggested_type?: SuggestedType;
}

export interface LeadSaveRequest {
  target: 'contact' | 'company';
  create_linked_company?: boolean;
}

export interface LeadActionResponse {
  message: string;
  affected: number;
  details: string[];
}

export interface LeadCriteria {
  keywords: string[];
  titles: string[];
  industries: string[];
  locations: string[];
  company_types: string[];
  lead_types: LeadType[];
  seniorities: string[];
  target: string | null;
  purpose: string | null;
  recency_hint: string | null;
  rationale: string | null;
}

export interface CurrentSearchParams {
  keywords?: string | null;
  target?: string | null;
  purpose?: string | null;
  locations?: string[];
  lead_types?: LeadType[];
  sources?: string[];
}

export interface LeadCriteriaRequest {
  resume_id?: string | null;
  goal?: string | null;
  niche?: string | null;
  current?: CurrentSearchParams | null;
}

export interface LeadCriteriaResponse {
  criteria: LeadCriteria;
  tracked_names: string[];
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
  return null;
}

async function asJson<T>(res: Response, fallback: string): Promise<T> {
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(extractDetail(data) || `${fallback} (status ${res.status}).`);
  }
  return res.json() as Promise<T>;
}

/** AI-proposed search criteria — user reviews before any scraping. */
export async function recommendLeadCriteria(
  payload: LeadCriteriaRequest
): Promise<LeadCriteriaResponse> {
  const res = await apiPost('/leads/recommend-criteria', payload);
  return asJson<LeadCriteriaResponse>(res, 'Failed to recommend criteria');
}

/** Scrape leads across sources, dedupe, and persist. */
export async function searchLeads(payload: LeadSearchRequest): Promise<LeadSearchResponse> {
  const res = await apiPost('/leads/search', payload);
  return asJson<LeadSearchResponse>(res, 'Lead search failed');
}

/** Safety net well above the slowest search (profile reads run in a browser). */
const LEAD_STREAM_TIMEOUT_MS = 600_000;

/**
 * Search with SSE progress: `onEvent` fires per pipeline event; resolves with
 * the final `done` event's full LeadSearchResponse. Uses a direct backend URL
 * (same pattern as chat streaming) so the Next proxy can't buffer the stream.
 */
export async function searchLeadsStream(
  payload: LeadSearchRequest,
  onEvent: (event: LeadProgressEvent) => void,
  signal?: AbortSignal
): Promise<LeadSearchResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LEAD_STREAM_TIMEOUT_MS);
  const onOuterAbort = () => controller.abort();
  signal?.addEventListener('abort', onOuterAbort);

  try {
    const res = await fetch(`${BACKEND_URL}/api/v1/leads/search?stream=true`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(extractDetail(data) || `Lead search failed (status ${res.status}).`);
    }
    const reader = res.body?.getReader();
    if (!reader) {
      throw new Error('Lead search stream has no body.');
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let final: LeadSearchResponse | null = null;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data: ')) continue;

        let event: LeadProgressEvent;
        try {
          event = JSON.parse(trimmed.slice(6)) as LeadProgressEvent;
        } catch {
          continue; // skip malformed events
        }
        if (event.phase === 'error') {
          throw new Error(event.detail || 'Lead search failed. Please try again.');
        }
        onEvent(event);
        if (event.phase === 'done' && event.result) {
          final = event.result;
        }
      }
    }

    if (!final) {
      throw new Error('Lead search stream ended unexpectedly. Please try again.');
    }
    return final;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onOuterAbort);
  }
}

export async function listLeads(params?: {
  search_id?: string;
  status?: LeadStatus;
  lead_type?: LeadType;
}): Promise<LeadListResponse> {
  const query = new URLSearchParams();
  if (params?.search_id) query.set('search_id', params.search_id);
  if (params?.status) query.set('status', params.status);
  if (params?.lead_type) query.set('lead_type', params.lead_type);
  const qs = query.toString();
  const res = await apiFetch(`/leads${qs ? `?${qs}` : ''}`, { credentials: 'include' });
  return asJson<LeadListResponse>(res, 'Failed to load leads');
}

export async function updateLead(id: string, payload: LeadUpdate): Promise<Lead> {
  const res = await apiPatch(`/leads/${id}`, payload);
  return asJson<Lead>(res, 'Failed to update lead');
}

export async function saveLead(id: string, payload: LeadSaveRequest): Promise<Lead> {
  const res = await apiPost(`/leads/${id}/save`, payload);
  return asJson<Lead>(res, 'Failed to save lead');
}

export async function bulkSaveLeads(
  leadIds: string[],
  payload: LeadSaveRequest
): Promise<LeadActionResponse> {
  const res = await apiPost('/leads/bulk-save', { lead_ids: leadIds, ...payload });
  return asJson<LeadActionResponse>(res, 'Failed to save leads');
}

export async function deleteLead(id: string): Promise<LeadActionResponse> {
  const res = await apiDelete(`/leads/${id}`);
  return asJson<LeadActionResponse>(res, 'Failed to delete lead');
}

export async function bulkDeleteLeads(leadIds: string[]): Promise<LeadActionResponse> {
  const res = await apiPost('/leads/bulk-delete', { lead_ids: leadIds });
  return asJson<LeadActionResponse>(res, 'Failed to delete leads');
}

export interface LeadSearchDraft {
  draft_id: string;
  name: string;
  keywords: string | null;
  target: string | null;
  purpose: string | null;
  locations: string[];
  lead_types: string[];
  sources: string[];
  enrich_contacts: boolean;
  updated_at: string;
}

export interface LeadSearchDraftUpsert {
  name: string;
  keywords?: string | null;
  target?: string | null;
  purpose?: string | null;
  locations?: string[];
  lead_types?: string[];
  sources?: string[];
  enrich_contacts?: boolean;
}

export async function listLeadDrafts(): Promise<{ drafts: LeadSearchDraft[] }> {
  const res = await apiFetch('/leads/drafts', { credentials: 'include' });
  return asJson<{ drafts: LeadSearchDraft[] }>(res, 'Failed to load drafts');
}

export async function saveLeadDraft(payload: LeadSearchDraftUpsert): Promise<LeadSearchDraft> {
  const res = await apiPut('/leads/drafts', payload);
  return asJson<LeadSearchDraft>(res, 'Failed to save draft');
}

export async function deleteLeadDraft(draftId: string): Promise<LeadActionResponse> {
  const res = await apiDelete(`/leads/drafts/${draftId}`);
  return asJson<LeadActionResponse>(res, 'Failed to delete draft');
}
