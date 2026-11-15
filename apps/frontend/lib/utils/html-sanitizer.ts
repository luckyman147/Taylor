import DOMPurify from 'isomorphic-dompurify';

/**
 * Whitelist of allowed HTML tags for rich text content
 */
const ALLOWED_TAGS = ['strong', 'em', 'u', 'a'];

/**
 * Whitelist of allowed HTML attributes
 */
const ALLOWED_ATTR = ['href', 'target', 'rel'];

/**
 * Sanitizes HTML content using DOMPurify with a strict whitelist.
 * Only allows bold, italic, underline, and link formatting.
 * Uses isomorphic-dompurify which works in both browser and Node.js.
 *
 * @param dirty - The unsanitized HTML string
 * @returns Sanitized HTML string safe for rendering
 */
export function sanitizeHtml(dirty: string): string {
  return DOMPurify.sanitize(dirty, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    FORCE_BODY: true,
  });
}

/** Tags allowed in the email signature preview (mirrors backend allowlist). */
const SIGNATURE_TAGS = [
  'a',
  'b',
  'blockquote',
  'br',
  'div',
  'em',
  'font',
  'h1',
  'h2',
  'h3',
  'h4',
  'hr',
  'i',
  'img',
  'li',
  'p',
  'span',
  'strong',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
  'u',
  'ul',
  'ol',
];

const SIGNATURE_ATTR = [
  'align',
  'alt',
  'border',
  'cellpadding',
  'cellspacing',
  'class',
  'color',
  'colspan',
  'face',
  'height',
  'href',
  'rel',
  'rowspan',
  'size',
  'src',
  'style',
  'target',
  'title',
  'valign',
  'width',
];

/**
 * Sanitizes the user-configured HTML email signature for live preview.
 * Broader than {@link sanitizeHtml} (tables/inline styles/images) but still
 * strips scripts, event handlers, and javascript: URLs.
 */
export function sanitizeSignatureHtml(dirty: string): string {
  return DOMPurify.sanitize(dirty, {
    ALLOWED_TAGS: SIGNATURE_TAGS,
    ALLOWED_ATTR: SIGNATURE_ATTR,
    ALLOW_DATA_ATTR: false,
    FORCE_BODY: true,
  });
}
