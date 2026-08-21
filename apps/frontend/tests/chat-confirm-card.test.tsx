import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ConfirmCard } from '@/components/chat/confirm-card';

vi.mock('@/lib/i18n', () => ({
  useTranslations: () => ({
    t: (key: string) => key,
  }),
}));

describe('ConfirmCard', () => {
  const pending = {
    token: 'abc123',
    tool: 'create_skill',
    summary: 'Add skill: Python',
  };

  it('renders the summary text', () => {
    render(
      <ConfirmCard
        pendingAction={pending}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText('Add skill: Python')).toBeInTheDocument();
  });

  it('renders execute and cancel buttons', () => {
    render(
      <ConfirmCard
        pendingAction={pending}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText('chat.confirm.execute')).toBeInTheDocument();
    expect(screen.getByText('chat.confirm.cancel')).toBeInTheDocument();
  });

  it('calls onConfirm with token when execute clicked', () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmCard
        pendingAction={pending}
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByText('chat.confirm.execute'));
    expect(onConfirm).toHaveBeenCalledWith('abc123');
  });

  it('calls onCancel with token when cancel clicked', () => {
    const onCancel = vi.fn();
    render(
      <ConfirmCard
        pendingAction={pending}
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByText('chat.confirm.cancel'));
    expect(onCancel).toHaveBeenCalledWith('abc123');
  });
});
