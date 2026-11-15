'use client';

import { useState } from 'react';
import { Loader2, MailQuestion, Reply } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { useTranslations } from '@/lib/i18n';
import { checkEmailReplies, updateSentEmailOutcome, type ReplyCandidate } from '@/lib/api/email';

interface CheckRepliesPanelProps {
  onChecked?: () => void;
}

export function CheckRepliesPanel({ onChecked }: CheckRepliesPanelProps) {
  const { t } = useTranslations();
  const { showToast } = useToast();
  const [checking, setChecking] = useState(false);
  const [checkedCount, setCheckedCount] = useState<number | null>(null);
  const [candidates, setCandidates] = useState<ReplyCandidate[]>([]);
  const [unavailableReason, setUnavailableReason] = useState<string | null>(null);
  const [confirmingIds, setConfirmingIds] = useState<Set<string>>(new Set());

  async function handleCheck() {
    if (checking) return;
    setChecking(true);
    try {
      const result = await checkEmailReplies();
      setCheckedCount(result.checked);
      setCandidates(result.candidates);
      setUnavailableReason(result.unavailable_reason);
      onChecked?.();
    } catch (e) {
      showToast(e instanceof Error ? e.message : t('emailAnalytics.checkReplies.failed'), 'error');
    } finally {
      setChecking(false);
    }
  }

  async function handleConfirm(candidate: ReplyCandidate) {
    setConfirmingIds((prev) => new Set(prev).add(candidate.log_id));
    try {
      await updateSentEmailOutcome(candidate.log_id, 'responded');
      setCandidates((prev) => prev.filter((c) => c.log_id !== candidate.log_id));
      showToast(t('emailAnalytics.checkReplies.confirmed'), 'success');
    } catch (e) {
      showToast(
        e instanceof Error ? e.message : t('emailAnalytics.checkReplies.confirmFailed'),
        'error'
      );
    } finally {
      setConfirmingIds((prev) => {
        const next = new Set(prev);
        next.delete(candidate.log_id);
        return next;
      });
    }
  }

  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-[#e6e3dc] bg-paper-tint p-6">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-primary shadow-sw-sm">
          <MailQuestion className="h-5 w-5" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h2 className="text-lg font-bold text-ink">{t('emailAnalytics.checkReplies.title')}</h2>
          <p className="text-sm text-steel-grey">{t('emailAnalytics.checkReplies.description')}</p>
        </div>
      </div>

      <Button onClick={handleCheck} disabled={checking} className="self-start">
        {checking && <Loader2 className="h-4 w-4 animate-spin" />}
        {checking
          ? t('emailAnalytics.checkReplies.checking')
          : t('emailAnalytics.checkReplies.button')}
      </Button>

      {unavailableReason && (
        <p className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-ink">
          {unavailableReason}
        </p>
      )}

      {checkedCount !== null && !unavailableReason && (
        <p className="text-sm text-steel-grey">
          {candidates.length === 0
            ? t('emailAnalytics.checkReplies.none')
            : t('emailAnalytics.checkReplies.result', { count: checkedCount })}
        </p>
      )}

      {candidates.length > 0 && (
        <ul className="flex flex-col gap-2">
          {candidates.map((candidate) => {
            const isConfirming = confirmingIds.has(candidate.log_id);
            return (
              <li
                key={candidate.log_id}
                className="flex flex-col gap-2 rounded-xl border border-[#e6e3dc] bg-white p-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-semibold text-ink">
                    {candidate.recipient_email}
                    {candidate.company_name ? ` · ${candidate.company_name}` : ''}
                  </span>
                  <Button
                    size="sm"
                    variant="success"
                    onClick={() => handleConfirm(candidate)}
                    disabled={isConfirming}
                  >
                    {isConfirming ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Reply className="h-4 w-4" />
                    )}
                    {t('emailAnalytics.checkReplies.confirm')}
                  </Button>
                </div>
                <div className="flex flex-col gap-0.5 text-xs text-steel-grey">
                  <span className="truncate">
                    <span className="font-semibold text-ink">
                      {t('emailAnalytics.checkReplies.sentSubject')}:
                    </span>{' '}
                    {candidate.sent_subject}
                  </span>
                  <span className="truncate">
                    <span className="font-semibold text-ink">
                      {t('emailAnalytics.checkReplies.matchedSubject')}:
                    </span>{' '}
                    {candidate.matched.subject}
                  </span>
                  <span className="truncate">
                    <span className="font-semibold text-ink">
                      {t('emailAnalytics.checkReplies.from')}:
                    </span>{' '}
                    {candidate.matched.sender}
                  </span>
                  {candidate.matched.snippet && (
                    <p className="mt-1 whitespace-pre-wrap rounded-lg bg-paper-tint px-2 py-1.5 text-ink">
                      {candidate.matched.snippet}
                    </p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
