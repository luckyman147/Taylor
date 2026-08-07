'use client';

import * as React from 'react';
import { Button } from '@/components/ui/button';
import { Save, Loader2, FileText, Type } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslations } from '@/lib/i18n';

export interface CoverLetterEditorProps {
  /** Cover letter content */
  content: string;
  /** Callback when content changes */
  onChange: (content: string) => void;
  /** Callback when save is triggered */
  onSave: () => void;
  /** Whether save is in progress */
  isSaving: boolean;
  /** Additional class names */
  className?: string;
}

export function CoverLetterEditor({
  content,
  onChange,
  onSave,
  isSaving,
  className,
}: CoverLetterEditorProps) {
  const { t } = useTranslations();
  const wordCount = content
    .trim()
    .split(/\s+/)
    .filter((w) => w.length > 0).length;
  const charCount = content.length;

  return (
    <div className={cn('flex flex-col', className)}>
      {/* Editor Card */}
      <div className="overflow-hidden rounded-2xl border border-[#e6e3dc] bg-white shadow-sw-xs">
        {/* Card Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e6e3dc] bg-secondary/40 px-5 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/10">
              <FileText className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h2 className="text-sm font-bold uppercase tracking-wide text-ink">
                {t('coverLetter.title')}
              </h2>
              <p className="text-xs text-ink-soft">{t('coverLetter.editor.tip')}</p>
            </div>
          </div>
          <span className="rounded-full border border-[#e6e3dc] bg-white px-3 py-1 text-[11px] font-semibold text-ink-soft">
            {t('builder.contentStats.wordsChars', { wordCount, charCount })}
          </span>
        </div>

        {/* Editor Area */}
        <div className="p-5">
          <textarea
            value={content}
            onChange={(e) => onChange(e.target.value)}
            placeholder={t('coverLetter.editor.placeholder')}
            spellCheck
            className={cn(
              'w-full resize-none rounded-2xl border border-[#e6e3dc] bg-white p-4',
              'min-h-[420px] text-sm leading-relaxed text-ink',
              'placeholder:text-steel-grey',
              'focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20'
            )}
          />
        </div>

        {/* Card Footer */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#e6e3dc] bg-secondary/40 px-5 py-3">
          <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-steel-grey">
            <Type className="h-3.5 w-3.5" />
            Markdown
          </span>
          <Button size="sm" onClick={onSave} disabled={isSaving}>
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {isSaving ? t('common.saving') : t('common.save')}
          </Button>
        </div>
      </div>
    </div>
  );
}
