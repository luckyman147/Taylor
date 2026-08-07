'use client';

import * as React from 'react';
import { AlertTriangle, Lightbulb, ListChecks, MessageSquareText, Target } from 'lucide-react';
import { GeneratePrompt } from './generate-prompt';
import type {
  InterviewPrepData,
  InterviewPrepQuestion,
  InterviewPrepSkillGap,
} from '@/components/common/resume_previewer_context';
import { cn } from '@/lib/utils';
import { useTranslations } from '@/lib/i18n';

interface InterviewPrepViewProps {
  interviewPrep: InterviewPrepData | null;
  isGenerating: boolean;
  error?: string | null;
  onGenerate: () => void;
  isTailoredResume: boolean;
  canGenerate?: boolean;
  unavailableMessage?: string | null;
  className?: string;
}

function Section({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-2xl border border-[#e6e3dc] bg-white shadow-sw-xs">
      <div className="flex items-center gap-3 border-b border-[#e6e3dc] bg-secondary/40 px-5 py-3.5">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
          <Icon className="h-4 w-4 text-primary" />
        </span>
        <h3 className="text-sm font-bold uppercase tracking-wide text-ink">{title}</h3>
      </div>
      <div className="p-5">{children}</div>
    </section>
  );
}

function StringList({ items }: { items: string[] }) {
  if (!items.length) return null;
  return (
    <ul className="space-y-2.5">
      {items.map((item, index) => (
        <li key={`${item}-${index}`} className="flex gap-3 text-sm leading-relaxed text-ink-soft">
          <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function QuestionList({ items }: { items: InterviewPrepQuestion[] }) {
  const { t } = useTranslations();

  if (!items.length) return null;
  return (
    <div className="space-y-3">
      {items.map((item, index) => (
        <div
          key={`${item.question}-${index}`}
          className="rounded-xl border border-[#e6e3dc] bg-secondary/30 p-4"
        >
          <div className="flex items-start gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[11px] font-bold text-primary">
              {index + 1}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-bold leading-relaxed text-ink">{item.question}</p>
              {item.focus_area && (
                <span className="mt-2 inline-flex items-center rounded-full border border-primary/20 bg-primary/5 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-primary">
                  {t('interviewPrep.focusArea')}: {item.focus_area}
                </span>
              )}
              {item.suggested_answer_points.length > 0 && (
                <div className="mt-3 rounded-lg border border-[#e6e3dc] bg-white p-3">
                  <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-steel-grey">
                    {t('interviewPrep.suggestedAnswerPoints')}
                  </p>
                  <StringList items={item.suggested_answer_points} />
                </div>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function SkillGapList({ items }: { items: InterviewPrepSkillGap[] }) {
  const { t } = useTranslations();

  if (!items.length) return null;
  return (
    <div className="space-y-3">
      {items.map((item, index) => (
        <div
          key={`${item.skill}-${index}`}
          className="rounded-xl border border-[#e6e3dc] bg-secondary/30 p-4"
        >
          <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-[#fbf6e9] px-2.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-amber-700">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-600" />
            {item.skill}
          </span>
          <div className="mt-3 space-y-3 text-sm leading-relaxed text-ink-soft">
            <div className="rounded-lg border border-[#e6e3dc] bg-white p-3">
              <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-steel-grey">
                {t('interviewPrep.whyItMatters')}
              </span>
              <p>{item.why_it_matters}</p>
            </div>
            <div className="rounded-lg border border-[#e6e3dc] bg-white p-3">
              <span className="mb-1 block text-[11px] font-bold uppercase tracking-wide text-steel-grey">
                {t('interviewPrep.preparationSuggestion')}
              </span>
              <p>{item.preparation_suggestion}</p>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function InterviewPrepView({
  interviewPrep,
  isGenerating,
  error,
  onGenerate,
  isTailoredResume,
  canGenerate = true,
  unavailableMessage,
  className,
}: InterviewPrepViewProps) {
  const { t } = useTranslations();

  if (!interviewPrep) {
    return (
      <div className={className}>
        {error && (
          <div className="mb-4 flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-red-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
            <p className="text-sm leading-relaxed">{error}</p>
          </div>
        )}
        {isTailoredResume && !canGenerate ? (
          <div className="flex min-h-[400px] flex-col items-center justify-center rounded-2xl border border-dashed border-[#e6e3dc] p-12 text-center">
            <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-amber-50">
              <AlertTriangle className="h-8 w-8 text-amber-600" />
            </div>
            <h3 className="mb-3 text-sm font-bold uppercase tracking-wider text-ink-soft">
              {t('interviewPrep.unavailableTitle')}
            </h3>
            <p className="max-w-md text-xs leading-relaxed text-steel-grey">
              {unavailableMessage ?? t('interviewPrep.missingContextDescription')}
            </p>
          </div>
        ) : (
          <GeneratePrompt
            type="interview-prep"
            isGenerating={isGenerating}
            onGenerate={onGenerate}
            isTailoredResume={isTailoredResume}
          />
        )}
      </div>
    );
  }

  return (
    <div className={cn('space-y-4 p-4 md:p-6', className)}>
      {error && (
        <div className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 p-4 text-red-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
          <p className="text-sm leading-relaxed">{error}</p>
        </div>
      )}
      {isTailoredResume && !canGenerate && (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-[#fbf6e9] p-4 text-amber-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <p className="text-sm leading-relaxed">
            {unavailableMessage ?? t('interviewPrep.missingContextDescription')}
          </p>
        </div>
      )}

      <Section title={t('interviewPrep.sections.talkingPoints')} icon={Lightbulb}>
        <StringList items={interviewPrep.talking_points} />
      </Section>

      <Section title={t('interviewPrep.sections.roleFit')} icon={Target}>
        <StringList items={interviewPrep.role_fit_analysis} />
      </Section>

      <Section title={t('interviewPrep.sections.resumeQuestions')} icon={MessageSquareText}>
        <QuestionList items={interviewPrep.resume_questions} />
      </Section>

      <Section title={t('interviewPrep.sections.projectFollowUps')} icon={ListChecks}>
        <QuestionList items={interviewPrep.project_follow_ups} />
      </Section>

      <Section title={t('interviewPrep.sections.skillGaps')} icon={AlertTriangle}>
        <SkillGapList items={interviewPrep.skill_gaps} />
      </Section>
    </div>
  );
}
