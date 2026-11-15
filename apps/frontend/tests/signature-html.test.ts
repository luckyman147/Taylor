import { describe, expect, it } from 'vitest';
import {
  EMPTY_SIGNATURE_FIELDS,
  generateSignatureHtml,
  parseSignatureToFields,
  isSignatureTooLong,
  isEmptySignatureFields,
  profileToSignatureFields,
  resolveAvatarSrc,
  MAX_SIG_CHARS,
  type SignatureFields,
} from '@/lib/utils/signature-html';
import { sanitizeSignatureHtml } from '@/lib/utils/html-sanitizer';

const base: SignatureFields = {
  ...EMPTY_SIGNATURE_FIELDS,
  name: 'Jane Doe',
  title: 'Engineer',
  company: 'Acme',
  phone: '+1 555 0100',
  email: 'jane@acme.test',
  website: 'https://acme.test',
  linkedin: 'https://linkedin.com/in/jane',
  tagline: 'Open to work',
  usePhoto: true,
  photoSrc: 'https://acme.test/avatar.png',
  accentColor: '#1d4ed8',
  layout: 'stacked',
  nameBold: true,
  nameItalic: false,
  nameUnderline: false,
  showDivider: true,
};

describe('generateSignatureHtml', () => {
  it('returns empty string for empty fields', () => {
    expect(generateSignatureHtml({ ...EMPTY_SIGNATURE_FIELDS })).toBe('');
  });

  it('emits allowlisted stacked HTML with name, contacts and links', () => {
    const html = generateSignatureHtml(base);
    expect(html).toContain('Jane Doe');
    expect(html).toContain('mailto:jane@acme.test');
    expect(html).toContain('tel:');
    expect(html).toContain('href="https://acme.test"');
    expect(html).toContain('href="https://linkedin.com/in/jane"');
    expect(html).toContain('color:#1d4ed8');
    expect(html).toContain('<img');
    expect(html).toContain('Open to work');
    expect(html).toContain('<hr');
    expect(html).not.toMatch(/<script|onclick|javascript:/i);
  });

  it('escapes HTML special characters in user fields', () => {
    const html = generateSignatureHtml({
      ...EMPTY_SIGNATURE_FIELDS,
      name: '<script>alert(1)</script>',
      company: 'A & B <Co>',
      tagline: '<img onerror=x>',
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
    expect(html).toContain('A &amp; B &lt;Co&gt;');
    expect(html).toContain('&lt;img');
  });

  it('rejects javascript: URLs and unsafe photo srcs', () => {
    const html = generateSignatureHtml({
      ...EMPTY_SIGNATURE_FIELDS,
      name: 'X',
      website: 'javascript:alert(1)',
      usePhoto: true,
      photoSrc: 'javascript:alert(1)',
    });
    expect(html).not.toMatch(/javascript:/i);
  });

  it('omits photo when usePhoto is false even if photoSrc set', () => {
    const html = generateSignatureHtml({
      ...base,
      usePhoto: false,
    });
    expect(html).not.toContain('<img');
  });

  it('applies name bold/italic/underline styles', () => {
    const html = generateSignatureHtml({
      ...base,
      usePhoto: false,
      showDivider: false,
      tagline: '',
      nameBold: true,
      nameItalic: true,
      nameUnderline: true,
    });
    expect(html).toContain('font-weight:700');
    expect(html).toContain('font-style:italic');
    expect(html).toContain('text-decoration:underline');
  });

  it('layout table uses a table element', () => {
    const html = generateSignatureHtml({ ...base, layout: 'table' });
    expect(html).toContain('<table');
    expect(html).toContain('border-right');
  });

  it('layout inline uses inline-block spans', () => {
    const html = generateSignatureHtml({ ...base, layout: 'inline' });
    expect(html).toContain('display:inline-block');
    expect(html).not.toContain('<table');
  });

  it('output survives sanitizeSignatureHtml without losing content', () => {
    const html = generateSignatureHtml(base);
    const clean = sanitizeSignatureHtml(html);
    expect(clean).toContain('Jane Doe');
    expect(clean).toContain('mailto:jane@acme.test');
    expect(clean).toContain('Open to work');
  });

  it('applies name size, photo size, text align and outer padding', () => {
    const html = generateSignatureHtml({
      ...base,
      nameSize: 22,
      photoSize: 64,
      textAlign: 'center',
      padding: 12,
    });
    expect(html).toContain('font-size:22px');
    expect(html).toContain('width="64"');
    expect(html).toContain('text-align:center');
    expect(html).toContain('padding:12px');
  });

  it('photo side position uses a table on stacked layout', () => {
    const html = generateSignatureHtml({
      ...base,
      layout: 'stacked',
      photoPosition: 'left',
    });
    expect(html).toContain('<table');
    expect(html).toMatch(/<img[^>]*>[^<]*<\/td>/);
  });

  it('photo right places img after the text cell', () => {
    const html = generateSignatureHtml({
      ...base,
      layout: 'table',
      photoPosition: 'right',
    });
    expect(html).toContain('<table');
    expect(html).toContain('border-left');
    const textIdx = html.indexOf('Jane Doe');
    const imgIdx = html.indexOf('<img');
    expect(textIdx).toBeGreaterThan(-1);
    expect(imgIdx).toBeGreaterThan(textIdx);
  });

  it('spacing compact tightens row margins', () => {
    const compact = generateSignatureHtml({ ...base, spacing: 'compact' });
    const relaxed = generateSignatureHtml({ ...base, spacing: 'relaxed' });
    expect(compact).toContain('margin:0 0 2px');
    expect(relaxed).toContain('margin:0 0 8px');
  });
});

describe('parseSignatureToFields', () => {
  it('round-trips generated HTML back to fields', () => {
    const html = generateSignatureHtml(base);
    const parsed = parseSignatureToFields(html);
    expect(parsed).not.toBeNull();
    expect(parsed!.name).toBe('Jane Doe');
    expect(parsed!.title).toBe('Engineer');
    expect(parsed!.company).toBe('Acme');
    expect(parsed!.email).toBe('jane@acme.test');
    expect(parsed!.website).toBe('https://acme.test');
    expect(parsed!.linkedin).toBe('https://linkedin.com/in/jane');
    expect(parsed!.photoSrc).toBe('https://acme.test/avatar.png');
    expect(parsed!.usePhoto).toBe(true);
    expect(parsed!.accentColor.toLowerCase()).toBe('#1d4ed8');
    expect(parsed!.layout).toBe('stacked');
    expect(parsed!.showDivider).toBe(true);
    expect(parsed!.nameBold).toBe(true);
    expect(parsed!.tagline).toBe('Open to work');
    expect(parsed!.photoPosition).toBe('top');
    expect(parsed!.photoSize).toBe(48);
    expect(parsed!.nameSize).toBe(16);
  });

  it('round-trips size, align and padding controls', () => {
    const html = generateSignatureHtml({
      ...base,
      nameSize: 20,
      photoSize: 64,
      textAlign: 'center',
      padding: 8,
      spacing: 'relaxed',
    });
    const parsed = parseSignatureToFields(html)!;
    expect(parsed.nameSize).toBe(20);
    expect(parsed.photoSize).toBe(64);
    expect(parsed.textAlign).toBe('center');
    expect(parsed.padding).toBe(8);
    expect(parsed.spacing).toBe('relaxed');
  });

  it('detects table layout', () => {
    const html = generateSignatureHtml({ ...base, layout: 'table' });
    expect(parseSignatureToFields(html)!.layout).toBe('table');
  });

  it('returns empty fields for empty string', () => {
    expect(parseSignatureToFields('')).toEqual(EMPTY_SIGNATURE_FIELDS);
  });

  it('returns null for non-structural / dangerous HTML', () => {
    expect(parseSignatureToFields('plain text only')).toBeNull();
    expect(parseSignatureToFields('<script>alert(1)</script>')).toBeNull();
  });
});

describe('isSignatureTooLong', () => {
  it('flags over the backend max', () => {
    expect(isSignatureTooLong('x'.repeat(MAX_SIG_CHARS))).toBe(false);
    expect(isSignatureTooLong('x'.repeat(MAX_SIG_CHARS + 1))).toBe(true);
  });
});

describe('resolveAvatarSrc', () => {
  it('keeps absolute http(s) URLs', () => {
    expect(resolveAvatarSrc('https://cdn.example/a.png')).toBe('https://cdn.example/a.png');
  });

  it('prefixes relative paths with origin when available', () => {
    const out = resolveAvatarSrc('/api/v1/avatar/x.png');
    if (typeof window !== 'undefined') {
      expect(out).toBe(`${window.location.origin}/api/v1/avatar/x.png`);
    } else {
      expect(out).toBe('');
    }
  });

  it('returns empty for missing/invalid', () => {
    expect(resolveAvatarSrc(null)).toBe('');
    expect(resolveAvatarSrc('  ')).toBe('');
    expect(resolveAvatarSrc('data:text/html,x')).toBe('');
  });
});

describe('profileToSignatureFields', () => {
  it('maps career profile identity into signature fields with avatar photo', () => {
    const seed = profileToSignatureFields({
      name: 'Jane Doe',
      title: 'Engineer',
      email: 'jane@acme.test',
      phone: '+1 555',
      website: 'https://acme.test',
      linkedin: 'https://linkedin.com/in/jane',
      github: null,
      avatar: 'https://cdn.example/logo.png',
      work_experience: [{ company: 'Acme' }, { company: null }],
    });
    expect(seed).toEqual({
      name: 'Jane Doe',
      title: 'Engineer',
      email: 'jane@acme.test',
      phone: '+1 555',
      website: 'https://acme.test',
      linkedin: 'https://linkedin.com/in/jane',
      company: 'Acme',
      photoSrc: 'https://cdn.example/logo.png',
      usePhoto: true,
    });
  });

  it('maps relative avatar to absolute photo when window origin exists', () => {
    const seed = profileToSignatureFields({ name: 'A', avatar: '/api/v1/avatar/1.png' });
    expect(seed.name).toBe('A');
    expect(seed.usePhoto).toBe(true);
    expect(seed.photoSrc).toContain('/api/v1/avatar/1.png');
    expect(seed.photoSrc).not.toMatch(/^\/api/);
  });

  it('returns empty for null profile and no photo without avatar', () => {
    expect(profileToSignatureFields(null)).toEqual({});
    const seed = profileToSignatureFields({ name: 'A', avatar: null });
    expect(seed.usePhoto).toBeUndefined();
    expect(seed.photoSrc).toBeUndefined();
    expect(seed.name).toBe('A');
  });
});

describe('isEmptySignatureFields', () => {
  it('detects empty vs partially filled', () => {
    expect(isEmptySignatureFields({ ...EMPTY_SIGNATURE_FIELDS })).toBe(true);
    expect(isEmptySignatureFields({ ...EMPTY_SIGNATURE_FIELDS, name: 'X' })).toBe(false);
    expect(isEmptySignatureFields({ ...EMPTY_SIGNATURE_FIELDS, email: 'a@b.c' })).toBe(false);
    expect(isEmptySignatureFields({ ...EMPTY_SIGNATURE_FIELDS, tagline: 'Hi' })).toBe(false);
  });
});
