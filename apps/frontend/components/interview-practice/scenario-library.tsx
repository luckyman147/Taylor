'use client';

import Clock from 'lucide-react/dist/esm/icons/clock';
import Mic from 'lucide-react/dist/esm/icons/mic';
import { Button } from '@/components/ui/button';
import { useTranslations } from '@/lib/i18n';
import { PRACTICE_SCENARIOS, type PracticeScenario } from './scenarios';

interface ScenarioLibraryProps {
  onStart: (scenario: PracticeScenario) => void;
}

export function ScenarioLibrary({ onStart }: ScenarioLibraryProps) {
  const { t } = useTranslations();

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-lg font-bold text-ink">{t('interviewPractice.libraryTitle')}</h2>
        <p className="text-sm text-steel-grey">{t('interviewPractice.libraryDescription')}</p>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {PRACTICE_SCENARIOS.map((scenario) => (
          <article
            key={scenario.id}
            className="flex flex-col gap-3 rounded-2xl border border-[#e6e3dc] bg-paper-tint p-5"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-primary shadow-sw-sm">
                <Mic className="h-4 w-4" />
              </span>
              <span className="flex items-center gap-1 text-xs font-semibold uppercase tracking-wide text-steel-grey">
                <Clock className="h-3.5 w-3.5" />
                {t('interviewPractice.minutes', { count: scenario.durationMinutes })}
              </span>
            </div>
            <h3 className="text-base font-bold text-ink">
              {t(`interviewPractice.scenarios.${scenario.i18nKey}.title`)}
            </h3>
            <p className="line-clamp-3 flex-1 text-sm text-steel-grey">
              {t(`interviewPractice.scenarios.${scenario.i18nKey}.description`)}
            </p>
            <Button
              variant="default"
              size="sm"
              className="w-full"
              onClick={() => onStart(scenario)}
            >
              {t('interviewPractice.practiceStart')}
            </Button>
          </article>
        ))}
      </div>
    </section>
  );
}