'use client';

import { useState } from 'react';
import { Check, X, Loader2 } from 'lucide-react';
import { useTranslations } from '@/lib/i18n';
import type { PendingAction } from '@/lib/api/chat';

interface ConfirmCardProps {
  pendingAction: PendingAction;
  onConfirm: (token: string) => void;
  onCancel: (token: string) => void;
}

export function ConfirmCard({
  pendingAction,
  onConfirm,
  onCancel,
}: ConfirmCardProps) {
  const { t } = useTranslations();
  const [executing, setExecuting] = useState(false);

  const handleConfirm = () => {
    setExecuting(true);
    onConfirm(pendingAction.token);
  };

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
      <div className="mb-2 text-xs font-bold text-amber-800">
        {t('chat.confirm.pendingAction')}
      </div>
      <p className="mb-3 text-xs text-amber-700">{pendingAction.summary}</p>
      <div className="flex gap-2">
        <button
          onClick={handleConfirm}
          disabled={executing}
          className="flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-bold text-white hover:bg-[#17304f] disabled:opacity-50"
        >
          {executing ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Check className="h-3 w-3" />
          )}
          {t('chat.confirm.execute')}
        </button>
        <button
          onClick={() => onCancel(pendingAction.token)}
          disabled={executing}
          className="flex items-center gap-1 rounded-md border border-[#e6e3dc] bg-white px-3 py-1.5 text-xs font-bold text-ink-soft hover:bg-[#f0ece4] disabled:opacity-50"
        >
          <X className="h-3 w-3" />
          {t('chat.confirm.cancel')}
        </button>
      </div>
    </div>
  );
}
