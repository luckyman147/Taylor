'use client';

import { useTranslations } from '@/lib/i18n';
import { Mail, Reply, Percent, Clock, Ban } from 'lucide-react';
import type { EmailStatsResponse } from '@/lib/api/email';

interface StatCardsProps {
  stats: EmailStatsResponse;
}

function formatPercent(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

export function StatCards({ stats }: StatCardsProps) {
  const { t } = useTranslations();

  const cards = [
    {
      key: 'total',
      label: t('emailAnalytics.stats.totalSent'),
      value: String(stats.total_sent),
      icon: Mail,
    },
    {
      key: 'responded',
      label: t('emailAnalytics.stats.responded'),
      value: String(stats.responded),
      icon: Reply,
    },
    {
      key: 'rate',
      label: t('emailAnalytics.stats.responseRate'),
      value: formatPercent(stats.response_rate),
      icon: Percent,
    },
    {
      key: 'pending',
      label: t('emailAnalytics.stats.pending'),
      value: String(stats.pending),
      icon: Clock,
    },
    {
      key: 'bounced',
      label: t('emailAnalytics.stats.bounced'),
      value: String(stats.bounced),
      icon: Ban,
    },
  ];

  return (
    <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
      {cards.map((card) => (
        <div
          key={card.key}
          className="flex flex-col gap-2 rounded-2xl border border-[#e6e3dc] bg-paper-tint p-4"
        >
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-steel-grey">
            <card.icon className="h-4 w-4 text-primary" />
            {card.label}
          </div>
          <div className="text-2xl font-bold text-ink">{card.value}</div>
        </div>
      ))}
    </section>
  );
}
