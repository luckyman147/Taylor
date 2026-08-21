'use client';

import { MessageCircle, Target, Briefcase, BarChart3 } from 'lucide-react';
import { useTranslations } from '@/lib/i18n';
import { cn } from '@/lib/utils';

interface ModeSwitcherProps {
  currentMode: string;
  onModeChange: (mode: string) => void;
  disabled?: boolean;
}

const MODES = [
  { id: 'ask', icon: MessageCircle, labelKey: 'chat.mode.ask' },
  { id: 'coach', icon: Target, labelKey: 'chat.mode.coach' },
  { id: 'recruiter', icon: Briefcase, labelKey: 'chat.mode.recruiter' },
  { id: 'resume_analyst', icon: BarChart3, labelKey: 'chat.mode.resumeAnalyst' },
];

export function ModeSwitcher({
  currentMode,
  onModeChange,
  disabled,
}: ModeSwitcherProps) {
  const { t } = useTranslations();

  return (
    <div className="flex gap-1.5">
      {MODES.map((mode) => (
        <button
          key={mode.id}
          onClick={() => onModeChange(mode.id)}
          disabled={disabled}
          className={cn(
            'flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-all',
            currentMode === mode.id
              ? 'border-primary/25 bg-primary/10 text-primary'
              : 'border-transparent text-ink-muted hover:bg-[#f0ece4] hover:text-ink-soft',
            disabled && 'opacity-50',
          )}
          title={t(mode.labelKey)}
        >
          <mode.icon className="h-3.5 w-3.5" />
          <span>{t(mode.labelKey)}</span>
        </button>
      ))}
    </div>
  );
}
