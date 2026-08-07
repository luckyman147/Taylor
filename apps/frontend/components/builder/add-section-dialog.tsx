'use client';

import React, { useState } from 'react';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Plus, FileText, List, ListOrdered, Check } from 'lucide-react';
import type { SectionType } from '@/components/dashboard/resume-component';
import { useTranslations } from '@/lib/i18n';

interface AddSectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (displayName: string, sectionType: SectionType) => void;
}

type SelectableSectionType = Exclude<SectionType, 'personalInfo'>;

/**
 * AddSectionDialog Component
 *
 * Dialog for creating new custom sections.
 * Allows user to enter a name and select a section type.
 */
export const AddSectionDialog: React.FC<AddSectionDialogProps> = ({
  open,
  onOpenChange,
  onAdd,
}) => {
  const { t } = useTranslations();
  const [displayName, setDisplayName] = useState('');
  const [sectionType, setSectionType] = useState<SelectableSectionType>('text');

  const handleSubmit = () => {
    if (displayName.trim()) {
      onAdd(displayName.trim(), sectionType);
      setDisplayName('');
      setSectionType('text');
      onOpenChange(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && displayName.trim()) {
      handleSubmit();
    }
  };

  const sectionTypes: {
    type: SelectableSectionType;
    label: string;
    icon: React.ReactNode;
    description: string;
  }[] = [
    {
      type: 'text',
      label: t('builder.customSections.sectionTypes.textBlockLabel'),
      icon: <FileText className="w-5 h-5" />,
      description: t('builder.customSections.sectionTypes.textBlockDescription'),
    },
    {
      type: 'itemList',
      label: t('builder.customSections.sectionTypes.itemListLabel'),
      icon: <ListOrdered className="w-5 h-5" />,
      description: t('builder.customSections.sectionTypes.itemListDescription'),
    },
    {
      type: 'stringList',
      label: t('builder.customSections.sectionTypes.stringListLabel'),
      icon: <List className="w-5 h-5" />,
      description: t('builder.customSections.sectionTypes.stringListDescription'),
    },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] rounded-2xl p-0 gap-0 overflow-hidden">
        <DialogHeader className="p-6 pb-4 border-b border-[#e6e3dc]">
          <DialogTitle className="font-sans text-xl font-bold uppercase tracking-tight">
            {t('builder.customSections.dialogTitle')}
          </DialogTitle>
          <DialogDescription className="mt-2 text-xs text-ink-soft">
            {t('builder.customSections.dialogDescription')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 p-6">
          {/* Section Name */}
          <div className="space-y-2">
            <Label className=" text-xs uppercase tracking-wider text-ink-soft">
              {t('builder.customSections.sectionNameLabel')}
            </Label>
            <Input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={t('builder.customSections.sectionNamePlaceholder')}
              className="border-[#c9c5bc] focus:border-primary"
              autoFocus
            />
          </div>

          {/* Section Type */}
          <div className="space-y-3">
            <Label className=" text-xs uppercase tracking-wider text-ink-soft">
              {t('builder.customSections.sectionTypeLabel')}
            </Label>
            <div className="space-y-2">
              {sectionTypes.map((item) => {
                const selected = sectionType === item.type;
                return (
                  <button
                    key={item.type}
                    type="button"
                    onClick={() => setSectionType(item.type)}
                    className={`w-full rounded-2xl border p-4 text-left transition-all ${
                      selected
                        ? 'border-primary bg-primary/5 shadow-sw-xs ring-1 ring-primary'
                        : 'border-[#e6e3dc] bg-white hover:border-primary hover:bg-paper-tint'
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border transition-colors ${
                          selected
                            ? 'border-primary bg-primary text-white'
                            : 'border-[#e6e3dc] bg-paper-tint text-ink-soft'
                        }`}
                      >
                        {item.icon}
                      </div>
                      <div className="flex-1">
                        <div className="text-sm font-semibold text-ink">{item.label}</div>
                        <div className="mt-0.5 text-xs text-steel-grey">{item.description}</div>
                      </div>
                      {selected && (
                        <span className="mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary text-white">
                          <Check className="h-3 w-3" />
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <DialogFooter className="flex-row justify-end gap-3 border-t border-[#e6e3dc] bg-secondary p-4">
          <DialogClose asChild>
            <Button variant="outline" className="rounded-full">
              {t('common.cancel')}
            </Button>
          </DialogClose>
          <Button onClick={handleSubmit} disabled={!displayName.trim()} className="rounded-full">
            <Plus className="w-4 h-4 mr-2" />
            {t('builder.addSection')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

/**
 * AddSectionButton Component
 *
 * Button that triggers the AddSectionDialog.
 */
interface AddSectionButtonProps {
  onAdd: (displayName: string, sectionType: SectionType) => void;
}

export const AddSectionButton: React.FC<AddSectionButtonProps> = ({ onAdd }) => {
  const { t } = useTranslations();
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button
        variant="outline"
        onClick={() => setOpen(true)}
        className="w-full rounded-2xl border-dashed border-[#e6e3dc] py-6 hover:border-primary hover:bg-paper-tint hover:border-solid transition-all"
      >
        <Plus className="w-5 h-5 mr-2" />
        {t('builder.customSections.addCustomSectionButton')}
      </Button>
      <AddSectionDialog open={open} onOpenChange={setOpen} onAdd={onAdd} />
    </>
  );
};