import { marked } from 'marked';
import DOMPurify from 'isomorphic-dompurify';

/**
 * Whitelist of allowed HTML tags for markdown-rendered content.
 * Covers the block + inline elements produced by marked's GFM output.
 */
const ALLOWED_TAGS = [
  'p',
  'br',
  'hr',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'ul',
  'ol',
  'li',
  'blockquote',
  'strong',
  'b',
  'em',
  'i',
  'u',
  'del',
  'code',
  'pre',
  'a',
  'span',
  'table',
  'thead',
  'tbody',
  'tr',
  'td',
  'th',
];

const ALLOWED_ATTR = ['href', 'target', 'rel'];

/**
 * Converts markdown (headings, bold/italic, lists, links, code) into
 * sanitized HTML. Isomorphic — safe on both the server and the client.
 */
export function renderMarkdownHtml(content: string): string {
  const normalized = content.replace(/^[ \t]+$/gm, '');
  const rawHtml = marked.parse(normalized, { async: false, breaks: true, gfm: true });
  return DOMPurify.sanitize(String(rawHtml), {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    FORCE_BODY: true,
  });
}

/**
 * Tailwind classes that style the markdown HTML output to match the Taylor
 * design system. Applied to the container that owns the rendered HTML.
 */
export const MARKDOWN_BODY_CLASSES = [
  'text-sm leading-relaxed text-ink-soft',
  '[&>p+*]:mt-3 [&>*+p]:mt-3 [&>p+p]:mt-3',
  '[&_h1]:mb-2 [&_h1]:mt-5 [&_h1]:text-xl [&_h1]:font-bold [&_h1]:tracking-tight [&_h1]:text-ink',
  '[&_h2]:mb-2 [&_h2]:mt-5 [&_h2]:text-lg [&_h2]:font-bold [&_h2]:tracking-tight [&_h2]:text-ink',
  '[&_h3]:mb-2 [&_h3]:mt-4 [&_h3]:text-base [&_h3]:font-bold [&_h3]:text-ink',
  '[&_h4]:mb-2 [&_h4]:mt-4 [&_h4]:text-sm [&_h4]:font-bold [&_h4]:uppercase [&_h4]:tracking-wide [&_h4]:text-ink',
  '[&_ul]:my-3 [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-5',
  '[&_ol]:my-3 [&_ol]:list-decimal [&_ol]:space-y-1.5 [&_ol]:pl-5',
  '[&_li]:pl-1',
  '[&_a]:font-medium [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2',
  '[&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:border-primary/40 [&_blockquote]:pl-4 [&_blockquote]:italic [&_blockquote]:text-ink',
  '[&_hr]:my-5 [&_hr]:border-[#e6e3dc]',
  '[&_code]:rounded-md [&_code]:bg-secondary [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-xs [&_code]:text-ink',
  '[&_pre]:my-3 [&_pre]:overflow-x-auto [&_pre]:rounded-xl [&_pre]:border [&_pre]:border-[#e6e3dc] [&_pre]:bg-secondary/60 [&_pre]:p-4 [&_pre]:text-xs [&_pre]:leading-relaxed [&_pre]:text-ink',
  '[&_pre>code]:bg-transparent [&_pre>code]:p-0 [&_pre>code]:text-xs',
  '[&_table]:my-3 [&_table]:w-full [&_table]:border-collapse [&_table]:text-sm',
  '[&_th]:border [&_th]:border-[#e6e3dc] [&_th]:bg-secondary/60 [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:font-bold [&_th]:text-ink',
  '[&_td]:border [&_td]:border-[#e6e3dc] [&_td]:px-3 [&_td]:py-2',
] as const;
