'use client';

import { X } from 'lucide-react';
import { useTranslations } from '@/lib/i18n';
import type { MemoryCandidate } from '@/lib/api/chat';

interface MemoryCardProps {
  candidates: MemoryCandidate[];
  onDismiss: (statement: string) => void;
}

export function MemoryCard({ candidates, onDismiss }: MemoryCardProps) {
  const { t } = useTranslations();

  if (candidates.length === 0) return null;

  return (
    <div className="rounded-xl border border-primary/15 bg-primary/5 p-3">
      <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-primary">
        {t('chat.memory.saved')}
      </div>
      <div className="space-y-1.5">
        {candidates.map((c, i) => (
          <div
            key={i}
            className="flex items-center justify-between gap-2 rounded-lg bg-white px-3 py-2 text-sm text-ink"
          >
            <span className="truncate">{c.statement}</span>
            <button
              onClick={() => onDismiss(c.statement)}
              className="shrink-0 rounded p-0.5 text-ink-muted hover:text-destructive"
              aria-label={t('chat.memory.dismiss')}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
