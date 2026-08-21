'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { fetchRedFlags, type RedFlagsResponse } from '@/lib/api/job-intel';
import { useTranslations } from '@/lib/i18n';

interface RedFlagsPanelProps {
  jobId?: string | null;
}

const SEVERITY_STYLES: Record<string, string> = {
  danger: 'border-red-200 bg-red-50',
  warning: 'border-amber-200 bg-amber-50',
  info: 'border-[#e6e3dc] bg-paper-tint/60',
};

const SEVERITY_TEXT: Record<string, string> = {
  danger: 'text-red-700',
  warning: 'text-amber-700',
  info: 'text-ink-soft',
};

export function RedFlagsPanel({ jobId }: RedFlagsPanelProps) {
  const { t } = useTranslations();
  const [data, setData] = useState<RedFlagsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const fetchData = useCallback(async (id: string) => {
    setLoading(true);
    setError(false);
    try {
      const result = await fetchRedFlags(id);
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
        <p className="text-xs font-bold text-red-700">{t('tailor.jobIntel.redFlags.loadFailed')}</p>
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
        <div className="h-4 w-24 animate-pulse rounded bg-gray-200" />
        <div className="mt-3 space-y-2">
          <div className="h-8 animate-pulse rounded bg-gray-100" />
          <div className="h-8 animate-pulse rounded bg-gray-100" />
        </div>
      </div>
    );
  }

  if (!data) return null;

  const { red_flags, ghost_risk_percent } = data;

  return (
    <div className="mb-3 border border-[#e6e3dc] bg-white p-4">
      <div className="flex items-center gap-3">
        <h3 className="text-xs font-bold uppercase tracking-wider">
          {'// '}
          {t('tailor.jobIntel.redFlags.title')}
        </h3>
        <span
          className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${
            ghost_risk_percent >= 60
              ? 'border-red-300 bg-red-100 text-red-700'
              : ghost_risk_percent >= 30
                ? 'border-yellow-300 bg-yellow-100 text-yellow-700'
                : 'border-green-300 bg-green-100 text-green-700'
          }`}
        >
          {ghost_risk_percent}% {t('tailor.jobIntel.redFlags.ghostRisk')}
        </span>
      </div>

      {red_flags.length === 0 ? (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-green-700">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          {t('tailor.jobIntel.redFlags.noFlags')}
        </p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {red_flags.map((flag, i) => (
            <li
              key={i}
              className={`flex items-start gap-2 rounded-md border px-2.5 py-1.5 text-xs ${
                SEVERITY_STYLES[flag.severity] ?? SEVERITY_STYLES.info
              }`}
            >
              <AlertTriangle
                className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${
                  SEVERITY_TEXT[flag.severity] ?? SEVERITY_TEXT.info
                }`}
              />
              <div className={`min-w-0 ${SEVERITY_TEXT[flag.severity] ?? SEVERITY_TEXT.info}`}>
                <p className="font-semibold">{flag.flag}</p>
                {flag.concern && <p className="text-[11px] opacity-80">{flag.concern}</p>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}