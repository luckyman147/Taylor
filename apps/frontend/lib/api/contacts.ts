import { apiFetch, apiPost, apiPatch, apiDelete } from './client';

// Stable enum keys (decoupled from i18n labels).
export type ContactGoal =
  | 'networking'
  | 'informational_interview'
  | 'request_referral'
  | 'research_interviewer'
  | 'research_career';

export type ContactStatus =
  | 'to_contact'
  | 'contacted'
  | 'follow_up'
  | 'meeting_scheduled'
  | 'thank_you_sent';

export type ContactRelationship =
  | 'self'
  | 'coworker'
  | 'friend'
  | 'family'
  | 'other'
  | 'recruiter'
  | 'mentor'
  | 'hiring_manager'
  | 'alumni';

export interface Contact {
  contact_id: string;
  name: string;
  email: string | null;
  company: string | null;
  location: string | null;
  goal: ContactGoal | null;
  status: ContactStatus | null;
  relationship: ContactRelationship | null;
  follow_up_date: string | null;
  description: string | null;
  linkedin_url: string | null;
  website_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface ContactListResponse {
  contacts: Contact[];
}

export interface ContactCreate {
  name: string;
  email?: string;
  company?: string;
  location?: string;
  goal?: ContactGoal;
  status?: ContactStatus;
  relationship?: ContactRelationship;
  follow_up_date?: string;
  description?: string;
  linkedin_url?: string;
  website_url?: string;
}

export interface ContactUpdate {
  name?: string | null;
  email?: string | null;
  company?: string | null;
  location?: string | null;
  goal?: ContactGoal | null;
  status?: ContactStatus | null;
  relationship?: ContactRelationship | null;
  follow_up_date?: string | null;
  description?: string | null;
  linkedin_url?: string | null;
  website_url?: string | null;
}

export interface ContactActionResponse {
  message: string;
  affected: number;
}

export interface ContactImportError {
  row: number;
  name: string | null;
  error: string;
}

export interface ContactImportResponse {
  created: number;
  skipped: number;
  errors: ContactImportError[];
}

/** The columns found in an import file, plus fields already matched by alias. */
export interface ContactImportHeaders {
  headers: string[];
  detected: Partial<Record<ContactField, string>>;
}

/** Contact fields that can be mapped to an import column. */
export type ContactField =
  | 'name'
  | 'email'
  | 'company'
  | 'location'
  | 'goal'
  | 'status'
  | 'relationship'
  | 'follow_up_date'
  | 'description'
  | 'linkedin_url'
  | 'website_url';

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

// List all tracked contacts (ordered by name).
export async function listContacts(): Promise<ContactListResponse> {
  const res = await apiFetch('/contacts', { credentials: 'include' });
  return asJson<ContactListResponse>(res, 'Failed to load contacts');
}

// Create a contact (dedupes on name server-side).
export async function createContact(payload: ContactCreate): Promise<Contact> {
  const res = await apiPost('/contacts', payload);
  return asJson<Contact>(res, 'Failed to create contact');
}

// Fetch one contact.
export async function getContact(id: string): Promise<Contact> {
  const res = await apiFetch(`/contacts/${id}`, { credentials: 'include' });
  return asJson<Contact>(res, 'Failed to load contact');
}

// Update one contact (partial).
export async function updateContact(id: string, payload: ContactUpdate): Promise<Contact> {
  const res = await apiPatch(`/contacts/${id}`, payload);
  return asJson<Contact>(res, 'Failed to update contact');
}

// Delete one contact.
export async function deleteContact(id: string): Promise<void> {
  const res = await apiDelete(`/contacts/${id}`);
  await asJson<ContactActionResponse>(res, 'Failed to delete contact');
}

// Delete many contacts at once.
export async function bulkDeleteContacts(contactIds: string[]): Promise<ContactActionResponse> {
  const res = await apiPost('/contacts/bulk-delete', { contact_ids: contactIds });
  return asJson<ContactActionResponse>(res, 'Failed to delete contacts');
}

// Detect the column headers of a CSV/Excel file (no import happens).
export async function getImportHeaders(file: File): Promise<ContactImportHeaders> {
  const formData = new FormData();
  formData.append('file', file);
  const res = await apiFetch('/contacts/import/headers', {
    method: 'POST',
    credentials: 'include',
    body: formData,
  });
  return asJson<ContactImportHeaders>(res, 'Failed to read file headers');
}

// Import contacts from a CSV or Excel (.xlsx) file upload.
// `mapping` pins {field: exact column header}; without it the server
// auto-detects columns via aliases.
export async function importContacts(
  file: File,
  mapping?: Partial<Record<ContactField, string>>
): Promise<ContactImportResponse> {
  const formData = new FormData();
  formData.append('file', file);
  if (mapping) {
    formData.append('mapping', JSON.stringify(mapping));
  }
  const res = await apiFetch('/contacts/import', {
    method: 'POST',
    credentials: 'include',
    body: formData,
  });
  return asJson<ContactImportResponse>(res, 'Failed to import contacts');
}
