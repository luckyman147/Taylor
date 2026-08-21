'use client';

import { useState } from 'react';
import ArrowLeft from 'lucide-react/dist/esm/icons/arrow-left';
import Check from 'lucide-react/dist/esm/icons/check';
import Clock from 'lucide-react/dist/esm/icons/clock';
import Lightbulb from 'lucide-react/dist/esm/icons/lightbulb';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';
import MessageCircleQuestion from 'lucide-react/dist/esm/icons/message-circle-question';
import RotateCcw from 'lucide-react/dist/esm/icons/rotate-ccw';
import Send from 'lucide-react/dist/esm/icons/send';
import X from 'lucide-react/dist/esm/icons/x';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/lib/context/language-context';
import { useTranslations } from '@/lib/i18n';
import {
  generatePracticeFeedback,
  type PracticeFeedbackResponse,
  type PracticeLevel,
} from '@/lib/api/interview-practice';
import type { ActiveScenario } from './scenarios';

interface PracticePanelProps {
  scenario: ActiveScenario;
  onClose: () => void;
  onSessionRecorded: () => void;
}

const LEVEL_STYLES: Record<PracticeLevel, string> = {
  strong: 'bg-emerald-100 text-emerald-700',
  good: 'bg-amber-100 text-amber-700',
  needs_work: 'bg-red-100 text-red-700',
};

export function PracticePanel({ scenario, onClose, onSessionRecorded }: PracticePanelProps) {
  const { t } = useTranslations();
  const { uiLanguage } = useLanguage();
  const [answer, setAnswer] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<PracticeFeedbackResponse | null>(null);

  async function submitPractice() {
    if (!answer.trim()) {
      setError(t('interviewPractice.practiceAnswerRequired'));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const result = await generatePracticeFeedback({
        scenario_id: scenario.id,
        scenario_title: scenario.title,
        scenario_description: scenario.description,
        duration_minutes: scenario.durationMinutes,
        answer,
        output_language: uiLanguage,
      });
      setFeedback(result);
      onSessionRecorded();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('interviewPractice.practiceFeedbackError'));
    } finally {
      setSubmitting(false);
    }
  }

  function practiceAgain() {
    setFeedback(null);
    setAnswer('');
    setError(null);
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Button variant="ghost" size="sm" className="-ml-2" onClick={onClose}>
            <ArrowLeft className="h-4 w-4" />
            {t('interviewPractice.backToLibrary')}
          </Button>
          <h2 className="mt-1 text-lg font-bold text-ink">{scenario.title}</h2>
          {scenario.description && (
            <p className="text-sm text-steel-grey">{scenario.description}</p>
          )}
          {scenario.durationMinutes !== null && (
            <span className="mt-1 inline-flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-steel-grey">
              <Clock className="h-3.5 w-3.5" />
              {t('interviewPractice.minutes', { count: scenario.durationMinutes })}
            </span>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={practiceAgain}>
          <RotateCcw className="h-4 w-4" />
          {t('interviewPractice.practiceAgain')}
        </Button>
      </div>

      <div className="flex flex-col gap-3 rounded-2xl border border-[#e6e3dc] bg-paper-tint p-5">
        <label htmlFor="practice-answer" className="text-sm font-semibold uppercase tracking-wide text-ink">
          {t('interviewPractice.practiceAnswerLabel')}
        </label>
        <textarea
          id="practice-answer"
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          placeholder={t('interviewPractice.practiceAnswerPlaceholder')}
          disabled={submitting}
          rows={8}
          className="w-full resize-y rounded-xl border border-[#c9c5bc] bg-white p-3 text-sm text-ink placeholder:text-steel-grey focus:border-ink focus:outline-none disabled:opacity-60"
        />
        <p className="text-xs text-steel-grey">{t('interviewPractice.resumeGroundingNote')}</p>
        {error && <p className="text-sm font-medium text-red-600">{error}</p>}
        <div>
          <Button onClick={submitPractice} disabled={submitting}>
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {t('interviewPractice.practiceScoring')}
              </>
            ) : (
              <>
                <Send className="h-4 w-4" />
                {t('interviewPractice.practiceGetFeedback')}
              </>
            )}
          </Button>
        </div>
      </div>

      {feedback && (
        <div className="flex flex-col gap-4 rounded-2xl border border-[#e6e3dc] bg-white p-5">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm font-semibold uppercase tracking-wide text-steel-grey">
              {t('interviewPractice.scoreLabel')}
            </span>
            <span className="text-3xl font-bold text-ink">{feedback.score}/10</span>
            <span
              className={`rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide ${LEVEL_STYLES[feedback.level]}`}
            >
              {t(`interviewPractice.levels.${feedback.level}`)}
            </span>
          </div>

          <FeedbackList
            title={t('interviewPractice.strengthsTitle')}
            items={feedback.strengths}
            icon={<Check className="h-4 w-4 text-emerald-600" />}
          />
          <FeedbackList
            title={t('interviewPractice.improvementsTitle')}
            items={feedback.improvements}
            icon={<X className="h-4 w-4 text-red-500" />}
          />
          <FeedbackList
            title={t('interviewPractice.recommendedPointsTitle')}
            items={feedback.recommended_answer_points}
            icon={<Lightbulb className="h-4 w-4 text-amber-500" />}
          />
          <FeedbackList
            title={t('interviewPractice.followUpsTitle')}
            items={feedback.follow_ups}
            icon={<MessageCircleQuestion className="h-4 w-4 text-primary" />}
          />
        </div>
      )}
    </section>
  );
}

interface FeedbackListProps {
  title: string;
  items: string[];
  icon: React.ReactNode;
}

function FeedbackList({ title, items, icon }: FeedbackListProps) {
  if (!items || items.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold uppercase tracking-wide text-ink">{title}</h3>
      <ul className="flex flex-col gap-2">
        {items.map((item, index) => (
          <li key={index} className="flex items-start gap-2 text-sm text-ink">
            <span className="mt-0.5 shrink-0">{icon}</span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}