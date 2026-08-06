/**
 * MCP status and configuration API client.
 */

import { apiFetch, apiPost } from './client';

// Simple TTL cache
const _cache = new Map<string, { data: unknown; expiry: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function cached<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = _cache.get(key);
  if (hit && hit.expiry > now) {
    return Promise.resolve(hit.data as T);
  }
  return fetcher().then((data) => {
    _cache.set(key, { data, expiry: now + CACHE_TTL });
    return data;
  });
}

export function invalidateGitHubCache() {
  _cache.delete('github_status');
  _cache.delete('github_repos');
}

// Invalidate on import to pick up latest data
invalidateGitHubCache();

export interface MCPServerStatus {
  available: boolean;
  backend: string;
  details: string;
  enabled: boolean;
}

export interface MCPStatusResponse {
  mcp_servers: Record<string, MCPServerStatus>;
}

export interface GitHubStatusResponse {
  installed: boolean;
  authenticated: boolean;
  user: string | null;
  message: string;
}

export interface GitHubRepo {
  name: string;
  description: string | null;
  visibility: string;
  url: string;
  pushed_at: string | null;
  stargazer_count: number;
  is_fork: boolean;
  is_archived: boolean;
  languages: string[];
  topics: string[];
  readme: string;
}

export interface GitHubReposResponse {
  repos: GitHubRepo[];
  total: number;
}

export async function fetchMCPStatus(): Promise<MCPStatusResponse> {
  const res = await apiFetch('/mcp/status');
  if (!res.ok) throw new Error('Failed to fetch MCP status');
  return res.json();
}

export async function configureMCP(mcpName: string, enabled: boolean): Promise<void> {
  await apiPost('/mcp/configure', { mcp_name: mcpName, enabled });
}

export async function restartMCPs(): Promise<{
  message: string;
  available: number;
  total: number;
}> {
  const res = await apiPost('/mcp/restart', {});
  if (!res.ok) throw new Error('Failed to restart MCPs');
  _cache.delete('mcp_status');
  return res.json();
}

export async function fetchGitHubStatus(): Promise<GitHubStatusResponse> {
  return cached('github_status', async () => {
    const res = await apiFetch('/github/github/status');
    if (!res.ok) throw new Error('Failed to fetch GitHub status');
    return res.json();
  });
}

export async function fetchGitHubAuthUrl(): Promise<{ url: string | null; error?: string }> {
  const res = await apiFetch('/github/github/auth-url');
  if (!res.ok) throw new Error('Failed to get auth URL');
  return res.json();
}

export async function githubCallback(
  code?: string,
  token?: string
): Promise<{ authenticated: boolean; user?: string; message: string }> {
  const res = await apiPost('/github/github/callback', { code, token });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.detail || 'GitHub authentication failed');
  }
  invalidateGitHubCache();
  return res.json();
}

export async function disconnectGitHub(): Promise<void> {
  await apiPost('/github/github/disconnect', {});
  invalidateGitHubCache();
}

export async function fetchGitHubRepos(): Promise<GitHubReposResponse> {
  return cached('github_repos', async () => {
    const res = await apiFetch('/github/github/repos');
    if (!res.ok) throw new Error('Failed to fetch GitHub repos');
    return res.json();
  });
}
