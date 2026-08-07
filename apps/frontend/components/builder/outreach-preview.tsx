'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { Linkedin, Mail } from 'lucide-react';
import { useTranslations } from '@/lib/i18n';
import { MarkdownContent } from '@/components/common/markdown-content';

export interface OutreachPreviewProps {
  /** Outreach message content */
  content: string;
  /** Additional class names */
  className?: string;
}

export function OutreachPreview({ content, className }: OutreachPreviewProps) {
  const { t } = useTranslations();

  return (
    <div
      className={cn(
        'overflow-hidden rounded-2xl border border-[#e6e3dc] bg-white shadow-sw-xs md:max-w-3xl',
        className
      )}
    >
      {/* Preview Header */}
      <div className="border-b border-[#e6e3dc] bg-secondary/50 px-5 py-3">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-[#0077B5]/10">
              <Linkedin className="h-4 w-4 text-[#0077B5]" />
            </span>
            <span className="text-xs font-bold uppercase tracking-wide text-ink-soft">
              {t('outreach.preview.channels.linkedin')}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10">
              <Mail className="h-4 w-4 text-primary" />
            </span>
            <span className="text-xs font-bold uppercase tracking-wide text-ink-soft">
              {t('outreach.preview.channels.email')}
            </span>
          </div>
        </div>
      </div>

      {/* Message Preview */}
      <div className="p-6 md:p-8">
        {content && content.trim().length > 0 ? (
          <div className="space-y-6">
            {/* Message Card */}
            <div className="rounded-2xl border border-[#e6e3dc] bg-secondary/40 p-5 shadow-sw-xs">
              <MarkdownContent content={content} />
            </div>

            {/* Usage Tips */}
            <div className="rounded-2xl border border-[#e6e3dc] bg-white p-5">
              <p className="mb-3 text-xs font-bold uppercase tracking-wider text-primary">
                {t('outreach.preview.howToUseTitle')}
              </p>
              <ul className="space-y-1.5 text-xs leading-relaxed text-ink-soft">
                <li>{t('outreach.preview.steps.step1')}</li>
                <li>{t('outreach.preview.steps.step2')}</li>
                <li>{t('outreach.preview.steps.step3')}</li>
                <li>{t('outreach.preview.steps.step4')}</li>
              </ul>
            </div>
          </div>
        ) : (
          <div className="py-12 text-center text-steel-grey">
            <p className="text-sm">{t('outreach.preview.emptyTitle')}</p>
            <p className="mt-2 text-xs">{t('outreach.preview.emptyDescription')}</p>
          </div>
        )}
      </div>
    </div>
  );
}
