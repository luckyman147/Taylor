'use client';

import { useEffect, useState } from 'react';
import Briefcase from 'lucide-react/dist/esm/icons/briefcase';
import Building2 from 'lucide-react/dist/esm/icons/building-2';
import Link from 'next/link';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';
import { useTranslations } from '@/lib/i18n';
import { listApplications, type Application } from '@/lib/api/tracker';

export function UpcomingInterviews() {
  const { t } = useTranslations();
  const [loading, setLoading] = useState(true);
  const [upcoming, setUpcoming] = useState<Application[]>([]);

  useEffect(() => {
    let active = true;
    listApplications()
      .then((res) => {
        if (!active) return;
        const interviews = (res.columns.interview ?? []).slice().sort(
          (a, b) =>
            new Date(b.updated_at ?? 0).getTime() - new Date(a.updated_at ?? 0).getTime()
        );
        setUpcoming(interviews);
      })
      .catch(() => {
        if (active) setUpcoming([]);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-bold text-ink">{t('interviewPractice.upcomingTitle')}</h2>
          <p className="text-sm text-steel-grey">{t('interviewPractice.upcomingDescription')}</p>
        </div>
        <Link
          href="/tracker"
          className="text-sm font-semibold uppercase tracking-wide text-primary hover:underline"
        >
          {t('interviewPractice.upcomingViewTracker')}
        </Link>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-steel-grey">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t('interviewPractice.loading')}
        </div>
      ) : upcoming.length === 0 ? (
        <p className="text-sm text-steel-grey">{t('interviewPractice.upcomingEmpty')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {upcoming.map((application) => (
            <li key={application.application_id}>
              <Link
                href="/tracker"
                className="flex items-center gap-3 rounded-2xl border border-[#e6e3dc] bg-paper-tint px-4 py-3 transition-colors hover:border-ink"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-primary shadow-sw-sm">
                  <Building2 className="h-4 w-4" />
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-sm font-semibold text-ink">
                    {application.company || t('interviewPractice.upcomingUntitled')}
                  </span>
                  {application.role && (
                    <span className="flex items-center gap-1 truncate text-xs text-steel-grey">
                      <Briefcase className="h-3 w-3 shrink-0" />
                      {application.role}
                    </span>
                  )}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}