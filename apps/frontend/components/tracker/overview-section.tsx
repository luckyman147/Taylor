'use client';

import { useCallback, useEffect, useState } from 'react';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';
import Sparkles from 'lucide-react/dist/esm/icons/sparkles';
import TrendingUp from 'lucide-react/dist/esm/icons/trending-up';
import XCircle from 'lucide-react/dist/esm/icons/x-circle';
import CalendarClock from 'lucide-react/dist/esm/icons/calendar-clock';
import Target from 'lucide-react/dist/esm/icons/target';
import { useTranslations } from '@/lib/i18n';
import { getCareerInsights, type CareerInsightsResponse } from '@/lib/api/profile';
import { MarkdownContent } from '@/components/common/markdown-content';

function StatCard({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-2xl border border-[#e6e3dc] bg-white p-4 shadow-sw-xs">
      <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-ink-soft">
        <Icon className="h-4 w-4" />
        {label}
      </div>
      <div className="text-2xl font-bold text-ink">{value}</div>
      {hint && <div className="mt-1 text-xs text-ink-soft">{hint}</div>}
    </div>
  );
}

function formatRate(value: number | null): string {
  if (value === null) return '—';
  return `${Math.round(value * 100)}%`;
}

function formatDays(value: number | null): string {
  if (value === null) return '—';
  return value.toFixed(0);
}

export function OverviewSection() {
  const { t } = useTranslations();
  const [insights, setInsights] = useState<CareerInsightsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setInsights(await getCareerInsights());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  const stats = insights?.stats;

  return (
    <div className="space-y-5 pb-8">
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {stats && (
        <>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-5">
            <StatCard
              icon={TrendingUp}
              label={t('profile.overview.totalApplications')}
              value={String(stats.total ?? 0)}
            />
            <StatCard
              icon={XCircle}
              label={t('profile.overview.rejectionRate')}
              value={formatRate(stats.rejection_rate)}
              hint={t('profile.overview.rejectionRateHint')}
            />
            <StatCard
              icon={Target}
              label={t('profile.overview.appliedToInterview')}
              value={formatRate(stats.applied_to_interview_rate)}
            />
            <StatCard
              icon={Sparkles}
              label={t('profile.overview.interviewToAccepted')}
              value={formatRate(stats.interview_to_accepted_rate)}
            />
            <StatCard
              icon={CalendarClock}
              label={t('profile.overview.medianDaysToInterview')}
              value={formatDays(stats.median_days_to_interview)}
              hint={t('profile.overview.medianDaysHint')}
            />
          </div>

          {insights?.narrative ? (
            <div className="rounded-2xl border border-[#e6e3dc] bg-white p-5 shadow-sw-xs">
              <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-primary">
                <Sparkles className="h-4 w-4" />
                {t('profile.overview.llmInsights')}
              </div>
              <MarkdownContent content={insights.narrative} />
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-[#e6e3dc] bg-paper-tint/50 p-5 text-sm text-ink-soft">
              {t('profile.overview.insightsEmpty')}
            </div>
          )}
        </>
      )}

      {!stats && !error && (
        <div className="rounded-2xl border border-dashed border-[#e6e3dc] p-8 text-center text-sm text-ink-soft">
          {t('profile.overview.noData')}
        </div>
      )}
    </div>
  );
}
