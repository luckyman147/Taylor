'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import UserRound from 'lucide-react/dist/esm/icons/user-round';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';
import { Button } from '@/components/ui/button';
import { RetroTabs, type Tab } from '@/components/ui/retro-tabs';
import { useTranslations } from '@/lib/i18n';
import {
  getProfile,
  importEducationFromMaster,
  type CareerProfile,
  type ProfileBundle,
} from '@/lib/api/profile';
import { ExperienceTab } from './experience-tab';
import { GraphTab } from './graph-tab';
import { ProfileTab } from './profile-tab';
import { SkillRoiTab } from './skill-roi-tab';

export function ProfilePage() {
  const { t } = useTranslations();
  const [bundle, setBundle] = useState<ProfileBundle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('profile');

  const refresh = useCallback(async () => {
    setError(null);
    try {
      setBundle(await getProfile());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // The Education tab always reflects the latest master resume: every time it
  // is opened, sync the education entries from the CV (replace-when-present),
  // then refresh so the tab renders what the import produced.
  useEffect(() => {
    if (activeTab !== 'education') return;
    let cancelled = false;
    (async () => {
      try {
        await importEducationFromMaster();
        if (!cancelled) setBundle(await getProfile());
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeTab]);

  const tabs: Tab[] = [
    { id: 'profile', label: t('profile.tabs.profile') },
    { id: 'experience', label: t('profile.tabs.experience') },
    { id: 'education', label: t('profile.tabs.education') },
    { id: 'projects', label: t('profile.tabs.projects') },
    { id: 'achievements', label: t('profile.tabs.achievements') },
    { id: 'skill-roi', label: t('profile.tabs.skillRoi') },
  ];

  const patchProfile = useCallback((profile: CareerProfile) => {
    setBundle((prev) => (prev ? { ...prev, profile } : prev));
  }, []);

  return (
    <div className="flex min-h-0 flex-1 flex-col p-6">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-white">
            <UserRound className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-ink">{t('profile.title')}</h1>
            <p className="text-xs text-ink-soft">{t('profile.subtitle')}</p>
            {bundle?.profile.source_resume_id && (
              <Link
                href="/resumes"
                className="mt-1 inline-flex items-center gap-1 rounded-full border border-[#e6e3dc] bg-secondary px-2.5 py-0.5 text-[10px] font-medium text-ink-soft transition-colors hover:text-ink"
              >
                {t('profile.header.sourceFrom')}: {bundle.profile.source_resume_title}
              </Link>
            )}
          </div>
        </div>
        <RetroTabs tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />
      </header>

      {error && (
        <div className="mb-4 flex items-center justify-between rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <span>{error}</span>
          <Button variant="outline" size="sm" onClick={() => void refresh()}>
            {t('common.retry')}
          </Button>
        </div>
      )}

      {!bundle && !error ? (
        <div className="flex flex-1 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          {bundle && activeTab === 'profile' && (
            <ProfileTab bundle={bundle} onProfileSaved={patchProfile} />
          )}
          {bundle && activeTab === 'experience' && (
            <ExperienceTab bundle={bundle} onChanged={setBundle} />
          )}
          {bundle && activeTab === 'education' && (
            <GraphTab bundle={bundle} section="education" onChanged={setBundle} />
          )}
          {bundle && activeTab === 'projects' && (
            <GraphTab bundle={bundle} section="projects" onChanged={setBundle} />
          )}
          {bundle && activeTab === 'achievements' && (
            <GraphTab bundle={bundle} section="achievements" onChanged={setBundle} />
          )}
          {bundle && activeTab === 'skill-roi' && <SkillRoiTab />}
        </div>
      )}
    </div>
  );
}
