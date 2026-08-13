import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createCompany,
  deleteCompany,
  getCompany,
  getImportHeaders,
  importCompanies,
  listCompanies,
  updateCompany,
} from '@/lib/api/companies';

/**
 * Company API client contracts: the wrappers must hit the right method/URL,
 * send the right payloads, and surface backend detail messages.
 */

describe('companies API client', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const lastCall = () => {
    const [url, options] = fetchMock.mock.calls.at(-1)!;
    return { url: String(url), options: options as RequestInit };
  };

  it('listCompanies GETs /companies', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ companies: [] }), { status: 200 }));
    const res = await listCompanies();
    const { url } = lastCall();
    expect(url).toContain('/companies');
    expect(res.companies).toEqual([]);
  });

  it('createCompany POSTs the payload to /companies', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ company_id: 'x' }), { status: 201 }));
    await createCompany({
      name: 'Acme Corp',
      company_size: '51-200',
      company_type: 'enterprise',
      year_founded: 1999,
    });
    const { url, options } = lastCall();
    expect(url).toContain('/companies');
    expect(options.method).toBe('POST');
    expect(JSON.parse(String(options.body))).toEqual({
      name: 'Acme Corp',
      company_size: '51-200',
      company_type: 'enterprise',
      year_founded: 1999,
    });
  });

  it('getCompany GETs /companies/{id}', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ company_id: 'x', name: 'Acme' }), { status: 200 })
    );
    const company = await getCompany('x');
    const { url } = lastCall();
    expect(url).toContain('/companies/x');
    expect(company.name).toBe('Acme');
  });

  it('updateCompany PATCHes /companies/{id} with the partial', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ company_id: 'x' }), { status: 200 }));
    await updateCompany('x', { industry: 'SaaS', company_size: '1000+' });
    const { url, options } = lastCall();
    expect(url).toContain('/companies/x');
    expect(options.method).toBe('PATCH');
    expect(JSON.parse(String(options.body))).toEqual({ industry: 'SaaS', company_size: '1000+' });
  });

  it('deleteCompany DELETEs /companies/{id}', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ message: 'ok', affected: 1 }), { status: 200 })
    );
    await deleteCompany('x');
    const { url, options } = lastCall();
    expect(url).toContain('/companies/x');
    expect(options.method).toBe('DELETE');
  });

  it('importCompanies POSTs a FormData file to /companies/import', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ created: 2, skipped: 1, errors: [] }), { status: 200 })
    );
    const file = new File(['name\nAcme\n'], 'companies.csv', { type: 'text/csv' });
    const result = await importCompanies(file);
    const { url, options } = lastCall();
    expect(url).toContain('/companies/import');
    expect(options.method).toBe('POST');
    expect(options.body).toBeInstanceOf(FormData);
    const formData = options.body as FormData;
    expect(formData.get('file')).toBe(file);
    expect(formData.get('mapping')).toBeNull();
    expect(result).toEqual({ created: 2, skipped: 1, errors: [] });
  });

  it('importCompanies sends the column mapping as JSON when provided', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ created: 1, skipped: 0, errors: [] }), { status: 200 })
    );
    const file = new File(['Company Name\nAcme\n'], 'companies.csv', { type: 'text/csv' });
    await importCompanies(file, {
      name: 'Company Name',
      phone: 'Phone Number',
    });
    const formData = lastCall().options.body as FormData;
    expect(formData.get('file')).toBe(file);
    expect(JSON.parse(String(formData.get('mapping')))).toEqual({
      name: 'Company Name',
      phone: 'Phone Number',
    });
  });

  it('getImportHeaders POSTs the file to /companies/import/headers', async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          headers: ['Company Name', 'Phone'],
          detected: { name: 'Company Name', phone: 'Phone' },
        }),
        { status: 200 }
      )
    );
    const file = new File(['Company Name,Phone\nAcme,123\n'], 'companies.csv', {
      type: 'text/csv',
    });
    const result = await getImportHeaders(file);
    const { url, options } = lastCall();
    expect(url).toContain('/companies/import/headers');
    expect(options.method).toBe('POST');
    const formData = options.body as FormData;
    expect(formData.get('file')).toBe(file);
    expect(result.headers).toEqual(['Company Name', 'Phone']);
    expect(result.detected.name).toBe('Company Name');
  });

  it('createCompany forwards phone and address when provided', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ company_id: 'x' }), { status: 201 }));
    await createCompany({
      name: 'Acme Corp',
      phone: '+216 71 234 567',
      address: '14 Rue de la Source, Tunis',
    });
    const { options } = lastCall();
    expect(JSON.parse(String(options.body))).toEqual({
      name: 'Acme Corp',
      phone: '+216 71 234 567',
      address: '14 Rue de la Source, Tunis',
    });
  });

  it('surfaces the backend detail message on failure', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ detail: 'A company with this name already exists.' }), {
        status: 409,
      })
    );
    await expect(createCompany({ name: 'Acme' })).rejects.toThrow(
      'A company with this name already exists.'
    );
  });
});
