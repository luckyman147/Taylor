'use client';

import { useState } from 'react';
import Lightbulb from 'lucide-react/dist/esm/icons/lightbulb';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';
import Send from 'lucide-react/dist/esm/icons/send';
import { Button } from '@/components/ui/button';
import { useTranslations } from '@/lib/i18n';
import type { ActiveScenario } from './scenarios';

interface CustomScenarioProps {
  onStart: (scenario: ActiveScenario) => void;
}

export function CustomScenario({ onStart }: CustomScenarioProps) {
  const { t } = useTranslations();
  const [idea, setIdea] = useState('');

  function start() {
    const trimmed = idea.trim();
    if (!trimmed) return;
    onStart({
      id: null,
      title: trimmed,
      description: null,
      durationMinutes: null,
    });
  }

  return (
    <section className="flex flex-col gap-3 rounded-2xl border border-[#e6e3dc] bg-paper-tint p-5">
      <div className="flex items-center gap-2">
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-primary shadow-sw-sm">
          <Lightbulb className="h-4 w-4" />
        </span>
        <div>
          <h2 className="text-base font-bold text-ink">{t('interviewPractice.customTitle')}</h2>
          <p className="text-sm text-steel-grey">{t('interviewPractice.customDescription')}</p>
        </div>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          value={idea}
          onChange={(e) => setIdea(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') start();
          }}
          placeholder={t('interviewPractice.customPlaceholder')}
          className="w-full rounded-xl border border-[#c9c5bc] bg-white px-3 py-2 text-sm text-ink placeholder:text-steel-grey focus:border-ink focus:outline-none"
        />
        <Button onClick={start} disabled={!idea.trim()} className="shrink-0">
          <Send className="h-4 w-4" />
          {t('interviewPractice.customStart')}
        </Button>
      </div>
    </section>
  );
}