'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, MailPlus, RefreshCw } from 'lucide-react';
import SidebarNav from '@/components/common/SidebarNav';
import { Button } from '@/components/ui/button';
import { useTranslations } from '@/lib/i18n';
import {
  EMAIL_HISTORY_PAGE_SIZE,
  fetchEmailHistory,
  fetchEmailStats,
  type EmailStatsResponse,
  type SentEmail,
} from '@/lib/api/email';
import { StatCards } from '@/components/email-analytics/stat-cards';
import { ResponseChart } from '@/components/email-analytics/response-chart';
import { SegmentBreakdown } from '@/components/email-analytics/segment-breakdown';
import { OutcomeTimeline } from '@/components/email-analytics/outcome-timeline';
import { CheckRepliesPanel } from '@/components/email-analytics/check-replies-panel';
import { AnalyzePanel } from '@/components/email-analytics/analyze-panel';

export default function EmailAnalyticsPage() {
  const router = useRouter();
  const { t } = useTranslations();
  const [stats, setStats] = useState<EmailStatsResponse | null>(null);
  const [emails, setEmails] = useState<SentEmail[]>([]);
  const [totalEmails, setTotalEmails] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    Promise.all([
      fetchEmailStats(),
      fetchEmailHistory({
        limit: EMAIL_HISTORY_PAGE_SIZE,
        offset: (page - 1) * EMAIL_HISTORY_PAGE_SIZE,
      }),
    ])
      .then(([nextStats, history]) => {
        if (!active) return;
        setStats(nextStats);
        setEmails(history.emails);
        setTotalEmails(history.total);
        // Clamp when the total shrinks below the current page (e.g. after
        // filters on the backend) so we never sit on an empty page.
        const maxPage = Math.max(1, Math.ceil(history.total / EMAIL_HISTORY_PAGE_SIZE));
        if (page > maxPage) setPage(maxPage);
      })
      .catch(() => {
        if (!active) return;
        setStats(null);
        setEmails([]);
        setTotalEmails(0);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [refreshKey, page]);

  const refresh = useCallback(() => {
    setRefreshKey((n) => n + 1);
    router.refresh();
  }, [router]);

  return (
    <div className="flex h-[100dvh] w-full flex-col overflow-hidden bg-white pl-16">
      <SidebarNav currentPage="email-analytics" onNavigate={(page) => router.push(page)} />
      <main className="flex min-h-0 w-full max-w-[104rem] flex-col overflow-y-auto">
        <div className="flex flex-col gap-6 p-6 md:p-8">
          <header className="flex items-start justify-between gap-4">
            <div className="flex flex-col gap-1">
              <h1 className="text-2xl font-bold text-ink">{t('emailAnalytics.title')}</h1>
              <p className="text-sm text-steel-grey">{t('emailAnalytics.subtitle')}</p>
            </div>
            <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
              <RefreshCw className={loading ? 'animate-spin' : undefined} />
              {t('emailAnalytics.refresh')}
            </Button>
          </header>

          {loading ? (
            <div className="flex items-center gap-2 text-sm text-steel-grey">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t('emailAnalytics.loading')}
            </div>
          ) : stats === null ? (
            <p className="text-sm text-steel-grey">{t('emailAnalytics.loadFailed')}</p>
          ) : stats.total_sent === 0 ? (
            <section className="flex flex-col items-center gap-4 rounded-2xl border border-[#e6e3dc] bg-paper-tint p-12 text-center">
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-white text-primary shadow-sw-sm">
                <MailPlus className="h-7 w-7" />
              </span>
              <div className="flex flex-col gap-1">
                <h2 className="text-lg font-bold text-ink">{t('emailAnalytics.empty.title')}</h2>
                <p className="max-w-md text-sm text-steel-grey">
                  {t('emailAnalytics.empty.description')}
                </p>
              </div>
            </section>
          ) : (
            <>
              <StatCards stats={stats} />
              <ResponseChart timeline={stats.timeline} />
              <CheckRepliesPanel />
              <SegmentBreakdown stats={stats} />
              <AnalyzePanel totalSent={stats.total_sent} />
              <OutcomeTimeline
                emails={emails}
                page={page}
                total={totalEmails}
                pageSize={EMAIL_HISTORY_PAGE_SIZE}
                onPageChange={setPage}
              />
            </>
          )}
        </div>
      </main>
    </div>
  );
}
