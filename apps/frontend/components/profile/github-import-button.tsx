'use client';

import React, { useEffect, useState } from 'react';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';
import Github from 'lucide-react/dist/esm/icons/github';
import Search from 'lucide-react/dist/esm/icons/search';
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useTranslations } from '@/lib/i18n';
import { importProjectsFromGithub, type GitHubImportResult } from '@/lib/api/profile';
import type { GitHubRepo } from '@/lib/api/mcp';

function Checkbox({
  checked,
  onCheckedChange,
  className = '',
}: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onCheckedChange(!checked);
      }}
      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border-2 transition-colors ${className} ${
        checked ? 'border-primary bg-primary' : 'border-[#c9c5bc] bg-white'
      }`}
    >
      {checked && (
        <svg
          className="h-2.5 w-2.5 text-white"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
        </svg>
      )}
    </button>
  );
}

interface GitHubImportButtonProps {
  onImported: (result: GitHubImportResult) => void;
}

export function GitHubImportButton({ onImported }: GitHubImportButtonProps) {
  const { t } = useTranslations();
  const [ghConnected, setGhConnected] = useState(false);
  const [checking, setChecking] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [repos, setRepos] = useState<GitHubRepo[] | null>(null);
  const [reposLoading, setReposLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [connecting, setConnecting] = useState(false);
  const [tokenInput, setTokenInput] = useState('');
  const [showTokenInput, setShowTokenInput] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importStep, setImportStep] = useState<'idle' | 'fetching' | 'importing'>('idle');
  const [repoSearch, setRepoSearch] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { fetchGitHubStatus } = await import('@/lib/api/mcp');
        const status = await fetchGitHubStatus();
        if (cancelled) return;
        setGhConnected(status.authenticated);
      } catch {
        // Connection state unknown — the import call will surface errors.
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const openRepoPicker = async () => {
    setError(null);
    setReposLoading(true);
    try {
      const { fetchGitHubRepos } = await import('@/lib/api/mcp');
      const res = await fetchGitHubRepos();
      setRepos(res.repos);
      setSelected(new Set(res.repos.map((repo) => repo.url)));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setReposLoading(false);
    }
  };

  const handleClick = () => {
    setError(null);
    if (ghConnected) {
      setDialogOpen(true);
      void openRepoPicker();
    } else {
      setShowTokenInput(false);
      setDialogOpen(true);
    }
  };

  const handleConnectOAuth = async () => {
    setConnecting(true);
    setError(null);
    try {
      const { fetchGitHubAuthUrl } = await import('@/lib/api/mcp');
      const { url, error: authError } = await fetchGitHubAuthUrl();
      if (authError) {
        setError(authError);
        setShowTokenInput(true);
        setConnecting(false);
        return;
      }
      if (url) {
        window.location.href = url;
        return;
      }
      setError(t('profile.github.connectHint'));
      setConnecting(false);
    } catch {
      setError(t('profile.github.connectHint'));
      setShowTokenInput(true);
      setConnecting(false);
    }
  };

  const handleConnectToken = async () => {
    if (!tokenInput.trim()) return;
    setConnecting(true);
    setError(null);
    try {
      const { githubCallback } = await import('@/lib/api/mcp');
      const result = await githubCallback(undefined, tokenInput.trim());
      if (result.authenticated) {
        setGhConnected(true);
        setShowTokenInput(false);
        await openRepoPicker();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setConnecting(false);
    }
  };

  const toggleRepo = (url: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(url)) next.delete(url);
      else next.add(url);
      return next;
    });
  };

  const toggleAll = () => {
    setSelected((prev) =>
      prev.size === repos?.length ? new Set() : new Set((repos ?? []).map((r) => r.url))
    );
  };

  const runImport = async () => {
    if (selected.size === 0) {
      setError(t('profile.projects.noSelection'));
      return;
    }
    setImporting(true);
    setImportStep('importing');
    setError(null);
    try {
      const result = await importProjectsFromGithub({ repo_urls: [...selected] });
      onImported(result);
      setDialogOpen(false);
      setRepos(null);
      setSelected(new Set());
      setRepoSearch('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setImporting(false);
      setImportStep('idle');
    }
  };

  const needsConnect = !ghConnected && repos === null;

  return (
    <>
      <Button
        size="sm"
        onClick={handleClick}
        disabled={checking || importing}
        className="rounded-full border border-[#24292f] bg-[#24292f] px-4 py-2 text-xs text-white shadow-sw-sm transition-colors hover:bg-[#1c2128]"
      >
        {importing || reposLoading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Github className="h-4 w-4" />
        )}
        {importing ? t('profile.projects.importing') : t('profile.projects.importFromGithub')}
      </Button>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-2xl p-0 gap-0 overflow-hidden">
          <DialogHeader className="border-b border-[#e6e3dc] bg-white p-6">
            <DialogTitle>
              {needsConnect
                ? t('profile.github.connectTitle')
                : t('profile.projects.importDialogTitle')}
            </DialogTitle>
            <DialogDescription>
              {needsConnect
                ? t('profile.github.connectHint')
                : t('profile.projects.importDialogDescription')}
            </DialogDescription>
          </DialogHeader>

          {needsConnect ? (
            <div className="space-y-4 p-6">
              <div className="flex gap-2">
                <Button
                  onClick={() => void handleConnectOAuth()}
                  disabled={connecting}
                  className="rounded-full border border-[#24292f] bg-[#24292f] px-4 py-2 text-xs text-white shadow-sw-sm transition-colors hover:bg-[#1c2128]"
                >
                  {connecting ? (
                    <Loader2 className="w-3 h-3 animate-spin mr-2 inline" />
                  ) : (
                    <Github className="w-3 h-3 mr-2 inline" />
                  )}
                  {t('profile.github.connect')}
                </Button>
                <Button
                  onClick={() => setShowTokenInput(!showTokenInput)}
                  variant="ghost"
                  className="rounded-full px-4 py-2 text-xs"
                >
                  {t('profile.github.useToken')}
                </Button>
              </div>
              {showTokenInput && (
                <div className="space-y-2">
                  <Label className="text-xs">{t('profile.github.tokenLabel')}</Label>
                  <Input
                    type="password"
                    placeholder="ghp_xxxxxxxxxxxx"
                    value={tokenInput}
                    onChange={(e) => setTokenInput(e.target.value)}
                    className="rounded-xl"
                  />
                  <p className="text-[10px] text-ink-soft">
                    {t('profile.github.tokenHelpStart')}{' '}
                    <a
                      href="https://github.com/settings/tokens/new?scopes=repo,user"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline"
                    >
                      github.com/settings/tokens
                    </a>{' '}
                    {t('profile.github.tokenHelpEnd')}
                  </p>
                </div>
              )}
            </div>
          ) : reposLoading || repos === null ? (
            <div className="space-y-3 p-6">
              <div className="flex items-center gap-2 text-sm text-ink-soft">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t('profile.github.loading')}
              </div>
              <div className="space-y-2">
                {[1, 2, 3].map((i) => (
                  <div
                    key={i}
                    className="flex items-center gap-3 rounded-xl border border-[#f0ece4] px-4 py-3"
                  >
                    <div className="h-4 w-4 animate-pulse rounded bg-[#e6e3dc]" />
                    <div className="flex-1 space-y-1.5">
                      <div className="h-3.5 w-1/3 animate-pulse rounded bg-[#e6e3dc]" />
                      <div className="h-2.5 w-2/3 animate-pulse rounded bg-[#f0ece4]" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : repos.length === 0 ? (
            <p className="p-6 text-sm text-ink-soft">{t('profile.github.noDescription')}</p>
          ) : (
            <div className="max-h-[50vh] overflow-y-auto">
              <div className="sticky top-0 z-10 border-b border-[#f0ece4] bg-white p-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft" />
                  <Input
                    placeholder={t('profile.projects.repoSearch')}
                    value={repoSearch}
                    onChange={(e) => setRepoSearch(e.target.value)}
                    className="h-9 rounded-xl border-[#e6e3dc] pl-9 text-xs"
                  />
                </div>
              </div>
              {(() => {
                const filtered = repoSearch.trim()
                  ? repos.filter((repo) => {
                      const q = repoSearch.toLowerCase();
                      return (
                        repo.name.toLowerCase().includes(q) ||
                        (repo.description && repo.description.toLowerCase().includes(q)) ||
                        repo.languages.some((l) => l.toLowerCase().includes(q))
                      );
                    })
                  : repos;
                return filtered.length === 0 ? (
                  <p className="p-6 text-center text-sm text-ink-soft">
                    {t('profile.projects.noRepoResults')}
                  </p>
                ) : (
                  <div className="p-2">
                    <div
                      onClick={toggleAll}
                      className="flex cursor-pointer items-center gap-2 border-b border-[#f0ece4] px-4 py-2 text-xs font-semibold text-ink"
                    >
                      <Checkbox
                        checked={selected.size === filtered.length}
                        onCheckedChange={toggleAll}
                      />
                      {t('profile.projects.selectAll')} ({selected.size}/{filtered.length})
                    </div>
                    {filtered.map((repo) => (
                      <div
                        key={repo.url}
                        onClick={() => toggleRepo(repo.url)}
                        className="flex cursor-pointer items-start gap-3 border-b border-[#f0ece4] px-4 py-3 hover:bg-secondary/40"
                      >
                        <Checkbox
                          checked={selected.has(repo.url)}
                          onCheckedChange={() => toggleRepo(repo.url)}
                          className="mt-0.5"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-sm font-semibold text-ink">
                              {repo.name}
                            </span>
                            <span
                              className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${
                                repo.visibility === 'PUBLIC'
                                  ? 'border-green-200 bg-green-50 text-green-600'
                                  : 'border-amber-200 bg-[#fbf6e9] text-amber-600'
                              }`}
                            >
                              {repo.visibility}
                            </span>
                          </div>
                          {repo.description && (
                            <p className="mt-0.5 truncate text-xs text-ink-soft">
                              {repo.description}
                            </p>
                          )}
                          {repo.languages.length > 0 && (
                            <div className="mt-1 flex flex-wrap gap-1">
                              {repo.languages.slice(0, 5).map((lang) => (
                                <span
                                  key={lang}
                                  className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-600"
                                >
                                  {lang}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
          )}

          {importing && (
            <div className="mx-6 my-3 flex items-center gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4 text-xs text-primary">
              <Loader2 className="h-4 w-4 animate-spin" />
              <p>{t('profile.projects.importing')}</p>
            </div>
          )}

          {error && (
            <div className="mx-6 my-3 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-xs text-red-700">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
              <p className="break-words">{error}</p>
            </div>
          )}

          <DialogFooter className="flex-row justify-end gap-3 border-t border-[#e6e3dc] bg-secondary p-4">
            <Button variant="ghost" onClick={() => setDialogOpen(false)}>
              {t('common.cancel')}
            </Button>
            {!needsConnect && repos !== null && !reposLoading && (
              <Button onClick={() => void runImport()} disabled={importing || selected.size === 0}>
                {importing && <Loader2 className="h-4 w-4 animate-spin" />}
                {importing
                  ? t('profile.projects.importing')
                  : t('profile.projects.importSelected', { count: String(selected.size) })}
              </Button>
            )}
            {needsConnect && (
              <Button
                onClick={() => void handleConnectToken()}
                disabled={connecting || !tokenInput.trim()}
              >
                {connecting && <Loader2 className="h-4 w-4 animate-spin" />}
                {t('profile.github.tokenSubmit')}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
