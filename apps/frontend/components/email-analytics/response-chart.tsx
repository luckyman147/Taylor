'use client';

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useTranslations } from '@/lib/i18n';
import type { EmailTimelinePoint } from '@/lib/api/email';

interface ResponseChartProps {
  timeline: EmailTimelinePoint[];
}

function formatDay(day: string): string {
  const date = new Date(`${day}T00:00:00`);
  if (Number.isNaN(date.getTime())) return day;
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function ResponseChart({ timeline }: ResponseChartProps) {
  const { t } = useTranslations();

  if (timeline.length === 0) {
    return (
      <section className="rounded-2xl border border-[#e6e3dc] bg-paper-tint p-6">
        <h2 className="text-lg font-bold text-ink">{t('emailAnalytics.chart.title')}</h2>
        <p className="mt-2 text-sm text-steel-grey">{t('emailAnalytics.chart.empty')}</p>
      </section>
    );
  }

  const data = timeline.map((point) => ({
    ...point,
    day: formatDay(point.date),
  }));

  return (
    <section className="rounded-2xl border border-[#e6e3dc] bg-paper-tint p-6">
      <h2 className="text-lg font-bold text-ink">{t('emailAnalytics.chart.title')}</h2>
      <div className="mt-4 h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
            <defs>
              <linearGradient id="fillSent" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#1E3A5F" stopOpacity={0.25} />
                <stop offset="100%" stopColor="#1E3A5F" stopOpacity={0.02} />
              </linearGradient>
              <linearGradient id="fillResponded" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#15803D" stopOpacity={0.3} />
                <stop offset="100%" stopColor="#15803D" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#e6e3dc" vertical={false} />
            <XAxis
              dataKey="day"
              tick={{ fontSize: 11, fill: '#6b7280' }}
              tickLine={false}
              axisLine={{ stroke: '#e6e3dc' }}
            />
            <YAxis
              allowDecimals={false}
              tick={{ fontSize: 11, fill: '#6b7280' }}
              tickLine={false}
              axisLine={false}
              width={36}
            />
            <Tooltip
              contentStyle={{
                borderRadius: 12,
                border: '1px solid #e6e3dc',
                fontSize: 12,
                boxShadow: '0 4px 14px rgba(0,0,0,0.08)',
              }}
            />
            <Area
              type="monotone"
              dataKey="sent"
              name={t('emailAnalytics.chart.sent')}
              stroke="#1E3A5F"
              strokeWidth={2}
              fill="url(#fillSent)"
            />
            <Area
              type="monotone"
              dataKey="responded"
              name={t('emailAnalytics.chart.responded')}
              stroke="#15803D"
              strokeWidth={2}
              fill="url(#fillResponded)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
