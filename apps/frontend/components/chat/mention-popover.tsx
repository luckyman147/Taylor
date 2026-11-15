'use client';

import { Building2, User, FileText } from 'lucide-react';
import { useMentionPopover } from '@/hooks/use-mention-popover';

interface MentionPopoverProps {
  query: string;
  onSelect: (name: string) => void;
  onClose: () => void;
  textareaRef: React.RefObject<HTMLTextAreaElement | null>;
}

const ICONS = { company: Building2, contact: User, resume: FileText } as const;
const GROUP_LABELS = { company: 'Companies', contact: 'Contacts', resume: 'Resumes' } as const;

export function MentionPopover(props: MentionPopoverProps) {
  const { loading, items, groups, flatItems, activeIndex, setActiveIndex, handleSelect, listRef } =
    useMentionPopover(props);

  if (loading && items.length === 0) {
    return (
      <div className="z-50 absolute bottom-full left-0 mb-2 w-72 rounded-2xl border border-[#e2e0d8] bg-[#f8f7f5] p-3 shadow-sw-sm">
        <span className="text-xs text-ink-muted">Loading...</span>
      </div>
    );
  }

  if (flatItems.length === 0) {
    return (
      <div className="z-50 absolute bottom-full left-0 mb-2 w-72 rounded-2xl border border-[#e2e0d8] bg-[#f8f7f5] p-3 shadow-sw-sm">
        <span className="text-xs text-ink-muted">No results for &quot;{props.query}&quot;</span>
      </div>
    );
  }

  let globalIndex = 0;

  return (
    <div className="z-50 absolute bottom-full left-0 mb-2 w-80 rounded-2xl border border-[#e2e0d8] bg-[#f8f7f5] py-2 shadow-sw-sm max-h-72 overflow-y-auto">
      <div ref={listRef}>
        {Array.from(groups.entries()).map(([type, groupItems]) => {
          const Icon = ICONS[type as keyof typeof ICONS];
          return (
            <div key={type}>
              <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-ink-muted">
                {GROUP_LABELS[type as keyof typeof GROUP_LABELS]}
              </div>
              {groupItems.map((item) => {
                const idx = globalIndex++;
                const isActive = idx === activeIndex;
                return (
                  <button
                    key={item.id}
                    data-index={idx}
                    onClick={() => handleSelect(item.name)}
                    onMouseEnter={() => setActiveIndex(idx)}
                    className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors ${
                      isActive ? 'bg-primary/10 text-primary' : 'text-ink hover:bg-[#e6e3dc]'
                    }`}
                  >
                    <Icon
                      className={`h-4 w-4 shrink-0 ${isActive ? 'text-primary' : 'text-ink-muted'}`}
                    />
                    <span className="truncate font-medium">{item.name}</span>
                    {item.subtitle && (
                      <span className="ml-auto truncate text-xs text-ink-muted">
                        {item.subtitle}
                      </span>
                    )}
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
