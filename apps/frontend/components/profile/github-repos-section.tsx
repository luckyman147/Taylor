'use client';

import React, { useEffect, useState } from 'react';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';
import Github from 'lucide-react/dist/esm/icons/github';
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useTranslations } from '@/lib/i18n';

export interface GitHubRepoItem {
  name: string;
  description: string | null;
  visibility: string;
  url: string;
  stargazer_count: number;
  languages: string[];
  topics: string[];
  readme: string;
}

export function GitHubReposSection() {
  const { t } = useTranslations();
  const [repos, setRepos] = useState<GitHubRepoItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ghUser, setGhUser] = useState<string | null>(null);
  const [ghConnected, setGhConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [tokenInput, setTokenInput] = useState('');
  const [showTokenInput, setShowTokenInput] = useState(false);

  const loadStatus = async () => {
    try {
      const { fetchGitHubStatus, fetchGitHubRepos } = await import('@/lib/api/mcp');
      const status = await fetchGitHubStatus();
      setGhConnected(status.authenticated);
      setGhUser(status.user);
      if (status.authenticated) {
        const res = await fetchGitHubRepos();
        setRepos(res.repos);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadStatus();
  }, []);

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
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to start OAuth');
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
        setGhUser(result.user || null);
        setShowTokenInput(false);
        const { fetchGitHubRepos } = await import('@/lib/api/mcp');
        const res = await fetchGitHubRepos();
        setRepos(res.repos);
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Invalid token');
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    try {
      const { disconnectGitHub } = await import('@/lib/api/mcp');
      await disconnectGitHub();
      setGhConnected(false);
      setGhUser(null);
      setRepos([]);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to disconnect');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-ink-soft">
        <Loader2 className="w-4 h-4 animate-spin" />
        {t('profile.github.loading')}
      </div>
    );
  }

  if (!ghConnected) {
    return (
      <div className="space-y-3">
        <p className="text-xs text-ink-soft">{t('profile.github.connectHint')}</p>
        {error && (
          <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-xs text-red-700">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
            <p className="break-words">{error}</p>
          </div>
        )}
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
          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <Label className="text-xs">{t('profile.github.tokenLabel')}</Label>
              <Input
                type="password"
                placeholder="ghp_xxxxxxxxxxxx"
                value={tokenInput}
                onChange={(e) => setTokenInput(e.target.value)}
                className="mt-1 rounded-xl"
              />
              <p className="text-[10px] text-ink-soft mt-1">
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
            <Button
              onClick={() => void handleConnectToken()}
              disabled={connecting || !tokenInput.trim()}
              className="rounded-full px-4 py-2 text-xs"
            >
              {t('profile.github.tokenSubmit')}
            </Button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm">
          <div className="w-2 h-2 rounded-full bg-green-500" />
          <span className="text-xs">
            {t('profile.github.connectedAs')} <strong>{ghUser}</strong>
          </span>
          <span className="text-xs text-ink-soft">
            · {repos.length} {t('profile.github.repositories')}
          </span>
        </div>
        <Button
          onClick={() => void handleDisconnect()}
          variant="ghost"
          className="rounded-full px-3 py-1 text-xs text-destructive"
        >
          {t('profile.github.disconnect')}
        </Button>
      </div>

      {error && (
        <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-xs text-red-700">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
          <p className="break-words">{error}</p>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 max-h-[500px] overflow-y-auto">
        {repos.map((repo, idx) => (
          <RepoCard key={repo.url} repo={repo} index={idx} />
        ))}
      </div>
    </div>
  );
}

function RepoCard({ repo, index }: { repo: GitHubRepoItem; index: number }) {
  const { t } = useTranslations();
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-2xl border border-[#e6e3dc] bg-white p-4 shadow-sw-xs">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-[10px] text-ink-soft shrink-0">{index + 1}.</span>
          <a
            href={repo.url}
            target="_blank"
            rel="noopener noreferrer"
            className="truncate text-xs font-bold text-ink hover:underline"
          >
            {repo.name}
          </a>
        </div>
        <span
          className={`shrink-0 ml-2 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase ${
            repo.visibility === 'PUBLIC'
              ? 'border-green-200 bg-green-50 text-green-600'
              : 'border-amber-200 bg-[#fbf6e9] text-amber-600'
          }`}
        >
          {repo.visibility}
        </span>
      </div>
      <p className="mt-2 text-xs text-ink-soft line-clamp-2">
        {repo.description || t('profile.github.noDescription')}
      </p>
      <div className="flex flex-wrap gap-1 mt-2">
        {repo.languages.slice(0, 3).map((lang) => (
          <span
            key={lang}
            className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-600"
          >
            {lang}
          </span>
        ))}
        {repo.topics.slice(0, 3).map((topic) => (
          <span
            key={topic}
            className="rounded-full border border-green-200 bg-green-50 px-2 py-0.5 text-[10px] font-semibold text-green-600"
          >
            {topic}
          </span>
        ))}
      </div>
      <div className="flex items-center gap-3 mt-2 text-[10px] text-ink-soft">
        {repo.stargazer_count > 0 && <span>⭐ {repo.stargazer_count}</span>}
        {repo.readme && (
          <button onClick={() => setExpanded(!expanded)} className="text-primary hover:underline">
            {expanded ? t('profile.github.hideReadme') : t('profile.github.showReadme')}
          </button>
        )}
      </div>
      {expanded && repo.readme && (
        <pre className="mt-2 max-h-40 overflow-y-auto overflow-x-auto whitespace-pre-wrap rounded-xl border border-[#e6e3dc] bg-secondary/30 p-3 text-[10px]">
          {repo.readme}
        </pre>
      )}
    </div>
  );
}
