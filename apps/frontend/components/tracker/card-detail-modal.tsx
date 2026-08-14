'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';
import Pencil from 'lucide-react/dist/esm/icons/pencil';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useTranslations } from '@/lib/i18n';
import { getApplicationDetail, updateApplication, type ApplicationDetail } from '@/lib/api/tracker';
import { STATUS_DOT } from './status-colors';

interface CardDetailModalProps {
  applicationId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdated: () => void;
}

export function CardDetailModal({
  applicationId,
  open,
  onOpenChange,
  onUpdated,
}: CardDetailModalProps) {
  const { t } = useTranslations();
  const router = useRouter();
  const [detail, setDetail] = useState<ApplicationDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [notes, setNotes] = useState('');
  const [rejectionReason, setRejectionReason] = useState('');
  const [interviewRounds, setInterviewRounds] = useState('');
  const [savingNotes, setSavingNotes] = useState(false);
  const [notesError, setNotesError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !applicationId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    getApplicationDetail(applicationId)
      .then((data) => {
        if (cancelled) return;
        setDetail(data);
        setNotes(data.notes ?? '');
        setRejectionReason(data.rejection_reason ?? '');
        setInterviewRounds(
          data.interview_rounds !== null && data.interview_rounds !== undefined
            ? String(data.interview_rounds)
            : ''
        );
        setNotesError(null);
      })
      .catch(() => {
        if (!cancelled) setDetail(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, applicationId]);

  // Keep textarea Enter from bubbling to dialog/global handlers.
  const handleNotesKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter') e.stopPropagation();
  };

  const handleSaveNotes = async () => {
    if (!applicationId) return;
    setSavingNotes(true);
    setNotesError(null);
    try {
      await updateApplication(applicationId, {
        notes,
        rejection_reason: rejectionReason.trim() || null,
        interview_rounds: interviewRounds.trim() === '' ? null : Number(interviewRounds),
      });
      onUpdated();
    } catch {
      // Show a generic message — never echo raw backend error text inline,
      // which could contain sensitive values.
      setNotesError(t('common.error'));
    } finally {
      setSavingNotes(false);
    }
  };

  const resumeAvailable = Boolean(detail?.resume);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl p-0 gap-0 overflow-hidden">
        <DialogHeader className="border-b border-[#e6e3dc] bg-white p-6">
          <DialogTitle>{detail?.company || t('tracker.card.companyUnknown')}</DialogTitle>
          <DialogDescription>{detail?.role || t('tracker.card.roleUnknown')}</DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-steel-grey" />
          </div>
        ) : detail ? (
          <div className="space-y-4 p-6">
            <div className="flex items-center gap-2  text-xs uppercase text-ink-soft">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-[#e6e3dc] bg-white px-2.5 py-1 font-semibold text-ink shadow-sw-xs">
                <span className={`h-2 w-2 rounded-full ${STATUS_DOT[detail.status]}`} />
                {t(`tracker.columns.${detail.status}`)}
              </span>
              {detail.applied_at && (
                <span>
                  {new Date(detail.applied_at).toLocaleDateString('en-US', {
                    month: 'short',
                    year: 'numeric',
                  })}
                </span>
              )}
            </div>

            <div className="space-y-1">
              <Label>{t('tracker.modal.jobDescription')}</Label>
              <div className="max-h-48 overflow-y-auto whitespace-pre-wrap rounded-xl border border-[#e6e3dc] bg-background p-3 text-sm">
                {detail.job_content || t('tracker.modal.noJobDescription')}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label htmlFor="card-rejection-reason">{t('tracker.modal.rejectionReason')}</Label>
                <Textarea
                  id="card-rejection-reason"
                  value={rejectionReason}
                  onChange={(e) => setRejectionReason(e.target.value)}
                  onKeyDown={handleNotesKeyDown}
                  placeholder={t('tracker.modal.rejectionReasonPlaceholder')}
                  rows={2}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="card-interview-rounds">{t('tracker.modal.interviewRounds')}</Label>
                <Input
                  id="card-interview-rounds"
                  type="number"
                  min={0}
                  value={interviewRounds}
                  onChange={(e) => setInterviewRounds(e.target.value)}
                  placeholder={t('tracker.modal.interviewRoundsPlaceholder')}
                />
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor="card-notes">{t('tracker.modal.notes')}</Label>
              <Textarea
                id="card-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                onKeyDown={handleNotesKeyDown}
                placeholder={t('tracker.modal.notesPlaceholder')}
                rows={3}
              />
              <div className="flex items-center justify-end gap-3">
                {notesError && <span className=" text-xs text-destructive">{notesError}</span>}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleSaveNotes}
                  disabled={savingNotes}
                >
                  {savingNotes ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    t('tracker.modal.saveNotes')
                  )}
                </Button>
              </div>
            </div>

            {!resumeAvailable && (
              <p className=" text-xs text-warning">{t('tracker.modal.resumeUnavailable')}</p>
            )}
          </div>
        ) : (
          <p className="px-6 py-6 text-center  text-sm text-steel-grey">
            {t('tracker.modal.loadFailed')}
          </p>
        )}

        <DialogFooter className="flex-row justify-end gap-3 border-t border-[#e6e3dc] bg-secondary p-4">
          <Button
            onClick={() => {
              if (detail?.resume_id) router.push(`/builder?id=${detail.resume_id}`);
            }}
            disabled={!resumeAvailable}
          >
            <Pencil className="h-4 w-4" />
            {t('tracker.modal.editResume')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
