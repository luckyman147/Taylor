import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryCard } from '@/components/chat/memory-card';

vi.mock('@/lib/i18n', () => ({
  useTranslations: () => ({
    t: (key: string) => key,
  }),
}));

describe('MemoryCard', () => {
  it('renders nothing when candidates empty', () => {
    const { container } = render(
      <MemoryCard candidates={[]} onDismiss={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders each candidate statement', () => {
    render(
      <MemoryCard
        candidates={[
          { statement: 'I prefer remote work' },
          { statement: 'I like TypeScript' },
        ]}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByText('I prefer remote work')).toBeInTheDocument();
    expect(screen.getByText('I like TypeScript')).toBeInTheDocument();
  });

  it('calls onDismiss with statement when X clicked', () => {
    const onDismiss = vi.fn();
    render(
      <MemoryCard
        candidates={[{ statement: 'I prefer remote work' }]}
        onDismiss={onDismiss}
      />,
    );
    const dismissBtn = screen.getByLabelText('chat.memory.dismiss');
    fireEvent.click(dismissBtn);
    expect(onDismiss).toHaveBeenCalledWith('I prefer remote work');
  });

  it('renders the saved header', () => {
    render(
      <MemoryCard
        candidates={[{ statement: 'test' }]}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByText('chat.memory.saved')).toBeInTheDocument();
  });
});
