'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { useTranslations } from '@/lib/i18n';
import { MarkdownContent } from '@/components/common/markdown-content';

export interface CoverLetterPersonalInfo {
  name?: string;
  title?: string;
  email?: string;
  phone?: string;
  location?: string;
  website?: string;
  linkedin?: string;
  github?: string;
}

export interface CoverLetterPreviewProps {
  /** Cover letter content */
  content: string;
  /** Personal info for header */
  personalInfo: CoverLetterPersonalInfo;
  /** Page size for styling */
  pageSize?: 'A4' | 'LETTER';
  /** Additional class names */
  className?: string;
}

export function CoverLetterPreview({
  content,
  personalInfo,
  pageSize = 'A4',
  className,
}: CoverLetterPreviewProps) {
  const { t, locale } = useTranslations();
  // The date is locale/timezone-dependent, so rendering it during SSR would
  // mismatch hydration. Compute it only after the component is mounted.
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);
  const today = mounted
    ? new Intl.DateTimeFormat(locale, {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      }).format(new Date())
    : '';

  return (
    <div
      className={cn(
        'overflow-hidden rounded-2xl border border-[#e6e3dc] bg-white shadow-sw-xs',
        className
      )}
    >
      <div
        className={cn('mx-auto p-8 md:p-12', pageSize === 'A4' ? 'min-h-[297mm]' : 'min-h-[11in]')}
        style={{
          maxWidth: pageSize === 'A4' ? '210mm' : '8.5in',
        }}
      >
        {/* Header - Personal Info */}
        <header className="mb-8 border-b border-[#e6e3dc] pb-5">
          <h1 className="text-2xl font-bold tracking-tight text-ink">
            {personalInfo.name || t('coverLetter.preview.defaultName')}
          </h1>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-soft">
            {personalInfo.email && <span>{personalInfo.email}</span>}
            {personalInfo.phone && <span>{personalInfo.phone}</span>}
            {personalInfo.location && <span>{personalInfo.location}</span>}
            {personalInfo.linkedin && <span>{personalInfo.linkedin}</span>}
          </div>
        </header>

        {/* Date */}
        <div className="mb-8 pb-3 text-sm text-ink-soft">{today}</div>

        {/* Body (markdown-aware) */}
        <div className="space-y-4">
          {content && content.trim().length > 0 ? (
            <MarkdownContent content={content} />
          ) : (
            <div className="py-12 text-center text-steel-grey">
              <p className="text-sm">{t('coverLetter.preview.emptyTitle')}</p>
              <p className="mt-2 text-xs">{t('coverLetter.preview.emptyDescription')}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
