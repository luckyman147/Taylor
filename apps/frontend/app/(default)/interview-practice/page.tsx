'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import SidebarNav from '@/components/common/SidebarNav';
import { useTranslations } from '@/lib/i18n';
import { CustomScenario } from '@/components/interview-practice/custom-scenario';
import { HistoryList } from '@/components/interview-practice/history-list';
import { PracticePanel } from '@/components/interview-practice/practice-panel';
import { ScenarioLibrary } from '@/components/interview-practice/scenario-library';
import { UpcomingInterviews } from '@/components/interview-practice/upcoming-interviews';
import { type ActiveScenario, type PracticeScenario } from '@/components/interview-practice/scenarios';

export default function InterviewPracticePage() {
  const router = useRouter();
  const { t } = useTranslations();
  const [activeScenario, setActiveScenario] = useState<ActiveScenario | null>(null);
  const [historyRefresh, setHistoryRefresh] = useState(0);

  function startScenario(scenario: PracticeScenario) {
    setActiveScenario({
      id: scenario.id,
      title: t(`interviewPractice.scenarios.${scenario.i18nKey}.title`),
      description: t(`interviewPractice.scenarios.${scenario.i18nKey}.description`),
      durationMinutes: scenario.durationMinutes,
    });
  }

  return (
    <div className="flex h-[100dvh] w-full flex-col overflow-hidden bg-white pl-16">
      <SidebarNav
        currentPage="interview-practice"
        onNavigate={(page) => router.push(page)}
      />
      <main className="flex min-h-0 w-full max-w-[104rem] flex-col overflow-y-auto">
        <div className="flex flex-col gap-6 p-6 md:p-8">
          <header className="flex flex-col gap-1">
            <h1 className="text-2xl font-bold text-ink">{t('interviewPractice.title')}</h1>
            <p className="text-sm text-steel-grey">{t('interviewPractice.subtitle')}</p>
          </header>

          {activeScenario ? (
            <PracticePanel
              scenario={activeScenario}
              onClose={() => setActiveScenario(null)}
              onSessionRecorded={() => setHistoryRefresh((n) => n + 1)}
            />
          ) : (
            <>
              <UpcomingInterviews />
              <CustomScenario
                onStart={(scenario) => {
                  setActiveScenario(scenario);
                }}
              />
              <ScenarioLibrary
                onStart={(scenario) => {
                  startScenario(scenario);
                }}
              />
              <HistoryList refreshKey={historyRefresh} />
            </>
          )}
        </div>
      </main>
    </div>
  );
}