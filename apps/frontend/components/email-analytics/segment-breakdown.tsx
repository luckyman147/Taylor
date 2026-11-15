'use client';

import { useTranslations } from '@/lib/i18n';
import type { EmailStatsResponse, SegmentStat } from '@/lib/api/email';

interface SegmentBreakdownProps {
  stats: EmailStatsResponse;
}

const KNOWN_SEGMENT_KEYS = new Set([
  'company',
  'contact',
  'personalized',
  'shared',
  'general',
  'internship',
  'job',
  'cold',
  'custom',
]);

function useSegmentLabel(): (key: string) => string {
  const { t } = useTranslations();
  return (key: string) => (KNOWN_SEGMENT_KEYS.has(key) ? t(`emailAnalytics.segments.${key}`) : key);
}

function formatRate(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

function SegmentTable({ titleKey, segments }: { titleKey: string; segments: SegmentStat[] }) {
  const { t } = useTranslations();
  const label = useSegmentLabel();

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-bold text-ink">{t(titleKey)}</h3>
      {segments.length === 0 ? (
        <p className="text-sm text-steel-grey">—</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-steel-grey">
              <th className="py-1 font-semibold">{t('emailAnalytics.segments.segment')}</th>
              <th className="py-1 text-right font-semibold">{t('emailAnalytics.segments.sent')}</th>
              <th className="py-1 text-right font-semibold">
                {t('emailAnalytics.segments.replied')}
              </th>
              <th className="py-1 text-right font-semibold">{t('emailAnalytics.segments.rate')}</th>
            </tr>
          </thead>
          <tbody>
            {segments.map((segment) => (
              <tr key={segment.key} className="border-t border-[#e6e3dc]">
                <td className="py-1.5 text-ink">{label(segment.key)}</td>
                <td className="py-1.5 text-right text-ink">{segment.sent}</td>
                <td className="py-1.5 text-right text-ink">{segment.responded}</td>
                <td className="py-1.5 text-right font-semibold text-ink">
                  {formatRate(segment.response_rate)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

export function SegmentBreakdown({ stats }: SegmentBreakdownProps) {
  const { t } = useTranslations();

  return (
    <section className="rounded-2xl border border-[#e6e3dc] bg-paper-tint p-6">
      <h2 className="text-lg font-bold text-ink">{t('emailAnalytics.segments.title')}</h2>
      <div className="mt-4 grid gap-6 md:grid-cols-3">
        <SegmentTable
          titleKey="emailAnalytics.segments.byRecipientType"
          segments={stats.by_recipient_type}
        />
        <SegmentTable titleKey="emailAnalytics.segments.byMode" segments={stats.by_mode} />
        <SegmentTable titleKey="emailAnalytics.segments.byPurpose" segments={stats.by_purpose} />
      </div>

      <div className="mt-6 flex flex-col gap-2">
        <h3 className="text-sm font-bold text-ink">{t('emailAnalytics.topSubjects.title')}</h3>
        {stats.top_subjects.length === 0 ? (
          <p className="text-sm text-steel-grey">{t('emailAnalytics.topSubjects.empty')}</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-steel-grey">
                <th className="py-1 font-semibold">{t('emailAnalytics.topSubjects.subject')}</th>
                <th className="py-1 text-right font-semibold">
                  {t('emailAnalytics.segments.sent')}
                </th>
                <th className="py-1 text-right font-semibold">
                  {t('emailAnalytics.segments.replied')}
                </th>
                <th className="py-1 text-right font-semibold">
                  {t('emailAnalytics.segments.rate')}
                </th>
              </tr>
            </thead>
            <tbody>
              {stats.top_subjects.map((item) => (
                <tr key={item.subject} className="border-t border-[#e6e3dc]">
                  <td className="max-w-md truncate py-1.5 text-ink" title={item.subject}>
                    {item.subject}
                  </td>
                  <td className="py-1.5 text-right text-ink">{item.sent}</td>
                  <td className="py-1.5 text-right text-ink">{item.responded}</td>
                  <td className="py-1.5 text-right font-semibold text-ink">
                    {formatRate(item.response_rate)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
