'use client';

import { useCallback, useEffect, useState } from 'react';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw';
import TrendingUp from 'lucide-react/dist/esm/icons/trending-up';
import { Button } from '@/components/ui/button';
import { useTranslations } from '@/lib/i18n';
import { getMarketPosition, type MarketPositionResponse } from '@/lib/api/profile';

/** Badge styles for domain readiness. */
const READINESS_STYLES: Record<string, string> = {
  strong: 'bg-green-100 text-green-800',
  adequate: 'bg-amber-100 text-amber-800',
  underqualified: 'bg-red-100 text-red-800',
};

/** Badge styles for role seniority. */
const SENIORITY_STYLES: Record<string, string> = {
  senior: 'bg-green-100 text-green-800',
  mid: 'bg-primary/10 text-primary',
  junior: 'bg-amber-100 text-amber-800',
};

/**
 * Ordinal form of a percentile per locale ("84th", "84e", "84.º", "84").
 * Only en/fr/es/pt-BR add a suffix; zh/ja/ko use the bare number.
 */
function ordinal(value: number, locale: string): string {
  if (locale === 'en') {
    const mod100 = value % 100;
    if (mod100 >= 11 && mod100 <= 13) return `${value}th`;
    const suffix = { 1: 'st', 2: 'nd', 3: 'rd' }[value % 10] ?? 'th';
    return `${value}${suffix}`;
  }
  if (locale === 'fr') return `${value}e`;
  if (locale === 'es' || locale === 'pt-BR') return `${value}.º`;
  return String(value);
}

function PercentileRow({
  label,
  percentile,
  badge,
}: {
  label: string;
  percentile: number;
  badge?: React.ReactNode;
}) {
  const { t, locale } = useTranslations();
  return (
    <div className="flex items-center gap-3 px-5 py-2.5">
      <div className="w-44 shrink-0 truncate text-sm font-semibold text-ink" title={label}>
        {label}
      </div>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-[#e6e3dc]">
        <div
          className="h-full rounded-full bg-primary"
          style={{ width: `${Math.min(Math.max(percentile, 0), 100)}%` }}
        />
      </div>
      <div className="w-28 shrink-0 text-right text-xs font-bold text-primary">
        {t('profile.market.percentile', { ordinal: ordinal(percentile, locale) })}
      </div>
      {badge}
    </div>
  );
}

export function MarketPositionCard() {
  const { t } = useTranslations();
  const [data, setData] = useState<MarketPositionResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setData(await getMarketPosition());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <section className="overflow-hidden rounded-2xl border border-[#e6e3dc] bg-white shadow-sw-xs">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e6e3dc] bg-paper-tint/50 px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
            <TrendingUp className="h-4.5 w-4.5" />
          </div>
          <div>
            <h3 className="text-sm font-bold text-ink">{t('profile.market.title')}</h3>
            <p className="mt-0.5 text-xs text-ink-soft">{t('profile.market.description')}</p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          {t('profile.market.refresh')}
        </Button>
      </div>

      {loading && !data ? (
        <div className="flex items-center justify-center gap-2 px-5 py-10 text-sm text-ink-soft">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t('common.loading')}
        </div>
      ) : error && !data ? (
        <div className="px-5 py-4 text-sm text-red-700">{error}</div>
      ) : data ? (
        <div className="py-3">
          {data.note && (
            <div className="mx-5 mb-3 rounded-xl border border-dashed border-[#e6e3dc] bg-paper-tint/50 px-4 py-3 text-sm text-ink-soft">
              {t('profile.market.noteEmpty')}
            </div>
          )}

          {data.current_role && (
            <div className="mx-5 mb-3 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3">
              <div className="text-xs font-bold uppercase tracking-wide text-primary">
                {t('profile.market.currentRole')}
              </div>
              <div className="mt-1 text-base font-bold text-ink">{data.current_role}</div>
              {data.specialization.length > 0 && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <span className="text-xs text-ink-soft">
                    {t('profile.market.specialization')}
                  </span>
                  {data.specialization.map((skill) => (
                    <span
                      key={skill}
                      className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary"
                    >
                      {skill}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          {data.recommended_roles.length > 0 && (
            <div className="mx-5 mb-3 rounded-xl border border-[#e6e3dc] bg-paper-tint/50">
              <div className="px-4 pt-3">
                <div className="text-xs font-bold uppercase tracking-wide text-ink-soft">
                  {t('profile.market.picksTitle')}
                </div>
                <div className="mt-0.5 text-xs text-ink-soft">
                  {t('profile.market.picksDescription')}
                </div>
              </div>
              <div className="mt-2 divide-y divide-[#f0ece4]">
                {data.recommended_roles.map((role) => (
                  <div
                    key={`${role.domain}:${role.role}`}
                    className="flex items-center gap-3 px-4 py-2.5"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold text-ink" title={role.role}>
                        {role.role}
                      </div>
                      <div className="mt-0.5 truncate text-xs text-ink-soft" title={role.reason}>
                        {role.reason}
                      </div>
                    </div>
                    <span
                      className={`w-16 shrink-0 rounded-full px-2 py-0.5 text-center text-[10px] font-bold uppercase tracking-wide ${SENIORITY_STYLES[role.seniority] ?? 'bg-secondary text-ink-soft'}`}
                    >
                      {t(`profile.market.seniority.${role.seniority}`)}
                    </span>
                    <div className="w-20 shrink-0 text-right text-xs font-bold text-primary">
                      {t('profile.market.match', { score: role.match_score })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {data.domains.length > 0 && (
            <div className="border-b border-[#f0ece4] pb-2">
              <div className="px-5 py-1 text-xs font-bold uppercase tracking-wide text-ink-soft">
                {t('profile.market.domainsTitle')}
              </div>
              {data.domains.map((domain) => (
                <PercentileRow
                  key={domain.domain}
                  label={t(`profile.market.domains.${domain.domain}`)}
                  percentile={domain.percentile}
                  badge={
                    <span
                      className={`w-28 shrink-0 rounded-full px-2 py-0.5 text-center text-[10px] font-bold uppercase tracking-wide ${READINESS_STYLES[domain.readiness] ?? 'bg-secondary text-ink-soft'}`}
                    >
                      {t(`profile.market.readiness.${domain.readiness}`)}
                    </span>
                  }
                />
              ))}
            </div>
          )}

          {data.skills.length > 0 && (
            <div className="pt-2">
              <div className="px-5 py-1 text-xs font-bold uppercase tracking-wide text-ink-soft">
                {t('profile.market.skillsTitle')}
              </div>
              {data.skills.map((skill) => (
                <PercentileRow
                  key={skill.skill}
                  label={skill.skill}
                  percentile={skill.percentile}
                />
              ))}
            </div>
          )}

          <div className="mx-5 mt-3 rounded-xl bg-secondary px-4 py-3 text-sm text-ink">
            <span className="mr-2 font-bold uppercase tracking-wide text-primary">
              {t('profile.market.verdictTitle')}
            </span>
            {data.verdict}
          </div>
        </div>
      ) : null}
    </section>
  );
}
