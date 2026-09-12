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

// ── Custom MCP Server Management ────────────────────────────────────

export interface MCPServer {
  server_id: string;
  name: string;
  display_name: string | null;
  url: string | null;
  transport: string;
  server_type: string;
  enabled: boolean;
  status: string;
  error_message: string | null;
  tools_json: string | null;
  last_connected_at: string | null;
  health_last_success: string | null;
  health_last_failure: string | null;
  health_consecutive_failures: number;
  health_avg_latency_ms: number;
  health_total_calls: number;
  health_success_calls: number;
  created_at: string;
  updated_at: string;
}

export interface MCPTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  server_id: string;
  server_name: string;
}

export async function fetchMCPServers(): Promise<MCPServer[]> {
  const res = await apiFetch('/mcp/servers');
  if (!res.ok) throw new Error('Failed to fetch MCP servers');
  return res.json();
}

export async function createMCPServer(data: {
  name: string;
  url?: string;
  transport?: string;
  display_name?: string;
}): Promise<MCPServer> {
  const res = await apiPost('/mcp/servers', data);
  if (!res.ok) throw new Error('Failed to create MCP server');
  return res.json();
}

export async function updateMCPServer(
  serverId: string,
  data: { url?: string; transport?: string; display_name?: string; enabled?: boolean }
): Promise<MCPServer> {
  const res = await apiFetch(`/mcp/servers/${serverId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error('Failed to update MCP server');
  return res.json();
}

export async function deleteMCPServer(serverId: string): Promise<void> {
  const res = await apiFetch(`/mcp/servers/${serverId}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete MCP server');
}

export async function connectMCPServer(
  serverId: string
): Promise<{ connected: boolean; tools: MCPTool[] }> {
  const res = await apiPost(`/mcp/servers/${serverId}/connect`, {});
  if (!res.ok) throw new Error('Failed to connect to MCP server');
  return res.json();
}

export async function disconnectMCPServer(serverId: string): Promise<void> {
  await apiPost(`/mcp/servers/${serverId}/disconnect`, {});
}

export async function fetchMCPServerHealth(
  serverId: string
): Promise<{
  server_id: string;
  health_score: number;
  healthy: boolean;
  consecutive_failures: number;
}> {
  const res = await apiFetch(`/mcp/servers/${serverId}/health`);
  if (!res.ok) throw new Error('Failed to fetch server health');
  return res.json();
}

export async function resetMCPServerHealth(serverId: string): Promise<void> {
  await apiPost(`/mcp/servers/${serverId}/reset-health`, {});
}

export async function storeMCPCredential(
  serverId: string,
  data: { auth_type: string; auth_config: Record<string, unknown> }
): Promise<{ credential_id: string }> {
  const res = await apiPost(`/mcp/servers/${serverId}/credentials`, data);
  if (!res.ok) throw new Error('Failed to store credential');
  return res.json();
}

export async function fetchMCPTools(): Promise<MCPTool[]> {
  const res = await apiFetch('/mcp/tools');
  if (!res.ok) throw new Error('Failed to fetch MCP tools');
  return res.json();
}

export async function discoverMCPTools(): Promise<{
  servers: number;
  total_tools: number;
  tools_by_server: Record<string, number>;
}> {
  const res = await apiPost('/mcp/discover', {});
  if (!res.ok) throw new Error('Failed to discover tools');
  return res.json();
}
