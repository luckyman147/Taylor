'use client';

import {
  Search,
  User,
  Briefcase,
  Mail,
  BarChart3,
  Globe,
  Plug,
  Wrench,
} from 'lucide-react';
import { useSlashCommand, type SlashCommand } from '@/hooks/use-slash-command';

interface SlashCommandPopoverProps {
  query: string;
  onSelect: (toolName: string) => void;
  onClose: () => void;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
}

const GROUP_ICONS: Record<string, typeof Search> = {
  Jobs: Briefcase,
  Profile: User,
  Skills: BarChart3,
  Applications: Briefcase,
  Contacts: User,
  Email: Mail,
  Research: Globe,
  MCP: Plug,
};

function ToolIcon({ tool }: { tool: SlashCommand }) {
  if (tool.source === 'mcp') return <Plug className="h-3.5 w-3.5 shrink-0 text-violet-500" />;
  const Icon = GROUP_ICONS[tool.group] || Wrench;
  return <Icon className="h-3.5 w-3.5 shrink-0 text-ink-muted" />;
}

export function SlashCommandPopover(props: SlashCommandPopoverProps) {
  const { loading, items, groups, flatItems, activeIndex, setActiveIndex, handleSelect, listRef } =
    useSlashCommand(props);

  if (loading && items.length === 0) {
    return (
      <div className="z-50 absolute bottom-full left-0 mb-2 w-80 rounded-2xl border border-[#e2e0d8] bg-[#f8f7f5] p-3 shadow-sw-sm">
        <span className="text-xs text-ink-muted">Loading tools...</span>
      </div>
    );
  }

  if (flatItems.length === 0) {
    return (
      <div className="z-50 absolute bottom-full left-0 mb-2 w-80 rounded-2xl border border-[#e2e0d8] bg-[#f8f7f5] p-3 shadow-sw-sm">
        <span className="text-xs text-ink-muted">
          No tools match &quot;/{props.query}&quot;
        </span>
      </div>
    );
  }

  let globalIndex = 0;

  return (
    <div className="z-50 absolute bottom-full left-0 mb-2 w-80 rounded-2xl border border-[#e2e0d8] bg-[#f8f7f5] py-2 shadow-sw-sm max-h-80 overflow-y-auto">
      <div className="px-3 pb-1.5 pt-1">
        <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-muted">
          Tools &amp; Commands
        </span>
      </div>
      <div ref={listRef}>
        {Array.from(groups.entries()).map(([group, groupItems]) => {
          return (
            <div key={group}>
              <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-muted">
                {group}
              </div>
              {groupItems.map((item) => {
                const idx = globalIndex++;
                const isActive = idx === activeIndex;
                return (
                  <button
                    key={item.name}
                    data-index={idx}
                    onClick={() => handleSelect(item.name)}
                    onMouseEnter={() => setActiveIndex(idx)}
                    className={`flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors ${
                      isActive ? 'bg-primary/10 text-primary' : 'text-ink hover:bg-[#e6e3dc]'
                    }`}
                  >
                    <ToolIcon tool={item} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-medium font-mono">
                          /{item.name}
                        </span>
                        {item.source === 'mcp' && item.mcpServer && (
                          <span className="shrink-0 rounded bg-violet-100 px-1 py-0.5 text-[9px] font-semibold text-violet-600">
                            {item.mcpServer}
                          </span>
                        )}
                      </div>
                      <span className="block truncate text-xs text-ink-muted">
                        {item.description}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
