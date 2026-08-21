'use client';

import React from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { PersonalInfo, ContactDisplayField } from '@/components/dashboard/resume-component';
import { useTranslations } from '@/lib/i18n';
import { cn } from '@/lib/utils';

interface PersonalInfoFormProps {
  data: PersonalInfo;
  onChange: (data: PersonalInfo) => void;
}

/** Fields that can render as a short hypertext label ("Email", "LinkedIn") or the full value. */
const DISPLAY_FIELDS: ContactDisplayField[] = ['email', 'phone', 'website', 'linkedin', 'github'];

const DisplayModeSwitch: React.FC<{
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: string;
  field: string;
}> = ({ checked, onCheckedChange, label, field }) => {
  const handleToggle = () => onCheckedChange(!checked);

  return (
    <div className="flex items-center justify-end gap-2">
      <span className="text-xs text-steel-grey">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={`${field}: ${label}`}
        onClick={handleToggle}
        className={cn(
          'relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full',
          'border border-[#c9c5bc] transition-colors',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2',
          checked ? 'bg-primary' : 'bg-paper-tint'
        )}
      >
        <span
          className={cn(
            'pointer-events-none block h-3.5 w-3.5 rounded-full bg-white border border-[#c9c5bc]',
            'transition-transform duration-200',
            checked ? 'translate-x-[18px]' : 'translate-x-[2px]'
          )}
        />
      </button>
    </div>
  );
};

export const PersonalInfoForm: React.FC<PersonalInfoFormProps> = ({ data, onChange }) => {
  const { t } = useTranslations();

  const handleChange = (field: keyof PersonalInfo, value: string) => {
    onChange({
      ...data,
      [field]: value,
    });
  };

  const handleDisplayToggle = (field: ContactDisplayField, labelMode: boolean) => {
    const contactDisplay = { ...(data.contactDisplay ?? {}) };
    if (labelMode) {
      contactDisplay[field] = 'label';
    } else {
      delete contactDisplay[field];
    }
    onChange({ ...data, contactDisplay });
  };

  const renderField = (
    field: keyof PersonalInfo,
    labelKey: string,
    placeholderKey: string,
    inputProps: { type?: string } = {}
  ) => {
    const isDisplayField = DISPLAY_FIELDS.includes(field as ContactDisplayField);
    return (
      <div className="space-y-2">
        <Label htmlFor={field} className=" text-xs uppercase tracking-wider text-steel-grey">
          {t(labelKey)}
        </Label>
        <Input
          id={field}
          type={inputProps.type}
          value={(data[field] as string) || ''}
          onChange={(e) => handleChange(field, e.target.value)}
          placeholder={t(placeholderKey)}
          className="rounded-lg border-ink focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:border-primary bg-transparent"
        />
        {isDisplayField && (
          <DisplayModeSwitch
            checked={data.contactDisplay?.[field as ContactDisplayField] === 'label'}
            onCheckedChange={(labelMode) =>
              handleDisplayToggle(field as ContactDisplayField, labelMode)
            }
            label={t('builder.personalInfoForm.displayAsLink')}
            field={field}
          />
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4 rounded-2xl border border-[#e6e3dc] p-6 bg-white shadow-sw-xs">
      <h3 className="text-lg font-bold uppercase tracking-tight border-b border-[#e6e3dc] pb-2 mb-4">
        {t('builder.personalInfo')}
      </h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {renderField(
          'name',
          'resume.personalInfo.name',
          'builder.personalInfoForm.placeholders.name'
        )}
        {renderField(
          'title',
          'resume.personalInfo.title',
          'builder.personalInfoForm.placeholders.title'
        )}
        {renderField(
          'email',
          'resume.personalInfo.email',
          'builder.personalInfoForm.placeholders.email',
          {
            type: 'email',
          }
        )}
        {renderField(
          'phone',
          'resume.personalInfo.phone',
          'builder.personalInfoForm.placeholders.phone',
          {
            type: 'tel',
          }
        )}
        {renderField(
          'location',
          'resume.personalInfo.location',
          'builder.personalInfoForm.placeholders.location'
        )}
        {renderField(
          'website',
          'resume.personalInfo.website',
          'builder.personalInfoForm.placeholders.website'
        )}
        {renderField(
          'linkedin',
          'resume.personalInfo.linkedin',
          'builder.personalInfoForm.placeholders.linkedin'
        )}
        {renderField(
          'github',
          'resume.personalInfo.github',
          'builder.personalInfoForm.placeholders.github'
        )}
      </div>
    </div>
  );
};
