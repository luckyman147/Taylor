'use client';

import { useMemo, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Dropdown, type DropdownOption } from '@/components/ui/dropdown';
import { useToast } from '@/components/ui/toast';
import { useTranslations } from '@/lib/i18n';
import {
  bulkUpdateSentEmailOutcomes,
  updateSentEmailOutcome,
  type SentEmail,
  type SentEmailOutcome,
} from '@/lib/api/email';
import { cn } from '@/lib/utils';

interface OutcomeTimelineProps {
  emails: SentEmail[];
  page: number;
  total: number;
  pageSize: number;
  onPageChange: (page: number) => void;
}

const OUTCOMES: SentEmailOutcome[] = ['pending', 'responded', 'not_interested', 'bounced'];

const OUTCOME_BADGE_STYLES: Record<SentEmailOutcome, string> = {
  pending: 'bg-warning/10 text-warning border-warning/30',
  responded: 'bg-success/10 text-success border-success/30',
  not_interested: 'bg-secondary text-ink border-[#d9d5cc]',
  bounced: 'bg-destructive/10 text-destructive border-destructive/30',
};

function formatSentAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function looksLikeHtml(body: string): boolean {
  return /<[a-z][^>]*>/i.test(body);
}

export function OutcomeTimeline({
  emails,
  page,
  total,
  pageSize,
  onPageChange,
}: OutcomeTimelineProps) {
  const { t } = useTranslations();
  const { showToast } = useToast();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkOutcome, setBulkOutcome] = useState<SentEmailOutcome>('responded');
  const [bulkUpdating, setBulkUpdating] = useState(false);
  const [updatingIds, setUpdatingIds] = useState<Set<string>>(new Set());
  const [localOutcomes, setLocalOutcomes] = useState<Record<string, SentEmailOutcome>>({});
  const [viewingEmail, setViewingEmail] = useState<SentEmail | null>(null);

  const outcomeOptions: DropdownOption[] = useMemo(
    () => OUTCOMES.map((id) => ({ id, label: t(`emailAnalytics.outcomes.${id}`) })),
    [t]
  );

  // Outcome changes apply optimistically via localOutcomes — no page refetch.
  const effectiveOutcome = (email: SentEmail): SentEmailOutcome =>
    localOutcomes[email.log_id] ?? email.outcome;

  const allSelected = emails.length > 0 && selected.size === emails.length;
  const hasSelection = selected.size > 0;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const showPagination = total > pageSize;
  const rangeFrom = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const rangeTo = Math.min(page * pageSize, total);

  function goToPage(next: number) {
    if (next < 1 || next > pageCount || next === page) return;
    setSelected(new Set()); // selection never spans pages
    onPageChange(next);
  }

  function toggleSelectAll() {
    setSelected(allSelected ? new Set() : new Set(emails.map((e) => e.log_id)));
  }

  function toggleOne(logId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(logId)) next.delete(logId);
      else next.add(logId);
      return next;
    });
  }

  async function handleRowOutcome(logId: string, outcome: SentEmailOutcome) {
    setUpdatingIds((prev) => new Set(prev).add(logId));
    setLocalOutcomes((prev) => ({ ...prev, [logId]: outcome }));
    try {
      await updateSentEmailOutcome(logId, outcome);
      showToast(t('emailAnalytics.timeline.outcomeUpdated'), 'success');
    } catch (e) {
      showToast(
        e instanceof Error ? e.message : t('emailAnalytics.timeline.updateFailed'),
        'error'
      );
      setLocalOutcomes((prev) => {
        const next = { ...prev };
        delete next[logId];
        return next;
      });
    } finally {
      setUpdatingIds((prev) => {
        const next = new Set(prev);
        next.delete(logId);
        return next;
      });
    }
  }

  async function handleBulkApply() {
    const logIds = Array.from(selected);
    if (logIds.length === 0 || bulkUpdating) return;
    setBulkUpdating(true);
    try {
      const result = await bulkUpdateSentEmailOutcomes(logIds, bulkOutcome);
      showToast(t('emailAnalytics.timeline.bulkSuccess', { count: result.updated }), 'success');
      setLocalOutcomes((prev) => {
        const next = { ...prev };
        for (const id of logIds) next[id] = bulkOutcome;
        return next;
      });
      setSelected(new Set());
    } catch (e) {
      showToast(e instanceof Error ? e.message : t('emailAnalytics.timeline.bulkFailed'), 'error');
    } finally {
      setBulkUpdating(false);
    }
  }

  if (total === 0) {
    return (
      <section className="rounded-2xl border border-[#e6e3dc] bg-paper-tint p-6">
        <h2 className="text-lg font-bold text-ink">{t('emailAnalytics.timeline.title')}</h2>
        <p className="mt-2 text-sm text-steel-grey">{t('emailAnalytics.timeline.empty')}</p>
      </section>
    );
  }

  return (
    <>
      <section className="rounded-2xl border border-[#e6e3dc] bg-paper-tint p-6">
        <h2 className="text-lg font-bold text-ink">{t('emailAnalytics.timeline.title')}</h2>

        <ul className="mt-4 flex flex-col gap-2">
          <li className="flex items-center gap-3 px-2 text-xs font-semibold uppercase tracking-wide text-steel-grey">
            <Checkbox
              checked={allSelected}
              onChange={toggleSelectAll}
              aria-label={t('emailAnalytics.timeline.selectAll')}
            />
            <span className="w-6" aria-hidden="true" />
            <span className="min-w-0 flex-1">{t('emailAnalytics.timeline.recipient')}</span>
            <span className="hidden w-28 sm:block">{t('emailAnalytics.timeline.sentAt')}</span>
            <span className="w-40">{t('emailAnalytics.timeline.outcome')}</span>
          </li>
          {emails.map((email) => {
            const outcome = effectiveOutcome(email);
            const isUpdating = updatingIds.has(email.log_id);
            return (
              <li
                key={email.log_id}
                role="button"
                tabIndex={0}
                aria-label={email.recipient_email}
                onClick={() => setViewingEmail(email)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setViewingEmail(email);
                  }
                }}
                className="flex cursor-pointer items-center gap-3 rounded-xl border border-[#e6e3dc] bg-white px-2 py-2.5 transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/20"
              >
                <span className="flex shrink-0" onClick={(e) => e.stopPropagation()}>
                  <Checkbox
                    checked={selected.has(email.log_id)}
                    onChange={() => toggleOne(email.log_id)}
                    aria-label={email.recipient_email}
                  />
                </span>
                <span
                  className={cn(
                    'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[10px] font-bold uppercase',
                    OUTCOME_BADGE_STYLES[outcome]
                  )}
                  title={t(`emailAnalytics.outcomes.${outcome}`)}
                >
                  {t(`emailAnalytics.timeline.outcomeAbbrev.${outcome}`)}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-ink">
                    {email.recipient_email}
                  </span>
                  <span className="block truncate text-xs text-steel-grey">
                    {email.subject}
                    {email.company_name ? ` · ${email.company_name}` : ''}
                  </span>
                </span>
                <span className="hidden w-28 text-xs text-steel-grey sm:block">
                  {formatSentAt(email.sent_at)}
                </span>
                <span className="flex w-40 items-center gap-1" onClick={(e) => e.stopPropagation()}>
                  {isUpdating ? (
                    <Loader2 className="h-4 w-4 animate-spin text-steel-grey" />
                  ) : (
                    <Dropdown
                      options={outcomeOptions}
                      value={outcome}
                      onChange={(value) =>
                        handleRowOutcome(email.log_id, value as SentEmailOutcome)
                      }
                      ariaLabel={t('emailAnalytics.timeline.outcome')}
                      className="w-full"
                      triggerClassName="h-8 w-full rounded-lg px-2 py-0 text-xs"
                    />
                  )}
                </span>
              </li>
            );
          })}
        </ul>

        {showPagination && (
          <nav
            aria-label={t('emailAnalytics.timeline.title')}
            className="mt-4 flex flex-wrap items-center justify-between gap-3"
          >
            <span className="text-xs text-steel-grey">
              {t('emailAnalytics.timeline.showing', { from: rangeFrom, to: rangeTo, total })}
            </span>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={page <= 1}
                onClick={() => goToPage(page - 1)}
              >
                {t('emailAnalytics.timeline.prev')}
              </Button>
              <span className="text-xs font-semibold text-steel-grey">
                {page} / {pageCount}
              </span>
              <Button
                size="sm"
                variant="outline"
                disabled={page >= pageCount}
                onClick={() => goToPage(page + 1)}
              >
                {t('emailAnalytics.timeline.next')}
              </Button>
            </div>
          </nav>
        )}
      </section>

      {/* Floating bulk-action bar — slides up whenever rows are selected */}
      <div
        aria-hidden={!hasSelection}
        className={cn(
          'pointer-events-none fixed bottom-6 left-[calc(50%+2rem)] z-50 -translate-x-1/2 transition-all duration-200 ease-out',
          hasSelection ? 'translate-y-0 opacity-100' : 'translate-y-20 opacity-0'
        )}
      >
        <div
          className={cn(
            'flex items-center gap-3 rounded-full border border-[#e6e3dc] bg-white px-5 py-3 shadow-sw-xl',
            hasSelection && 'pointer-events-auto'
          )}
        >
          <span className="whitespace-nowrap text-sm font-semibold text-ink">
            {t('emailAnalytics.timeline.selectedCount', { count: selected.size })}
          </span>
          <Dropdown
            options={outcomeOptions}
            value={bulkOutcome}
            onChange={(value) => setBulkOutcome(value as SentEmailOutcome)}
            ariaLabel={t('emailAnalytics.timeline.bulkAction')}
            direction="up"
            className="w-44"
            triggerClassName="h-9 rounded-full px-3 py-0 text-sm"
          />
          <Button
            size="sm"
            className="rounded-full"
            onClick={handleBulkApply}
            disabled={bulkUpdating || !hasSelection}
          >
            {bulkUpdating && <Loader2 className="h-4 w-4 animate-spin" />}
            {t('emailAnalytics.timeline.bulkApply')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="rounded-full px-2"
            aria-label={t('emailAnalytics.timeline.clearSelection')}
            onClick={() => setSelected(new Set())}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Email body preview — opens on row click */}
      <Dialog
        open={viewingEmail !== null}
        onOpenChange={(open) => {
          if (!open) setViewingEmail(null);
        }}
      >
        <DialogContent className="max-w-2xl">
          {viewingEmail && (
            <div className="flex flex-col gap-4 p-6">
              <DialogHeader className="pr-8">
                <DialogTitle>{viewingEmail.recipient_email}</DialogTitle>
                <DialogDescription className="truncate">
                  {viewingEmail.subject}
                  {viewingEmail.company_name ? ` · ${viewingEmail.company_name}` : ''}
                </DialogDescription>
              </DialogHeader>
              <div className="flex flex-wrap items-center gap-3 text-xs text-steel-grey">
                <span>{formatSentAt(viewingEmail.sent_at)}</span>
                <span
                  className={cn(
                    'inline-flex h-6 items-center rounded-full border px-2 text-[10px] font-bold uppercase',
                    OUTCOME_BADGE_STYLES[effectiveOutcome(viewingEmail)]
                  )}
                >
                  {t(`emailAnalytics.outcomes.${effectiveOutcome(viewingEmail)}`)}
                </span>
              </div>
              {viewingEmail.body ? (
                looksLikeHtml(viewingEmail.body) ? (
                  <iframe
                    title={t('emailAnalytics.timeline.recipient')}
                    srcDoc={viewingEmail.body}
                    sandbox=""
                    className="h-[50vh] w-full rounded-xl border border-[#e6e3dc] bg-white"
                  />
                ) : (
                  <div className="h-[50vh] overflow-y-auto whitespace-pre-wrap rounded-xl border border-[#e6e3dc] bg-white px-4 py-3 text-sm leading-relaxed text-ink">
                    {viewingEmail.body}
                  </div>
                )
              ) : (
                <p className="rounded-xl border border-[#e6e3dc] bg-paper-tint px-3 py-4 text-sm text-steel-grey">
                  —
                </p>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
