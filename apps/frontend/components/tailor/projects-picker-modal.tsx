'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useTranslations } from '@/lib/i18n';
import type { ProjectSuggestion } from '@/lib/api/resume';
import { JobDnaPanel } from '@/components/tailor/job-dna-panel';
import { RedFlagsPanel } from '@/components/tailor/red-flags-panel';
import { HiringProbabilityPanel } from '@/components/tailor/hiring-probability-panel';

export const MAX_SELECTABLE_PROJECTS = 4;

interface ProjectsPickerModalProps {
  isOpen: boolean;
  isFetching: boolean;
  isTailoring: boolean;
  suggestions: ProjectSuggestion[];
  errorMessage?: string | null;
  jobId?: string | null;
  onClose: () => void;
  onTailor: (selectedNames: string[]) => void;
  onKeepCurrent: () => void;
}

export function ProjectsPickerModal({
  isOpen,
  isFetching,
  isTailoring,
  suggestions,
  errorMessage,
  jobId,
  onClose,
  onTailor,
  onKeepCurrent,
}: ProjectsPickerModalProps) {
  const { t } = useTranslations();
  // Default to keeping the current Projects section. Replacing it is an
  // explicit opt-in: the user must switch to "choose" and select projects.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<'keep' | 'choose'>('keep');

  useEffect(() => {
    if (isOpen) {
      setMode('keep');
      setSelected(new Set());
    }
  }, [isOpen, suggestions]);

  const toggle = (name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else if (next.size < MAX_SELECTABLE_PROJECTS) {
        next.add(name);
      }
      return next;
    });
  };

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open && !isTailoring) {
          onClose();
        }
      }}
    >
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col p-0 gap-0">
        <DialogHeader className="border-b border-[#e6e3dc] px-6 py-5">
          <DialogTitle className="font-sans text-2xl font-bold uppercase tracking-tight">
            {t('tailor.projectsPicker.title')}
          </DialogTitle>
          <p className="mt-1 text-xs text-ink-soft">{t('tailor.projectsPicker.subtitle')}</p>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          <div
            role="radiogroup"
            aria-label={t('tailor.projectsPicker.title')}
            className="mb-4 grid gap-2 sm:grid-cols-2"
          >
            <button
              type="button"
              role="radio"
              aria-checked={mode === 'keep'}
              disabled={isFetching || isTailoring}
              onClick={() => setMode('keep')}
              className={`rounded-xl border p-4 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                mode === 'keep'
                  ? 'border-primary bg-primary/5'
                  : 'border-[#e6e3dc] hover:border-primary/60'
              }`}
            >
              <span className="block text-sm font-bold text-ink">
                {t('tailor.projectsPicker.modeKeep')}
              </span>
              <span className="mt-0.5 block text-xs text-ink-soft">
                {t('tailor.projectsPicker.modeKeepHint')}
              </span>
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={mode === 'choose'}
              disabled={isFetching || isTailoring}
              onClick={() => setMode('choose')}
              className={`rounded-xl border p-4 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
                mode === 'choose'
                  ? 'border-primary bg-primary/5'
                  : 'border-[#e6e3dc] hover:border-primary/60'
              }`}
            >
              <span className="block text-sm font-bold text-ink">
                {t('tailor.projectsPicker.modeChoose')}
              </span>
              <span className="mt-0.5 block text-xs text-ink-soft">
                {t('tailor.projectsPicker.modeChooseHint')}
              </span>
            </button>
          </div>

          <HiringProbabilityPanel jobId={isOpen ? jobId : null} />
          <JobDnaPanel jobId={isOpen ? jobId : null} />
          <RedFlagsPanel jobId={isOpen ? jobId : null} />

          {mode === 'keep' ? (
            <div className="rounded-xl border border-[#e6e3dc] bg-[#faf9f7] p-4 text-xs text-ink-soft">
              {t('tailor.projectsPicker.keepNote')}
            </div>
          ) : isFetching ? (
            <div className="flex items-center justify-center gap-2 py-12 text-xs text-ink-soft">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t('common.processing')}
            </div>
          ) : (
            <div className="space-y-3">
              {suggestions.map((suggestion) => {
                const isChecked = selected.has(suggestion.name);
                const atLimit = !isChecked && selected.size >= MAX_SELECTABLE_PROJECTS;
                return (
                  <button
                    key={suggestion.name}
                    type="button"
                    disabled={atLimit || isTailoring}
                    onClick={() => toggle(suggestion.name)}
                    className={`w-full rounded-xl border p-4 text-left transition-colors ${
                      isChecked
                        ? 'border-primary bg-primary/5'
                        : atLimit
                          ? 'cursor-not-allowed border-[#e6e3dc] opacity-60'
                          : 'border-[#e6e3dc] hover:border-primary/60'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-bold text-ink">{suggestion.name}</span>
                          {suggestion.already_in_resume && (
                            <span className="rounded-full border border-[#e6e3dc] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-ink-soft">
                              {t('tailor.projectsPicker.inResume')}
                            </span>
                          )}
                        </div>
                        {suggestion.role && (
                          <p className="mt-0.5 text-xs text-ink-soft">
                            {suggestion.role}
                            {suggestion.years ? ` · ${suggestion.years}` : ''}
                          </p>
                        )}
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        <span className="rounded-full bg-[#f6f4ee] px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-ink-soft">
                          {t('tailor.projectsPicker.matchScore')} {suggestion.score}
                        </span>
                        <span
                          className={`flex h-5 w-5 items-center justify-center rounded-md border ${
                            isChecked
                              ? 'border-primary bg-primary text-white'
                              : 'border-[#c9c5bc] bg-white'
                          }`}
                        >
                          {isChecked && (
                            <svg
                              className="h-3 w-3"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="3"
                            >
                              <path
                                d="M20 6L9 17l-5-5"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          )}
                        </span>
                      </div>
                    </div>

                    {suggestion.description.length > 0 ? (
                      <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-ink">
                        {suggestion.description.map((bullet) => (
                          <li key={bullet}>{bullet}</li>
                        ))}
                      </ul>
                    ) : (
                      <p className="mt-2 flex items-center gap-1.5 text-xs text-amber-700">
                        <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                        {t('tailor.projectsPicker.noDescription')}
                      </p>
                    )}
                  </button>
                );
              })}

              <p className="pt-1 text-center text-[11px] text-ink-soft">
                {t('tailor.projectsPicker.selectHint', { count: MAX_SELECTABLE_PROJECTS })}
              </p>
            </div>
          )}
        </div>

        {errorMessage && (
          <div className="flex items-start gap-2 border-t border-[#eec2c2] bg-[#fdf3f2] px-6 py-3 text-xs text-red-700">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {errorMessage}
          </div>
        )}

        <div className="flex items-center justify-end gap-2 border-t border-[#e6e3dc] px-6 py-4">
          <Button
            variant="ghost"
            onClick={onClose}
            disabled={isFetching || isTailoring}
            className="text-xs"
          >
            {t('common.cancel')}
          </Button>
          {mode === 'keep' ? (
            <Button
              onClick={onKeepCurrent}
              disabled={isFetching || isTailoring}
              className="text-xs"
            >
              {isTailoring ? (
                <>
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  {t('common.processing')}
                </>
              ) : (
                t('tailor.projectsPicker.tailorWithCurrent')
              )}
            </Button>
          ) : (
            <Button
              onClick={() => onTailor(Array.from(selected))}
              disabled={isFetching || isTailoring || selected.size === 0}
              className="text-xs"
            >
              {isTailoring ? (
                <>
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  {t('common.processing')}
                </>
              ) : (
                t('tailor.projectsPicker.tailorWithSelection')
              )}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
