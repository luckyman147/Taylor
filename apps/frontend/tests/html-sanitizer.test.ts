import { describe, expect, it } from 'vitest';
import { sanitizeHtml, sanitizeSignatureHtml } from '@/lib/utils/html-sanitizer';

/**
 * sanitizeHtml guards every `dangerouslySetInnerHTML` sink (rich-text bullets,
 * LLM output). Whitelist: strong/em/u/a + href/target/rel. Anything else must go.
 */

describe('sanitizeHtml', () => {
  it('keeps whitelisted formatting tags', () => {
    const out = sanitizeHtml('<strong>bold</strong> <em>italic</em> <u>under</u>');
    expect(out).toContain('<strong>bold</strong>');
    expect(out).toContain('<em>italic</em>');
    expect(out).toContain('<u>under</u>');
  });

  it('keeps anchor href', () => {
    const out = sanitizeHtml('<a href="https://example.com">link</a>');
    expect(out).toContain('href="https://example.com"');
    expect(out).toContain('link');
  });

  it('strips <script> entirely (tag + content)', () => {
    const out = sanitizeHtml('<script>alert(1)</script>safe');
    expect(out).not.toContain('script');
    expect(out).not.toContain('alert');
    expect(out).toContain('safe');
  });

  it('strips event-handler attributes but keeps the element text', () => {
    const out = sanitizeHtml('<a href="https://x.com" onclick="evil()">click</a>');
    expect(out).not.toContain('onclick');
    expect(out).toContain('click');
  });

  it('removes a non-whitelisted tag while keeping its text', () => {
    const out = sanitizeHtml('<div>plain text</div>');
    expect(out).not.toContain('<div>');
    expect(out).toContain('plain text');
  });

  it('drops dangerous tags like <img onerror>', () => {
    const out = sanitizeHtml('<img src=x onerror="alert(1)">');
    expect(out).not.toContain('img');
    expect(out).not.toContain('onerror');
  });
});

describe('sanitizeSignatureHtml', () => {
  it('keeps email-signature structure (tables, styles, links)', () => {
    const out = sanitizeSignatureHtml(
      '<table style="border:0"><tr><td style="color:#111"><strong>Name</strong><br><a href="https://x.com">Site</a></td></tr></table>'
    );
    expect(out).toContain('<strong>Name</strong>');
    expect(out).toContain('href="https://x.com"');
    expect(out).toContain('<table');
    expect(out).toContain('style=');
  });

  it('strips <script> blocks with content', () => {
    const out = sanitizeSignatureHtml('<p>Hi</p><script>alert(1)</script>');
    expect(out).not.toContain('script');
    expect(out).not.toContain('alert');
    expect(out).toContain('Hi');
  });

  it('drops event handlers and javascript: URLs', () => {
    const out = sanitizeSignatureHtml(
      '<a href="javascript:alert(1)" onclick="evil()">x</a>'
    );
    expect(out).not.toContain('javascript:');
    expect(out).not.toContain('onclick');
    expect(out).toContain('x');
  });
});
