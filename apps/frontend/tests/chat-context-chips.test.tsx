import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ContextChips } from '@/components/chat/context-chips';

vi.mock('@/lib/i18n', () => ({
  useTranslations: () => ({
    t: (key: string, fallback?: string) => fallback || key,
  }),
}));

describe('ContextChips', () => {
  it('renders nothing when sources empty', () => {
    const { container } = render(<ContextChips sources={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders a chip per source', () => {
    render(<ContextChips sources={['funnel_stats', 'skill_roi']} />);
    expect(screen.getByText('chat.context.funnel_stats')).toBeInTheDocument();
    expect(screen.getByText('chat.context.skill_roi')).toBeInTheDocument();
  });

  it('applies primary styling', () => {
    render(<ContextChips sources={['audit']} />);
    const chip = screen.getByText('chat.context.audit');
    expect(chip.className).toContain('bg-primary/10');
  });
});
