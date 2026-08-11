'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from '@/lib/i18n';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';
import Check from 'lucide-react/dist/esm/icons/check';
import Github from 'lucide-react/dist/esm/icons/github';
import Search from 'lucide-react/dist/esm/icons/search';
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle';
import type { GitHubRepo } from '@/lib/api/mcp';

interface GitHubRepoPickerProps {
  onChange: (repoNames: string[]) => void;
  disabled?: boolean;
}

export function GitHubRepoPicker({ onChange, disabled = false }: GitHubRepoPickerProps) {
  const { t } = useTranslations();
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [repos, setRepos] = useState<
    Array<{ name: string; description: string | null; languages: string[]; topics: string[] }>
  >([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState('');

  type RepoItem = {
    name: string;
    description: string | null;
    languages: string[];
    topics: string[];
  };
  const dedupeRepos = (list: RepoItem[]) =>
    list.filter((repo, index) => list.findIndex((r) => r.name === repo.name) === index);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const { getCached, fetchGitHubStatus, fetchGitHubRepos } = await import('@/lib/api/mcp');

        // Cache-first: if the cache (memory + localStorage) is fresh, render
        // it right away without touching the backend. Only fetch from MCP
        // when the cache is empty or expired.
        const cachedStatus = getCached<{ authenticated: boolean }>('github_status');
        const cachedRepos = getCached<{ repos: GitHubRepo[] }>('github_repos');
        if (cachedStatus && cachedRepos) {
          if (cancelled) return;
          setConnected(cachedStatus.authenticated);
          setRepos(dedupeRepos(cachedRepos.repos));
          setLoading(false);
          return;
        }

        const status = await fetchGitHubStatus();
        if (cancelled) return;
        if (!status.authenticated) {
          setConnected(false);
          setLoading(false);
          return;
        }
        setConnected(true);
        const res = await fetchGitHubRepos();
        if (cancelled) return;
        setRepos(dedupeRepos(res.repos));
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : t('tailor.github.loadError'));
          setConnected(false);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visibleRepos = useMemo(() => {
    const q = query.trim().toLowerCase();
    const uniqueRepos = repos.filter(
      (repo, index) => repos.findIndex((r) => r.name === repo.name) === index
    );
    if (!q) return uniqueRepos;
    return uniqueRepos.filter(
      (repo) =>
        repo.name.toLowerCase().includes(q) ||
        (repo.description ?? '').toLowerCase().includes(q) ||
        repo.languages.some((l) => l.toLowerCase().includes(q)) ||
        repo.topics.some((topic) => topic.toLowerCase().includes(q))
    );
  }, [repos, query]);

  const toggleRepo = (name: string) => {
    setSelected((prev) => (prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name]));
  };

  // Sync selection upward AFTER commit — calling onChange inside a state
  // updater would trigger a parent setState during render (setState-in-render).
  useEffect(() => {
    onChange(selected);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected]);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-4 text-sm text-steel-grey" role="status">
        <Loader2 className="h-4 w-4 animate-spin" />
        {t('tailor.github.loading')}
      </div>
    );
  }

  if (!connected) {
    return (
      <div className="space-y-3 py-1">
        <p className="text-xs text-steel-grey">{t('tailor.github.notConnected')}</p>
        {error && (
          <div className="flex items-start gap-2 rounded-xl border border-[#eec2c2] bg-[#fdf3f2] p-3 text-xs text-red-700">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-600" />
            {error}
          </div>
        )}
        <Link
          href="/settings"
          className="inline-flex w-full items-center justify-center gap-2 rounded-full border border-[#24292f] bg-[#24292f] px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-[#1c2128]"
        >
          <Github className="h-3.5 w-3.5" />
          {t('tailor.github.connectButton')}
        </Link>
      </div>
    );
  }

  if (repos.length === 0) {
    return (
      <div className="py-4 text-xs text-steel-grey">
        <p className="mb-3">{t('tailor.github.noRepos')}</p>
        <Link
          href="/settings"
          className="text-xs font-bold uppercase text-primary underline underline-offset-2 hover:text-primary/80"
        >
          {t('tailor.github.gotoSettings')}
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-bold uppercase tracking-widest text-steel-grey">
          {t('tailor.github.selectedCount', { count: selected.length })}
        </p>
        {selected.length > 0 && (
          <button
            type="button"
            onClick={() => setSelected([])}
            disabled={disabled}
            className="shrink-0 text-xs font-bold uppercase underline underline-offset-2 text-steel-grey transition-colors hover:text-ink disabled:opacity-40"
          >
            {t('tailor.github.clearSelection')}
          </button>
        )}
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-steel-grey" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('tailor.github.searchPlaceholder')}
          className="w-full rounded-xl border border-[#c9c5bc] bg-white py-2 pl-9 pr-3 text-sm text-ink placeholder:text-steel-grey focus:border-primary focus:outline-none"
          aria-label={t('tailor.github.searchPlaceholder')}
        />
      </div>

      <ul className="max-h-64 space-y-1 overflow-y-auto pr-1">
        {visibleRepos.map((repo) => {
          const isSelected = selected.includes(repo.name);
          return (
            <li key={repo.name}>
              <button
                type="button"
                onClick={() => toggleRepo(repo.name)}
                disabled={disabled}
                className={`flex w-full items-start gap-2.5 rounded-xl border p-3 text-left transition-colors disabled:opacity-50 ${
                  isSelected
                    ? 'border-primary bg-primary/5'
                    : 'border-[#e6e3dc] bg-white hover:bg-background'
                }`}
                aria-pressed={isSelected}
              >
                <span
                  className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                    isSelected
                      ? 'border-primary bg-primary text-white'
                      : 'border-steel-grey bg-white'
                  }`}
                >
                  {isSelected && <Check className="h-3 w-3" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-ink">{repo.name}</span>
                  {repo.description && (
                    <span className="mt-0.5 line-clamp-2 block text-xs text-steel-grey">
                      {repo.description}
                    </span>
                  )}
                  {repo.languages.length > 0 && (
                    <span className="mt-1 block text-[11px] uppercase tracking-wide text-steel-grey">
                      {repo.languages.slice(0, 4).join(' · ')}
                    </span>
                  )}
                </span>
              </button>
            </li>
          );
        })}
        {visibleRepos.length === 0 && (
          <li className="py-3 text-center text-xs text-steel-grey">
            {t('tailor.github.noResults')}
          </li>
        )}
      </ul>
    </div>
  );
}
