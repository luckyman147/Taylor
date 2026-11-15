'use client';

import { useEffect, useState } from 'react';
import { Lightbulb, Loader2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useTranslations } from '@/lib/i18n';
import {
  analyzeOutreachHistory,
  fetchLatestOutreachAnalysis,
  type OutreachAnalysisReport,
} from '@/lib/api/email';

interface AnalyzePanelProps {
  totalSent: number;
}

const MIN_EMAILS_TO_ANALYZE = 3;

function TipList({ titleKey, items }: { titleKey: string; items: string[] }) {
  const { t } = useTranslations();
  if (items.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <h4 className="text-xs font-bold uppercase tracking-wide text-steel-grey">{t(titleKey)}</h4>
      <ul className="flex flex-col gap-1">
        {items.map((item, index) => (
          <li key={index} className="flex gap-2 text-sm text-ink">
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function AnalyzePanel({ totalSent }: AnalyzePanelProps) {
  const { t } = useTranslations();
  const [analyzing, setAnalyzing] = useState(false);
  const [report, setReport] = useState<OutreachAnalysisReport | null>(null);
  const [emailsAnalyzed, setEmailsAnalyzed] = useState<number | null>(null);
  const [createdAt, setCreatedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const notEnoughData = totalSent < MIN_EMAILS_TO_ANALYZE;

  // Load the last saved analysis on mount so the report survives reloads.
  useEffect(() => {
    let active = true;
    fetchLatestOutreachAnalysis()
      .then((saved) => {
        if (!active || !saved) return;
        setReport(saved.report);
        setEmailsAnalyzed(saved.emails_analyzed || null);
        setCreatedAt(saved.created_at ?? null);
      })
      .catch(() => {
        /* saved report is optional — ignore load failures */
      });
    return () => {
      active = false;
    };
  }, []);

  async function handleAnalyze() {
    if (analyzing) return;
    setAnalyzing(true);
    setError(null);
    try {
      const result = await analyzeOutreachHistory();
      setReport(result.report);
      setEmailsAnalyzed(result.emails_analyzed);
      setCreatedAt(result.created_at ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('emailAnalytics.analyze.failed'));
    } finally {
      setAnalyzing(false);
    }
  }

  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-[#e6e3dc] bg-paper-tint p-6">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-primary shadow-sw-sm">
          <Sparkles className="h-5 w-5" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h2 className="text-lg font-bold text-ink">{t('emailAnalytics.analyze.title')}</h2>
          <p className="text-sm text-steel-grey">{t('emailAnalytics.analyze.description')}</p>
        </div>
      </div>

      <Button onClick={handleAnalyze} disabled={analyzing || notEnoughData} className="self-start">
        {analyzing && <Loader2 className="h-4 w-4 animate-spin" />}
        {analyzing ? t('emailAnalytics.analyze.analyzing') : t('emailAnalytics.analyze.button')}
      </Button>

      {notEnoughData && (
        <p className="text-sm text-steel-grey">{t('emailAnalytics.analyze.empty')}</p>
      )}

      {error && (
        <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-ink">
          {error}
        </p>
      )}

      {report && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            {emailsAnalyzed !== null && (
              <p className="text-xs font-semibold uppercase tracking-wide text-steel-grey">
                {t('emailAnalytics.analyze.emailsAnalyzed', { count: emailsAnalyzed })}
              </p>
            )}
            {createdAt && (
              <p className="text-xs text-steel-grey">
                {t('emailAnalytics.analyze.savedAt', {
                  date: new Date(createdAt).toLocaleString(),
                })}
              </p>
            )}
          </div>

          {report.summary && (
            <p className="rounded-xl border border-[#e6e3dc] bg-white px-4 py-3 text-sm leading-relaxed text-ink">
              {report.summary}
            </p>
          )}

          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-xl border border-success/30 bg-success/5 p-4">
              <TipList titleKey="emailAnalytics.analyze.whatWorks" items={report.what_works} />
            </div>
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4">
              <TipList titleKey="emailAnalytics.analyze.whatFails" items={report.what_fails} />
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-3">
            <div className="rounded-xl border border-[#e6e3dc] bg-white p-4">
              <TipList titleKey="emailAnalytics.analyze.subjectTips" items={report.subject_tips} />
            </div>
            <div className="rounded-xl border border-[#e6e3dc] bg-white p-4">
              <TipList titleKey="emailAnalytics.analyze.bodyTips" items={report.body_tips} />
            </div>
            <div className="rounded-xl border border-[#e6e3dc] bg-white p-4">
              <TipList titleKey="emailAnalytics.analyze.ctaTips" items={report.cta_tips} />
            </div>
          </div>

          {(report.example_subject || report.example_body) && (
            <div className="flex flex-col gap-2 rounded-xl border border-primary/30 bg-primary/5 p-4">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-primary">
                <Lightbulb className="h-4 w-4" />
                {t('emailAnalytics.analyze.example')}
              </div>
              {report.example_subject && (
                <div className="text-sm">
                  <span className="font-semibold text-ink">
                    {t('emailAnalytics.analyze.exampleSubject')}:
                  </span>{' '}
                  <span className="text-ink">{report.example_subject}</span>
                </div>
              )}
              {report.example_body && (
                <pre className="whitespace-pre-wrap rounded-lg bg-white px-3 py-2 font-sans text-sm text-ink">
                  {report.example_body}
                </pre>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
