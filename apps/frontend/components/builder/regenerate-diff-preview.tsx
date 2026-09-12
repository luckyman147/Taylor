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
import {
  Check,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  Briefcase,
  FolderKanban,
  Lightbulb,
  FileText,
  Sparkles,
  TriangleAlert,
} from 'lucide-react';
import { useTranslations } from '@/lib/i18n';
import type { RegenerateItemError, RegeneratedItem } from '@/lib/api/enrichment';

interface RegenerateDiffPreviewProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  regeneratedItems: RegeneratedItem[];
  regenerateErrors?: RegenerateItemError[];
  error: string | null;
  onAccept: () => void;
  onReject: () => void;
  isApplying: boolean;
}

/**
 * RegenerateDiffPreview Component
 *
 * Third step of the regenerate wizard.
 * Shows side-by-side comparison of original vs regenerated content.
 * Soft card design with pill badges.
 */
export const RegenerateDiffPreview: React.FC<RegenerateDiffPreviewProps> = ({
  open,
  onOpenChange,
  regeneratedItems,
  regenerateErrors = [],
  error,
  onAccept,
  onReject,
  isApplying,
}) => {
  const { t } = useTranslations();
  const [expandedItems, setExpandedItems] = React.useState<Set<string>>(
    new Set(regeneratedItems.map((item) => item.item_id))
  );

  React.useEffect(() => {
    // Expand all items when regeneratedItems changes
    setExpandedItems(new Set(regeneratedItems.map((item) => item.item_id)));
  }, [regeneratedItems]);

  const toggleItem = (itemId: string) => {
    const newExpanded = new Set(expandedItems);
    if (newExpanded.has(itemId)) {
      newExpanded.delete(itemId);
    } else {
      newExpanded.add(itemId);
    }
    setExpandedItems(newExpanded);
  };

  type ItemLabelSource = Pick<RegeneratedItem, 'item_id' | 'item_type' | 'title' | 'subtitle'>;

  const getItemLabel = (item: ItemLabelSource) => {
    if (item.item_type === 'skills') {
      return t('builder.regenerate.selectDialog.skills');
    }
    if (item.item_type === 'summary') {
      return t('builder.regenerate.selectDialog.summary');
    }

    const title = item.title?.trim();
    const subtitle = item.subtitle?.trim();

    if (title && subtitle) {
      return `${title} | ${subtitle}`;
    }

    return title || item.item_id;
  };

  const getItemIcon = (itemType: string) => {
    switch (itemType) {
      case 'experience':
        return <Briefcase className="h-4 w-4 text-primary" />;
      case 'project':
        return <FolderKanban className="h-4 w-4 text-primary" />;
      case 'skills':
        return <Lightbulb className="h-4 w-4 text-primary" />;
      case 'summary':
        return <FileText className="h-4 w-4 text-primary" />;
      default:
        return null;
    }
  };

  const resolveErrorMessage = (value: string) => {
    if (value === 'No changes to apply') {
      return t('builder.regenerate.errors.noChangesToApply');
    }

    if (/network|fetch/i.test(value) || value.includes('Failed to fetch')) {
      return t('builder.regenerate.errors.networkError');
    }

    if (/resume content changed|uniquely matched|please regenerate/i.test(value)) {
      return t('builder.regenerate.errors.resumeChanged');
    }

    return t('builder.regenerate.errors.applyFailed');
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[800px] rounded-2xl max-h-[90vh] p-0 gap-0 overflow-hidden">
        <DialogHeader className="p-6 pb-4 border-b border-[#e6e3dc]">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
            <div className="flex items-start gap-3">
              <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10">
                <Sparkles className="h-4 w-4 text-primary" />
              </span>
              <div>
                <DialogTitle className="font-sans text-lg font-bold text-ink">
                  {t('builder.regenerate.diffPreview.title')}
                </DialogTitle>
                <DialogDescription className="mt-1 text-xs text-steel-grey">
                  {t('builder.regenerate.diffPreview.subtitle')}
                </DialogDescription>
              </div>
            </div>
            <span className="inline-flex w-fit items-center rounded-full border border-secondary/80 bg-secondary px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-steel-grey">
              {t('builder.regenerate.stepLabel', { current: '3', total: '3' })}
            </span>
          </div>
        </DialogHeader>

        {/* Stats Card */}
        <div className="px-6 pt-4">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-green-200 bg-green-50 px-3 py-1 text-xs font-semibold text-green-700">
            <Check className="h-3 w-3" />
            {t('builder.regenerate.diffPreview.changesCount').replace(
              '{count}',
              String(regeneratedItems.length)
            )}
          </span>
        </div>

        {error ? (
          <div className="px-6 pt-4">
            <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-red-700">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
              <p className="text-sm">{resolveErrorMessage(error)}</p>
            </div>
          </div>
        ) : null}

        {regenerateErrors.length > 0 ? (
          <div className="px-6 pt-4">
            <div className="rounded-xl border border-amber-200 bg-[#fbf6e9] p-4">
              <p className="text-xs font-semibold text-amber-800">
                {t('builder.regenerate.diffPreview.partialFailures', {
                  count: regenerateErrors.length,
                })}
              </p>
              <ul className="mt-2 space-y-1">
                {regenerateErrors.map((failed) => (
                  <li key={failed.item_id} className="text-xs text-amber-700">
                    • {getItemLabel(failed)}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        ) : null}

        {/* Diff Content */}
        <div className="space-y-3 p-6 max-h-[50vh] overflow-y-auto">
          {regeneratedItems.map((item) => (
            <div
              key={item.item_id}
              className="overflow-hidden rounded-2xl border border-[#e6e3dc] bg-white shadow-sw-xs"
            >
              {/* Item Header */}
              <button
                type="button"
                onClick={() => toggleItem(item.item_id)}
                aria-expanded={expandedItems.has(item.item_id)}
                aria-label={
                  expandedItems.has(item.item_id)
                    ? t('builder.regenerate.diffPreview.collapseItem', { item: getItemLabel(item) })
                    : t('builder.regenerate.diffPreview.expandItem', { item: getItemLabel(item) })
                }
                className="flex w-full items-center justify-between gap-3 border-b border-[#e6e3dc] bg-secondary/40 px-4 py-3 transition-colors hover:bg-secondary/70"
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10">
                    {getItemIcon(item.item_type)}
                  </span>
                  <span className="truncate text-sm font-bold text-ink">{getItemLabel(item)}</span>
                </span>
                {expandedItems.has(item.item_id) ? (
                  <ChevronDown className="h-4 w-4 shrink-0 text-steel-grey" />
                ) : (
                  <ChevronRight className="h-4 w-4 shrink-0 text-steel-grey" />
                )}
              </button>

              {/* Item Diff Content */}
              {expandedItems.has(item.item_id) && (
                <div>
                  {/* Change Summary */}
                  {item.diff_summary && (
                    <div className="border-b border-[#e6e3dc] bg-amber-50/60 px-4 py-2.5">
                      <p className="text-xs font-medium leading-relaxed text-amber-800">
                        {item.diff_summary}
                      </p>
                    </div>
                  )}

                  {/* Original Content */}
                  <div className="border-b border-[#e6e3dc] p-4">
                    <div className="mb-2 flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full bg-red-500" />
                      <span className="text-[10px] font-bold uppercase tracking-wider text-steel-grey">
                        {t('builder.regenerate.diffPreview.originalLabel')}
                      </span>
                    </div>
                    <div className="space-y-1 rounded-xl bg-red-50/70 p-3">
                      {item.original_content.length > 0 ? (
                        item.original_content.map((content, idx) => (
                          <p key={idx} className="text-sm text-red-800 line-through">
                            <span className="mr-1.5 font-semibold">−</span>
                            {content}
                          </p>
                        ))
                      ) : (
                        <p className="text-sm italic text-steel-grey">
                          {t('builder.regenerate.diffPreview.noContent')}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* New Content */}
                  <div className="p-4">
                    <div className="mb-2 flex items-center gap-1.5">
                      <span className="h-2 w-2 rounded-full bg-green-600" />
                      <span className="text-[10px] font-bold uppercase tracking-wider text-steel-grey">
                        {t('builder.regenerate.diffPreview.newLabel')}
                      </span>
                    </div>
                    <div className="space-y-2 rounded-xl bg-green-50/60 p-3">
                      {item.item_type === 'skills' &&
                      item.new_skill_groups &&
                      item.new_skill_groups.length > 0 ? (
                        item.new_skill_groups.map((group) => (
                          <div key={group.name}>
                            <p className="text-xs font-bold text-green-900 mb-0.5">{group.name}</p>
                            <p className="text-sm text-green-800 pl-2">
                              <span className="mr-1.5 font-semibold">+</span>
                              {group.skills.join(', ')}
                            </p>
                          </div>
                        ))
                      ) : item.new_content.length > 0 ? (
                        item.new_content.map((content, idx) => (
                          <p key={idx} className="text-sm text-green-800">
                            <span className="mr-1.5 font-semibold">+</span>
                            {content}
                          </p>
                        ))
                      ) : (
                        <p className="text-sm italic text-steel-grey">
                          {t('builder.regenerate.diffPreview.noContent')}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        <DialogFooter className="flex-row justify-between gap-3 rounded-b-2xl border-t border-[#e6e3dc] bg-secondary p-4">
          <Button
            variant="outline"
            onClick={onReject}
            disabled={isApplying}
            className="rounded-full"
          >
            <RefreshCw className="h-4 w-4" />
            {t('builder.regenerate.diffPreview.rejectButton')}
          </Button>
          <Button
            variant="success"
            onClick={onAccept}
            disabled={isApplying}
            className="rounded-full"
          >
            {isApplying ? (
              <>
                <span className="animate-spin">
                  <Check className="h-4 w-4" />
                </span>
                {t('builder.regenerate.diffPreview.applying')}
              </>
            ) : (
              <>
                <Check className="h-4 w-4" />
                {t('builder.regenerate.diffPreview.acceptButton')}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default RegenerateDiffPreview;
