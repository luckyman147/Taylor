'use client';

import React, { useState } from 'react';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';
import Plus from 'lucide-react/dist/esm/icons/plus';
import X from 'lucide-react/dist/esm/icons/x';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface StringListSectionProps {
  title: string;
  items: string[];
  emptyText: string;
  addPlaceholder: string;
  addLabel: string;
  removeLabel: string;
  onAdd: (value: string) => void;
  onRemove: (index: number) => void;
  busy?: boolean;
}

export function StringListSection({
  title,
  items,
  emptyText,
  addPlaceholder,
  addLabel,
  removeLabel,
  onAdd,
  onRemove,
  busy = false,
}: StringListSectionProps) {
  const [draft, setDraft] = useState('');

  const submit = () => {
    const value = draft.trim();
    if (!value) return;
    onAdd(value);
    setDraft('');
  };

  return (
    <section className="rounded-2xl border border-[#e6e3dc] bg-white p-5 shadow-sw-xs">
      <div className="mb-4 text-xs font-bold uppercase tracking-wide text-primary">{title}</div>
      {items.length === 0 ? (
        <p className="mb-3 text-sm text-ink-soft">{emptyText}</p>
      ) : (
        <div className="mb-3 flex flex-wrap gap-2">
          {items.map((item, idx) => (
            <span
              key={`${item}-${idx}`}
              className="inline-flex items-center gap-1.5 rounded-full border border-[#e6e3dc] bg-paper-tint px-3 py-1 text-sm text-ink"
            >
              {item}
              <button
                type="button"
                onClick={() => onRemove(idx)}
                disabled={busy}
                aria-label={`${removeLabel}: ${item}`}
                className="text-steel-grey transition-colors hover:text-destructive disabled:opacity-50"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={addPlaceholder}
          disabled={busy}
        />
        <Button size="sm" onClick={submit} disabled={busy || draft.trim() === ''}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          {addLabel}
        </Button>
      </div>
    </section>
  );
}
