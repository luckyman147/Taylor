'use client';

import React, { useState, useRef, useEffect } from 'react';
import X from 'lucide-react/dist/esm/icons/x';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2';
import MoveRight from 'lucide-react/dist/esm/icons/move-right';
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useTranslations } from '@/lib/i18n';
import { APPLICATION_STATUS_ORDER, type ApplicationStatus } from '@/lib/api/tracker';
import { STATUS_DOT } from './status-colors';

interface BulkActionBarProps {
  selectedCount: number;
  onMove: (status: ApplicationStatus) => void;
  onDelete: () => void;
  onClear: () => void;
}

export function BulkActionBar({ selectedCount, onMove, onDelete, onClear }: BulkActionBarProps) {
  const { t } = useTranslations();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const moveRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (moveRef.current && !moveRef.current.contains(event.target as Node)) {
        setMoveOpen(false);
      }
    }
    if (moveOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [moveOpen]);

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-[#e6e3dc] bg-white p-3 shadow-sw-xs">
      <span className="flex h-9 items-center gap-1.5 rounded-full bg-primary px-4 text-xs font-bold uppercase tracking-wide text-white">
        {t('tracker.bulk.selected', { count: String(selectedCount) })}
      </span>

      <span className="mx-1 hidden h-6 w-px shrink-0 bg-[#e6e3dc] sm:block" />

      {/* Move-to — compact pill trigger with an inline stage menu */}
      <div className="relative" ref={moveRef}>
        <button
          type="button"
          onClick={() => setMoveOpen((open) => !open)}
          aria-haspopup="menu"
          aria-expanded={moveOpen}
          className="flex h-9 items-center gap-2 rounded-full border border-[#e6e3dc] bg-white px-4 text-xs font-bold uppercase tracking-wide text-ink shadow-sw-xs transition-all hover:border-primary hover:text-primary"
        >
          <MoveRight className="h-4 w-4 text-primary" />
          {t('tracker.bulk.moveTo')}
          <ChevronDown
            className={`h-3.5 w-3.5 transition-transform duration-200 ${
              moveOpen ? 'rotate-180' : ''
            }`}
          />
        </button>

        {moveOpen && (
          <div
            role="menu"
            aria-label={t('tracker.bulk.moveTo')}
            className="absolute right-0 top-full z-50 mt-2 w-56 rounded-2xl border border-[#e6e3dc] bg-white p-1.5 shadow-sw-lg"
          >
            {APPLICATION_STATUS_ORDER.map((status) => (
              <button
                key={status}
                type="button"
                role="menuitem"
                onClick={() => {
                  setMoveOpen(false);
                  onMove(status);
                }}
                className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-xs font-bold uppercase tracking-wide text-ink transition-colors hover:bg-paper-tint hover:text-primary"
              >
                <span className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[status]}`} />
                {t(`tracker.columns.${status}`)}
              </button>
            ))}
          </div>
        )}
      </div>

      <Button
        size="sm"
        className="rounded-full border border-destructive/30 bg-destructive/5 px-4 text-destructive transition-colors hover:border-destructive hover:bg-destructive hover:text-white"
        onClick={() => setConfirmDelete(true)}
      >
        <Trash2 className="h-4 w-4" />
        {t('common.delete')}
      </Button>

      <Button
        variant="ghost"
        size="sm"
        className="rounded-full px-4 text-ink-soft hover:text-ink"
        onClick={onClear}
      >
        <X className="h-4 w-4" />
        {t('tracker.bulk.clear')}
      </Button>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={t('tracker.bulk.deleteConfirmTitle')}
        description={t('tracker.bulk.deleteConfirmDescription', { count: String(selectedCount) })}
        confirmLabel={t('common.delete')}
        variant="warning"
        onConfirm={() => {
          setConfirmDelete(false);
          onDelete();
        }}
      />
    </div>
  );
}
