import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ModeSkillSelector } from '@/components/chat/mode-switcher';

vi.mock('@/lib/i18n', () => ({
  useTranslations: () => ({
    t: (key: string) => key,
  }),
}));

describe('ModeSkillSelector', () => {
  it('renders all three base modes', () => {
    render(
      <ModeSkillSelector
        currentMode="ask"
        currentSkills={[]}
        onModeChange={vi.fn()}
        onSkillsChange={vi.fn()}
      />,
    );
    expect(screen.getByText('chat.mode.ask')).toBeInTheDocument();
    expect(screen.getByText('chat.mode.agent')).toBeInTheDocument();
    expect(screen.getByText('chat.mode.search')).toBeInTheDocument();
  });

  it('calls onModeChange with mode id when clicked', () => {
    const onModeChange = vi.fn();
    render(
      <ModeSkillSelector
        currentMode="ask"
        currentSkills={[]}
        onModeChange={onModeChange}
        onSkillsChange={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText('chat.mode.agent'));
    expect(onModeChange).toHaveBeenCalledWith('agent');
  });

  it('highlights the active mode', () => {
    render(
      <ModeSkillSelector
        currentMode="agent"
        currentSkills={[]}
        onModeChange={vi.fn()}
        onSkillsChange={vi.fn()}
      />,
    );
    const agentBtn = screen.getByText('chat.mode.agent').closest('button');
    expect(agentBtn?.className).toContain('bg-primary');
  });

  it('shows skills only in agent mode', () => {
    const { rerender } = render(
      <ModeSkillSelector
        currentMode="ask"
        currentSkills={[]}
        onModeChange={vi.fn()}
        onSkillsChange={vi.fn()}
      />,
    );
    expect(screen.queryByText('Skills:')).not.toBeInTheDocument();

    rerender(
      <ModeSkillSelector
        currentMode="agent"
        currentSkills={[]}
        onModeChange={vi.fn()}
        onSkillsChange={vi.fn()}
      />,
    );
    expect(screen.getByText('Skills:')).toBeInTheDocument();
  });

  it('calls onSkillsChange when skill toggled', () => {
    const onSkillsChange = vi.fn();
    render(
      <ModeSkillSelector
        currentMode="agent"
        currentSkills={[]}
        onModeChange={vi.fn()}
        onSkillsChange={onSkillsChange}
      />,
    );
    fireEvent.click(screen.getByText('chat.skill.coach'));
    expect(onSkillsChange).toHaveBeenCalledWith(['coach']);
  });
});
