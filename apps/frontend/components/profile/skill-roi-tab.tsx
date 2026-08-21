'use client';

import { useCallback, useEffect, useState } from 'react';
import ExternalLink from 'lucide-react/dist/esm/icons/external-link';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw';
import Sparkles from 'lucide-react/dist/esm/icons/sparkles';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useTranslations } from '@/lib/i18n';
import {
  getSkillResources,
  getSkillRoi,
  type CareerRoiResponse,
  type SkillResource,
  type SkillRoiRow,
} from '@/lib/api/profile';
import { MarkdownContent } from '@/components/common/markdown-content';
import { MarketPositionCard } from './market-position-card';

/** Static class mapping so Tailwind keeps the badges. */
const EFFORT_STYLES: Record<string, string> = {
  low: 'bg-green-100 text-green-800',
  medium: 'bg-amber-100 text-amber-800',
  high: 'bg-red-100 text-red-800',
};

/** Badge styles for learning-resource types. */
const RESOURCE_SOURCE_STYLES: Record<string, string> = {
  docs: 'border-blue-200 bg-blue-50 text-blue-700',
  course: 'border-violet-200 bg-violet-50 text-violet-700',
  article: 'border-teal-200 bg-teal-50 text-teal-700',
  video: 'border-orange-200 bg-orange-50 text-orange-700',
};

/** How many gap/strengthen skills the resources call may cover (schema max 12). */
const MAX_RESOURCE_SKILLS = 12;

function resourceSkills(data: CareerRoiResponse): string[] {
  return [...data.gaps, ...data.strengthen].map((row) => row.skill).slice(0, MAX_RESOURCE_SKILLS);
}

function DemandCell({ row }: { row: SkillRoiRow }) {
  const { t } = useTranslations();
  return (
    <div className="text-xs text-ink-soft">
      {row.matching_jobs} {t('profile.roi.jobs')} · {row.jobs_unlocked_pct}%
    </div>
  );
}

/** Difficulty label per effort level (advisory wording: Easy / Medium / Hard). */
const DIFFICULTY_LABELS: Record<string, string> = {
  low: 'profile.roi.difficultyEasy',
  medium: 'profile.roi.difficultyMedium',
  high: 'profile.roi.difficultyHard',
};

/** How many skills the advisor ranks (top by ROI). */
const ADVISOR_LIMIT = 10;

