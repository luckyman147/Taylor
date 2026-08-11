/**
 * MCP status and configuration API client.
 */

import { apiFetch, apiPost } from './client';

// GitHub data is cached with an explicit check-then-fetch flow:
// fetchGitHubStatus() / fetchGitHubRepos() first look up the cache (memory +
// localStorage) and only call the backend MCP when the cache is empty, stale,
// or explicitly invalidated. Fetching repos is heavy (per-repo languages +
// READMEs), so the cache is persisted across page reloads.
const MEMORY_CACHE = new Map<string, { data: unknown; expiry: number }>();
const LS_CACHE_PREFIX = 'gh_cache_';
const GITHUB_STATUS_TTL = 5 * 60 * 1000; // 5 minutes
const GITHUB_REPOS_TTL = 30 * 60 * 1000; // 30 minutes — heavy to fetch
const IN_FLIGHT = new Map<string, Promise<unknown>>();

interface CacheEntry<T> {
  data: T;
  expiry: number;
}

function now(): number {
  return Date.now();
}

function readMemory<T>(key: string): T | null {
  const hit = MEMORY_CACHE.get(key);
  if (hit && hit.expiry > now()) return hit.data as T;
  return null;
}

function readPersisted<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(`${LS_CACHE_PREFIX}${key}`);
    if (!raw) return null;
    const entry = JSON.parse(raw) as CacheEntry<T>;
    if (typeof entry?.expiry !== 'number' || typeof entry?.data === 'undefined') return null;
    if (entry.expiry <= now()) {
      window.localStorage.removeItem(`${LS_CACHE_PREFIX}${key}`);
      return null;
    }
    return entry.data;
  } catch {
    return null;
  }
}

function writePersisted(key: string, data: unknown, ttl: number): void {
  try {
    const entry: CacheEntry<unknown> = { data, expiry: now() + ttl };
    window.localStorage.setItem(`${LS_CACHE_PREFIX}${key}`, JSON.stringify(entry));
  } catch {
    // localStorage unavailable (private mode / SSR) — memory cache still applies
  }
}

function invalidateKey(key: string): void {
  MEMORY_CACHE.delete(key);
  try {
    window.localStorage.removeItem(`${LS_CACHE_PREFIX}${key}`);
  } catch {
    // ignore storage errors
  }
}

/**
 * Resolve a cached value: memory first, then localStorage. Returns null when
 * the cache is empty or expired, so callers know they must fetch from MCP.
 */
export function getCached<T>(key: string): T | null {
  return readMemory<T>(key) ?? readPersisted<T>(key);
}

async function cached<T>(key: string, ttl: number, fetcher: () => Promise<T>): Promise<T> {
  const fresh = getCached<T>(key);
  if (fresh !== null) {
    MEMORY_CACHE.set(key, { data: fresh as never, expiry: now() + ttl });
    return fresh;
  }

  // Debounce concurrent calls so two mounted components fire one request.
  const inFlight = IN_FLIGHT.get(key);
  if (inFlight) {
    return inFlight as Promise<T>;
  }

  const request = fetcher().then((data) => {
    writePersisted(key, data, ttl);
    MEMORY_CACHE.set(key, { data: data as never, expiry: now() + ttl });
    return data;
  });
  IN_FLIGHT.set(key, request);
  try {
    return await request;
  } finally {
    IN_FLIGHT.delete(key);
  }
}

/** Force-refetch GitHub data on the next access (used after connect/disconnect). */
export function invalidateGitHubCache(): void {
  invalidateKey('github_status');
  invalidateKey('github_repos');
}

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
  IN_FLIGHT.delete('mcp_status');
  return res.json();
}

export async function fetchGitHubStatus(): Promise<GitHubStatusResponse> {
  return cached('github_status', GITHUB_STATUS_TTL, async () => {
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
  return cached('github_repos', GITHUB_REPOS_TTL, async () => {
    const res = await apiFetch('/github/github/repos');
    if (!res.ok) throw new Error('Failed to fetch GitHub repos');
    return res.json();
  });
}
