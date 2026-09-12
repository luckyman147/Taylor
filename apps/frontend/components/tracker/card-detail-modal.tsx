'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';
import Pencil from 'lucide-react/dist/esm/icons/pencil';
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle';
import ShieldAlert from 'lucide-react/dist/esm/icons/shield-alert';
import CheckCircle2 from 'lucide-react/dist/esm/icons/check-circle-2';
import CircleDashed from 'lucide-react/dist/esm/icons/circle-dashed';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RetroTabs } from '@/components/ui/retro-tabs';
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

function MetricBar({ label, value, percent, color }: { label: string; value: string; percent: number; color: string }) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between">
        <span className="text-xs font-medium text-ink-soft">{label}</span>
        <span className={`text-sm font-bold tabular-nums ${color}`}>{value}</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full transition-all duration-500 ${color === 'text-green-600' ? 'bg-green-500' : color === 'text-yellow-600' ? 'bg-yellow-500' : color === 'text-red-600' ? 'bg-red-500' : 'bg-primary'}`}
          style={{ width: `${Math.min(percent, 100)}%` }}
        />
      </div>
    </div>
  );
}

function StatCard({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="rounded-lg border border-[#e6e3dc] bg-white p-3 text-center shadow-sw-xs">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-ink-muted">{label}</p>
      <p className={`mt-0.5 text-lg font-bold tabular-nums ${color}`}>{value}</p>
    </div>
  );
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

  const [activeTab, setActiveTab] = useState('details');
  const [analyzing, setAnalyzing] = useState(false);
  const [jobAnalysis, setJobAnalysis] = useState<ShouldApplyResponse | null>(null);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !applicationId) {
      setDetail(null);
      setJobAnalysis(null);
      setActiveTab('details');
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
    return () => { cancelled = true; };
  }, [open, applicationId]);

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
      setNotesError(t('common.error'));
    } finally {
      setSavingNotes(false);
    }
  };

  const handleAnalyze = async () => {
    if (!detail?.job_id || analyzing) return;
    setAnalyzing(true);
    setAnalyzeError(null);
    setActiveTab('analysis');
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

  const verdictConfig = {
    yes: { icon: CheckCircle2, color: 'text-green-600', bg: 'bg-green-50', border: 'border-green-200', label: 'Apply' },
    conditional: { icon: CircleDashed, color: 'text-yellow-600', bg: 'bg-yellow-50', border: 'border-yellow-200', label: 'Maybe' },
    no: { icon: ShieldAlert, color: 'text-red-600', bg: 'bg-red-50', border: 'border-red-200', label: 'Skip' },
  } as const;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl p-0 gap-0 overflow-hidden flex flex-col">
        {/* Header */}
        <DialogHeader className="border-b border-[#e6e3dc] bg-white px-8 py-6">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <DialogTitle className="truncate">{detail?.company || t('tracker.card.companyUnknown')}</DialogTitle>
              <DialogDescription className="mt-0.5 truncate">{detail?.role || t('tracker.card.roleUnknown')}</DialogDescription>
            </div>
            {detail && (
              <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-[#e6e3dc] bg-white px-2.5 py-1 text-xs font-semibold text-ink shadow-sw-xs">
                <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[detail.status]}`} />
                {t(`tracker.columns.${detail.status}`)}
              </span>
            )}
          </div>
        </DialogHeader>

        {/* Tabs */}
        <div className="border-b border-[#e6e3dc] bg-white px-8">
          <RetroTabs
            tabs={[
              { id: 'details', label: 'Details' },
              { id: 'analysis', label: jobAnalysis ? 'Analysis' : 'Analyze' },
            ]}
            activeTab={activeTab}
            onTabChange={(id) => {
              if (id === 'analysis' && !jobAnalysis) {
                handleAnalyze();
              } else {
                setActiveTab(id);
              }
            }}
          />
        </div>

        {/* Content */}
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-5 w-5 animate-spin text-steel-grey" />
          </div>
        ) : detail ? (
          <div className="flex-1 overflow-y-auto">
            {activeTab === 'details' ? (
              <div className="space-y-6 p-8">
                {/* Job Description */}
                <div className="space-y-1.5">
                  <Label>{t('tracker.modal.jobDescription')}</Label>
                  <div className="max-h-52 overflow-y-auto whitespace-pre-wrap rounded-xl border border-[#e6e3dc] bg-background p-5 text-sm leading-relaxed">
                    {detail.job_content || t('tracker.modal.noJobDescription')}
                  </div>
                </div>

                {/* Rejection + Interview rounds */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
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
                  <div className="space-y-1.5">
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

                {/* Notes */}
                <div className="space-y-1.5">
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
                    {notesError && <span className="text-xs text-destructive">{notesError}</span>}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleSaveNotes}
                      disabled={savingNotes}
                    >
                      {savingNotes ? <Loader2 className="h-4 w-4 animate-spin" /> : t('tracker.modal.saveNotes')}
                    </Button>
                  </div>
                </div>

                {!resumeAvailable && (
                  <p className="text-xs text-warning">{t('tracker.modal.resumeUnavailable')}</p>
                )}
              </div>
            ) : (
              /* Analysis Tab */
              <div className="p-8">
                {analyzing ? (
                  <div className="flex flex-col items-center justify-center gap-3 py-16">
                    <Loader2 className="h-6 w-6 animate-spin text-primary" />
                    <p className="text-sm text-ink-soft">Analyzing job...</p>
                  </div>
                ) : analyzeError ? (
                  <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
                    <AlertTriangle className="h-8 w-8 text-destructive" />
                    <p className="text-sm text-ink-soft">{analyzeError}</p>
                    <Button variant="outline" size="sm" onClick={handleAnalyze}>Retry</Button>
                  </div>
                ) : jobAnalysis ? (
                  <div className="space-y-6">
                    {/* Verdict hero */}
                    {(() => {
                      const vc = verdictConfig[jobAnalysis.verdict];
                      const Icon = vc.icon;
                      return (
                        <div className={`flex items-center gap-4 rounded-xl border ${vc.border} ${vc.bg} p-5`}>
                          <Icon className={`h-8 w-8 shrink-0 ${vc.color}`} />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className={`text-sm font-bold uppercase ${vc.color}`}>{vc.label}</span>
                              <span className="text-sm text-ink-muted">&mdash;</span>
                              <span className="text-sm text-ink">{jobAnalysis.verdict_reason}</span>
                            </div>
                            {jobAnalysis.main_weakness && jobAnalysis.main_weakness !== 'N/A' && (
                              <p className="mt-1 text-xs text-ink-muted">
                                Key gap: {jobAnalysis.main_weakness}
                              </p>
                            )}
                          </div>
                        </div>
                      );
                    })()}

                    {/* Progress bars */}
                    <div className="space-y-4 rounded-xl border border-[#e6e3dc] bg-white p-5 shadow-sw-xs">
                      <MetricBar label="Keyword Match" value={`${jobAnalysis.match_percent}%`} percent={jobAnalysis.match_percent} color={jobAnalysis.match_percent >= 60 ? 'text-green-600' : jobAnalysis.match_percent >= 40 ? 'text-yellow-600' : 'text-red-600'} />
                      <MetricBar label="Career Relevance" value={`${jobAnalysis.career_relevance}%`} percent={jobAnalysis.career_relevance} color={jobAnalysis.career_relevance >= 60 ? 'text-green-600' : jobAnalysis.career_relevance >= 40 ? 'text-yellow-600' : 'text-red-600'} />
                      <MetricBar label="Ghost Risk" value={`${jobAnalysis.ghost_risk_percent}%`} percent={jobAnalysis.ghost_risk_percent} color={jobAnalysis.ghost_risk_percent <= 30 ? 'text-green-600' : jobAnalysis.ghost_risk_percent <= 50 ? 'text-yellow-600' : 'text-red-600'} />
                    </div>

                    {/* Stats row */}
                    <div className="grid grid-cols-3 gap-4">
                      <StatCard label="Competition" value={jobAnalysis.competition} color={jobAnalysis.competition === 'Low' ? 'text-green-600' : jobAnalysis.competition === 'Medium' ? 'text-yellow-600' : 'text-red-600'} />
                      <StatCard label="Salary" value={jobAnalysis.salary_potential ? `$${Math.round(jobAnalysis.salary_potential / 1000)}k` : 'N/A'} color="text-ink" />
                      <StatCard label="Relevance" value={`${Math.round(jobAnalysis.career_relevance)}%`} color={jobAnalysis.career_relevance >= 60 ? 'text-green-600' : 'text-yellow-600'} />
                    </div>

                    {/* Missing skills */}
                    {jobAnalysis.comparison?.technical?.missing?.length > 0 && (
                      <div className="rounded-xl border border-orange-200 bg-orange-50/50 p-5">
                        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-orange-700">Missing Skills</p>
                        <div className="flex flex-wrap gap-1.5">
                          {jobAnalysis.comparison.technical.missing.map((s: { skill: string; weight: number }) => (
                            <span key={s.skill} className="inline-flex items-center gap-1 rounded-full border border-orange-200 bg-orange-100 px-2.5 py-0.5 text-xs font-medium text-orange-700">
                              {s.skill}
                              <span className="text-[10px] text-orange-400">&times;{s.weight}</span>
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Red flags */}
                    {jobAnalysis.red_flags.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-xs font-semibold uppercase tracking-wider text-ink-soft">Red Flags</p>
                        {jobAnalysis.red_flags.map((rf, i) => (
                          <div key={i} className="flex items-start gap-3 rounded-xl border border-[#e6e3dc] bg-white p-4 shadow-sw-xs">
                            <AlertTriangle className={`mt-0.5 h-4 w-4 shrink-0 ${
                              rf.severity === 'danger' ? 'text-red-500' :
                              rf.severity === 'warning' ? 'text-yellow-500' : 'text-blue-500'
                            }`} />
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-ink">{rf.flag}</p>
                              <p className="mt-0.5 text-xs text-ink-muted">{rf.concern}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Recommendation */}
                    {jobAnalysis.recommendation && jobAnalysis.recommendation !== 'N/A' && (
                      <div className="rounded-xl border border-[#e6e3dc] bg-secondary p-5">
                        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-ink-soft">Recommendation</p>
                        <p className="text-sm leading-relaxed text-ink">{jobAnalysis.recommendation}</p>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
                    <p className="text-sm text-ink-soft">Click &ldquo;Analyze&rdquo; to get detailed insights about this job.</p>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <p className="px-6 py-16 text-center text-sm text-steel-grey">{t('tracker.modal.loadFailed')}</p>
        )}

        {/* Footer */}
        <div className="flex shrink-0 flex-row items-center justify-end gap-3 border-t border-[#e6e3dc] bg-secondary px-8 py-5">
          <div className="flex-1" />
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
      </DialogContent>
    </Dialog>
  );
}