function AdvisorTable({ rows }: { rows: SkillRoiRow[] }) {
  const { t } = useTranslations();
  const ranked = [...rows].sort((a, b) => b.roi_score - a.roi_score).slice(0, ADVISOR_LIMIT);
  return (
    <div className="overflow-hidden rounded-2xl border border-[#e6e3dc] bg-white shadow-sw-xs">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e6e3dc] bg-paper-tint/50 px-5 py-4">
        <div>
          <h3 className="text-sm font-bold text-ink">{t('profile.roi.advisorTitle')}</h3>
          <p className="mt-0.5 text-xs text-ink-soft">{t('profile.roi.advisorDescription')}</p>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#e6e3dc] bg-secondary">
              <th className="px-5 py-3 text-left text-xs font-bold uppercase tracking-wide text-ink-soft">
                {t('profile.roi.skill')}
              </th>
              <th className="px-5 py-3 text-left text-xs font-bold uppercase tracking-wide text-ink-soft">
                {t('profile.roi.jobsUnlocked')}
              </th>
              <th className="px-5 py-3 text-left text-xs font-bold uppercase tracking-wide text-ink-soft">
                {t('profile.roi.difficulty')}
              </th>
              <th className="px-5 py-3 text-right text-xs font-bold uppercase tracking-wide text-ink-soft">
                {t('profile.roi.roiScore')}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#f0ece4]">
            {ranked.map((row, index) => (
              <tr key={row.skill}>
                <td className="px-5 py-3">
                  <div className="flex items-center gap-2.5">
                    <span className="w-5 text-xs font-bold text-ink-soft">#{index + 1}</span>
                    <span className="font-semibold text-ink">{row.skill}</span>
                  </div>
                </td>
                <td className="px-5 py-3">
                  <span className="text-xs font-semibold text-green-700">
                    +{row.jobs_unlocked_pct}%
                  </span>
                </td>
                <td className="px-5 py-3">
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${EFFORT_STYLES[row.learning_effort] ?? EFFORT_STYLES.medium}`}
                  >
                    {t(DIFFICULTY_LABELS[row.learning_effort] ?? 'profile.roi.difficultyMedium')}
                  </span>
                </td>
                <td className="px-5 py-3">
                  <div className="ml-auto w-28">
                    <div className="mb-1 text-right text-sm font-bold text-primary">
                      {row.roi_score}
                    </div>
                    <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#e6e3dc]">
                      <div
                        className="h-full rounded-full bg-primary"
                        style={{ width: `${row.roi_score}%` }}
                      />
                    </div>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ResourceLinks({ resources, loading }: { resources: SkillResource[]; loading: boolean }) {
  const { t } = useTranslations();
  if (loading) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-ink-soft">
        <RefreshCw className="h-3 w-3 animate-spin" />
        {t('profile.roi.loadingResources')}
      </span>
    );
  }
  if (resources.length === 0) {
    return <span className="text-xs text-ink-soft">{t('profile.roi.noResources')}</span>;
  }
  return (
    <ul className="space-y-1">
      {resources.map((resource) => (
        <li key={resource.url} className="flex items-center gap-2">
          <a
            href={resource.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex max-w-full items-center gap-1 text-xs font-medium text-primary hover:underline"
            title={resource.url}
          >
            <span className="truncate">{resource.title}</span>
            <ExternalLink className="h-3 w-3 shrink-0" />
          </a>
          {resource.source && (
            <span
              className={`shrink-0 rounded-full border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${RESOURCE_SOURCE_STYLES[resource.source] ?? 'border-[#e6e3dc] bg-secondary text-ink-soft'}`}
            >
              {resource.source}
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}

function SectionShell({
  title,
  description,
  resourcesLoading,
  onRefreshResources,
  children,
}: {
  title: string;
  description: string;
  resourcesLoading: boolean;
  onRefreshResources: () => void;
  children: React.ReactNode;
}) {
  const { t } = useTranslations();
  return (
    <section className="overflow-hidden rounded-2xl border border-[#e6e3dc] bg-white shadow-sw-xs">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e6e3dc] bg-paper-tint/50 px-5 py-4">
        <div>
          <h3 className="text-sm font-bold text-ink">{title}</h3>
          <p className="mt-0.5 text-xs text-ink-soft">{description}</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={onRefreshResources}
          disabled={resourcesLoading}
        >
          <RefreshCw className={`h-3.5 w-3.5 ${resourcesLoading ? 'animate-spin' : ''}`} />
          {t('profile.roi.refreshResources')}
        </Button>
      </div>
      {children}
    </section>
  );
}

function ActionTable({
  rows,
  column,
  resources,
  resourcesLoading,
}: {
  rows: SkillRoiRow[];
  column: 'learn' | 'strengthen';
  resources: Record<string, SkillResource[]>;
  resourcesLoading: boolean;
}) {
  const { t } = useTranslations();
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="border-b border-[#e6e3dc] bg-secondary">
          <th className="px-5 py-3 text-left text-xs font-bold uppercase tracking-wide text-ink-soft">
            {t('profile.roi.skill')}
          </th>
          <th className="px-5 py-3 text-left text-xs font-bold uppercase tracking-wide text-ink-soft">
            {t('profile.roi.jobsUnlocked')}
          </th>
          {column === 'strengthen' && (
            <th className="px-5 py-3 text-left text-xs font-bold uppercase tracking-wide text-ink-soft">
              {t('profile.roi.youKnow')}
            </th>
          )}
          <th className="px-5 py-3 text-left text-xs font-bold uppercase tracking-wide text-ink-soft">
            {t('profile.roi.resources')}
          </th>
        </tr>
      </thead>
      <tbody className="divide-y divide-[#f0ece4]">
        {rows.map((row) => (
          <tr key={row.skill}>
            <td className="px-5 py-3 font-semibold text-ink">{row.skill}</td>
            <td className="px-5 py-3">
              <DemandCell row={row} />
            </td>
            {column === 'strengthen' && (
              <td className="px-5 py-3">
                <div className="flex items-center gap-2">
                  <div className="h-1.5 w-20 overflow-hidden rounded-full bg-[#e6e3dc]">
                    <div
                      className="h-full rounded-full bg-amber-400"
                      style={{ width: `${row.existing_knowledge}%` }}
                    />
                  </div>
                  <span className="text-xs text-ink-soft">{row.existing_knowledge}%</span>
                </div>
              </td>
            )}
            <td className="px-5 py-3">
              <ResourceLinks
                resources={resources[row.skill] ?? []}
                loading={resourcesLoading && !resources[row.skill]}
              />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function SkillRoiTab() {
  const { t } = useTranslations();
  const [data, setData] = useState<CareerRoiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resources, setResources] = useState<Record<string, SkillResource[]>>({});
  const [resourcesLoading, setResourcesLoading] = useState(false);
  const [resourcesError, setResourcesError] = useState<string | null>(null);
  const [showRest, setShowRest] = useState(false);
  const [adviceDialogOpen, setAdviceDialogOpen] = useState(false);
  const [adviceLoading, setAdviceLoading] = useState(false);
  const [adviceError, setAdviceError] = useState<string | null>(null);
  const [advice, setAdvice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getSkillRoi({});
      setData(result);
      setResources({});
      setResourcesError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchAdvice = useCallback(async () => {
    setAdviceLoading(true);
    setAdviceError(null);
    setAdvice(null);
    try {
      const result = await getSkillRoi({ include_advice: true });
      setAdvice(result.advice);
    } catch (e) {
      setAdviceError(e instanceof Error ? e.message : String(e));
    } finally {
      setAdviceLoading(false);
    }
  }, []);

  const openAdviceDialog = () => {
    setAdviceDialogOpen(true);
    void fetchAdvice();
  };

  const loadResources = useCallback(
    async (refresh = false) => {
      if (!data) return;
      const skills = resourceSkills(data);
      if (skills.length === 0) return;
      setResourcesLoading(true);
      setResourcesError(null);
      try {
        const result = await getSkillResources({ skills, refresh });
        setResources((prev) => ({ ...prev, ...result.resources }));
        if (result.note) setResourcesError(result.note);
      } catch (e) {
        setResourcesError(e instanceof Error ? e.message : String(e));
      } finally {
        setResourcesLoading(false);
      }
    },
    [data]
  );

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    void loadResources();
  }, [loadResources]);

  const refresh = () => void load();
  const gaps = data?.gaps ?? [];
  const strengthen = data?.strengthen ?? [];
  const rest = data?.rest ?? [];
  const allOnTrack = data && gaps.length === 0 && strengthen.length === 0;
  const advisorRows = [...gaps, ...strengthen, ...rest];

  return (
    <div className="space-y-5 pb-8">
      <MarketPositionCard />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-ink-soft">{t('profile.roi.description')}</p>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={refresh} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            {t('profile.roi.refresh')}
          </Button>
          <Button size="sm" onClick={openAdviceDialog}>
            <Sparkles className="h-4 w-4" />
            {t('profile.roi.getAdvice')}
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {advisorRows.length > 0 && <AdvisorTable rows={advisorRows} />}

      {data?.note && (
        <div className="rounded-2xl border border-dashed border-[#e6e3dc] bg-paper-tint/50 p-5 text-sm text-ink-soft">
          {data.note}
        </div>
      )}

      {allOnTrack && (
        <div className="rounded-2xl border border-[#e6e3dc] bg-white p-5 text-sm text-ink-soft shadow-sw-xs">
          {t('profile.roi.allOnTrack')}
        </div>
      )}

      {gaps.length > 0 && (
        <SectionShell
          title={t('profile.roi.learnTitle')}
          description={t('profile.roi.learnDescription')}
          resourcesLoading={resourcesLoading}
          onRefreshResources={() => void loadResources(true)}
        >
          <ActionTable
            rows={gaps}
            column="learn"
            resources={resources}
            resourcesLoading={resourcesLoading}
          />
        </SectionShell>
      )}

      {strengthen.length > 0 && (
        <SectionShell
          title={t('profile.roi.strengthenTitle')}
          description={t('profile.roi.strengthenDescription')}
          resourcesLoading={resourcesLoading}
          onRefreshResources={() => void loadResources(true)}
        >
          <ActionTable
            rows={strengthen}
            column="strengthen"
            resources={resources}
            resourcesLoading={resourcesLoading}
          />
        </SectionShell>
      )}

      {resourcesError && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
          {resourcesError}
        </div>
      )}

      {rest.length > 0 && (
        <div className="overflow-hidden rounded-2xl border border-[#e6e3dc] bg-white shadow-sw-xs">
          <button
            type="button"
            className="flex w-full items-center justify-between px-5 py-4 text-sm font-semibold text-ink hover:bg-paper-tint/50"
            onClick={() => setShowRest((prev) => !prev)}
          >
            <span>
              {showRest
                ? t('profile.roi.hideRest')
                : t('profile.roi.showRest', { count: rest.length })}
            </span>
            <span className="text-xs font-normal text-ink-soft">{t('profile.roi.restHint')}</span>
          </button>
          {showRest && (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[#e6e3dc] bg-secondary">
                      <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-ink-soft">
                        {t('profile.roi.skill')}
                      </th>
                      <th className="px-4 py-3 text-center text-xs font-bold uppercase tracking-wide text-ink-soft">
                        {t('profile.roi.jobsUnlocked')}
                      </th>
                      <th className="px-4 py-3 text-center text-xs font-bold uppercase tracking-wide text-ink-soft">
                        {t('profile.roi.salaryImpact')}
                      </th>
                      <th className="px-4 py-3 text-center text-xs font-bold uppercase tracking-wide text-ink-soft">
                        {t('profile.roi.learningEffort')}
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-bold uppercase tracking-wide text-ink-soft">
                        {t('profile.roi.roiScore')}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#f0ece4]">
                    {rest.map((row) => (
                      <tr key={row.skill}>
                        <td className="px-4 py-3 font-semibold text-ink">{row.skill}</td>
                        <td className="px-4 py-3 text-center">
                          <div className="text-xs text-ink-soft">
                            {row.matching_jobs} · {row.jobs_unlocked_pct}%
                          </div>
                        </td>
                        <td className="px-4 py-3 text-center text-xs text-ink-soft">
                          {row.salary_impact_pct === null
                            ? t('profile.roi.noData')
                            : `${row.salary_impact_pct > 0 ? '+' : ''}${row.salary_impact_pct}%`}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span
                            className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${EFFORT_STYLES[row.learning_effort] ?? EFFORT_STYLES.medium}`}
                          >
                            {t(`profile.roi.effort.${row.learning_effort}`)}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="ml-auto w-28">
                            <div className="mb-1 text-right text-sm font-bold text-primary">
                              {row.roi_score}
                            </div>
                            <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#e6e3dc]">
                              <div
                                className="h-full rounded-full bg-primary"
                                style={{ width: `${row.roi_score}%` }}
                              />
                            </div>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="px-4 py-3 text-xs text-ink-soft">{t('profile.roi.formula')}</div>
            </>
          )}
        </div>
      )}

      <Dialog open={adviceDialogOpen} onOpenChange={setAdviceDialogOpen}>
        <DialogContent className="max-w-2xl gap-0 overflow-hidden p-0">
          <DialogHeader className="border-b border-[#e6e3dc] bg-white p-6">
            <DialogTitle>
              <span className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-primary" />
                {t('profile.roi.advice')}
              </span>
            </DialogTitle>
            <DialogDescription>{t('profile.roi.adviceDescription')}</DialogDescription>
          </DialogHeader>
          <div className="max-h-[70vh] overflow-y-auto p-6">
            {adviceLoading ? (
              <div className="flex items-center justify-center gap-2 py-10 text-sm text-ink-soft">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t('profile.roi.adviceLoading')}
              </div>
            ) : adviceError ? (
              <p className="text-sm text-red-700">{adviceError}</p>
            ) : advice ? (
              <MarkdownContent content={advice} />
            ) : (
              <p className="text-sm text-ink-soft">{t('profile.roi.adviceUnavailable')}</p>
            )}
          </div>
          <DialogFooter className="flex-row justify-end gap-3 border-t border-[#e6e3dc] bg-secondary p-4">
            {adviceError && (
              <Button variant="outline" onClick={() => void fetchAdvice()} disabled={adviceLoading}>
                <RefreshCw className="h-4 w-4" />
                {t('common.retry')}
              </Button>
            )}
            <Button onClick={() => setAdviceDialogOpen(false)}>{t('common.close')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
