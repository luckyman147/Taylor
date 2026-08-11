'use client';

import React from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  Briefcase,
  FolderKanban,
  Lightbulb,
  Github,
  ChevronDown,
  ChevronRight,
  Sparkles,
} from 'lucide-react';
import { useTranslations } from '@/lib/i18n';
import type { RegenerateItemInput } from '@/lib/api/enrichment';
import { GitHubRepoPicker } from '@/components/tailor/github-repo-picker';

interface RegenerateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  experienceItems: RegenerateItemInput[];
  projectItems: RegenerateItemInput[];
  skillsItem: RegenerateItemInput | null;
  selectedItems: RegenerateItemInput[];
  onSelectionChange: (items: RegenerateItemInput[]) => void;
  selectedRepos: string[];
  onReposChange: (repos: string[]) => void;
  onContinue: () => void;
}

/**
 * RegenerateDialog Component
 *
 * First step of the regenerate wizard.
 * Allows user to select which resume items to regenerate.
 * Soft card design with pill badges and rounded selection rows.
 */
export const RegenerateDialog: React.FC<RegenerateDialogProps> = ({
  open,
  onOpenChange,
  experienceItems,
  projectItems,
  skillsItem,
  selectedItems,
  onSelectionChange,
  selectedRepos,
  onReposChange,
  onContinue,
}) => {
  const { t } = useTranslations();
  const [expandedSections, setExpandedSections] = React.useState<Set<string>>(
    new Set(['experience', 'projects', 'skills'])
  );

  const toggleSection = (section: string) => {
    const newExpanded = new Set(expandedSections);
    if (newExpanded.has(section)) {
      newExpanded.delete(section);
    } else {
      newExpanded.add(section);
    }
    setExpandedSections(newExpanded);
  };

  const isSelected = (item: RegenerateItemInput) => {
    return selectedItems.some((s) => s.item_id === item.item_id);
  };

  const toggleItem = (item: RegenerateItemInput) => {
    if (isSelected(item)) {
      onSelectionChange(selectedItems.filter((s) => s.item_id !== item.item_id));
    } else {
      onSelectionChange([...selectedItems, item]);
    }
  };

  const hasItems = experienceItems.length > 0 || projectItems.length > 0 || skillsItem !== null;

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
                  {t('builder.regenerate.selectDialog.title')}
                </DialogTitle>
                <DialogDescription className="mt-1 text-xs text-steel-grey">
                  {t('builder.regenerate.selectDialog.subtitle')}
                </DialogDescription>
              </div>
            </div>
            <span className="inline-flex w-fit items-center rounded-full border border-[#e6e3dc] bg-secondary px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-steel-grey">
              {t('builder.regenerate.stepLabel', { current: '1', total: '3' })}
            </span>
          </div>
        </DialogHeader>

        <div className="p-6 space-y-4 max-h-[50vh] overflow-y-auto">
          {!hasItems && (
            <div className="rounded-2xl border border-dashed border-[#e6e3dc] bg-white px-6 py-10 text-center">
              <p className="text-sm text-steel-grey">
                {t('builder.regenerate.selectDialog.noItemsAvailable')}
              </p>
            </div>
          )}

          {/* Experience Section */}
          {experienceItems.length > 0 && (
            <SectionCard
              icon={<Briefcase className="h-4 w-4 text-primary" />}
              label={t('builder.regenerate.selectDialog.experience')}
              count={experienceItems.length}
              isExpanded={expandedSections.has('experience')}
              onToggle={() => toggleSection('experience')}
            >
              {experienceItems.map((item) => (
                <ItemRow
                  key={item.item_id}
                  item={item}
                  isSelected={isSelected(item)}
                  onToggle={() => toggleItem(item)}
                />
              ))}
            </SectionCard>
          )}

          {/* Projects Section */}
          {projectItems.length > 0 && (
            <SectionCard
              icon={<FolderKanban className="h-4 w-4 text-primary" />}
              label={t('builder.regenerate.selectDialog.projects')}
              count={projectItems.length}
              isExpanded={expandedSections.has('projects')}
              onToggle={() => toggleSection('projects')}
            >
              {projectItems.map((item) => (
                <ItemRow
                  key={item.item_id}
                  item={item}
                  isSelected={isSelected(item)}
                  onToggle={() => toggleItem(item)}
                />
              ))}
            </SectionCard>
          )}

          {/* Skills Section */}
          {skillsItem && (
            <SectionCard
              icon={<Lightbulb className="h-4 w-4 text-primary" />}
              label={t('builder.regenerate.selectDialog.skills')}
              count={1}
              isExpanded={expandedSections.has('skills')}
              onToggle={() => toggleSection('skills')}
            >
              <ItemRow
                item={skillsItem}
                isSelected={isSelected(skillsItem)}
                onToggle={() => toggleItem(skillsItem)}
              />
            </SectionCard>
          )}

          {/* GitHub Projects Section */}
          <SectionCard
            icon={<Github className="h-4 w-4 text-primary" />}
            label={t('builder.regenerate.selectDialog.githubProjects')}
            count={selectedRepos.length}
            isExpanded={expandedSections.has('github')}
            onToggle={() => toggleSection('github')}
          >
            <GitHubRepoPicker onChange={onReposChange} disabled={false} />
          </SectionCard>
        </div>

        <DialogFooter className="flex-row justify-end gap-3 rounded-b-2xl border-t border-[#e6e3dc] bg-secondary p-4">
          <DialogClose asChild>
            <Button variant="outline" className="rounded-full">
              {t('common.cancel')}
            </Button>
          </DialogClose>
          <Button
            onClick={onContinue}
            disabled={selectedItems.length === 0 && selectedRepos.length === 0}
            className="rounded-full"
          >
            {t('builder.regenerate.selectDialog.continueButton')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

interface SectionCardProps {
  icon: React.ReactNode;
  label: string;
  count: number;
  isExpanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

const SectionCard: React.FC<SectionCardProps> = ({
  icon,
  label,
  count,
  isExpanded,
  onToggle,
  children,
}) => {
  return (
    <div className="overflow-hidden rounded-2xl border border-[#e6e3dc] bg-white shadow-sw-xs">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isExpanded}
        className="flex w-full items-center justify-between gap-3 border-b border-[#e6e3dc] bg-secondary/40 px-4 py-3 transition-colors hover:bg-secondary/70"
      >
        <span className="flex items-center gap-2.5">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10">
            {icon}
          </span>
          <span className="text-sm font-bold uppercase tracking-wide text-ink">{label}</span>
          <span className="rounded-full border border-[#e6e3dc] bg-white px-2 py-0.5 text-[10px] font-semibold text-steel-grey">
            {count}
          </span>
        </span>
        {isExpanded ? (
          <ChevronDown className="h-4 w-4 text-steel-grey" />
        ) : (
          <ChevronRight className="h-4 w-4 text-steel-grey" />
        )}
      </button>
      <div className="space-y-1.5 p-2">{isExpanded && children}</div>
    </div>
  );
};

/**
 * ItemRow - Individual selectable item row
 */
interface ItemRowProps {
  item: RegenerateItemInput;
  isSelected: boolean;
  onToggle: () => void;
}

const ItemRow: React.FC<ItemRowProps> = ({ item, isSelected, onToggle }) => {
  const { t } = useTranslations();

  const contentCount = item.current_content.length;
  const itemCountKey =
    contentCount === 1
      ? 'builder.regenerate.selectDialog.itemCount.one'
      : 'builder.regenerate.selectDialog.itemCount.other';
  const itemCountLabel = t(itemCountKey).replace('{count}', String(contentCount));

  return (
    <button
      type="button"
      onClick={onToggle}
      className={`flex w-full items-center gap-3 rounded-xl p-3 text-left transition-all ${
        isSelected ? 'bg-primary/5 ring-1 ring-primary' : 'hover:bg-secondary/60'
      }`}
    >
      {/* Checkbox */}
      <span
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors ${
          isSelected ? 'border-primary bg-primary' : 'border-[#c9c5bc] bg-white'
        }`}
      >
        {isSelected && (
          <svg className="h-3 w-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
          </svg>
        )}
      </span>

      {/* Item Info */}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-ink">{item.title}</span>
        {item.subtitle && (
          <span className="block truncate text-xs text-steel-grey">{item.subtitle}</span>
        )}
      </span>

      {/* Content preview */}
      <span className="shrink-0 rounded-full border border-[#e6e3dc] bg-white px-2 py-0.5 text-[10px] font-semibold text-steel-grey">
        {itemCountLabel}
      </span>
    </button>
  );
};

export default RegenerateDialog;
