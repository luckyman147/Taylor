'use client';

import React from 'react';
import { Label } from '@/components/ui/label';
import { TagInput } from '@/components/ui/tag-input';
import { useTranslations } from '@/lib/i18n';

interface LanguagesFormProps {
  data: string[];
  onChange: (data: string[]) => void;
}

export const LanguagesForm: React.FC<LanguagesFormProps> = ({ data, onChange }) => {
  const { t } = useTranslations();

  return (
    <div className="space-y-6">
      <p className=" text-xs uppercase tracking-wider text-primary">
        {t('builder.languagesForm.instructions')}
      </p>

      <div className="space-y-2">
        <Label className=" text-xs uppercase tracking-wider text-steel-grey">
          {t('resume.sections.languages')}
        </Label>
        <TagInput
          value={data}
          onChange={onChange}
          placeholder={t('builder.languagesForm.placeholder')}
        />
      </div>
    </div>
  );
};
