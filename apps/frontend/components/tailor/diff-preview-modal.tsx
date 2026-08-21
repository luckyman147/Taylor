'use client';

import { useState, useEffect, useRef } from 'react';
import { AlertTriangle, CheckCircle, X, ChevronDown, ChevronRight, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useTranslations } from '@/lib/i18n';
import type {
  ResumeDiffSummary,
  ResumeFieldDiff,
} from '@/components/common/resume_previewer_context';
import type { RecruiterRecommendation } from '@/lib/api/resume';
import type { ShouldApplyResponse } from '@/lib/api/job-intel';

interface DiffPreviewModalProps {
  isOpen: boolean;
  isConfirming?: boolean;
  onClose: () => void;
  onReject: () => void;
  onConfirm: () => void;
  diffSummary?: ResumeDiffSummary;
  detailedChanges?: ResumeFieldDiff[];
  errorMessage?: string;
  shouldApply?: ShouldApplyResponse;
  recommendations?: RecruiterRecommendation[];
  isGeneratingRecommendations?: boolean;
  recommendationsError?: string | null;
  onRecommendationAction?: (id: string, action: 'accept' | 'reject' | 'apply') => void;
  onRegenerateRecommendations?: (rejectedIds: string[]) => void;
}

export function DiffPreviewModal({
  isOpen,
  isConfirming = false,
  onClose,
  onReject,
  onConfirm,
  diffSummary,
  detailedChanges,
  errorMessage,
  shouldApply,
  recommendations,
  isGeneratingRecommendations = false,
  recommendationsError,
  onRecommendationAction,
  onRegenerateRecommendations,
}: DiffPreviewModalProps) {
  const { t } = useTranslations();
  const [expandedSections, setExpandedSections] = useState<Set<string>>(
    new Set(['summary', 'skills', 'descriptions', 'experience'])
  );

  // Recommendation action states
  const [recStatuses, setRecStatuses] = useState<Record<string, 'accepted' | 'rejected' | 'applied'>>({});

  const handleRecAction = (id: string, action: 'accept' | 'reject' | 'apply') => {
    setRecStatuses((prev) => ({ ...prev, [id]: action === 'accept' ? 'accepted' : action === 'reject' ? 'rejected' : 'applied' }));
    onRecommendationAction?.(id, action);
  };

  const rejectedIds = Object.entries(recStatuses)
    .filter(([, s]) => s === 'rejected')
    .map(([id]) => id);

  // Elapsed timer while confirming
  const [elapsed, setElapsed] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (isConfirming) {
      setElapsed(0);
      intervalRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);
    } else {
      if (intervalRef.current) clearInterval(intervalRef.current);
      setElapsed(0);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isConfirming]);

  if (!diffSummary || !detailedChanges) {
    return (
      <Dialog
        open={isOpen}
        onOpenChange={(open) => {
          if (!open && !isConfirming) {
            onClose();
          }
        }}
      >
        <DialogContent className="max-w-5xl max-h-[90vh] overflow-hidden flex flex-col p-6">
          <DialogHeader className="border-b border-[#e6e3dc] pb-4 bg-white -mx-6 -mt-6 px-6 pt-6">
            <DialogTitle className="font-sans text-2xl font-bold uppercase tracking-tight">
              {t('tailor.missingDiffDialog.title')}
            </DialogTitle>
          </DialogHeader>

          <div className="mt-6 border border-[#e6e3dc] bg-white p-4  text-xs text-ink-soft">
            {t('tailor.missingDiffDialog.description')}
          </div>
          <div className="mt-3 flex items-center gap-2  text-xs text-amber-700">
            <AlertTriangle className="w-4 h-4" />
            <span>{t('tailor.missingDiffDialog.confirmLabel')}</span>
          </div>

          <div className="flex justify-end items-center gap-3 pt-4 border-t border-[#e6e3dc] bg-white -mx-6 -mb-6 px-6 py-4">
            <Button variant="outline" onClick={onClose} disabled={isConfirming} className="gap-2">
              {t('common.cancel')}
            </Button>
            <Button variant="warning" onClick={onConfirm} disabled={isConfirming} className="gap-2">
              {isConfirming ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {t('common.saving')}
                </>
              ) : (
                t('tailor.missingDiffDialog.confirmLabel')
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  const toggleSection = (section: string) => {
    const newExpanded = new Set(expandedSections);
    if (newExpanded.has(section)) {
      newExpanded.delete(section);
    } else {
      newExpanded.add(section);
    }
    setExpandedSections(newExpanded);
  };

  // Group changes by type
  const summaryChanges = detailedChanges.filter((c) => c.field_type === 'summary');
  const skillChanges = detailedChanges.filter((c) => c.field_type === 'skill');
  const descChanges = detailedChanges.filter((c) => c.field_type === 'description');
  const certChanges = detailedChanges.filter((c) => c.field_type === 'certification');
  const experienceChanges = detailedChanges.filter((c) => c.field_type === 'experience');
  const educationChanges = detailedChanges.filter((c) => c.field_type === 'education');
  const projectChanges = detailedChanges.filter((c) => c.field_type === 'project');
  const languageChanges = detailedChanges.filter((c) => c.field_type === 'language');
  const awardChanges = detailedChanges.filter((c) => c.field_type === 'award');

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open && !isConfirming) {
          onClose();
        }
      }}
    >
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-hidden flex flex-col p-6">
        <DialogHeader className="border-b border-[#e6e3dc] pb-4 bg-white -mx-6 -mt-6 px-6 pt-6">
          <DialogTitle className="font-sans text-2xl font-bold uppercase tracking-tight">
            {t('tailor.diffModal.title')}
          </DialogTitle>
          <p className=" text-xs text-ink-soft mt-2">
            {'// '}
            {t('tailor.diffModal.subtitle')}
          </p>
        </DialogHeader>

        {/* Summary cards */}
        <div className="border border-[#e6e3dc] bg-white p-4 mt-4">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-3 h-3 bg-primary"></div>
            <h3 className=" text-sm font-bold uppercase tracking-wider">
              {t('tailor.diffModal.summary')}
            </h3>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
            <StatCard
              label={t('tailor.diffModal.skillsAdded')}
              value={diffSummary.skills_added}
              variant="success"
            />
            <StatCard
              label={t('tailor.diffModal.skillsRemoved')}
              value={diffSummary.skills_removed}
              variant="warning"
            />
            <StatCard
              label={t('tailor.diffModal.certificationsAdded')}
              value={diffSummary.certifications_added}
              variant="info"
            />
            <StatCard
              label={t('tailor.diffModal.descriptionsModified')}
              value={diffSummary.descriptions_modified}
              variant="info"
            />
            <StatCard
              label={t('tailor.diffModal.highRiskChanges')}
              value={diffSummary.high_risk_changes}
              variant={diffSummary.high_risk_changes > 0 ? 'danger' : 'success'}
            />
          </div>

          {diffSummary.high_risk_changes > 0 && (
            <div className="mt-4 border-2 border-warning bg-[#FFF7ED] p-3 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-warning shrink-0 mt-0.5" />
              <div>
                <p className=" text-xs font-bold uppercase text-[#C2410C]">
                  {t('tailor.diffModal.warningTitle', {
                    count: diffSummary.high_risk_changes,
                  })}
                </p>
                <p className=" text-xs text-[#C2410C] mt-1">
                  {t('tailor.diffModal.warningMessage')}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Should I Apply? compact bar */}
        {shouldApply && (
          <div className="border border-[#e6e3dc] bg-white p-3 mt-3 flex items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-ink-soft">
                {t('tailor.jobIntel.shouldApply.title')}
              </span>
              <span className={`text-[10px] font-bold uppercase px-2 py-0.5 border rounded ${
                shouldApply.verdict === 'yes' ? 'bg-green-100 text-green-700 border-green-300' :
                shouldApply.verdict === 'conditional' ? 'bg-yellow-100 text-yellow-700 border-yellow-300' :
                'bg-red-100 text-red-700 border-red-300'
              }`}>
                {shouldApply.verdict === 'yes' ? t('tailor.jobIntel.shouldApply.verdictYes') :
                 shouldApply.verdict === 'conditional' ? t('tailor.jobIntel.shouldApply.verdictConditional') :
                 t('tailor.jobIntel.shouldApply.verdictNo')}
              </span>
            </div>
            <div className="flex items-center gap-4 text-xs">
              <span className="font-bold">{shouldApply.match_percent}% {t('tailor.jobIntel.shouldApply.matchPercent')}</span>
              <span className="text-ink-soft">{shouldApply.verdict_reason}</span>
            </div>
            {shouldApply.ghost_risk_percent >= 30 && (
              <span className={`ml-auto text-[10px] font-bold px-2 py-0.5 border rounded ${
                shouldApply.ghost_risk_percent >= 60 ? 'bg-red-100 text-red-700 border-red-300' : 'bg-yellow-100 text-yellow-700 border-yellow-300'
              }`}>
                {shouldApply.ghost_risk_percent}% {t('tailor.jobIntel.redFlags.ghostRisk')}
              </span>
            )}
          </div>
        )}

        {errorMessage && (
          <div className="mt-4 border-2 border-red-600 bg-[#fdf3f2] p-3  text-xs text-red-700">
            {errorMessage}
          </div>
        )}

        {/* Recruiter Recommendations */}
        {(recommendations && recommendations.length > 0) || isGeneratingRecommendations || recommendationsError ? (
          <ChangeSection
            title={t('tailor.jobIntel.recommendations.title')}
            count={recommendations?.length ?? 0}
            isExpanded={expandedSections.has('recommendations')}
            onToggle={() => toggleSection('recommendations')}
          >
            {isGeneratingRecommendations ? (
              <div className="space-y-2">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="p-3 border border-[#e6e3dc] animate-pulse">
                    <div className="h-4 bg-gray-200 rounded w-1/3 mb-2" />
                    <div className="h-3 bg-gray-100 rounded w-2/3 mb-1" />
                    <div className="h-3 bg-gray-100 rounded w-1/2" />
                  </div>
                ))}
              </div>
            ) : recommendationsError ? (
              <div className="p-3 border border-red-200 bg-red-50 text-xs text-red-700">
                {recommendationsError}
              </div>
            ) : (
              <div className="space-y-3">
                {recommendations?.map((rec) => {
                  const status = recStatuses[rec.id];
                  return (
                    <div
                      key={rec.id}
                      className={`p-3 border border-[#e6e3dc] ${
                        status === 'accepted'
                          ? 'bg-green-50 border-green-200'
                          : status === 'rejected'
                            ? 'opacity-50 line-through'
                            : status === 'applied'
                              ? 'bg-blue-50 border-blue-200'
                              : 'bg-white'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1">
                          <p className="text-xs font-bold">{rec.title}</p>
                          <p className="text-[10px] text-ink-soft mt-0.5">{rec.detail}</p>
                          <p className="text-[10px] text-primary mt-0.5">{rec.impact}</p>
                          {rec.change && (
                            <div className="mt-1.5 p-2 bg-gray-50 border border-[#e6e3dc] text-[10px] text-ink-soft">
                              <span className="font-mono">{rec.change.path}</span>
                              {rec.change.before && (
                                <span className="ml-2 line-through text-red-600">{rec.change.before}</span>
                              )}
                              {rec.change.after && (
                                <span className="ml-2 text-green-700">{rec.change.after}</span>
                              )}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          {status && (
                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                              status === 'accepted' ? 'bg-green-100 text-green-700' :
                              status === 'rejected' ? 'bg-red-100 text-red-700' :
                              'bg-blue-100 text-blue-700'
                            }`}>
                              {status === 'accepted' ? t('tailor.jobIntel.recommendations.accepted') :
                               status === 'rejected' ? t('tailor.jobIntel.recommendations.rejected') :
                               t('tailor.jobIntel.recommendations.applied')}
                            </span>
                          )}
                          {!status && (
                            <>
                              <button
                                onClick={() => handleRecAction(rec.id, 'accept')}
                                className="p-1 bg-green-100 text-green-700 hover:bg-green-200 rounded text-[10px] font-bold"
                                title={t('tailor.jobIntel.recommendations.accept')}
                              >
                                <CheckCircle className="w-3 h-3" />
                              </button>
                              <button
                                onClick={() => handleRecAction(rec.id, 'reject')}
                                className="p-1 bg-red-100 text-red-700 hover:bg-red-200 rounded text-[10px] font-bold"
                                title={t('tailor.jobIntel.recommendations.reject')}
                              >
                                <X className="w-3 h-3" />
                              </button>
                              <button
                                onClick={() => handleRecAction(rec.id, 'apply')}
                                className="p-1 bg-blue-100 text-blue-700 hover:bg-blue-200 rounded text-[10px] font-bold"
                                title={t('tailor.jobIntel.recommendations.apply')}
                              >
                                <CheckCircle className="w-3 h-3" />
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
                {rejectedIds.length > 0 && onRegenerateRecommendations && (
                  <button
                    onClick={() => onRegenerateRecommendations(rejectedIds)}
                    className="w-full p-2 border border-[#e6e3dc] bg-paper-tint text-xs font-bold uppercase tracking-wider text-ink-soft hover:bg-gray-100"
                  >
                    {t('tailor.jobIntel.recommendations.regenerate')}
                  </button>
                )}
              </div>
            )}
          </ChangeSection>
        ) : null}

        {/* Detailed changes list */}
        <div className="flex-1 min-h-0 overflow-y-auto mt-4 space-y-4">
          {/* Summary changes */}
          {summaryChanges.length > 0 && (
            <ChangeSection
              title={t('tailor.diffModal.summaryChanges')}
              count={summaryChanges.length}
              isExpanded={expandedSections.has('summary')}
              onToggle={() => toggleSection('summary')}
            >
              {summaryChanges.map((change, idx) => (
                <ChangeItem key={idx} change={change} />
              ))}
            </ChangeSection>
          )}

          {/* Skill changes */}
          {skillChanges.length > 0 && (
            <ChangeSection
              title={t('tailor.diffModal.skillChanges')}
              count={skillChanges.length}
              isExpanded={expandedSections.has('skills')}
              onToggle={() => toggleSection('skills')}
            >
              {skillChanges.map((change, idx) => (
                <ChangeItem key={idx} change={change} />
              ))}
            </ChangeSection>
          )}

          {/* Experience changes */}
          {experienceChanges.length > 0 && (
            <ChangeSection
              title={t('tailor.diffModal.experienceChanges')}
              count={experienceChanges.length}
              isExpanded={expandedSections.has('experience')}
              onToggle={() => toggleSection('experience')}
            >
              {experienceChanges.map((change, idx) => (
                <ChangeItem key={idx} change={change} />
              ))}
            </ChangeSection>
          )}

          {/* Description changes */}
          {descChanges.length > 0 && (
            <ChangeSection
              title={t('tailor.diffModal.descriptionChanges')}
              count={descChanges.length}
              isExpanded={expandedSections.has('descriptions')}
              onToggle={() => toggleSection('descriptions')}
            >
              {descChanges.map((change, idx) => (
                <ChangeItem key={idx} change={change} />
              ))}
            </ChangeSection>
          )}

          {/* Education changes */}
          {educationChanges.length > 0 && (
            <ChangeSection
              title={t('tailor.diffModal.educationChanges')}
              count={educationChanges.length}
              isExpanded={expandedSections.has('education')}
              onToggle={() => toggleSection('education')}
            >
              {educationChanges.map((change, idx) => (
                <ChangeItem key={idx} change={change} />
              ))}
            </ChangeSection>
          )}

          {/* Project changes */}
          {projectChanges.length > 0 && (
            <ChangeSection
              title={t('tailor.diffModal.projectChanges')}
              count={projectChanges.length}
              isExpanded={expandedSections.has('project')}
              onToggle={() => toggleSection('project')}
            >
              {projectChanges.map((change, idx) => (
                <ChangeItem key={idx} change={change} />
              ))}
            </ChangeSection>
          )}

          {/* Certification changes */}
          {certChanges.length > 0 && (
            <ChangeSection
              title={t('tailor.diffModal.certificationChanges')}
              count={certChanges.length}
              isExpanded={expandedSections.has('certifications')}
              onToggle={() => toggleSection('certifications')}
            >
              {certChanges.map((change, idx) => (
                <ChangeItem key={idx} change={change} />
              ))}
            </ChangeSection>
          )}

          {/* Language changes */}
          {languageChanges.length > 0 && (
            <ChangeSection
              title={t('tailor.diffModal.languageChanges')}
              count={languageChanges.length}
              isExpanded={expandedSections.has('languages')}
              onToggle={() => toggleSection('languages')}
            >
              {languageChanges.map((change, idx) => (
                <ChangeItem key={idx} change={change} />
              ))}
            </ChangeSection>
          )}

          {/* Award changes */}
          {awardChanges.length > 0 && (
            <ChangeSection
              title={t('tailor.diffModal.awardChanges')}
              count={awardChanges.length}
              isExpanded={expandedSections.has('awards')}
              onToggle={() => toggleSection('awards')}
            >
              {awardChanges.map((change, idx) => (
                <ChangeItem key={idx} change={change} />
              ))}
            </ChangeSection>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex justify-between items-center pt-4 border-t border-[#e6e3dc] bg-white -mx-6 -mb-6 px-6 py-4">
          <Button variant="outline" onClick={onReject} disabled={isConfirming} className="gap-2">
            <X className="w-4 h-4" />
            {t('tailor.diffModal.rejectButton')}
          </Button>
          <div className="flex items-center gap-3">
            {isConfirming && elapsed > 0 && (
              <span className=" text-xs text-steel-grey">{elapsed}s</span>
            )}
            <Button
              onClick={onConfirm}
              disabled={isConfirming}
              className="gap-2 bg-success hover:bg-green-800"
            >
              {isConfirming ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {t('common.saving')}
                </>
              ) : (
                <>
                  <CheckCircle className="w-4 h-4" />
                  {t('tailor.diffModal.confirmButton')}
                </>
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Helper component: stat card
interface StatCardProps {
  label: string;
  value: number;
  variant: 'success' | 'warning' | 'danger' | 'info';
}

function StatCard({ label, value, variant }: StatCardProps) {
  const colors = {
    success: 'border-success bg-[#F0FDF4] text-success',
    warning: 'border-warning bg-[#FFF7ED] text-warning',
    danger: 'border-destructive bg-[#FEF2F2] text-destructive',
    info: 'border-primary bg-[#EFF6FF] text-primary',
  };

  return (
    <div className={`border-2 p-3 ${colors[variant]}`}>
      <div className=" text-2xl font-bold">{value}</div>
      <div className=" text-xs uppercase tracking-wider mt-1">{label}</div>
    </div>
  );
}

// Helper component: collapsible change section
interface ChangeSectionProps {
  title: string;
  count: number;
  isExpanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

function ChangeSection({ title, count, isExpanded, onToggle, children }: ChangeSectionProps) {
  return (
    <div className="border border-[#e6e3dc] bg-white">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between p-3 hover:bg-paper-tint"
      >
        <div className="flex items-center gap-2">
          {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
          <span className=" text-sm font-bold uppercase tracking-wider">
            {title} ({count})
          </span>
        </div>
      </button>

      {isExpanded && <div className="border-t border-[#e6e3dc] p-4 space-y-3">{children}</div>}
    </div>
  );
}

// Helper component: change item
interface ChangeItemProps {
  change: ResumeFieldDiff;
}

function ChangeItem({ change }: ChangeItemProps) {
  // Background tint + leading glyph instead of left-stripe borders.
  // Side-stripe borders are an impeccable absolute_ban (BAN 1) — the most
  // overused dashboard "design touch". The leading +/-/~ glyph carries the
  // semantic load and the bg tint reinforces it.
  const typeBackgrounds = {
    added: 'bg-[#F0FDF4]',
    removed: 'bg-[#FEF2F2]',
    modified: 'bg-[#EFF6FF]',
  };

  const typeGlyphColors = {
    added: 'text-success',
    removed: 'text-destructive',
    modified: 'text-primary',
  };

  const typeLabels = {
    added: '+',
    removed: '-',
    modified: '~',
  };

  return (
    <div className={`p-3 border border-[#e6e3dc] ${typeBackgrounds[change.change_type]}`}>
      <div className="flex items-start gap-2">
        <span
          className={` text-base font-bold uppercase tracking-wider ${typeGlyphColors[change.change_type]}`}
          aria-hidden="true"
        >
          {typeLabels[change.change_type]}
        </span>
        <div className="flex-1">
          {change.original_value && (
            <div className="line-through text-destructive  text-sm mb-1">
              {change.original_value}
            </div>
          )}
          {change.new_value && <div className="text-ink-soft  text-sm">{change.new_value}</div>}
        </div>
        {change.change_type === 'added' && change.confidence === 'high' && (
          <AlertTriangle className="w-4 h-4 text-warning shrink-0" />
        )}
      </div>
    </div>
  );
}
