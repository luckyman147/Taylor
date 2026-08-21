'use client';

import { useCallback, useEffect, useState } from 'react';
import { fetchHiringProbability, type HiringProbabilityResponse } from '@/lib/api/job-intel';
import { useTranslations } from '@/lib/i18n';

interface HiringProbabilityPanelProps {
  jobId?: string | null;
}

const FACTOR_STYLES: Record<string, { bar: string; text: string }> = {
  skills: { bar: 'bg-blue-500', text: 'text-blue-700' },
  experience: { bar: 'bg-emerald-500', text: 'text-emerald-700' },
  seniority: { bar: 'bg-purple-500', text: 'text-purple-700' },
};

const ASSESSMENT_STYLES: Record<string, string> = {
  'Excellent target': 'border-green-300 bg-green-50 text-green-700',
  'Good target': 'border-emerald-300 bg-emerald-50 text-emerald-700',
  Reach: 'border-yellow-300 bg-yellow-50 text-yellow-700',
  Stretch: 'border-orange-300 bg-orange-50 text-orange-700',
  'Long shot': 'border-red-300 bg-red-50 text-red-700',
};

export function HiringProbabilityPanel({ jobId }: HiringProbabilityPanelProps) {
  const { t } = useTranslations();
  const [data, setData] = useState<HiringProbabilityResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const fetchData = useCallback(async (id: string) => {
    setLoading(true);
    setError(false);
    try {
      const result = await fetchHiringProbability(id);
      setData(result);
    } catch {
      setData(null);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (jobId) {
      setData(null);
      setError(false);
      fetchData(jobId);
    }
  }, [jobId, fetchData]);

  if (!jobId) return null;

  if (error && !data) {
    return (
      <div className="mb-3 border border-red-200 bg-red-50 p-4">
        <p className="text-xs font-bold text-red-700">
          {t('tailor.hiringProbability.loadFailed')}
        </p>
        <button
          type="button"
          onClick={() => fetchData(jobId)}
          className="mt-2 rounded-full border border-red-300 bg-white px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-red-700 transition-colors hover:bg-red-100"
        >
          {t('common.retry')}
        </button>
      </div>
    );
  }

  if (loading && !data) {
    return (
      <div className="mb-3 border border-[#e6e3dc] bg-white p-4">
        <div className="h-4 w-40 animate-pulse rounded bg-gray-200" />
        <div className="mt-3 space-y-2">
          <div className="h-8 animate-pulse rounded bg-gray-100" />
          <div className="h-8 animate-pulse rounded bg-gray-100" />
          <div className="h-8 animate-pulse rounded bg-gray-100" />
        </div>
      </div>
    );
  }

  if (!data) return null;

  const factors: { key: 'skills' | 'experience' | 'seniority'; label: string; score: number; detail: string }[] = [
    {
      key: 'skills',
      label: t('tailor.hiringProbability.skills'),
      score: data.skills.score,
      detail: data.skills.detail,
    },
    {
      key: 'experience',
      label: t('tailor.hiringProbability.experience'),
      score: data.experience.score,
      detail: data.experience.detail,
    },
    {
      key: 'seniority',
      label: t('tailor.hiringProbability.seniority'),
      score: data.seniority.score,
      detail: data.seniority.detail,
    },
  ];

  return (
    <div className="mb-3 border border-[#e6e3dc] bg-white p-4">
      <h3 className="text-xs font-bold uppercase tracking-wider">
        {'// '}
        {t('tailor.hiringProbability.title')}
      </h3>

      <div className="mt-3 grid grid-cols-3 gap-2">
        {factors.map((factor) => {
          const style = FACTOR_STYLES[factor.key];
          return (
            <div key={factor.key} className="rounded-lg border border-[#e6e3dc] bg-paper-tint/50 p-2.5">
              <p className="text-[10px] font-bold uppercase tracking-wider text-ink-soft">
                {factor.label}
              </p>
              <p className={`mt-0.5 text-lg font-bold ${style.text}`}>{factor.score}%</p>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-gray-200">
                <div
                  className={`h-full rounded-full transition-all ${style.bar}`}
                  style={{ width: `${factor.score}%` }}
                />
              </div>
              <p className="mt-1.5 truncate text-[10px] text-ink-soft" title={factor.detail}>
                {factor.detail}
              </p>
            </div>
          );
        })}
      </div>

      <div className="mt-3 rounded-lg bg-primary/5 p-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[10px] font-bold uppercase tracking-wider text-primary">
            {t('tailor.hiringProbability.overall')}
          </p>
          <span
            className={`rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${
              ASSESSMENT_STYLES[data.assessment] ?? ASSESSMENT_STYLES.Reach
            }`}
          >
            {data.assessment}
          </span>
        </div>
        <div className="mt-2 flex items-center gap-3">
          <div className="h-3 flex-1 overflow-hidden rounded-full bg-gray-200">
            <div
              className="h-full rounded-full bg-primary transition-all"
              style={{ width: `${data.hiring_probability}%` }}
            />
          </div>
          <span className="text-xl font-bold text-primary">{data.hiring_probability}%</span>
        </div>
        <p className="mt-2 text-xs text-ink">{data.summary}</p>
        {data.gaps.length > 0 && (
          <ul className="mt-2 space-y-1">
            {data.gaps.map((gap, i) => (
              <li key={i} className="flex items-start gap-1.5 text-[11px] text-ink-soft">
                <span className="mt-0.5 text-amber-500">⚠</span>
                {gap}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}