'use client';

import { MessageCircle, Target, Briefcase } from 'lucide-react';
import { useTranslations } from '@/lib/i18n';
import { cn } from '@/lib/utils';

interface ModeSkillSelectorProps {
  currentMode: string;
  currentSkills: string[];
  onModeChange: (mode: string) => void;
  onSkillsChange: (skills: string[]) => void;
  disabled?: boolean;
}

const MODES = [
  { id: 'ask', icon: MessageCircle, labelKey: 'chat.mode.ask' },
  { id: 'agent', icon: Target, labelKey: 'chat.mode.agent' },
  { id: 'search', icon: Briefcase, labelKey: 'chat.mode.search' },
];

const SKILLS = [
  { id: 'coach', labelKey: 'chat.skill.coach', emoji: '🎯' },
  { id: 'recruiter', labelKey: 'chat.skill.recruiter', emoji: '👔' },
  { id: 'resume_analyst', labelKey: 'chat.skill.resumeAnalyst', emoji: '📊' },
];

export function ModeSkillSelector({
  currentMode,
  currentSkills,
  onModeChange,
  onSkillsChange,
  disabled,
}: ModeSkillSelectorProps) {
  const { t } = useTranslations();

  const toggleSkill = (skillId: string) => {
    if (disabled) return;
    const next = currentSkills.includes(skillId)
      ? currentSkills.filter((s) => s !== skillId)
      : [...currentSkills, skillId];
    onSkillsChange(next);
  };

  return (
    <div className="flex flex-col gap-2">
      {/* Base modes */}
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

      {/* Skills (only in agent mode) */}
      {currentMode === 'agent' && (
        <div className="flex gap-1.5">
          <span className="text-[10px] text-ink-muted self-center mr-1">Skills:</span>
          {SKILLS.map((skill) => (
            <button
              key={skill.id}
              onClick={() => toggleSkill(skill.id)}
              disabled={disabled}
              className={cn(
                'flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-all',
                currentSkills.includes(skill.id)
                  ? 'border-primary/25 bg-primary/10 text-primary'
                  : 'border-transparent text-ink-muted hover:bg-[#f0ece4] hover:text-ink-soft',
                disabled && 'opacity-50',
              )}
              title={t(skill.labelKey)}
            >
              <span>{skill.emoji}</span>
              <span>{t(skill.labelKey)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
