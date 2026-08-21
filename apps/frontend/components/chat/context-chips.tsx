'use client';

import { useTranslations } from '@/lib/i18n';

interface ContextChipsProps {
  sources: string[];
}

export function ContextChips({ sources }: ContextChipsProps) {
  const { t } = useTranslations();

  if (sources.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5">
      {sources.map((source, i) => (
        <span
          key={i}
          className="rounded-full bg-primary/10 px-2.5 py-0.5 text-[11px] font-medium text-primary"
        >
          {t(`chat.context.${source}`)}
        </span>
      ))}
    </div>
  );
}
