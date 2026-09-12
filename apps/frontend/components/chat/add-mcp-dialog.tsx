'use client';

import { useCallback, useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ToggleSwitch } from '@/components/ui/toggle-switch';
import {
  Loader2,
  CheckCircle2,
  AlertCircle,
  ArrowLeft,
  Plus,
  Wifi,
  WifiOff,
  Plug,
} from 'lucide-react';
import {
  fetchMCPStatus,
  configureMCP,
  createMCPServer,
  connectMCPServer,
  discoverMCPTools,
  type MCPServerStatus,
} from '@/lib/api/mcp';
import { MCP_BRAND_ICONS } from './mcp-brand-icons';

interface AddMCPDialogProps {
  open: boolean;
  onClose: () => void;
  onAdded?: () => void;
}

const BUILTIN_MCPS: {
  key: string;
  label: string;
  description: string;
  color: string;
  bg: string;
}[] = [
  { key: 'linkedin', label: 'LinkedIn', description: 'Job scraping & profile data', color: 'text-[#0A66C2]', bg: 'bg-blue-50' },
  { key: 'exa', label: 'Exa', description: 'AI-powered web search', color: 'text-violet-600', bg: 'bg-violet-50' },
  { key: 'github', label: 'GitHub', description: 'Repos, issues & code', color: 'text-[#24292F]', bg: 'bg-gray-100' },
  { key: 'rss', label: 'RSS Feeds', description: 'WeWorkRemotely, Dice', color: 'text-[#EE802F]', bg: 'bg-orange-50' },
  { key: 'web', label: 'Web Reader', description: 'Jina page extraction', color: 'text-[#059669]', bg: 'bg-emerald-50' },
  { key: 'tunisian', label: 'Tunisian', description: 'freelances.tn listings', color: 'text-[#E70013]', bg: 'bg-red-50' },
  { key: 'remote_freelance', label: 'Remote', description: 'RemoteOK, Himalayas', color: 'text-[#0891B2]', bg: 'bg-cyan-50' },
  { key: 'keejob', label: 'Keejob', description: 'Tunisia job board', color: 'text-[#D97706]', bg: 'bg-amber-50' },
];

type View = 'list' | 'add';
type Step = 'form' | 'connecting' | 'discovering' | 'done' | 'error';

