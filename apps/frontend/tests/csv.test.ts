import { describe, expect, it, vi } from 'vitest';
import { downloadCsv, toCsv } from '@/lib/utils/csv';

describe('toCsv', () => {
  it('writes headers and rows with CRLF and a UTF-8 BOM', () => {
    const csv = toCsv(
      ['name', 'size'],
      [
        ['Acme Corp', '51-200'],
        ['Beta', null],
      ]
    );
    expect(csv).toBe('\uFEFFname,size\r\nAcme Corp,51-200\r\nBeta,\r\n');
  });

  it('quotes fields containing commas, quotes, or newlines', () => {
    const csv = toCsv(
      ['name', 'email'],
      [
        ['Acme, Inc', 'a@b.c'],
        ['Multi\nline', 'say "hi"'],
      ]
    );
    expect(csv).toContain('"Acme, Inc",a@b.c');
    // Quotes inside a quoted field are doubled per RFC 4180.
    expect(csv).toContain('"Multi\nline","say ""hi"""');
  });

  it('converts numbers and nulls to empty strings', () => {
    const csv = toCsv(
      ['name', 'founded'],
      [
        ['Acme', 1999],
        ['Beta', undefined],
      ]
    );
    expect(csv).toBe('\uFEFFname,founded\r\nAcme,1999\r\nBeta,\r\n');
  });
});

describe('downloadCsv', () => {
  it('creates a blob download with the given filename', () => {
    const createObjectURL = vi.fn(() => 'blob:mock');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    downloadCsv('companies.csv', ['name'], [['Acme']]);

    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock');

    click.mockRestore();
    vi.unstubAllGlobals();
  });
});
