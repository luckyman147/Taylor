'use client';

import { useState, useEffect, useCallback } from 'react';
import { fetchJobDna, type JobDnaResponse } from '@/lib/api/job-intel';
import { useTranslations } from '@/lib/i18n';

interface JobDnaPanelProps {
  jobId?: string | null;
}

function DnaSkeleton() {
  return (
    <div className="space-y-3 animate-pulse">
      <div className="h-4 bg-gray-200 rounded w-1/4" />
      <div className="h-2 bg-gray-100 rounded-full" />
      <div className="grid grid-cols-3 gap-2">
        <div className="h-16 bg-gray-100 rounded" />
        <div className="h-16 bg-gray-100 rounded" />
        <div className="h-16 bg-gray-100 rounded" />
      </div>
    </div>
  );
}

export function JobDnaPanel({ jobId }: JobDnaPanelProps) {
  const { t } = useTranslations();
  const [dna, setDna] = useState<JobDnaResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);

  const fetchData = useCallback(async (id: string) => {
    setLoading(true);
    setError(false);
    try {
      const data = await fetchJobDna(id);
      setDna(data);
    } catch {
      setDna(null);
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (jobId) {
      setDna(null);
      setError(false);
      fetchData(jobId);
    }
  }, [jobId, fetchData]);

  if (!jobId) return null;

  if (error && !dna) {
    return (
      <div className="border border-red-200 bg-red-50 p-4 mb-3">
        <p className="text-xs font-bold text-red-700">{t('tailor.jobIntel.jobDna.loadFailed')}</p>
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

  if (loading && !dna) {
    return (
      <div className="border border-[#e6e3dc] bg-white p-4 mb-3">
        <DnaSkeleton />
      </div>
    );
  }

  if (!dna) return null;

  const { comparison } = dna;

  return (
    <div className="border border-[#e6e3dc] bg-white p-4 mb-3 space-y-3">
      <div className="flex items-center gap-3">
        <h3 className="text-xs font-bold uppercase tracking-wider">
          {'// '}
          {t('tailor.jobIntel.jobDna.title')}
        </h3>
        <span className="text-xs font-bold">{comparison.dna_match}%</span>
      </div>

      {/* Overall match bar */}
      <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
        <div
          className="h-full bg-primary rounded-full transition-all"
          style={{ width: `${comparison.dna_match}%` }}
        />
      </div>

      {/* Technical Skills */}
      <div>
        <p className="text-[10px] font-bold uppercase tracking-wider text-ink-soft mb-1.5">
          {t('tailor.jobIntel.jobDna.technical')}
        </p>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div>
            <p className="text-[10px] font-bold text-green-700 mb-1">
              {t('tailor.jobIntel.jobDna.matched')} ({comparison.technical.matched.length})
            </p>
            {comparison.technical.matched.map((s, i) => (
              <p key={i} className="text-ink-soft">{s.skill}</p>
            ))}
          </div>
          <div>
            <p className="text-[10px] font-bold text-red-700 mb-1">
              {t('tailor.jobIntel.jobDna.missing')} ({comparison.technical.missing.length})
            </p>
            {comparison.technical.missing.map((s, i) => (
              <p key={i} className="text-ink-soft">{s.skill}</p>
            ))}
          </div>
        </div>
      </div>

      {/* Experience */}
      <div>
        <p className="text-[10px] font-bold uppercase tracking-wider text-ink-soft mb-1.5">
          {t('tailor.jobIntel.jobDna.experience')}
        </p>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div>
            <p className="text-[10px] font-bold text-green-700 mb-1">
              {t('tailor.jobIntel.jobDna.matched')} ({comparison.experience.matched.length})
            </p>
            {comparison.experience.matched.map((d, i) => (
              <p key={i} className="text-ink-soft">{d}</p>
            ))}
          </div>
          <div>
            <p className="text-[10px] font-bold text-red-700 mb-1">
              {t('tailor.jobIntel.jobDna.missing')} ({comparison.experience.missing.length})
            </p>
            {comparison.experience.missing.map((d, i) => (
              <p key={i} className="text-ink-soft">{d}</p>
            ))}
          </div>
        </div>
      </div>

      {/* Company Culture */}
      <div>
        <p className="text-[10px] font-bold uppercase tracking-wider text-ink-soft mb-1.5">
          {t('tailor.jobIntel.jobDna.company')}
        </p>
        <div className="flex flex-wrap gap-1.5">
          {comparison.company.matched.map((c, i) => (
            <span key={i} className="text-[10px] px-2 py-0.5 bg-green-50 text-green-700 border border-green-200 rounded">
              {c}
            </span>
          ))}
          {comparison.company.missing.map((c, i) => (
            <span key={i} className="text-[10px] px-2 py-0.5 bg-red-50 text-red-700 border border-red-200 rounded">
              {c}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}