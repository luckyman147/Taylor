'use client';

import React, { useCallback, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { PersonalInfo, ContactDisplayField } from '@/components/dashboard/resume-component';
import { uploadAvatar, getProfile } from '@/lib/api/profile';
import { useTranslations } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { Camera, Loader2, Trash2, UserCheck } from 'lucide-react';

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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const handleChange = (field: keyof PersonalInfo, value: string) => {
    onChange({
      ...data,
      [field]: value,
    });
  };

  const handleAvatarUpload = async (file: File) => {
    if (!file.type.startsWith('image/')) return;
    setUploading(true);
    setUploadError(null);
    try {
      const result = await uploadAvatar(file);
      onChange({ ...data, avatar: result.url });
    } catch {
      setUploadError(t('builder.personalInfoForm.uploadError'));
    } finally {
      setUploading(false);
    }
  };

  const handleAvatarRemove = () => {
    onChange({ ...data, avatar: '' });
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
      <div className="flex items-center justify-between border-b border-[#e6e3dc] pb-2 mb-4">
        <h3 className="text-lg font-bold uppercase tracking-tight">
          {t('builder.personalInfo')}
        </h3>
        <Button
          variant="outline"
          size="sm"
          onClick={async () => {
            try {
              const { profile } = await getProfile();
              onChange({
                ...data,
                name: profile.name || data.name,
                title: profile.title || data.title,
                email: profile.email || data.email,
                phone: profile.phone || data.phone,
                location: profile.location || data.location,
                website: profile.website || data.website,
                linkedin: profile.linkedin || data.linkedin,
                github: profile.github || data.github,
                avatar: profile.avatar || data.avatar,
              });
            } catch {
              // Profile may not exist yet
            }
          }}
          className="gap-1.5 text-xs"
        >
          <UserCheck className="h-3.5 w-3.5" />
          {t('builder.chooseFromProfile')}
        </Button>
      </div>

      {/* Avatar upload */}
      <div className="flex items-center gap-4 pb-4 border-b border-[#e6e3dc]">
        <div
          className={cn(
            'flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-dashed transition-colors',
            data.avatar ? 'border-transparent' : 'border-[#c9c5bc] bg-paper-tint'
          )}
        >
          {data.avatar ? (
            <img src={data.avatar} alt="" className="h-full w-full object-cover" />
          ) : uploading ? (
            <Loader2 className="h-6 w-6 animate-spin text-steel-grey" />
          ) : (
            <Camera className="h-6 w-6 text-steel-grey" />
          )}
        </div>
        <div className="space-y-1">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleAvatarUpload(file);
              e.target.value = '';
            }}
          />
          {data.avatar ? (
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="rounded-lg"
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
              >
                {t('builder.personalInfoForm.changePhoto')}
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="rounded-lg text-destructive hover:text-destructive hover:bg-destructive/10"
                onClick={handleAvatarRemove}
              >
                <Trash2 className="h-4 w-4 mr-1" />
                {t('builder.personalInfoForm.removePhoto')}
              </Button>
            </div>
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="rounded-lg"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
            >
              {t('builder.personalInfoForm.uploadPhoto')}
            </Button>
          )}
          {uploadError && <p className="text-xs text-destructive">{uploadError}</p>}
        </div>
      </div>

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
