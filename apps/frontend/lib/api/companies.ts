import { apiFetch, apiPost, apiPatch, apiDelete } from './client';

// Stable enum keys (decoupled from i18n labels).
export type CompanySize = '1-10' | '11-50' | '51-200' | '201-1000' | '1000+';

export type CompanyType =
  'startup' | 'agency' | 'enterprise' | 'nonprofit' | 'education' | 'government' | 'other';

export type CompanyStatus =
  'watching' | 'contacted' | 'applied' | 'interviewing' | 'negotiating' | 'won' | 'lost';

export interface Company {
  company_id: string;
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  website: string | null;
  company_size: CompanySize | null;
  company_type: CompanyType | null;
  status: CompanyStatus | null;
  linkedin_url: string | null;
  industry: string | null;
  year_founded: number | null;
  created_at: string;
  updated_at: string;
}

export interface CompanyListResponse {
  companies: Company[];
}

export interface CompanyCreate {
  name: string;
  email?: string;
  phone?: string;
  address?: string;
  website?: string;
  company_size?: CompanySize;
  company_type?: CompanyType;
  status?: CompanyStatus;
  linkedin_url?: string;
  industry?: string;
  year_founded?: number;
}

export interface CompanyUpdate {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  website?: string | null;
  company_size?: CompanySize | null;
  company_type?: CompanyType | null;
  status?: CompanyStatus | null;
  linkedin_url?: string | null;
  industry?: string | null;
  year_founded?: number | null;
}

export interface CompanyActionResponse {
  message: string;
  affected: number;
}

export interface CompanyImportError {
  row: number;
  name: string | null;
  error: string;
}

export interface CompanyImportResponse {
  created: number;
  skipped: number;
  errors: CompanyImportError[];
}

/** The columns found in an import file, plus fields already matched by alias. */
export interface CompanyImportHeaders {
  headers: string[];
  detected: Partial<Record<CompanyField, string>>;
}

/** Company fields that can be mapped to an import column. */
export type CompanyField =
  | 'name'
  | 'email'
  | 'phone'
  | 'address'
  | 'website'
  | 'company_size'
  | 'company_type'
  | 'status'
  | 'linkedin_url'
  | 'industry'
  | 'year_founded';

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

// List all tracked companies (ordered by name).
export async function listCompanies(): Promise<CompanyListResponse> {
  const res = await apiFetch('/companies', { credentials: 'include' });
  return asJson<CompanyListResponse>(res, 'Failed to load companies');
}

// Create a company (dedupes on name server-side).
export async function createCompany(payload: CompanyCreate): Promise<Company> {
  const res = await apiPost('/companies', payload);
  return asJson<Company>(res, 'Failed to create company');
}

// Fetch one company.
export async function getCompany(id: string): Promise<Company> {
  const res = await apiFetch(`/companies/${id}`, { credentials: 'include' });
  return asJson<Company>(res, 'Failed to load company');
}

// Update one company (partial).
export async function updateCompany(id: string, payload: CompanyUpdate): Promise<Company> {
  const res = await apiPatch(`/companies/${id}`, payload);
  return asJson<Company>(res, 'Failed to update company');
}

// Delete one company.
export async function deleteCompany(id: string): Promise<void> {
  const res = await apiDelete(`/companies/${id}`);
  await asJson<CompanyActionResponse>(res, 'Failed to delete company');
}

// Delete many companies at once.
export async function bulkDeleteCompanies(companyIds: string[]): Promise<CompanyActionResponse> {
  const res = await apiPost('/companies/bulk-delete', { company_ids: companyIds });
  return asJson<CompanyActionResponse>(res, 'Failed to delete companies');
}

// Detect the column headers of a CSV/Excel file (no import happens).
export async function getImportHeaders(file: File): Promise<CompanyImportHeaders> {
  const formData = new FormData();
  formData.append('file', file);
  const res = await apiFetch('/companies/import/headers', {
    method: 'POST',
    credentials: 'include',
    body: formData,
  });
  return asJson<CompanyImportHeaders>(res, 'Failed to read file headers');
}

// Import companies from a CSV or Excel (.xlsx) file upload.
// `mapping` pins {field: exact column header}; without it the server
// auto-detects columns via aliases.
export async function importCompanies(
  file: File,
  mapping?: Partial<Record<CompanyField, string>>
): Promise<CompanyImportResponse> {
  const formData = new FormData();
  formData.append('file', file);
  if (mapping) {
    formData.append('mapping', JSON.stringify(mapping));
  }
  const res = await apiFetch('/companies/import', {
    method: 'POST',
    credentials: 'include',
    body: formData,
  });
  return asJson<CompanyImportResponse>(res, 'Failed to import companies');
}
