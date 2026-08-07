'use client';

import type { KeyboardEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useTranslations } from '@/lib/i18n';
import type { ResumeWizardProgress, ResumeWizardStep } from '@/lib/api/resume-wizard';

interface QuestionCardProps {
  step: ResumeWizardStep;
  question: string;
  sectionLabel: string;
  progress: ResumeWizardProgress;
  answer: string;
  onAnswerChange: (value: string) => void;
  canGoBack: boolean;
  isBusy: boolean;
  onContinue: () => void;
  onSkip: () => void;
  onBack: () => void;
  onReview: () => void;
  onFinalize: () => void;
  onKeepAdding: () => void;
  warnings: string[];
  /** AI's "you have enough to finish" signal — surfaces a ready hint on question steps. */
  isComplete?: boolean;
  /** Whether the draft can be finalized (e.g. has a name); gates the Create button. */
  canFinalize?: boolean;
}

export function QuestionCard({
  step,
  question,
  sectionLabel,
  progress,
  answer,
  onAnswerChange,
  canGoBack,
  isBusy,
  onContinue,
  onSkip,
  onBack,
  onReview,
  onFinalize,
  onKeepAdding,
  warnings,
  isComplete = false,
  canFinalize = true,
}: QuestionCardProps) {
  const { t } = useTranslations();
  const isReview = step === 'review';
  const isQuestion = step === 'question';
  const canContinue = answer.trim().length > 0 && !isBusy;
  const totalSegments = Math.max(progress.total, 1);

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Repo pattern: never let Enter bubble to a parent form/dialog.
    if (event.key !== 'Enter') return;
    event.stopPropagation();
    // Enter submits, Shift+Enter inserts a newline.
    if (!event.shiftKey) {
      event.preventDefault();
      if (canContinue) onContinue();
    }
  };

  return (
    <section className="rounded-2xl border border-[#e6e3dc] bg-white shadow-sw-xs">
      <div
        className="flex gap-1 border-b border-[#e6e3dc] p-2"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={totalSegments}
        aria-valuenow={progress.current}
      >
        {Array.from({ length: totalSegments }).map((_, index) => (
          <span
            key={index}
            className={
              index < progress.current
                ? 'h-1.5 flex-1 rounded-full bg-primary'
                : 'h-1.5 flex-1 rounded-full bg-[#efece4]'
            }
          />
        ))}
      </div>

      <div className="grid gap-6 p-5 md:p-8">
        <p className="inline-flex w-fit items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs font-bold uppercase tracking-wider text-primary">
          {sectionLabel}
        </p>
        <h2 className="text-2xl font-bold tracking-tight text-ink md:text-3xl">{question}</h2>

        {isReview ? (
          warnings.length > 0 && (
            <ul className="grid gap-2">
              {warnings.map((warning, index) => (
                <li
                  key={index}
                  className="rounded-xl border border-amber-200 bg-[#fbf6e9] px-4 py-2.5 text-sm text-amber-900"
                >
                  {warning}
                </li>
              ))}
            </ul>
          )
        ) : (
          <div className="grid gap-2">
            <label
              htmlFor="resume-wizard-answer"
              className=" text-xs font-bold uppercase tracking-wider text-steel-grey"
            >
              {t('resumeWizard.answerLabel')}
            </label>
            <Textarea
              id="resume-wizard-answer"
              value={answer}
              onChange={(event) => onAnswerChange(event.target.value)}
              onKeyDown={handleKeyDown}
              disabled={isBusy}
              className="min-h-40 rounded-xl border-[#e6e3dc] bg-white font-sans text-base shadow-sw-xs"
            />
          </div>
        )}

        {isQuestion && isComplete && (
          <p className="flex items-center gap-2 rounded-xl border border-green-200 bg-green-50 px-3 py-2 text-xs font-bold uppercase tracking-wider text-green-700">
            <span
              aria-hidden="true"
              className="inline-block h-2.5 w-2.5 rounded-full bg-green-600"
            />
            {t('resumeWizard.readyHint')}
          </p>
        )}

        <div className="flex flex-wrap gap-3 border-t border-[#e6e3dc] pt-5">
          {isReview ? (
            <>
              <Button
                type="button"
                variant="success"
                onClick={onFinalize}
                disabled={isBusy || !canFinalize}
                className="rounded-full"
              >
                {isBusy ? t('common.saving') : t('resumeWizard.actions.create')}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={onKeepAdding}
                disabled={isBusy}
                className="rounded-full"
              >
                {t('resumeWizard.actions.keepAdding')}
              </Button>
            </>
          ) : (
            <>
              <Button
                type="button"
                onClick={onContinue}
                disabled={!canContinue}
                className="rounded-full"
              >
                {isBusy ? t('common.loading') : t('resumeWizard.actions.continue')}
              </Button>
              {isQuestion && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={onSkip}
                  disabled={isBusy}
                  className="rounded-full"
                >
                  {t('resumeWizard.actions.skip')}
                </Button>
              )}
              {isQuestion && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={onReview}
                  disabled={isBusy}
                  className="rounded-full"
                >
                  {t('resumeWizard.actions.review')}
                </Button>
              )}
              {isQuestion && canGoBack && (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={onBack}
                  disabled={isBusy}
                  className="rounded-full"
                >
                  {t('resumeWizard.actions.back')}
                </Button>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
