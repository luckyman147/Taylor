'use client';

import { useEffect, useState } from 'react';
import CalendarClock from 'lucide-react/dist/esm/icons/calendar-clock';
import Check from 'lucide-react/dist/esm/icons/check';
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down';
import Clock from 'lucide-react/dist/esm/icons/clock';
import Lightbulb from 'lucide-react/dist/esm/icons/lightbulb';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';
import MessageCircleQuestion from 'lucide-react/dist/esm/icons/message-circle-question';
import X from 'lucide-react/dist/esm/icons/x';
import { cn } from '@/lib/utils';
import { useTranslations } from '@/lib/i18n';
import {
  fetchPracticeSessions,
  type PracticeSessionSummary,
} from '@/lib/api/interview-practice';

interface HistoryListProps {
  refreshKey: number;
}

function formatDate(iso: string, t: (key: string, params?: Record<string, string | number>) => string) {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return t('interviewPractice.historyUnknownDate');
  }
}

export function HistoryList({ refreshKey }: HistoryListProps) {
  const { t } = useTranslations();
  const [loading, setLoading] = useState(true);
  const [sessions, setSessions] = useState<PracticeSessionSummary[]>([]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetchPracticeSessions()
      .then((list) => {
        if (active) setSessions(list);
      })
      .catch(() => {
        if (active) setSessions([]);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [refreshKey]);

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-bold text-ink">{t('interviewPractice.historyTitle')}</h2>
        <p className="text-sm text-steel-grey">{t('interviewPractice.historyDescription')}</p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-steel-grey">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t('interviewPractice.loading')}
        </div>
      ) : sessions.length === 0 ? (
        <p className="text-sm text-steel-grey">{t('interviewPractice.historyEmpty')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {sessions.map((session) => {
            const isOpen = expanded.has(session.session_id);
            return (
              <li
                key={session.session_id}
                className="rounded-2xl border border-[#e6e3dc] bg-paper-tint"
              >
                <button
                  onClick={() => toggle(session.session_id)}
                  className="flex w-full items-center gap-3 px-4 py-3 text-left"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-primary shadow-sw-sm">
                    <CalendarClock className="h-4 w-4" />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-semibold text-ink">
                      {session.scenario_title}
                    </span>
                    <span className="flex items-center gap-2 text-xs text-steel-grey">
                      <span>{formatDate(session.created_at, t)}</span>
                      {session.duration_minutes !== null && session.duration_minutes !== undefined && (
                        <span className="flex items-center gap-0.5">
                          <Clock className="h-3 w-3" />
                          {t('interviewPractice.minutes', { count: session.duration_minutes })}
                        </span>
                      )}
                    </span>
                  </span>
                  {session.score !== null && session.score !== undefined && (
                    <span
                      className={cn(
                        'shrink-0 rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wide',
                        session.level === 'strong' && 'bg-emerald-100 text-emerald-700',
                        session.level === 'good' && 'bg-amber-100 text-amber-700',
                        session.level === 'needs_work' && 'bg-red-100 text-red-700'
                      )}
                    >
                      {session.score}/10
                    </span>
                  )}
                  <ChevronDown
                    className={cn(
                      'h-4 w-4 shrink-0 text-steel-grey transition-transform',
                      isOpen && 'rotate-180'
                    )}
                  />
                </button>
                {isOpen && (
                  <div className="flex flex-col gap-3 border-t border-[#e6e3dc] px-4 py-3">
                    <div>
                      <h4 className="text-xs font-semibold uppercase tracking-wide text-steel-grey">
                        {t('interviewPractice.historyAnswerLabel')}
                      </h4>
                      <p className="mt-1 whitespace-pre-wrap text-sm text-ink">{session.answer}</p>
                    </div>
                    <DetailList
                      title={t('interviewPractice.strengthsTitle')}
                      items={session.feedback?.strengths}
                      icon={<Check className="h-4 w-4 text-emerald-600" />}
                    />
                    <DetailList
                      title={t('interviewPractice.improvementsTitle')}
                      items={session.feedback?.improvements}
                      icon={<X className="h-4 w-4 text-red-500" />}
                    />
                    <DetailList
                      title={t('interviewPractice.recommendedPointsTitle')}
                      items={session.feedback?.recommended_answer_points}
                      icon={<Lightbulb className="h-4 w-4 text-amber-500" />}
                    />
                    <DetailList
                      title={t('interviewPractice.followUpsTitle')}
                      items={session.feedback?.follow_ups}
                      icon={<MessageCircleQuestion className="h-4 w-4 text-primary" />}
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

interface DetailListProps {
  title: string;
  items?: string[];
  icon: React.ReactNode;
}

function DetailList({ title, items, icon }: DetailListProps) {
  if (!items || items.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-steel-grey">{title}</h4>
      <ul className="flex flex-col gap-1.5">
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