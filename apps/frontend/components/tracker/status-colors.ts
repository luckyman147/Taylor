import type { ApplicationStatus } from '@/lib/api/tracker';

// Accent dot colour per pipeline stage (used in column headers, stage rail
// and the card-detail badge).
export const STATUS_DOT: Record<ApplicationStatus, string> = {
  saved: 'bg-blue-500',
  applied: 'bg-indigo-500',
  no_response: 'bg-slate-400',
  response: 'bg-teal-500',
  interview: 'bg-emerald-500',
  accepted: 'bg-green-600',
  rejected: 'bg-red-500',
};
