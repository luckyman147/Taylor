import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import { MentionPopover } from '@/components/chat/mention-popover';

vi.mock('@/lib/api/contacts', () => ({
  listContacts: vi.fn().mockResolvedValue({
    contacts: [{ contact_id: 'c1', name: 'Alice Smith', company: 'Acme' }],
  }),
}));

vi.mock('@/lib/api/companies', () => ({
  listCompanies: vi.fn().mockResolvedValue({
    companies: [{ company_id: 'co1', name: 'Google', status: 'Applied' }],
  }),
}));

vi.mock('@/lib/api/resume', () => ({
  fetchResumeList: vi
    .fn()
    .mockResolvedValue([{ resume_id: 'r1', title: 'Master Resume', is_master: true }]),
}));

describe('MentionPopover', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders fetched items grouped by type', async () => {
    const textareaRef = { current: document.createElement('textarea') };
    render(
      <MentionPopover query="" onSelect={vi.fn()} onClose={vi.fn()} textareaRef={textareaRef} />
    );

    await waitFor(() => {
      expect(screen.getByText('Google')).toBeInTheDocument();
      expect(screen.getByText('Alice Smith')).toBeInTheDocument();
      expect(screen.getByText('Master Resume')).toBeInTheDocument();
    });
  });

  it('filters items based on query', async () => {
    const textareaRef = { current: document.createElement('textarea') };
    render(
      <MentionPopover query="goo" onSelect={vi.fn()} onClose={vi.fn()} textareaRef={textareaRef} />
    );

    await waitFor(() => {
      expect(screen.getByText('Google')).toBeInTheDocument();
      expect(screen.queryByText('Alice Smith')).not.toBeInTheDocument();
    });
  });

  it('calls onSelect when an item is clicked', async () => {
    const onSelect = vi.fn();
    const textareaRef = { current: document.createElement('textarea') };
    render(
      <MentionPopover query="" onSelect={onSelect} onClose={vi.fn()} textareaRef={textareaRef} />
    );

    await waitFor(() => {
      expect(screen.getByText('Google')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText('Google'));
    expect(onSelect).toHaveBeenCalledWith('Google');
  });

  it('shows empty message when no matches found', async () => {
    const textareaRef = { current: document.createElement('textarea') };
    render(
      <MentionPopover
        query="nonexistent"
        onSelect={vi.fn()}
        onClose={vi.fn()}
        textareaRef={textareaRef}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/No results for/)).toBeInTheDocument();
    });
  });
});