export function AddMCPDialog({ open, onClose, onAdded }: AddMCPDialogProps) {
  const [builtinStatus, setBuiltinStatus] = useState<Record<string, MCPServerStatus>>({});
  const [toggling, setToggling] = useState<string | null>(null);

  const [view, setView] = useState<View>('list');
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [step, setStep] = useState<Step>('form');
  const [error, setError] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetchMCPStatus();
      setBuiltinStatus(res.mcp_servers);
    } catch {
      // Non-critical
    }
  }, []);

  useEffect(() => {
    if (open) {
      void loadStatus();
    }
  }, [open, loadStatus]);

  const reset = () => {
    setName('');
    setUrl('');
    setDisplayName('');
    setStep('form');
    setError(null);
    setView('list');
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleToggle = async (mcpKey: string, enabled: boolean) => {
    setToggling(mcpKey);
    try {
      await configureMCP(mcpKey, enabled);
      setBuiltinStatus((prev) => ({
        ...prev,
        [mcpKey]: { ...prev[mcpKey], enabled },
      }));
      onAdded?.();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : `Failed to toggle ${mcpKey}`);
    } finally {
      setToggling(null);
    }
  };

  const handleSubmit = async () => {
    if (!name.trim()) return;

    try {
      const server = await createMCPServer({
        name: name.trim(),
        url: url.trim() || undefined,
        display_name: displayName.trim() || undefined,
      });

      setStep('connecting');
      try {
        await connectMCPServer(server.server_id);
      } catch {
        // Connection may fail — server still registered
      }

      setStep('discovering');
      try {
        await discoverMCPTools();
      } catch {
        // Non-critical
      }

      setStep('done');
      onAdded?.();
      setTimeout(handleClose, 1200);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to add server');
      setStep('error');
    }
  };

  const enabledCount = Object.values(builtinStatus).filter((s) => s.enabled).length;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose()}>
      <DialogContent className="max-w-lg p-0 overflow-hidden">
        {/* ── Header ────────────────────────────────────── */}
        <DialogHeader className="px-6 pt-6 pb-0">
          {view === 'add' ? (
            <div className="flex items-center gap-3">
              <button
                onClick={() => { setView('list'); setError(null); setStep('form'); }}
                className="flex h-7 w-7 items-center justify-center rounded-lg hover:bg-[#f0efe9] transition-colors"
              >
                <ArrowLeft className="h-4 w-4 text-ink" />
              </button>
              <DialogTitle>Add Custom MCP</DialogTitle>
            </div>
          ) : (
            <DialogTitle>MCP Servers</DialogTitle>
          )}
          <p className="text-sm text-ink-soft mt-1">
            {view === 'add'
              ? 'Register a new MCP server and discover its tools'
              : 'Enable built-in integrations or add your own'}
          </p>
        </DialogHeader>

        {/* ── Nav tabs ──────────────────────────────────── */}
        {view === 'list' && (
          <div className="px-6 pt-4 pb-3">
            <div className="flex gap-2">
              <div className="flex items-center gap-2 rounded-lg bg-[#f0efe9] px-3 py-1.5 text-xs font-medium text-ink">
                <span>Integrations</span>
                <span className="rounded-full bg-white px-1.5 py-0.5 text-[10px] font-semibold text-ink-muted">
                  {enabledCount}/{BUILTIN_MCPS.length}
                </span>
              </div>
              <button
                onClick={() => setView('add')}
                className="flex items-center gap-1.5 rounded-lg border border-dashed border-[#d1cec7] px-3 py-1.5 text-xs font-medium text-ink-muted hover:border-primary hover:text-primary transition-colors"
              >
                <Plus className="h-3 w-3" />
                Custom MCP
              </button>
            </div>
          </div>
        )}

        {/* ── View: Built-in MCPs ───────────────────────── */}
        {view === 'list' && (
          <div className="px-6 pb-6">
            <div className="grid grid-cols-2 gap-2">
              {BUILTIN_MCPS.map((mcp) => {
                const status = builtinStatus[mcp.key];
                const isEnabled = status?.enabled ?? false;
                const isAvailable = status?.available ?? false;
                const Icon = MCP_BRAND_ICONS[mcp.key];
                const isToggling = toggling === mcp.key;

                return (
                  <div
                    key={mcp.key}
                    className={`relative rounded-xl border transition-all ${
                      isEnabled
                        ? 'border-primary/20 bg-primary/5 shadow-sm'
                        : 'border-[#e6e3dc] bg-white hover:border-[#d1cec7]'
                    }`}
                  >
                    <div className="p-3">
                      <div className="flex items-start justify-between mb-2">
                        <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${mcp.bg} ${mcp.color}`}>
                          <Icon className="h-4 w-4" />
                        </div>
                        {isToggling ? (
                          <Loader2 className="h-3.5 w-3.5 mt-0.5 animate-spin text-ink-muted" />
                        ) : (
                          <ToggleSwitch
                            checked={isEnabled}
                            onCheckedChange={(checked) => void handleToggle(mcp.key, checked)}
                            label=""
                            disabled={!isAvailable && !isEnabled}
                          />
                        )}
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-medium text-ink">{mcp.label}</span>
                        {isEnabled && isAvailable ? (
                          <Wifi className="h-3 w-3 text-emerald-500" />
                        ) : isEnabled && !isAvailable ? (
                          <WifiOff className="h-3 w-3 text-red-400" />
                        ) : null}
                      </div>
                      <p className="text-[11px] text-ink-muted mt-0.5 leading-snug">
                        {mcp.description}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── View: Add Custom MCP ──────────────────────── */}
        {view === 'add' && (
          <div className="px-6 pb-6 pt-4">
            {step === 'form' && (
              <div className="space-y-4">
                <div className="rounded-xl border border-[#e6e3dc] bg-[#faf9f7] p-4 space-y-4">
                  <div>
                    <Label className="text-xs font-medium">Server Name *</Label>
                    <Input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="e.g. brave_search"
                      className="mt-1.5 h-9 text-sm"
                      autoFocus
                      onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
                    />
                    <p className="mt-1 text-[11px] text-ink-muted">
                      Unique identifier for this server
                    </p>
                  </div>
                  <div>
                    <Label className="text-xs font-medium">Display Name</Label>
                    <Input
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder="e.g. Brave Search"
                      className="mt-1.5 h-9 text-sm"
                    />
                  </div>
                  <div>
                    <Label className="text-xs font-medium">Transport URL</Label>
                    <Input
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      placeholder="https://api.example.com/mcp"
                      className="mt-1.5 h-9 text-sm"
                    />
                    <p className="mt-1 text-[11px] text-ink-muted">
                      HTTP endpoint for the MCP server
                    </p>
                  </div>
                </div>

                <Button
                  className="w-full"
                  onClick={handleSubmit}
                  disabled={!name.trim()}
                >
                  <Plug className="mr-1.5 h-4 w-4" />
                  Add Server & Discover Tools
                </Button>
              </div>
            )}

            {step === 'connecting' && (
              <div className="flex flex-col items-center gap-3 py-12">
                <Loader2 className="h-7 w-7 animate-spin text-primary" />
                <p className="text-sm text-ink-soft">Connecting to server...</p>
              </div>
            )}

            {step === 'discovering' && (
              <div className="flex flex-col items-center gap-3 py-12">
                <Loader2 className="h-7 w-7 animate-spin text-primary" />
                <p className="text-sm text-ink-soft">Discovering available tools...</p>
              </div>
            )}

            {step === 'done' && (
              <div className="flex flex-col items-center gap-3 py-12">
                <CheckCircle2 className="h-7 w-7 text-emerald-500" />
                <p className="text-sm text-ink-soft">Server added successfully</p>
              </div>
            )}

            {step === 'error' && (
              <div className="space-y-4">
                <div className="flex items-center gap-2 rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  {error}
                </div>
                <Button variant="outline" className="w-full" onClick={() => setStep('form')}>
                  Try Again
                </Button>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
