'use client';

import { useCallback, useEffect, useState } from 'react';
import { Wifi, WifiOff, AlertTriangle, Loader2 } from 'lucide-react';
import { fetchMCPServers, type MCPServer } from '@/lib/api/mcp';

interface MCPBarProps {
  onMCPsChanged?: () => void;
}

export function MCPBar({ onMCPsChanged }: MCPBarProps) {
  const [servers, setServers] = useState<MCPServer[]>([]);
  const [loading, setLoading] = useState(true);

  const loadServers = useCallback(async () => {
    try {
      const data = await fetchMCPServers();
      setServers(data);
    } catch {
      // Silently fail — MCP bar is non-critical
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadServers();
  }, [loadServers]);

  const connectedCount = servers.filter((s) => s.status === 'connected').length;
  const toolCount = servers.reduce((acc, s) => {
    try {
      const tools = s.tools_json ? JSON.parse(s.tools_json) : [];
      return acc + tools.length;
    } catch {
      return acc;
    }
  }, 0);

  if (loading) {
    return (
      <div className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] text-ink-muted">
        <Loader2 className="h-3 w-3 animate-spin" />
        Loading MCPs...
      </div>
    );
  }

  if (servers.length === 0) return null;

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {servers.map((server) => (
        <div
          key={server.server_id}
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium border transition-colors ${
            server.status === 'connected'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
              : server.status === 'error'
                ? 'border-red-200 bg-red-50 text-red-600'
                : 'border-[#e6e3dc] bg-[#faf9f7] text-ink-muted'
          }`}
        >
          {server.status === 'connected' ? (
            <Wifi className="h-2.5 w-2.5" />
          ) : server.status === 'error' ? (
            <AlertTriangle className="h-2.5 w-2.5" />
          ) : (
            <WifiOff className="h-2.5 w-2.5" />
          )}
          <span>{server.display_name || server.name}</span>
        </div>
      ))}
      {connectedCount > 0 && (
        <span className="text-[10px] text-ink-muted">
          {connectedCount} connected · {toolCount} tools
        </span>
      )}
    </div>
  );
}
