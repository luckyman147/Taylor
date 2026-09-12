'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';
import Pencil from 'lucide-react/dist/esm/icons/pencil';
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle';
import TrendingUp from 'lucide-react/dist/esm/icons/trending-up';
import TrendingDown from 'lucide-react/dist/esm/icons/trending-down';
import Minus from 'lucide-react/dist/esm/icons/minus';
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
import { fetchShouldApply, type ShouldApplyResponse } from '@/lib/api/job-intel';
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

  // Job analysis state
  const [analyzing, setAnalyzing] = useState(false);
  const [jobAnalysis, setJobAnalysis] = useState<ShouldApplyResponse | null>(null);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);

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

  const handleAnalyze = async () => {
    if (!detail?.job_id || analyzing) return;
    setAnalyzing(true);
    setAnalyzeError(null);
    try {
      const result = await fetchShouldApply(detail.job_id);
      setJobAnalysis(result);
    } catch (e) {
      const msg = e instanceof Error ? e.message : t('common.error');
      setAnalyzeError(msg);
    } finally {
      setAnalyzing(false);
    }
  };

  const resumeAvailable = Boolean(detail?.resume);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl p-0 gap-0 overflow-hidden flex flex-col">
        <DialogHeader className="border-b border-[#e6e3dc] bg-white p-6">
          <DialogTitle>{detail?.company || t('tracker.card.companyUnknown')}</DialogTitle>
          <DialogDescription>{detail?.role || t('tracker.card.roleUnknown')}</DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-steel-grey" />
          </div>
        ) : detail ? (
          <div className="flex-1 overflow-y-auto space-y-4 p-6">
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

        <DialogFooter className="flex-col gap-0 border-t border-[#e6e3dc] p-0">
          {/* Analysis results panel */}
          {jobAnalysis && (
            <div className="space-y-4 p-5">
              {/* Verdict header */}
              <div className="flex items-start gap-3">
                <span className={`inline-block shrink-0 px-2.5 py-1 border rounded text-sm font-bold uppercase ${
                  jobAnalysis.verdict === 'yes' ? 'bg-green-100 text-green-700 border-green-300' :
                  jobAnalysis.verdict === 'conditional' ? 'bg-yellow-100 text-yellow-700 border-yellow-300' :
                  'bg-red-100 text-red-700 border-red-300'
                }`}>
                  {jobAnalysis.verdict}
                </span>
                <p className="text-sm text-ink-soft leading-relaxed">{jobAnalysis.verdict_reason}</p>
              </div>

              {/* Metric cards grid */}
              <div className="grid grid-cols-5 gap-2">
                {[
                  { label: 'Match', value: `${jobAnalysis.match_percent}%`, color: jobAnalysis.match_percent >= 60 ? 'text-green-600' : jobAnalysis.match_percent >= 40 ? 'text-yellow-600' : 'text-red-600' },
                  { label: 'Relevance', value: `${jobAnalysis.career_relevance}%`, color: jobAnalysis.career_relevance >= 60 ? 'text-green-600' : jobAnalysis.career_relevance >= 40 ? 'text-yellow-600' : 'text-red-600' },
                  { label: 'Ghost Risk', value: `${jobAnalysis.ghost_risk_percent}%`, color: jobAnalysis.ghost_risk_percent <= 30 ? 'text-green-600' : jobAnalysis.ghost_risk_percent <= 50 ? 'text-yellow-600' : 'text-red-600' },
                  { label: 'Competition', value: jobAnalysis.competition, color: jobAnalysis.competition === 'Low' ? 'text-green-600' : jobAnalysis.competition === 'Medium' ? 'text-yellow-600' : 'text-red-600' },
                  { label: 'Salary', value: jobAnalysis.salary_potential ? `$${Math.round(jobAnalysis.salary_potential / 1000)}k` : 'N/A', color: 'text-ink' },
                ].map((m) => (
                  <div key={m.label} className="rounded-lg border border-[#e6e3dc] bg-white p-2.5 text-center">
                    <p className="text-[11px] uppercase text-ink-muted">{m.label}</p>
                    <p className={`text-base font-bold ${m.color}`}>{m.value}</p>
                  </div>
                ))}
              </div>

              {/* Missing skills */}
              {jobAnalysis.comparison?.technical?.missing?.length > 0 && (
                <div className="rounded-lg border border-orange-200 bg-orange-50 p-3">
                  <p className="mb-1.5 text-xs font-semibold text-orange-700">Missing Skills</p>
                  <div className="flex flex-wrap gap-1.5">
                    {jobAnalysis.comparison.technical.missing.map((s: { skill: string; weight: number }) => (
                      <span key={s.skill} className="inline-block rounded-full bg-orange-100 border border-orange-200 px-2 py-0.5 text-[11px] font-medium text-orange-700">
                        {s.skill}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Red flags */}
              {jobAnalysis.red_flags.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-semibold text-ink-soft">Red Flags</p>
                  {jobAnalysis.red_flags.map((rf, i) => (
                    <div key={i} className="flex items-start gap-2 rounded-lg border border-[#e6e3dc] bg-white p-2.5">
                      <AlertTriangle className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${
                        rf.severity === 'danger' ? 'text-red-500' :
                        rf.severity === 'warning' ? 'text-yellow-500' : 'text-blue-500'
                      }`} />
                      <div>
                        <p className="text-xs font-medium text-ink">{rf.flag}</p>
                        <p className="text-[11px] text-ink-muted">{rf.concern}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* LLM recommendation */}
              {jobAnalysis.recommendation && jobAnalysis.recommendation !== 'N/A' && (
                <div className="rounded-lg border border-[#e6e3dc] bg-secondary p-3">
                  <p className="mb-1 text-xs font-semibold text-ink-soft">Recommendation</p>
                  <p className="text-sm text-ink leading-relaxed">{jobAnalysis.recommendation}</p>
                  {jobAnalysis.main_weakness && jobAnalysis.main_weakness !== 'N/A' && (
                    <p className="mt-2 text-xs text-ink-muted">
                      <span className="font-medium">Key gap:</span> {jobAnalysis.main_weakness}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Footer actions */}
          <div className="flex flex-row items-center justify-end gap-3 border-t border-[#e6e3dc] bg-secondary p-4">
            <div className="flex-1">
              {analyzeError && <span className="text-xs text-destructive">{analyzeError}</span>}
            </div>
            <Button
              variant="outline"
              onClick={handleAnalyze}
              disabled={!detail?.job_id || analyzing}
            >
              {analyzing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {analyzing ? t('common.processing') : t('tailor.jobIntel.shouldApply.analyze')}
            </Button>
            <Button
              onClick={() => {
                if (detail?.resume_id) router.push(`/builder?id=${detail.resume_id}`);
              }}
              disabled={!resumeAvailable}
            >
              <Pencil className="h-4 w-4" />
              {t('tracker.modal.editResume')}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
