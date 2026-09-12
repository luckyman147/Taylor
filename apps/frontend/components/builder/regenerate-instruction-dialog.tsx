'use client';

import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  ArrowLeft,
  Sparkles,
  Briefcase,
  FolderKanban,
  Lightbulb,
  FileText,
  CircleAlert,
} from 'lucide-react';
import { useTranslations } from '@/lib/i18n';
import type { RegenerateItemInput } from '@/lib/api/enrichment';

interface RegenerateInstructionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedItems: RegenerateItemInput[];
  instruction: string;
  onInstructionChange: (instruction: string) => void;
  error: string | null;
  onBack: () => void;
  onGenerate: () => void;
  isGenerating: boolean;
}

/**
 * RegenerateInstructionDialog Component
 *
 * Second step of the regenerate wizard.
 * Shows selected items and allows user to input improvement instructions.
 * Soft card design with pill badges.
 */
export const RegenerateInstructionDialog: React.FC<RegenerateInstructionDialogProps> = ({
  open,
  onOpenChange,
  selectedItems,
  instruction,
  onInstructionChange,
  error,
  onBack,
  onGenerate,
  isGenerating,
}) => {
  const { t } = useTranslations();

  const resolveErrorMessage = (value: string) => {
    if (value === 'No items selected') {
      return t('builder.regenerate.selectDialog.noItemsSelected');
    }

    if (/network|fetch/i.test(value) || value.includes('Failed to fetch')) {
      return t('builder.regenerate.errors.networkError');
    }

    return t('builder.regenerate.errors.generationFailed');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Allow Enter key in textarea without closing dialog
    if (e.key === 'Enter') {
      e.stopPropagation();
    }
  };

  const getItemIcon = (itemType: string) => {
    switch (itemType) {
      case 'experience':
        return <Briefcase className="h-3.5 w-3.5 text-primary" />;
      case 'project':
        return <FolderKanban className="h-3.5 w-3.5 text-primary" />;
      case 'skills':
        return <Lightbulb className="h-3.5 w-3.5 text-primary" />;
      case 'summary':
        return <FileText className="h-3.5 w-3.5 text-primary" />;
      default:
        return null;
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px] rounded-2xl p-0 gap-0 overflow-hidden">
        <DialogHeader className="p-6 pb-4 border-b border-[#e6e3dc]">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10">
                <Sparkles className="h-4 w-4 text-primary" />
              </span>
              <div>
                <DialogTitle className="font-sans text-lg font-bold text-ink">
                  {t('builder.regenerate.instructionDialog.title')}
                </DialogTitle>
                <DialogDescription className="mt-1 text-xs text-steel-grey">
                  {t('builder.regenerate.instructionDialog.subtitle')}
                </DialogDescription>
              </div>
            </div>
            <span className="inline-flex w-fit items-center rounded-full border border-secondary/80 bg-secondary px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-steel-grey">
              {t('builder.regenerate.stepLabel', { current: '2', total: '3' })}
            </span>
          </div>
        </DialogHeader>

        <div className="space-y-6 p-6">
          {error ? (
            <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-red-700">
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
              <p className="text-sm">{resolveErrorMessage(error)}</p>
            </div>
          ) : null}

          {/* Selected Items Summary */}
          <div className="space-y-2.5">
            <label className="text-xs font-bold uppercase tracking-wider text-steel-grey">
              {t('builder.regenerate.instructionDialog.selectedItems')}
            </label>
            <div className="flex flex-wrap gap-2">
              {selectedItems.map((item) => (
                <span
                  key={item.item_id}
                  className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-[#e6e8dc] bg-secondary/40 py-1.5 pl-2.5 pr-3 text-sm"
                >
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10">
                    {getItemIcon(item.item_type)}
                  </span>
                  <span className="truncate font-medium text-ink">{item.title}</span>
                </span>
              ))}
            </div>
          </div>

          {/* Instruction Input */}
          <div className="space-y-2.5">
            <label
              htmlFor="regenerate-instruction"
              className="text-xs font-bold uppercase tracking-wider text-steel-grey"
            >
              {t('builder.regenerate.instructionDialog.hint')}
            </label>
            <Textarea
              id="regenerate-instruction"
              value={instruction}
              onChange={(e) => onInstructionChange(e.target.value)}
              onKeyDown={handleKeyDown}
              maxLength={2000}
              placeholder={t('builder.regenerate.instructionDialog.placeholder')}
              className="min-h-[130px] rounded-2xl border-[#e6e3dc] bg-white px-4 py-3 shadow-sw-xs focus:border-primary focus:ring-primary/20 placeholder:text-xs"
              disabled={isGenerating}
            />
          </div>
        </div>

        <DialogFooter className="flex-row justify-between gap-3 rounded-b-2xl border-t border-[#e6e3dc] bg-secondary p-4">
          <Button
            variant="outline"
            onClick={onBack}
            disabled={isGenerating}
            className="rounded-full"
          >
            <ArrowLeft className="h-4 w-4" />
            {t('builder.regenerate.instructionDialog.backButton')}
          </Button>
          <Button onClick={onGenerate} disabled={isGenerating} className="rounded-full">
            {isGenerating ? (
              <>
                <Sparkles className="h-4 w-4 animate-spin" />
                {t('builder.regenerate.diffPreview.loading')}
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" />
                {t('builder.regenerate.instructionDialog.generateButton')}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default RegenerateInstructionDialog;
