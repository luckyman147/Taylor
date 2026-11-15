/**
 * Structured email-signature maker helpers: form fields ↔ allowlisted HTML.
 * Output must stay within the backend sanitizer allowlist (html_signature.py).
 */

export type SignatureLayout = 'stacked' | 'inline' | 'table';
export type SignaturePhotoPosition = 'top' | 'left' | 'right';
export type SignatureTextAlign = 'left' | 'center' | 'right';
export type SignatureSpacing = 'compact' | 'normal' | 'relaxed';

export interface SignatureFields {
  name: string;
  title: string;
  company: string;
  phone: string;
  email: string;
  website: string;
  linkedin: string;
  tagline: string;
  /** Show the career-profile avatar as the signature photo (not a free URL). */
  usePhoto: boolean;
  /** Resolved absolute photo URL (from profile.avatar) — internal, not a form field. */
  photoSrc: string;
  accentColor: string;
  layout: SignatureLayout;
  nameBold: boolean;
  nameItalic: boolean;
  nameUnderline: boolean;
  showDivider: boolean;
  /** Where the photo sits relative to the text block. */
  photoPosition: SignaturePhotoPosition;
  /** Horizontal alignment of the signature text block. */
  textAlign: SignatureTextAlign;
  /** Name font size in px. */
  nameSize: number;
  /** Photo edge size in px. */
  photoSize: number;
  /** Vertical rhythm between signature rows. */
  spacing: SignatureSpacing;
  /** Outer padding around the whole signature block (px). */
  padding: number;
}

export const EMPTY_SIGNATURE_FIELDS: SignatureFields = {
  name: '',
  title: '',
  company: '',
  phone: '',
  email: '',
  website: '',
  linkedin: '',
  tagline: '',
  usePhoto: false,
  photoSrc: '',
  accentColor: '#1d4ed8',
  layout: 'stacked',
  nameBold: true,
  nameItalic: false,
  nameUnderline: false,
  showDivider: false,
  photoPosition: 'top',
  textAlign: 'left',
  nameSize: 16,
  photoSize: 48,
  spacing: 'normal',
  padding: 0,
};

/** Minimal career-profile slice needed to pre-fill the signature maker. */
export interface SignatureProfileSource {
  name?: string | null;
  title?: string | null;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  linkedin?: string | null;
  github?: string | null;
  avatar?: string | null;
  work_experience?: ReadonlyArray<{ company?: string | null }>;
}

/**
 * Resolve a profile avatar path into an absolute URL safe to embed in email HTML.
 * Relative API paths (e.g. `/api/v1/avatar/x.png`) are prefixed with the current origin.
 */
export function resolveAvatarSrc(avatar: string | null | undefined): string {
  const raw = (avatar ?? '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith('/')) {
    if (typeof window !== 'undefined' && window.location?.origin) {
      return `${window.location.origin}${raw}`;
    }
    return '';
  }
  return '';
}

/**
 * Map career-profile fields into signature form fields (identity only).
 * Layout / accent color are design choices — left as defaults.
 * The photo always comes from `profile.avatar` (never a free-form URL field).
 */
export function profileToSignatureFields(
  profile: SignatureProfileSource | null | undefined
): Partial<SignatureFields> {
  if (!profile) return {};
  const out: Partial<SignatureFields> = {};
  const name = (profile.name ?? '').trim();
  const title = (profile.title ?? '').trim();
  const email = (profile.email ?? '').trim();
  const phone = (profile.phone ?? '').trim();
  const website = (profile.website ?? profile.github ?? '').trim();
  const linkedin = (profile.linkedin ?? '').trim();
  const company =
    (profile.work_experience ?? []).map((e) => (e?.company ?? '').trim()).find(Boolean) ?? '';
  const photoSrc = resolveAvatarSrc(profile.avatar);

  if (name) out.name = name;
  if (title) out.title = title;
  if (email) out.email = email;
  if (phone) out.phone = phone;
  if (website) out.website = website;
  if (linkedin) out.linkedin = linkedin;
  if (company) out.company = company;
  if (photoSrc) {
    out.photoSrc = photoSrc;
    out.usePhoto = true;
  }
  return out;
}

