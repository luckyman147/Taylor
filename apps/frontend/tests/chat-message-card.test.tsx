import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MessageCard } from '@/components/chat/message-card';

vi.mock('@/lib/i18n', () => ({
  useTranslations: () => ({
    t: (key: string, params?: Record<string, string>) =>
      params?.title ? `${key} ${params.title}` : key,
  }),
}));

vi.mock('@/components/common/markdown-content', () => ({
  MarkdownContent: ({ content }: { content: string }) => (
    <div data-testid="markdown">{content}</div>
  ),
}));

describe('MessageCard', () => {
  it('renders user message with correct styling', () => {
    render(<MessageCard role="user" content="Hello there" />);
    const msg = screen.getByText('Hello there');
    expect(msg).toBeInTheDocument();
    expect(msg.closest('.bg-primary')).toBeTruthy();
  });

  it('renders assistant message in a bordered card', () => {
    render(<MessageCard role="assistant" content="I can help" />);
    expect(screen.getByText('I can help')).toBeInTheDocument();
  });

  it('renders markdown content for assistant', () => {
    render(<MessageCard role="assistant" content="**Bold text**" />);
    const md = screen.getByTestId('markdown');
    expect(md).toHaveTextContent('**Bold text**');
  });

  it('renders tool cards', () => {
    const cards = [{ kind: 'stats', data: { funnel: { total: 10 } } }];
    render(<MessageCard role="assistant" content="" cards={cards} />);
    expect(screen.getByText('Career Stats')).toBeInTheDocument();
  });

  it('renders pending action confirm card', () => {
    const pending = { token: 'abc', tool: 'create_skill', summary: 'Add Python' };
    render(
      <MessageCard
        role="assistant"
        content=""
        pendingAction={pending}
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText('Add Python')).toBeInTheDocument();
    expect(screen.getByText('chat.confirm.execute')).toBeInTheDocument();
  });

  it('renders follow-up buttons', () => {
    const followups = ['Tell me more', 'What else?'];
    render(
      <MessageCard
        role="assistant"
        content=""
        followups={followups}
        onFollowup={vi.fn()}
      />,
    );
    expect(screen.getByText('Tell me more')).toBeInTheDocument();
    expect(screen.getByText('What else?')).toBeInTheDocument();
  });

  it('renders action links', () => {
    const actions = [{ kind: 'link', label: 'Open Builder', href: '/builder' }];
    render(<MessageCard role="assistant" content="" actions={actions} />);
    const link = screen.getByText('Open Builder');
    expect(link).toHaveAttribute('href', '/builder');
  });

  it('does not render cards for user messages', () => {
    const cards = [{ kind: 'stats', data: {} }];
    render(<MessageCard role="user" content="Hi" cards={cards} />);
    expect(screen.queryByText('Career Stats')).not.toBeInTheDocument();
  });
});
