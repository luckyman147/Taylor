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
    args: { skill_name: 'Python', category: 'Backend' },
  };

  it('renders the summary text and tool badge', () => {
    render(<ConfirmCard pendingAction={pending} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText('Add skill: Python')).toBeInTheDocument();
    expect(screen.getByText('create_skill')).toBeInTheDocument();
  });

  it('renders execute and cancel buttons', () => {
    render(<ConfirmCard pendingAction={pending} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText('chat.confirm.execute')).toBeInTheDocument();
    expect(screen.getByText('chat.confirm.cancel')).toBeInTheDocument();
  });

  it('toggles arguments preview', () => {
    render(<ConfirmCard pendingAction={pending} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.queryByText(/skill_name/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByText('chat.confirm.arguments'));
    expect(screen.getByText(/skill_name/)).toBeInTheDocument();
  });

  it('calls onConfirm with token when execute clicked', () => {
    const onConfirm = vi.fn();
    render(<ConfirmCard pendingAction={pending} onConfirm={onConfirm} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByText('chat.confirm.execute'));
    expect(onConfirm).toHaveBeenCalledWith('abc123');
  });

  it('calls onCancel with token when cancel clicked', () => {
    const onCancel = vi.fn();
    render(<ConfirmCard pendingAction={pending} onConfirm={vi.fn()} onCancel={onCancel} />);
    fireEvent.click(screen.getByText('chat.confirm.cancel'));
    expect(onCancel).toHaveBeenCalledWith('abc123');
  });
});