/** True when no meaningful identity data is present (safe to auto-seed). */
export function isEmptySignatureFields(fields: SignatureFields): boolean {
  return (
    !fields.name.trim() &&
    !fields.email.trim() &&
    !fields.phone.trim() &&
    !fields.title.trim() &&
    !fields.company.trim() &&
    !fields.website.trim() &&
    !fields.linkedin.trim() &&
    !fields.tagline.trim()
  );
}

const HEX_COLOR_RE = /^#[0-9a-fA-F]{3,8}$/;
const SAFE_URL_RE = /^(https?:\/\/|mailto:|tel:|#|\/)/i;
const MAX_SIG_CHARS = 20_000;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeHref(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (!SAFE_URL_RE.test(trimmed)) return null;
  if (/javascript:/i.test(trimmed)) return null;
  return trimmed;
}

function normalizeWebsite(url: string): string {
  const href = safeHref(url);
  if (!href) return '';
  const display = href.replace(/^https?:\/\//i, '').replace(/\/$/, '');
  return `<a href="${escapeHtml(href)}">${escapeHtml(display)}</a>`;
}

function normalizeLinkedIn(url: string): string {
  const href = safeHref(url);
  if (!href) return '';
  const display = 'LinkedIn';
  return `<a href="${escapeHtml(href)}">${display}</a>`;
}

function normalizePhone(phone: string): string {
  const trimmed = phone.trim();
  if (!trimmed) return '';
  const digits = trimmed.replace(/[^\d+()\-\s.]/g, '');
  if (!digits.trim()) return '';
  return `<a href="tel:${escapeHtml(digits.replace(/\s+/g, ''))}">${escapeHtml(trimmed)}</a>`;
}

function normalizeEmail(email: string): string {
  const trimmed = email.trim();
  if (!trimmed) return '';
  if (/[<>"']/g.test(trimmed)) return '';
  return `<a href="mailto:${escapeHtml(trimmed)}">${escapeHtml(trimmed)}</a>`;
}

const SPACING_PX: Record<SignatureSpacing, { row: number; block: number }> = {
  compact: { row: 2, block: 4 },
  normal: { row: 4, block: 8 },
  relaxed: { row: 8, block: 12 },
};

function clampPx(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function nameHtml(fields: SignatureFields): string {
  const accent = HEX_COLOR_RE.test(fields.accentColor.trim())
    ? fields.accentColor.trim()
    : EMPTY_SIGNATURE_FIELDS.accentColor;
  const name = escapeHtml(fields.name.trim());
  if (!name) return '';
  const size = clampPx(fields.nameSize, 12, 28, 16);
  const styles = [
    `color:${accent}`,
    `font-size:${size}px`,
    fields.nameBold ? 'font-weight:700' : 'font-weight:400',
    fields.nameItalic ? 'font-style:italic' : '',
    fields.nameUnderline ? 'text-decoration:underline' : '',
  ]
    .filter(Boolean)
    .join(';');
  return `<span style="${styles}">${name}</span>`;
}

function metaLine(fields: SignatureFields): string {
  const parts = [fields.title, fields.company]
    .map((p) => p.trim())
    .filter(Boolean)
    .map(escapeHtml);
  return parts.join(' · ');
}

function taglineHtml(fields: SignatureFields): string {
  const text = fields.tagline.trim();
  if (!text) return '';
  return `<span style="color:#555;font-size:13px;font-style:italic">${escapeHtml(text)}</span>`;
}

function contactParts(fields: SignatureFields): string[] {
  return [
    normalizePhone(fields.phone),
    normalizeEmail(fields.email),
    normalizeWebsite(fields.website),
    normalizeLinkedIn(fields.linkedin),
  ].filter(Boolean);
}

function photoHtml(fields: SignatureFields): string {
  if (!fields.usePhoto) return '';
  const src = safeHref(fields.photoSrc);
  if (!src) return '';
  const alt = escapeHtml(fields.name.trim() || 'Photo');
  const size = clampPx(fields.photoSize, 32, 96, 48);
  return (
    `<img src="${escapeHtml(src)}" alt="${alt}" width="${size}" height="${size}" ` +
    `style="border-radius:50%;object-fit:cover" />`
  );
}

const DIVIDER_HTML =
  '<hr style="border:none;border-top:1px solid #e6e3dc;margin:6px 0" />';

function alignValue(align: SignatureTextAlign): string {
  return align === 'center' ? 'center' : align === 'right' ? 'right' : 'left';
}

function rowMargin(fields: SignatureFields): string {
  const { row } = SPACING_PX[fields.spacing] ?? SPACING_PX.normal;
  return `0 0 ${row}px`;
}

function wrapBlock(fields: SignatureFields, inner: string): string {
  const pad = clampPx(fields.padding, 0, 32, 0);
  const align = alignValue(fields.textAlign);
  const padStyle = pad ? `padding:${pad}px;` : '';
  return `<div style="${padStyle}text-align:${align}">${inner}</div>`;
}

function photoSideIsLeft(fields: SignatureFields): boolean {
  // 'top' on a two-column layout still needs a side cell — prefer left.
  return fields.photoPosition !== 'right';
}

/**
 * Generate signature HTML from structured form fields.
 * Returns empty string when there is nothing to show.
 */
export function generateSignatureHtml(fields: SignatureFields): string {
  const name = nameHtml(fields);
  const meta = metaLine(fields);
  const tagline = taglineHtml(fields);
  const contacts = contactParts(fields);
  const photo = photoHtml(fields);
  const divider = fields.showDivider ? DIVIDER_HTML : '';
  const align = alignValue(fields.textAlign);
  const { row, block } = SPACING_PX[fields.spacing] ?? SPACING_PX.normal;

  if (!name && !meta && !tagline && contacts.length === 0 && !photo) return '';

  // Two-column / photo-side layouts use a table for email-client safety.
  const useSidePhoto =
    photo &&
    (fields.layout === 'table' ||
      (fields.layout === 'stacked' && fields.photoPosition !== 'top'));

  if (useSidePhoto) {
    const left = photoSideIsLeft(fields);
    const text: string[] = [];
    if (name) text.push(`<p style="margin:0 0 ${row}px;text-align:${align}">${name}</p>`);
    if (meta) {
      text.push(
        `<p style="margin:0 0 ${row}px;text-align:${align};color:#555;font-size:13px">${meta}</p>`
      );
    }
    if (tagline) text.push(`<p style="margin:0 0 ${row}px;text-align:${align}">${tagline}</p>`);
    if (divider) text.push(`<p style="margin:0 0 ${row}px;text-align:${align}">${divider}</p>`);
    if (contacts.length > 0) {
      text.push(
        `<p style="margin:0;text-align:${align};color:#333;font-size:13px;line-height:1.5">${contacts.join('<br>')}</p>`
      );
    }
    const textCell = text.join('') || '<p style="margin:0"></p>';
    const photoCell = photo;
    const gap = block;
    const cells = left
      ? `<td style="vertical-align:top;padding-right:${gap}px;border-right:2px solid #e6e3dc">${photoCell}</td>` +
        `<td style="vertical-align:top;padding-left:${gap}px">${textCell}</td>`
      : `<td style="vertical-align:top;padding-right:${gap}px">${textCell}</td>` +
        `<td style="vertical-align:top;padding-left:${gap}px;border-left:2px solid #e6e3dc">${photoCell}</td>`;
    const table =
      `<table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse">` +
      `<tr>${cells}</tr></table>`;
    return wrapBlock(fields, table);
  }

  if (fields.layout === 'inline') {
    const cells: string[] = [];
    const identity: string[] = [];
    if (name) identity.push(name);
    if (meta) identity.push(`<span style="color:#555;font-size:13px">${meta}</span>`);
    if (tagline) identity.push(tagline);
    const identityHtml =
      identity.length > 0
        ? `<span style="display:inline-block;vertical-align:middle;text-align:${align}">${identity.join('<br>')}</span>`
        : '';
    const contactHtml =
      contacts.length > 0
        ? `<span style="display:inline-block;vertical-align:middle;color:#333;font-size:13px;line-height:1.5;text-align:${align}">${
            divider ? `${divider}<br>` : ''
          }${contacts.join(' · ')}</span>`
        : '';
    if (photo && fields.photoPosition === 'right') {
      if (identityHtml) cells.push(identityHtml);
      if (contactHtml) cells.push(contactHtml);
      cells.push(photo);
    } else {
      if (photo) cells.push(photo);
      if (identityHtml) cells.push(identityHtml);
      if (contactHtml) cells.push(contactHtml);
    }
    return wrapBlock(
      fields,
      cells
        .map(
          (c) =>
            `<span style="display:inline-block;vertical-align:middle;margin-right:${block}px">${c}</span>`
        )
        .join('')
    );
  }

  // stacked (default) — photo top or pure text column
  const lines: string[] = [];
  if (photo && fields.photoPosition === 'top') {
    lines.push(
      `<p style="margin:0 0 ${block}px;text-align:${align}">${photo}</p>`
    );
  }
  if (name) lines.push(`<p style="margin:0 0 ${row}px;text-align:${align}">${name}</p>`);
  if (meta) {
    lines.push(
      `<p style="margin:0 0 ${row}px;text-align:${align};color:#555;font-size:13px">${meta}</p>`
    );
  }
  if (tagline) lines.push(`<p style="margin:0 0 ${row}px;text-align:${align}">${tagline}</p>`);
  if (divider) lines.push(`<p style="margin:0 0 ${row}px;text-align:${align}">${divider}</p>`);
  if (contacts.length > 0) {
    lines.push(
      `<p style="margin:0;text-align:${align};color:#333;font-size:13px;line-height:1.5">${contacts.join('<br>')}</p>`
    );
  }
  return wrapBlock(fields, lines.join(''));
}

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function firstMatch(html: string, re: RegExp): string {
  const m = html.match(re);
  return m ? m[1].trim() : '';
}

/**
 * Best-effort parse of signature HTML back into maker fields.
 * Returns null when the HTML does not look like maker output (caller keeps HTML intact).
 */
export function parseSignatureToFields(html: string): SignatureFields | null {
  const trimmed = html.trim();
  if (!trimmed) return { ...EMPTY_SIGNATURE_FIELDS };

  // Only parse HTML we (or a similar simple template) produced — detect signature-ish structure.
  const hasStructure =
    /<(p|table|div|span|strong|font|img|hr)\b/i.test(trimmed) &&
    !/<script|<iframe|<object|<embed/i.test(trimmed);
  if (!hasStructure) return null;

  const fields: SignatureFields = { ...EMPTY_SIGNATURE_FIELDS };

  // Name: prefer styled span, else first strong/first non-link text chunk.
  const spanStyleName = firstMatch(
    trimmed,
    /<span[^>]*style="[^"]*font-(?:weight|style)[^"]*"[^>]*>([^<]+)<\/span>/i
  );
  const strongName = firstMatch(trimmed, /<strong[^>]*>([^<]+)<\/strong>/i);
  const firstPText = firstMatch(trimmed, /<p[^>]*>\s*([^<][^<]*)/i);
  fields.name = spanStyleName || strongName || firstPText || '';

  // Name styles + accent from the name span style attribute.
  const nameSpan = trimmed.match(/<span[^>]*style="([^"]*)"[^>]*>[^<]*<\/span>/i);
  if (nameSpan) {
    const style = nameSpan[1];
    const accent = firstMatch(style, /color:\s*(#[0-9a-fA-F]{3,8})/i);
    if (HEX_COLOR_RE.test(accent)) fields.accentColor = accent;
    if (/font-weight:\s*700/i.test(style)) fields.nameBold = true;
    else if (/font-weight:\s*400/i.test(style)) fields.nameBold = false;
    if (/font-style:\s*italic/i.test(style)) fields.nameItalic = true;
    if (/text-decoration:\s*underline/i.test(style)) fields.nameUnderline = true;
    const sizeMatch = firstMatch(style, /font-size:\s*(\d+)px/i);
    if (sizeMatch) {
      const n = Number(sizeMatch);
      if (n >= 12 && n <= 28) fields.nameSize = n;
    }
  } else {
    const accent = firstMatch(trimmed, /color:(#[0-9a-fA-F]{3,8})/i);
    if (HEX_COLOR_RE.test(accent)) fields.accentColor = accent;
  }

  // Text alignment from wrapper or first aligned paragraph.
  if (/text-align:\s*center/i.test(trimmed)) fields.textAlign = 'center';
  else if (/text-align:\s*right/i.test(trimmed)) fields.textAlign = 'right';

  // Outer padding from wrapper div.
  const padMatch = firstMatch(trimmed, /<div[^>]*style="[^"]*padding:\s*(\d+)px[^"]*"/i);
  if (padMatch) {
    const n = Number(padMatch);
    if (n >= 0 && n <= 32) fields.padding = n;
  }

  // Spacing heuristic from first row margin-bottom.
  const rowMatch = firstMatch(trimmed, /margin:\s*0 0 (\d+)px/i);
  if (rowMatch) {
    const n = Number(rowMatch);
    if (n <= 3) fields.spacing = 'compact';
    else if (n >= 7) fields.spacing = 'relaxed';
    else fields.spacing = 'normal';
  }

  // Title / company from meta line (title · company)
  const metaMatch = trimmed.match(
    /<p[^>]*style="[^"]*color:\s*#555[^"]*font-size:13px[^"]*"[^>]*>([^<]+)<\/p>/i
  ) || trimmed.match(/<span[^>]*style="[^"]*color:\s*#555[^"]*font-size:13px[^"]*"[^>]*>([^<]+)<\/span>/i);
  if (metaMatch) {
    const meta = stripTags(metaMatch[1]);
    const pieces = meta.split('·').map((s) => s.trim()).filter(Boolean);
    if (pieces.length >= 2) {
      fields.title = pieces[0];
      fields.company = pieces.slice(1).join(' · ');
    } else if (pieces.length === 1) {
      fields.title = pieces[0];
    }
  }

  // Tagline: italic muted span that is not the name/meta.
  const taglineMatch = trimmed.match(
    /<span[^>]*style="[^"]*font-style:\s*italic[^"]*"[^>]*>([^<]+)<\/span>/i
  );
  if (taglineMatch) {
    const text = stripTags(taglineMatch[1]);
    if (text && text !== fields.name) fields.tagline = text;
  }

  // Links
  const anchors = [...trimmed.matchAll(/<a\b[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi)];
  for (const [, href, inner] of anchors) {
    const text = stripTags(inner);
    const h = href || '';
    if (/^mailto:/i.test(h)) {
      fields.email = h.replace(/^mailto:/i, '');
    } else if (/^tel:/i.test(h)) {
      fields.phone = text || h.replace(/^tel:/i, '');
    } else if (/linkedin\.com/i.test(h) || /^linkedin$/i.test(text)) {
      fields.linkedin = h;
    } else if (SAFE_URL_RE.test(h) && h.startsWith('http')) {
      if (!fields.website) fields.website = h;
      else if (!fields.linkedin) fields.linkedin = h;
    }
  }

  // Photo (from profile avatar — never a free URL field).
  const img = trimmed.match(/<img\b[^>]*src="([^"]*)"[^>]*>/i);
  if (img && safeHref(img[1])) {
    fields.photoSrc = img[1];
    fields.usePhoto = true;
    const w = firstMatch(img[0], /width="(\d+)"/i);
    if (w) {
      const n = Number(w);
      if (n >= 32 && n <= 96) fields.photoSize = n;
    }
    const tds = [...trimmed.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => m[1]);
    if (tds.length >= 2) {
      fields.photoPosition = /<img\b/i.test(tds[0]) ? 'left' : 'right';
      fields.layout = 'table';
    } else {
      const imgIdx = trimmed.indexOf('<img');
      const nameIdx = fields.name ? trimmed.indexOf(fields.name) : -1;
      fields.photoPosition = nameIdx >= 0 && imgIdx > nameIdx ? 'right' : 'top';
    }
  }

  // Divider
  if (/<hr\b/i.test(trimmed)) fields.showDivider = true;

  // Layout heuristic (table cells set layout above when photo is present).
  if (/<table\b/i.test(trimmed)) fields.layout = 'table';
  else if (/display:\s*inline-block/i.test(trimmed)) fields.layout = 'inline';
  else fields.layout = 'stacked';

  return fields;
}
export function isSignatureTooLong(html: string): boolean {
  return html.length > MAX_SIG_CHARS;
}

export { MAX_SIG_CHARS };
