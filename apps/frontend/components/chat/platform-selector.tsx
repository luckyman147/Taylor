'use client';

import { useCallback, useEffect, useState } from 'react';
import { Loader2, WifiOff } from 'lucide-react';
import { fetchMCPStatus, type MCPServerStatus } from '@/lib/api/mcp';

export interface Platform {
  key: string;
  label: string;
  color: string;
  bg: string;
}

const JOB_PLATFORMS: Platform[] = [
  { key: 'linkedin', label: 'LinkedIn', color: 'text-[#0A66C2]', bg: 'bg-blue-50' },
  { key: 'rss', label: 'RSS Feeds', color: 'text-[#EE802F]', bg: 'bg-orange-50' },
  { key: 'exa', label: 'Exa', color: 'text-violet-600', bg: 'bg-violet-50' },
  { key: 'remote_freelance', label: 'Remote', color: 'text-[#0891B2]', bg: 'bg-cyan-50' },
  { key: 'tunisian', label: 'Tunisian', color: 'text-[#E70013]', bg: 'bg-red-50' },
  { key: 'keejob', label: 'Keejob', color: 'text-[#D97706]', bg: 'bg-amber-50' },
];

interface PlatformSelectorProps {
  selected: string[];
  onChange: (sources: string[]) => void;
}

export function PlatformSelector({ selected, onChange }: PlatformSelectorProps) {
  const [statuses, setStatuses] = useState<Record<string, MCPServerStatus>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchMCPStatus()
      .then((res) => setStatuses(res.mcp_servers))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const isAvailable = useCallback(
    (key: string) => {
      const s = statuses[key];
      return s?.available ?? false;
    },
    [statuses]
  );

  const toggle = useCallback(
    (key: string) => {
      if (selected.includes(key)) {
        onChange(selected.filter((s) => s !== key));
      } else {
        onChange([...selected, key]);
      }
    },
    [selected, onChange]
  );

  const toggleAll = useCallback(() => {
    const available = JOB_PLATFORMS.filter((p) => isAvailable(p.key)).map((p) => p.key);
    if (available.length === selected.length) {
      onChange([]);
    } else {
      onChange(available);
    }
  }, [selected, onChange, isAvailable]);

  if (loading) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-ink-muted">
        <Loader2 className="h-3 w-3 animate-spin" />
        Loading sources...
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-xs font-semibold text-ink-soft">Job Sources</label>
        <button
          type="button"
          onClick={toggleAll}
          className="text-[10px] font-medium text-primary hover:underline"
        >
          {selected.length === JOB_PLATFORMS.filter((p) => isAvailable(p.key)).length
            ? 'Deselect all'
            : 'Select all available'}
        </button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {JOB_PLATFORMS.map((platform) => {
          const available = isAvailable(platform.key);
          const isSelected = selected.includes(platform.key);
          const disabled = !available;

          return (
            <button
              key={platform.key}
              type="button"
              disabled={disabled}
              onClick={() => toggle(platform.key)}
              title={disabled ? `Not connected — add ${platform.label} in MCP Servers` : undefined}
              className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                disabled
                  ? 'cursor-not-allowed border-[#e6e3dc] bg-gray-50 text-gray-400 opacity-60'
                  : isSelected
                    ? 'border-primary bg-primary text-white'
                    : `border-[#e6e3dc] bg-white text-ink-soft hover:bg-[#e6e3dc]`
              }`}
            >
              {disabled && <WifiOff className="h-2.5 w-2.5" />}
              {platform.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
