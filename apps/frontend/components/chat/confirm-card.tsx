'use client';

import { useState } from 'react';
import { Check, X, Loader2, ShieldAlert, ChevronDown, ChevronUp } from 'lucide-react';
import { useTranslations } from '@/lib/i18n';
import type { PendingAction } from '@/lib/api/chat';

interface ConfirmCardProps {
  pendingAction: PendingAction;
  onConfirm: (token: string) => void;
  onCancel: (token: string) => void;
}

export function ConfirmCard({ pendingAction, onConfirm, onCancel }: ConfirmCardProps) {
  const { t } = useTranslations();
  const [executing, setExecuting] = useState(false);
  const [showArgs, setShowArgs] = useState(false);

  const handleConfirm = () => {
    setExecuting(true);
    onConfirm(pendingAction.token);
  };

  const hasArgs = pendingAction.args && Object.keys(pendingAction.args).length > 0;

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50/80 p-3.5 shadow-sw-xs">
      <div className="mb-1.5 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-xs font-bold text-amber-900">
          <ShieldAlert className="h-4 w-4 text-amber-600" />
          <span>{t('chat.confirm.pendingAction')}</span>
        </div>
        <span className="rounded bg-amber-200/60 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 uppercase tracking-wider">
          {pendingAction.tool}
        </span>
      </div>

      <p className="mb-2 text-xs leading-relaxed text-amber-800">{pendingAction.summary}</p>

      {hasArgs && (
        <div className="mb-3">
          <button
            onClick={() => setShowArgs(!showArgs)}
            className="flex items-center gap-1 text-[11px] font-medium text-amber-700 hover:text-amber-900"
          >
            {showArgs ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            {t('chat.confirm.arguments')}
          </button>
          {showArgs && (
            <pre className="mt-1 rounded border border-amber-200 bg-amber-100/50 p-2 text-[10px] text-amber-900 overflow-x-auto">
              {JSON.stringify(pendingAction.args, null, 2)}
            </pre>
          )}
        </div>
      )}

      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={handleConfirm}
          disabled={executing}
          className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
        >
          {executing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          {t('chat.confirm.execute')}
        </button>
        <button
          onClick={() => onCancel(pendingAction.token)}
          disabled={executing}
          className="flex items-center gap-1.5 rounded-lg border border-[#e6e3dc] bg-white px-3 py-1.5 text-xs font-bold text-ink-soft transition-colors hover:bg-[#faf9f7] disabled:opacity-50"
        >
          <X className="h-3.5 w-3.5" />
          {t('chat.confirm.cancel')}
        </button>
      </div>
    </div>
  );
}
