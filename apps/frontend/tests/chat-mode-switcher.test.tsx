import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ModeSwitcher } from '@/components/chat/mode-switcher';

vi.mock('@/lib/i18n', () => ({
  useTranslations: () => ({
    t: (key: string) => key,
  }),
}));

describe('ModeSwitcher', () => {
  it('renders all four modes', () => {
    render(<ModeSwitcher currentMode="ask" onModeChange={vi.fn()} />);
    expect(screen.getByText('chat.mode.ask')).toBeInTheDocument();
    expect(screen.getByText('chat.mode.coach')).toBeInTheDocument();
    expect(screen.getByText('chat.mode.recruiter')).toBeInTheDocument();
    expect(screen.getByText('chat.mode.resumeAnalyst')).toBeInTheDocument();
  });

  it('calls onModeChange with mode id when clicked', () => {
    const onModeChange = vi.fn();
    render(<ModeSwitcher currentMode="ask" onModeChange={onModeChange} />);
    fireEvent.click(screen.getByText('chat.mode.coach'));
    expect(onModeChange).toHaveBeenCalledWith('coach');
  });

  it('highlights the active mode', () => {
    render(<ModeSwitcher currentMode="coach" onModeChange={vi.fn()} />);
    const coachBtn = screen.getByText('chat.mode.coach').closest('button');
    expect(coachBtn?.className).toContain('bg-primary');
  });

  it('disables buttons when disabled prop is true', () => {
    render(<ModeSwitcher currentMode="ask" onModeChange={vi.fn()} disabled />);
    const btn = screen.getByText('chat.mode.ask').closest('button');
    expect(btn).toBeDisabled();
  });
});
