import type { ContactStatus } from '@/lib/api/contacts';

/** Badge styles per contact status (static classes so Tailwind keeps them). */
export const STATUS_STYLES: Record<ContactStatus, string> = {
  to_contact: 'border-slate-200 bg-slate-100 text-slate-600',
  follow_up: 'border-sky-200 bg-sky-100 text-sky-700',
  meeting_scheduled: 'border-amber-200 bg-amber-100 text-amber-700',
  thank_you_sent: 'border-emerald-200 bg-emerald-100 text-emerald-700',
};