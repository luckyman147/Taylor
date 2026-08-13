import type { CompanyStatus } from '@/lib/api/companies';

/** Badge styles per company status (static classes so Tailwind keeps them). */
export const STATUS_STYLES: Record<CompanyStatus, string> = {
  watching: 'border-slate-200 bg-slate-100 text-slate-600',
  contacted: 'border-sky-200 bg-sky-100 text-sky-700',
  applied: 'border-blue-200 bg-blue-100 text-blue-700',
  interviewing: 'border-amber-200 bg-amber-100 text-amber-700',
  negotiating: 'border-violet-200 bg-violet-100 text-violet-700',
  won: 'border-emerald-200 bg-emerald-100 text-emerald-700',
  lost: 'border-rose-200 bg-rose-100 text-rose-700',
};
