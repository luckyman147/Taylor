/**
 * Helpers for the "shared bulk email" mode: one general AI-written email
 * generated once and sent individually to many recipients.
 */

/** Placeholder the model puts in the greeting; swapped per recipient at send time. */
export const GREETING_TOKEN = '{{name}}';

export type EmailMode = 'personalized' | 'shared';

/** Condense a list of recipient names for prompt/display use ("A, B and 3 more"). */
export function summarizeNames(names: string[]): string {
  const clean = names.map((n) => n.trim()).filter(Boolean);
  if (clean.length === 0) return '';
  if (clean.length <= 5) return clean.join(', ');
  return `${clean.slice(0, 5).join(', ')} and ${clean.length - 5} more`;
}

/**
 * Build the LLM instruction for a single shared email. Appended after the
 * user's own instruction (which the backend injects as highest priority).
 */
export function composeSharedInstruction(options: {
  recipientNames: string[];
  userInstruction?: string | null;
  personalizeGreeting: boolean;
}): string {
  const { recipientNames, userInstruction, personalizeGreeting } = options;
  const parts: string[] = [];
  if (userInstruction?.trim()) parts.push(userInstruction.trim());
  parts.push(
    [
      'SHARED EMAIL MODE: write ONE general outreach email that will be sent unchanged to every one of these recipients:',
      `${summarizeNames(recipientNames)}.`,
      'Do not include any recipient-specific or company-specific details in the subject or body.',
      personalizeGreeting
        ? `Begin the body with exactly one greeting line that starts with the literal token ${GREETING_TOKEN} followed by a comma — for example "${GREETING_TOKEN}," — and no other salutation. The token will be replaced with each recipient's name before sending.`
        : 'Begin the body with a generic greeting appropriate to the language of the email. Do not use any recipient or company name.',
    ].join(' ')
  );
  return parts.join('\n\n');
}

/**
 * Replace the greeting token with the recipient's display name.
 * Stray tokens fall back to "there" so nothing leaks into sent mail.
 */
export function applyGreeting(body: string, name: string | null | undefined): string {
  if (!body.includes(GREETING_TOKEN)) return body;
  const value = name?.trim() || 'there';
  return body.split(GREETING_TOKEN).join(value);
}
