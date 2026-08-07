'use client';

import { Loader2, CheckCircle2, Sparkles, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTranslations } from '@/lib/i18n';

interface LoadingStepProps {
  message: string;
  submessage?: string;
}

function LoadingStep({ message, submessage }: LoadingStepProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[400px] gap-6">
      <div className="relative">
        <Loader2 className="w-12 h-12 animate-spin text-black" />
      </div>
      <div className="text-center">
        <p className="text-xl  font-bold">{message}</p>
        {submessage && <p className="text-sm text-steel-grey mt-2 ">{submessage}</p>}
      </div>
    </div>
  );
}

export function AnalyzingStep() {
  const { t } = useTranslations();
  return (
    <LoadingStep
      message={t('enrichment.loading.analyzingTitle')}
      submessage={t('enrichment.loading.analyzingDescription')}
    />
  );
}

export function GeneratingStep() {
  const { t } = useTranslations();
  return (
    <LoadingStep
      message={t('enrichment.loading.generatingTitle')}
      submessage={t('enrichment.loading.generatingDescription')}
    />
  );
}

export function ApplyingStep() {
  const { t } = useTranslations();
  return (
    <LoadingStep
      message={t('enrichment.loading.applyingTitle')}
      submessage={t('enrichment.loading.applyingDescription')}
    />
  );
}

interface CompleteStepProps {
  onClose: () => void;
  updatedCount?: number;
}

export function CompleteStep({ onClose, updatedCount }: CompleteStepProps) {
  const { t } = useTranslations();
  const hasUpdatedCount = updatedCount !== undefined;
  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[400px] gap-6">
      <div className="relative">
        <CheckCircle2 className="w-16 h-16 text-green-600" />
      </div>
      <div className="text-center">
        <p className="text-2xl  font-bold">{t('enrichment.complete.title')}</p>
        <p className="text-sm text-steel-grey mt-2 ">
          {hasUpdatedCount
            ? updatedCount === 1
              ? t('enrichment.complete.updatedCountSingular', { count: updatedCount })
              : t('enrichment.complete.updatedCountPlural', { count: updatedCount })
            : t('enrichment.complete.updatedFallback')}
        </p>
      </div>
      <Button onClick={onClose} className="mt-4 gap-2">
        <Sparkles className="w-4 h-4" />
        {t('enrichment.complete.doneButton')}
      </Button>
    </div>
  );
}

interface NoImprovementsStepProps {
  onClose: () => void;
  summary?: string;
}

export function NoImprovementsStep({ onClose, summary }: NoImprovementsStepProps) {
  const { t } = useTranslations();
  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[400px] gap-6">
      <div className="relative">
        <CheckCircle2 className="w-16 h-16 text-green-600" />
      </div>
      <div className="text-center max-w-md">
        <p className="text-2xl  font-bold">{t('enrichment.noImprovements.title')}</p>
        <p className="text-sm text-steel-grey mt-2 ">
          {summary || t('enrichment.noImprovements.defaultDescription')}
        </p>
      </div>
      <Button onClick={onClose} className="mt-4 gap-2">
        <Sparkles className="w-4 h-4" />
        {t('common.close')}
      </Button>
    </div>
  );
}

interface ErrorStepProps {
  error: string;
  onRetry: () => void;
  onClose: () => void;
}

export function ErrorStep({ error, onRetry, onClose }: ErrorStepProps) {
  const { t } = useTranslations();
  return (
    <div className="flex flex-col items-center justify-center h-full min-h-[400px] gap-6 px-4">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-red-50">
        <AlertCircle className="h-7 w-7 text-red-600" />
      </div>
      <div className="text-center max-w-md">
        <h2 className="text-lg font-bold uppercase tracking-wide text-ink">
          {t('enrichment.error.title')}
        </h2>
        <div className="mt-4 flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-left">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
          <p className="text-sm text-red-700">{error}</p>
        </div>
      </div>
      <div className="flex gap-3 mt-2">
        <Button variant="outline" onClick={onClose} className="rounded-full">
          {t('common.cancel')}
        </Button>
        <Button onClick={onRetry} className="rounded-full">
          {t('common.retry')}
        </Button>
      </div>
    </div>
  );
}
