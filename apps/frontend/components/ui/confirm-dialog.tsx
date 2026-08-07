'use client';

import * as React from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from './dialog';
import { Button } from './button';
import { useTranslations } from '@/lib/i18n';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2';
import AlertTriangle from 'lucide-react/dist/esm/icons/alert-triangle';
import Check from 'lucide-react/dist/esm/icons/check';
import Info from 'lucide-react/dist/esm/icons/info';

/**
 * Confirm Dialog Component
 *
 * A modal dialog for confirming user actions with semantic variants:
 * - danger: Destructive actions (delete, remove)
 * - warning: Caution actions (reset, overwrite)
 * - success: Positive confirmations
 * - default: Neutral confirmations
 */

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  errorMessage?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  confirmDisabled?: boolean;
  variant?: 'danger' | 'warning' | 'success' | 'default';
  closeOnConfirm?: boolean;
  onConfirm: () => void;
  onCancel?: () => void;
  showCancelButton?: boolean;
}

export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open,
  onOpenChange,
  title,
  description,
  errorMessage,
  confirmLabel,
  cancelLabel,
  confirmDisabled = false,
  variant = 'default',
  closeOnConfirm = true,
  onConfirm,
  onCancel,
  showCancelButton = true,
}) => {
  const { t } = useTranslations();
  const finalConfirmLabel = confirmLabel ?? t('common.confirm');
  const finalCancelLabel = cancelLabel ?? t('common.cancel');

  const handleConfirm = () => {
    if (confirmDisabled) return;
    onConfirm();
    if (closeOnConfirm) {
      onOpenChange(false);
    }
  };

  const handleCancel = () => {
    onCancel?.();
    onOpenChange(false);
  };

  const variantStyles = {
    danger: {
      badge: 'bg-destructive/10 text-destructive',
      icon: Trash2,
      buttonVariant: 'destructive' as const,
    },
    warning: {
      badge: 'bg-warning/10 text-warning',
      icon: AlertTriangle,
      buttonVariant: 'warning' as const,
    },
    success: {
      badge: 'bg-success/10 text-success',
      icon: Check,
      buttonVariant: 'success' as const,
    },
    default: {
      badge: 'bg-primary/10 text-primary',
      icon: Info,
      buttonVariant: 'default' as const,
    },
  };

  const { badge, icon: Icon, buttonVariant } = variantStyles[variant];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="rounded-2xl sm:max-w-[425px] p-0 gap-0 overflow-hidden">
        <DialogHeader className="p-6 pb-4">
          <div className="flex items-start gap-4">
            <div
              className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl ${badge}`}
            >
              <Icon className="h-7 w-7" />
            </div>
            <div className="min-w-0 flex-1 pt-0.5">
              <DialogTitle className="font-sans text-xl font-bold uppercase tracking-tight">
                {title}
              </DialogTitle>
              <DialogDescription className="mt-2 max-h-60 overflow-y-auto whitespace-pre-wrap pl-0 text-xs text-ink-soft [overflow-wrap:anywhere]">
                {description}
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>
        {errorMessage && (
          <div className="px-6 pb-4">
            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive max-h-60 overflow-y-auto whitespace-pre-wrap [overflow-wrap:anywhere]">
              {errorMessage}
            </div>
          </div>
        )}
        <DialogFooter className="flex-row justify-end gap-3 border-t border-[#e6e3dc] bg-secondary p-4">
          {showCancelButton && (
            <Button variant="outline" onClick={handleCancel} className="rounded-full">
              {finalCancelLabel}
            </Button>
          )}
          <Button
            variant={buttonVariant}
            onClick={handleConfirm}
            className="rounded-full"
            disabled={confirmDisabled}
          >
            {finalConfirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
