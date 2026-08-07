'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { fetchLlmConfig, testLlmConnection } from '@/lib/api/config';
import { useTranslations } from '@/lib/i18n';
import { Loader2, Check, X, Zap, MousePointerClick, AlertTriangle } from 'lucide-react';

type Phase = 'idle' | 'testing' | 'ok' | 'failed';

interface ConfigSummary {
  provider?: string;
  model?: string;
}

interface TestResult {
  provider?: string;
  model?: string;
  latencyMs?: number;
  error?: string;
}

export function AIConnectionCard({ configured }: { configured: boolean }) {
  const { t } = useTranslations();
  const [phase, setPhase] = useState<Phase>('idle');
  const [result, setResult] = useState<TestResult>({});
  const [summary, setSummary] = useState<ConfigSummary>({});

  useEffect(() => {
    let alive = true;
    fetchLlmConfig()
      .then((config) => {
        if (!alive) return;
        setSummary({ provider: config.provider, model: config.model });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const run = useCallback(async () => {
    setPhase('testing');
    setResult({});
    const startedAt = performance.now();
    try {
      const res = await testLlmConnection();
      const latencyMs = Math.round(performance.now() - startedAt);
      setPhase(res.healthy ? 'ok' : 'failed');
      setResult({
        provider: res.provider || undefined,
        model: res.model || undefined,
        latencyMs: res.healthy ? latencyMs : undefined,
        error: !res.healthy ? res.error || res.error_detail || res.model_output : undefined,
      });
    } catch (err) {
      setPhase('failed');
      setResult({ error: err instanceof Error ? err.message : String(err) });
    }
  }, []);

  const statusDot =
    phase === 'ok'
      ? 'bg-success'
      : phase === 'failed'
        ? 'bg-destructive'
        : phase === 'testing'
          ? 'bg-warning animate-pulse'
          : 'bg-steel-grey';

  const provider = result.provider || summary.provider;
  const model = result.model || summary.model;
  const hasIdentity = Boolean(provider || model);

  return (
    <div className="rounded-xl border border-ink/20 bg-white p-5 shadow-sw-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className={`h-2.5 w-2.5 rounded-full ${statusDot}`} />
          <p className="text-xs font-bold uppercase tracking-widest text-ink-soft">
            {t('tailor.aiConnection.title')}
          </p>
        </div>
        {!configured && (
          <Link
            href="/settings"
            className="text-xs font-bold uppercase tracking-wide text-primary underline underline-offset-2 hover:text-ink transition-colors"
          >
            {t('tailor.aiConnection.gotoSettings')}
          </Link>
        )}
      </div>

      {configured && hasIdentity && (
        <p className="mt-3 text-sm font-medium text-ink">
          {t('tailor.aiConnection.connectedAs', {
            provider: provider ?? '—',
            model: model ?? '—',
          })}
        </p>
      )}
      <p className="mt-1 text-sm text-ink-soft">{t('tailor.aiConnection.subtitle')}</p>

      {phase === 'ok' && (
        <div className="mt-4 flex items-center justify-between rounded-lg border border-green-200 bg-green-50 px-3 py-2">
          <span className="flex items-center gap-2 text-sm text-success">
            <Check className="h-4 w-4" />
            {t('tailor.aiConnection.ok')}
          </span>
          {typeof result.latencyMs === 'number' && (
            <span className="text-xs text-success/80">
              {t('tailor.aiConnection.latency', { ms: result.latencyMs })}
            </span>
          )}
        </div>
      )}

      {phase === 'failed' && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2">
          <span className="flex items-center gap-2 text-sm text-red-700">
            <X className="h-4 w-4" />
            {t('tailor.aiConnection.failed')}
          </span>
          {result.error && <p className="mt-1 pl-6 text-xs text-red-600">{result.error}</p>}
        </div>
      )}

      {!configured && (
        <div className="mt-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <p className="text-xs text-amber-800">{t('tailor.aiConnection.notConfigured')}</p>
        </div>
      )}

      <Button
        size="sm"
        variant={phase === 'failed' ? 'outline' : 'default'}
        onClick={run}
        disabled={phase === 'testing' || !configured}
        className="mt-4 w-full"
      >
        {phase === 'testing' ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            {t('tailor.aiConnection.testing')}
          </>
        ) : phase === 'ok' || phase === 'failed' ? (
          <>
            <MousePointerClick className="h-4 w-4" />
            {t('tailor.aiConnection.retest')}
          </>
        ) : (
          <>
            <Zap className="h-4 w-4" />
            {t('tailor.aiConnection.test')}
          </>
        )}
      </Button>
    </div>
  );
}