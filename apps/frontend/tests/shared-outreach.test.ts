import { describe, expect, it } from 'vitest';
import {
  applyGreeting,
  composeSharedInstruction,
  summarizeNames,
  GREETING_TOKEN,
} from '@/lib/email/shared-outreach';

/**
 * Shared bulk-email mode: one general email generated once and sent
 * individually to many recipients, with an optional per-recipient
 * greeting token swapped at send time.
 */

describe('summarizeNames', () => {
  it('joins up to five names with commas', () => {
    expect(summarizeNames(['Acme', 'Globex'])).toBe('Acme, Globex');
  });

  it('truncates lists longer than five', () => {
    expect(summarizeNames(['A', 'B', 'C', 'D', 'E', 'F', 'G'])).toBe('A, B, C, D, E and 2 more');
  });

  it('skips blank names', () => {
    expect(summarizeNames([' ', 'Acme', ''])).toBe('Acme');
  });

  it('returns empty string for no names', () => {
    expect(summarizeNames([])).toBe('');
  });
});

describe('composeSharedInstruction', () => {
  it('leads with the user instruction and lists the recipients', () => {
    const out = composeSharedInstruction({
      recipientNames: ['Acme', 'Globex'],
      userInstruction: 'Keep it under 100 words',
      personalizeGreeting: true,
    });
    expect(out.startsWith('Keep it under 100 words')).toBe(true);
    expect(out).toContain('Acme, Globex');
    expect(out).toContain('ONE general outreach email');
  });

  it('requests the greeting token when personalization is on', () => {
    const out = composeSharedInstruction({
      recipientNames: ['Acme'],
      userInstruction: null,
      personalizeGreeting: true,
    });
    expect(out).toContain(GREETING_TOKEN);
    expect(out).toContain('replaced with each recipient');
  });

  it('requests a generic greeting when personalization is off', () => {
    const out = composeSharedInstruction({
      recipientNames: ['Acme'],
      userInstruction: null,
      personalizeGreeting: false,
    });
    expect(out).not.toContain(GREETING_TOKEN);
    expect(out).toContain('generic greeting');
    // Language-neutral boilerplate: no English-only greeting example.
    expect(out).not.toContain('"Hello,"');
  });

  it('works without a user instruction', () => {
    const out = composeSharedInstruction({
      recipientNames: ['Acme'],
      userInstruction: null,
      personalizeGreeting: true,
    });
    expect(out.startsWith('SHARED EMAIL MODE')).toBe(true);
  });
});

describe('applyGreeting', () => {
  it('replaces the token with the recipient name', () => {
    expect(applyGreeting(`${GREETING_TOKEN},\n\nHello there`, 'Acme')).toBe('Acme,\n\nHello there');
  });

  it('falls back to "there" when the name is missing', () => {
    expect(applyGreeting(GREETING_TOKEN, null)).toBe('there');
    expect(applyGreeting(GREETING_TOKEN, '  ')).toBe('there');
  });

  it('replaces every occurrence', () => {
    expect(applyGreeting(`${GREETING_TOKEN} and ${GREETING_TOKEN}`, 'A')).toBe('A and A');
  });

  it('leaves a body without the token untouched', () => {
    expect(applyGreeting('Hello,', 'Acme')).toBe('Hello,');
  });
});
