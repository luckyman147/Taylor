'use client';

import { useCallback, useEffect, useState } from 'react';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw';
import Sparkles from 'lucide-react/dist/esm/icons/sparkles';
import { Button } from '@/components/ui/button';
import { useTranslations } from '@/lib/i18n';
import { getSkillRoi, type CareerRoiResponse } from '@/lib/api/profile';
import { MarkdownContent } from '@/components/common/markdown-content';

/** Static class mapping so Tailwind keeps the badges. */
const EFFORT_STYLES: Record<string, string> = {
  low: 'bg-green-100 text-green-800',
  medium: 'bg-amber-100 text-amber-800',
  high: 'bg-red-100 text-red-800',
};

export function SkillRoiTab() {
  const { t } = useTranslations();
  const [data, setData] = useState<CareerRoiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (includeAdvice = false) => {
    setLoading(true);
    setError(null);
    try {
      setData(await getSkillRoi({ include_advice: includeAdvice }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const refreshWithAdvice = () => void load(true);

  return (
    <div className="space-y-5 pb-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-ink-soft">{t('profile.roi.description')}</p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => void load(false)} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            {t('profile.roi.refresh')}
          </Button>
          <Button size="sm" onClick={refreshWithAdvice} disabled={loading}>
            <Sparkles className="h-4 w-4" />
            {t('profile.roi.getAdvice')}
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {data?.note && (
        <div className="rounded-2xl border border-dashed border-[#e6e3dc] bg-paper-tint/50 p-5 text-sm text-ink-soft">
          {data.note}
        </div>
      )}

      {data && data.results.length > 0 && (
        <>
          <div className="overflow-hidden rounded-2xl border border-[#e6e3dc] bg-white shadow-sw-xs">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#e6e3dc] bg-secondary">
                  <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-ink-soft">
                    {t('profile.roi.skill')}
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-bold uppercase tracking-wide text-ink-soft">
                    {t('profile.roi.jobsUnlocked')}
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-bold uppercase tracking-wide text-ink-soft">
                    {t('profile.roi.salaryImpact')}
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-bold uppercase tracking-wide text-ink-soft">
                    {t('profile.roi.learningEffort')}
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wide text-ink-soft">
                    {t('profile.roi.roiScore')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#f0ece4]">
                {data.results.map((row) => (
                  <tr key={row.skill}>
                    <td className="px-4 py-3 font-semibold text-ink">{row.skill}</td>
                    <td className="px-4 py-3 text-center">
                      <div className="text-xs text-ink-soft">
                        {row.matching_jobs} · {row.jobs_unlocked_pct}%
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center text-xs text-ink-soft">
                      {row.salary_impact_pct === null
                        ? t('profile.roi.noData')
                        : `${row.salary_impact_pct > 0 ? '+' : ''}${row.salary_impact_pct}%`}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${EFFORT_STYLES[row.learning_effort] ?? EFFORT_STYLES.medium}`}
                      >
                        {t(`profile.roi.effort.${row.learning_effort}`)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="ml-auto w-28">
                        <div className="mb-1 text-right text-sm font-bold text-primary">
                          {row.roi_score}
                        </div>
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#e6e3dc]">
                          <div
                            className="h-full rounded-full bg-primary"
                            style={{ width: `${row.roi_score}%` }}
                          />
                        </div>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="text-xs text-ink-soft">{t('profile.roi.formula')}</div>
        </>
      )}

      {data?.advice && (
        <div className="rounded-2xl border border-[#e6e3dc] bg-white p-5 shadow-sw-xs">
          <div className="mb-2 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-primary">
            <Sparkles className="h-4 w-4" />
            {t('profile.roi.advice')}
          </div>
          <MarkdownContent content={data.advice} />
        </div>
      )}
    </div>
  );
}
