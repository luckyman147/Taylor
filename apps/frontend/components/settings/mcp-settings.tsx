'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Server,
  Plus,
  Trash2,
  RefreshCw,
  Wifi,
  WifiOff,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Key,
  ChevronDown,
  ChevronUp,
  Wrench,
} from 'lucide-react';
import {
  fetchMCPServers,
  createMCPServer,
  deleteMCPServer,
  connectMCPServer,
  disconnectMCPServer,
  resetMCPServerHealth,
  storeMCPCredential,
  testMCPServer,
  discoverServerTools,
  fetchServerTools,
  updateServerTool,
  type MCPServer,
  type MCPToolDef,
} from '@/lib/api/mcp';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { CredentialFields, type AuthType, type CredentialData } from './credential-fields';

export function MCPSettings() {
  const [servers, setServers] = useState<MCPServer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [showCredentialDialog, setShowCredentialDialog] = useState<string | null>(null);
  const [expandedServer, setExpandedServer] = useState<string | null>(null);
  const [newServer, setNewServer] = useState({ name: '', url: '', display_name: '' });
  const [newCredential, setNewCredential] = useState<CredentialData>({ auth_type: 'none' });
  const [connecting, setConnecting] = useState<string | null>(null);
  const [discovering, setDiscovering] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ serverId: string; success: boolean; message: string } | null>(null);
  const [serverTools, setServerTools] = useState<Record<string, MCPToolDef[]>>({});
  const [loadingTools, setLoadingTools] = useState<string | null>(null);

  const loadServers = useCallback(async () => {
    try {
      setLoading(true);
      const data = await fetchMCPServers();
      setServers(data);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load servers');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadServers();
  }, [loadServers]);

  const handleAddServer = async () => {
    if (!newServer.name.trim()) return;
    try {
      await createMCPServer({
        name: newServer.name,
        url: newServer.url || undefined,
        display_name: newServer.display_name || undefined,
      });
      setNewServer({ name: '', url: '', display_name: '' });
      setShowAddDialog(false);
      await loadServers();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to add server');
    }
  };

  const handleDeleteServer = async (serverId: string) => {
    try {
      await deleteMCPServer(serverId);
      await loadServers();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to delete server');
    }
  };

  const handleConnect = async (serverId: string) => {
    try {
      setConnecting(serverId);
      await connectMCPServer(serverId);
      await loadServers();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to connect');
    } finally {
      setConnecting(null);
    }
  };

  const handleDisconnect = async (serverId: string) => {
    try {
      await disconnectMCPServer(serverId);
      await loadServers();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to disconnect');
    }
  };

  const handleResetHealth = async (serverId: string) => {
    try {
      await resetMCPServerHealth(serverId);
      await loadServers();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to reset health');
    }
  };

  const handleAddCredential = async (serverId: string) => {
    try {
      await storeMCPCredential(serverId, {
        auth_type: newCredential.auth_type,
        auth_config: newCredential,
      });
      setNewCredential({ auth_type: 'none' });
      setShowCredentialDialog(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to store credential');
    }
  };

  const handleTestServer = async (serverId: string) => {
    try {
      setTesting(serverId);
      setTestResult(null);
      const result = await testMCPServer(serverId);
      setTestResult({
        serverId,
        success: result.success,
        message: result.success
          ? `Connected in ${result.latency_ms}ms`
          : `${result.error} (${result.latency_ms}ms)`,
      });
    } catch (e: unknown) {
      setTestResult({
        serverId,
        success: false,
        message: e instanceof Error ? e.message : 'Test failed',
      });
    } finally {
      setTesting(null);
    }
  };

  const handleDiscoverTools = async () => {
    try {
      setDiscovering('all');
      // Discover tools for all servers
      for (const server of servers) {
        if (server.enabled && server.url) {
          try {
            const result = await discoverServerTools(server.server_id);
            setServerTools((prev) => ({ ...prev, [server.server_id]: result.tools }));
          } catch {
            // Skip servers that fail
          }
        }
      }
      await loadServers();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to discover tools');
    } finally {
      setDiscovering(null);
    }
  };

  const handleDiscoverServerTools = async (serverId: string) => {
    try {
      setLoadingTools(serverId);
      const result = await discoverServerTools(serverId);
      setServerTools((prev) => ({ ...prev, [serverId]: result.tools }));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to discover tools');
    } finally {
      setLoadingTools(null);
    }
  };

  const handleLoadTools = async (serverId: string) => {
    try {
      setLoadingTools(serverId);
      const tools = await fetchServerTools(serverId);
      setServerTools((prev) => ({ ...prev, [serverId]: tools }));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load tools');
    } finally {
      setLoadingTools(null);
    }
  };

  const handleToggleTool = async (serverId: string, toolId: string, enabled: boolean) => {
    try {
      await updateServerTool(serverId, toolId, { enabled });
      setServerTools((prev) => ({
        ...prev,
        [serverId]: (prev[serverId] || []).map((t) =>
          t.id === toolId ? { ...t, enabled } : t
        ),
      }));
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to update tool');
    }
  };

  const statusIcon = (server: MCPServer) => {
    if (server.status === 'connected') return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
    if (server.status === 'error') return <AlertTriangle className="h-4 w-4 text-red-500" />;
    return <WifiOff className="h-4 w-4 text-ink-muted" />;
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-ink">MCP Servers</h3>
          <p className="text-sm text-ink-soft">
            Manage Model Context Protocol servers and their tools
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void handleDiscoverTools()}
            disabled={discovering !== null}
          >
            {discovering !== null ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            )}
            Discover Tools
          </Button>
          <Button size="sm" onClick={() => setShowAddDialog(true)}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            Add Server
          </Button>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
          <button onClick={() => setError(null)} className="ml-2 underline">
            Dismiss
          </button>
        </div>
      )}

      {/* Server list */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-ink-muted" />
        </div>
      ) : servers.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[#e6e3dc] py-12 text-center">
          <Server className="mx-auto mb-3 h-10 w-10 text-ink-muted" />
          <p className="text-sm text-ink-soft">No MCP servers registered</p>
          <p className="mt-1 text-xs text-ink-muted">
            Add a server to extend TAYLOR&apos;s capabilities
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {servers.map((server) => (
            <div
              key={server.server_id}
              className="rounded-xl border border-[#e6e3dc] bg-white overflow-hidden"
            >
              {/* Server header */}
              <div
                className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-[#faf9f7]"
                onClick={() => setExpandedServer(expandedServer === server.server_id ? null : server.server_id)}
              >
                <div className="flex items-center gap-3">
                  {statusIcon(server)}
                  <div>
                    <span className="text-sm font-medium text-ink">
                      {server.display_name || server.name}
                    </span>
                    <span className="ml-2 text-xs text-ink-muted">
                      {server.server_kind || 'remote'}
                    </span>
                  </div>
                  {server.url && (
                    <span className="rounded bg-[#f0efe9] px-2 py-0.5 text-[10px] text-ink-muted font-mono">
                      {server.url.length > 30 ? server.url.slice(0, 30) + '...' : server.url}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {server.health_consecutive_failures > 0 && (
                    <span className="text-[10px] text-red-500">
                      {server.health_consecutive_failures} failures
                    </span>
                  )}
                  {expandedServer === server.server_id ? (
                    <ChevronUp className="h-4 w-4 text-ink-muted" />
                  ) : (
                    <ChevronDown className="h-4 w-4 text-ink-muted" />
                  )}
                </div>
              </div>

              {/* Expanded details */}
              {expandedServer === server.server_id && (
                <div className="border-t border-[#e6e3dc] px-4 py-3 space-y-3 bg-[#faf9f7]">
                  {/* Status row */}
                  <div className="grid grid-cols-3 gap-4 text-xs">
                    <div>
                      <span className="text-ink-muted">Status</span>
                      <p className="font-medium text-ink capitalize">{server.status}</p>
                    </div>
                    <div>
                      <span className="text-ink-muted">Transport</span>
                      <p className="font-medium text-ink">{server.transport}</p>
                    </div>
                    <div>
                      <span className="text-ink-muted">Health Score</span>
                      <p className="font-medium text-ink">
                        {server.health_total_calls > 0
                          ? `${((server.health_success_calls / server.health_total_calls) * 100).toFixed(0)}%`
                          : 'N/A'}
                      </p>
                    </div>
                  </div>

                  {/* Error message */}
                  {server.error_message && (
                    <div className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">
                      {server.error_message}
                    </div>
                  )}

                  {/* Actions */}
                  <div className="flex gap-2 flex-wrap">
                    {server.status === 'connected' ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void handleDisconnect(server.server_id)}
                      >
                        <WifiOff className="mr-1.5 h-3 w-3" />
                        Disconnect
                      </Button>
                    ) : (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void handleConnect(server.server_id)}
                        disabled={connecting === server.server_id}
                      >
                        {connecting === server.server_id ? (
                          <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                        ) : (
                          <Wifi className="mr-1.5 h-3 w-3" />
                        )}
                        Connect
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void handleTestServer(server.server_id)}
                      disabled={testing === server.server_id}
                    >
                      {testing === server.server_id ? (
                        <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                      ) : (
                        <Wifi className="mr-1.5 h-3 w-3" />
                      )}
                      Test
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShowCredentialDialog(server.server_id)}
                    >
                      <Key className="mr-1.5 h-3 w-3" />
                      Credentials
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void handleResetHealth(server.server_id)}
                    >
                      <RefreshCw className="mr-1.5 h-3 w-3" />
                      Reset Health
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-destructive hover:bg-destructive/10"
                      onClick={() => void handleDeleteServer(server.server_id)}
                    >
                      <Trash2 className="mr-1.5 h-3 w-3" />
                      Delete
                    </Button>
                  </div>

                  {/* Tools section */}
                  <div className="mt-3 border-t border-[#e6e3dc] pt-3">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-1.5 text-xs text-ink-muted">
                        <Wrench className="h-3 w-3" />
                        <span>Tools</span>
                        {serverTools[server.server_id] && (
                          <span className="text-ink-muted">
                            ({serverTools[server.server_id].filter((t) => t.enabled).length}/
                            {serverTools[server.server_id].length} enabled)
                          </span>
                        )}
                      </div>
                      <div className="flex gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 px-2 text-[10px]"
                          onClick={() => void handleLoadTools(server.server_id)}
                          disabled={loadingTools === server.server_id}
                        >
                          {loadingTools === server.server_id ? (
                            <Loader2 className="h-2.5 w-2.5 animate-spin" />
                          ) : (
                            'Load'
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 px-2 text-[10px]"
                          onClick={() => void handleDiscoverServerTools(server.server_id)}
                          disabled={loadingTools === server.server_id}
                        >
                          {loadingTools === server.server_id ? (
                            <Loader2 className="h-2.5 w-2.5 animate-spin" />
                          ) : (
                            'Discover'
                          )}
                        </Button>
                      </div>
                    </div>

                    {serverTools[server.server_id] && serverTools[server.server_id].length > 0 ? (
                      <div className="space-y-1.5">
                        {serverTools[server.server_id].map((tool) => (
                          <div
                            key={tool.id}
                            className="flex items-center justify-between rounded-lg bg-white px-3 py-2 border border-[#e6e3dc]"
                          >
                            <div className="flex-1 min-w-0">
                              <p className="text-xs font-medium text-ink truncate">{tool.name}</p>
                              {tool.description && (
                                <p className="text-[10px] text-ink-muted truncate mt-0.5">
                                  {tool.description}
                                </p>
                              )}
                            </div>
                            <button
                              onClick={() => void handleToggleTool(server.server_id, tool.id, !tool.enabled)}
                              className={`ml-2 h-5 w-9 rounded-full transition-colors ${
                                tool.enabled ? 'bg-emerald-500' : 'bg-gray-300'
                              }`}
                            >
                              <span
                                className={`block h-4 w-4 rounded-full bg-white shadow transition-transform ${
                                  tool.enabled ? 'translate-x-4' : 'translate-x-0.5'
                                }`}
                              />
                            </button>
                          </div>
                        ))}
                      </div>
                    ) : serverTools[server.server_id] ? (
                      <p className="text-[10px] text-ink-muted text-center py-2">
                        No tools discovered. Click Discover to scan.
                      </p>
                    ) : null}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Add Server Dialog */}
      {showAddDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="mb-4 text-lg font-semibold text-ink">Add MCP Server</h3>
            <div className="space-y-4">
              <div>
                <Label className="text-sm">Server Name *</Label>
                <Input
                  value={newServer.name}
                  onChange={(e) => setNewServer({ ...newServer, name: e.target.value })}
                  placeholder="e.g. brave_search"
                  className="mt-1"
                />
              </div>
              <div>
                <Label className="text-sm">Display Name</Label>
                <Input
                  value={newServer.display_name}
                  onChange={(e) => setNewServer({ ...newServer, display_name: e.target.value })}
                  placeholder="e.g. Brave Search"
                  className="mt-1"
                />
              </div>
              <div>
                <Label className="text-sm">URL</Label>
                <Input
                  value={newServer.url}
                  onChange={(e) => setNewServer({ ...newServer, url: e.target.value })}
                  placeholder="https://api.example.com/mcp"
                  className="mt-1"
                />
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowAddDialog(false)}>
                Cancel
              </Button>
              <Button onClick={() => void handleAddServer()}>Add Server</Button>
            </div>
          </div>
        </div>
      )}

      {/* Credential Dialog */}
      {showCredentialDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-xl">
            <h3 className="mb-4 text-lg font-semibold text-ink">Add Credential</h3>
            <div className="space-y-4">
              <div>
                <Label className="text-sm">Auth Type</Label>
                <select
                  value={newCredential.auth_type}
                  onChange={(e) => setNewCredential({ ...newCredential, auth_type: e.target.value as AuthType })}
                  className="mt-1 w-full rounded-lg border border-[#e6e3dc] bg-white px-3 py-2 text-sm"
                >
                  <option value="none">None</option>
                  <option value="api_key">API Key</option>
                  <option value="bearer">Bearer Token</option>
                  <option value="basic">Basic Auth</option>
                  <option value="custom_headers">Custom Headers</option>
                  <option value="oauth">OAuth 2.0</option>
                </select>
              </div>
              <CredentialFields
                authType={newCredential.auth_type}
                data={newCredential}
                onChange={setNewCredential}
              />
              {testResult && testResult.serverId === showCredentialDialog && (
                <div
                  className={`rounded-lg px-3 py-2 text-xs ${
                    testResult.success
                      ? 'bg-emerald-50 text-emerald-600'
                      : 'bg-red-50 text-red-600'
                  }`}
                >
                  {testResult.message}
                </div>
              )}
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowCredentialDialog(null)}>
                Cancel
              </Button>
              <Button onClick={() => void handleAddCredential(showCredentialDialog)}>
                Store (Encrypted)
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
