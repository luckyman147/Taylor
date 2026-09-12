'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  ChevronDown,
  Trash2,
  Eye,
  EyeOff,
  Pencil,
  Check,
  X,
  User,
  FileText,
  Briefcase,
  GraduationCap,
  Rocket,
  Sparkles,
  LayoutTemplate,
} from 'lucide-react';
import type { SectionMeta } from '@/components/dashboard/resume-component';
import { useTranslations } from '@/lib/i18n';

interface SectionHeaderProps {
  section: SectionMeta;
  onRename: (newName: string) => void;
  onDelete: () => void;
  onToggleVisibility: () => void;
  canDelete: boolean;
  children?: React.ReactNode;
}

/**
 * Section icon lookup by section key.
 * Exported for reuse in the Design > Sections list.
 */
export const SECTION_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  personalInfo: User,
  summary: FileText,
  workExperience: Briefcase,
  education: GraduationCap,
  personalProjects: Rocket,
  skills: Sparkles,
  additional: Sparkles,
};

export const getSectionIcon = (section: SectionMeta): React.ComponentType<{ className?: string }> =>
  SECTION_ICONS[section.key] ?? SECTION_ICONS[section.id] ?? LayoutTemplate;

/**
 * Render the icon element for a section (avoids creating components during render).
 */
export const getSectionIconElement = (
  section: SectionMeta,
  className = 'h-4 w-4'
): React.ReactElement => {
  const Icon = getSectionIcon(section);
  return <Icon className={className} />;
};

/**
 * SectionHeader Component
 *
 * Accordion-style section header:
 * - Click the header row to expand/collapse the section content (collapsed by default)
 * - Per-section icon badge
 * - Editable display name
 * - Visibility toggle and delete (with confirmation for custom sections)
 *
 * Reordering (drag & drop / move controls) lives in Design > Sections.
 */
export const SectionHeader: React.FC<SectionHeaderProps> = ({
  section,
  onRename,
  onDelete,
  onToggleVisibility,
  canDelete,
  children,
}) => {
  const { t } = useTranslations();
  const [isExpanded, setIsExpanded] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editedName, setEditedName] = useState(section.displayName);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const handleStartEdit = () => {
    setEditedName(section.displayName);
    setIsEditing(true);
  };

  const handleSaveEdit = () => {
    if (editedName.trim()) {
      onRename(editedName.trim());
    }
    setIsEditing(false);
  };

  const handleCancelEdit = () => {
    setEditedName(section.displayName);
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSaveEdit();
    } else if (e.key === 'Escape') {
      handleCancelEdit();
    }
  };

  const handleDeleteClick = () => {
    if (section.isDefault) {
      // For default sections, just toggle visibility
      onToggleVisibility();
    } else {
      // For custom sections, show confirmation
      setShowDeleteConfirm(true);
    }
  };

  const isPersonalInfo = section.id === 'personalInfo';
  const isHidden = !section.isVisible;

  return (
    <div
      className={`overflow-hidden rounded-2xl border bg-white shadow-sw-xs transition-colors ${
        isHidden
          ? 'border-dashed border-[#c9c5bc] opacity-60'
          : isExpanded
            ? 'border-primary/40'
            : 'border-[#e6e3dc] hover:border-[#c9c5bc]'
      }`}
    >
      {/* Header Row */}
      <div className="flex items-center">
        {/* Toggle */}
        <button
          type="button"
          onClick={() => setIsExpanded(!isExpanded)}
          aria-expanded={isExpanded}
          className="group flex min-w-0 flex-1 items-center gap-3 py-3 pl-4 pr-2 text-left"
        >
          {/* Icon Badge */}
          <span
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition-colors ${
              isExpanded
                ? 'border-primary/30 bg-primary/5 text-primary'
                : 'border-transparent bg-paper-tint text-steel-grey group-hover:text-primary'
            }`}
          >
            {getSectionIconElement(section)}
          </span>

          {/* Name */}
          {isEditing ? null : (
            <span className="truncate text-base font-bold tracking-tight text-ink">
              {section.displayName}
            </span>
          )}

          {!section.isDefault && !isEditing && (
            <span className="hidden rounded-full border border-[#e6e3dc] bg-white px-2 py-0.5 text-[10px] uppercase tracking-wider text-steel-grey sm:inline">
              {t('builder.sectionHeader.customTag')}
            </span>
          )}
          {isHidden && !isEditing && (
            <span className="hidden rounded-full border border-orange-500 bg-orange-50 px-2 py-0.5 text-[10px] uppercase tracking-wider text-orange-600 sm:inline">
              {t('builder.sectionHeader.hiddenFromPdfTag')}
            </span>
          )}

          {/* Chevron */}
          <ChevronDown
            className={`ml-auto h-4 w-4 shrink-0 text-steel-grey transition-transform duration-200 ${
              isExpanded ? 'rotate-180 text-primary' : ''
            }`}
          />
        </button>

        {/* Controls */}
        {!isEditing ? (
          <div className="flex shrink-0 items-center gap-0.5 pr-2">
            {!isPersonalInfo && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-steel-grey"
                onClick={handleStartEdit}
                aria-label={t('builder.sectionHeader.renameSection')}
                title={t('builder.sectionHeader.renameSection')}
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
            )}
            {!isPersonalInfo && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-steel-grey"
                onClick={onToggleVisibility}
                aria-label={
                  section.isVisible
                    ? t('builder.sectionHeader.hideSection')
                    : t('builder.sectionHeader.showSection')
                }
                aria-pressed={!section.isVisible}
                title={
                  section.isVisible
                    ? t('builder.sectionHeader.hideSection')
                    : t('builder.sectionHeader.showSection')
                }
              >
                {section.isVisible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
              </Button>
            )}
            {canDelete && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                onClick={handleDeleteClick}
                aria-label={
                  section.isDefault
                    ? section.isVisible
                      ? t('builder.sectionHeader.hideSection')
                      : t('builder.sectionHeader.showSection')
                    : t('builder.sectionHeader.deleteSection')
                }
                title={
                  section.isDefault
                    ? section.isVisible
                      ? t('builder.sectionHeader.hideSection')
                      : t('builder.sectionHeader.showSection')
                    : t('builder.sectionHeader.deleteSection')
                }
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        ) : (
          <div className="flex shrink-0 items-center gap-1 pr-2">
            <Input
              value={editedName}
              onChange={(e) => setEditedName(e.target.value)}
              onKeyDown={handleKeyDown}
              className="h-8 w-40 rounded-lg text-base font-bold sm:w-48"
              autoFocus
            />
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-green-700 hover:text-green-800 hover:bg-green-50"
              onClick={handleSaveEdit}
              aria-label={t('common.save')}
              title={t('common.save')}
            >
              <Check className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-steel-grey hover:text-ink-soft hover:bg-paper-tint"
              onClick={handleCancelEdit}
              aria-label={t('common.cancel')}
              title={t('common.cancel')}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>

      {/* Section Content */}
      {isExpanded && <div className="border-t border-[#e6e3dc] px-4 py-4 md:px-5">{children}</div>}

      {/* Delete Confirmation Dialog */}
      <ConfirmDialog
        open={showDeleteConfirm}
        onOpenChange={setShowDeleteConfirm}
        title={t('builder.sectionHeader.deleteTitle')}
        description={t('builder.sectionHeader.deleteDescription', { name: section.displayName })}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        variant="danger"
        onConfirm={onDelete}
      />
    </div>
  );
};
