import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { InlineSelectEditor, InlineTextEditor } from '@/components/companies/inline-edit';

describe('inline-edit', () => {
  describe('InlineTextEditor', () => {
    it('commits the edited value on Enter', () => {
      const onCommit = vi.fn();
      const onCancel = vi.fn();
      render(
        <InlineTextEditor
          initialValue="Acme Corp"
          ariaLabel="Company name"
          onCommit={onCommit}
          onCancel={onCancel}
        />
      );

      const input = screen.getByRole('textbox', { name: 'Company name' });
      fireEvent.change(input, { target: { value: 'Globex Ltd' } });
      fireEvent.keyDown(input, { key: 'Enter' });

      expect(onCommit).toHaveBeenCalledWith('Globex Ltd');
      expect(onCancel).not.toHaveBeenCalled();
    });

    it('commits on blur', () => {
      const onCommit = vi.fn();
      render(
        <InlineTextEditor
          initialValue="Acme"
          ariaLabel="Company name"
          onCommit={onCommit}
          onCancel={() => {}}
        />
      );

      fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Acme 2' } });
      fireEvent.blur(screen.getByRole('textbox'));

      expect(onCommit).toHaveBeenCalledWith('Acme 2');
    });

    it('cancels without committing when the value is unchanged', () => {
      const onCommit = vi.fn();
      const onCancel = vi.fn();
      render(
        <InlineTextEditor
          initialValue="Acme"
          ariaLabel="Company name"
          onCommit={onCommit}
          onCancel={onCancel}
        />
      );

      fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });

      expect(onCommit).not.toHaveBeenCalled();
      expect(onCancel).toHaveBeenCalled();
    });

    it('cancels on Escape without committing', () => {
      const onCommit = vi.fn();
      const onCancel = vi.fn();
      render(
        <InlineTextEditor
          initialValue="Acme"
          ariaLabel="Company name"
          onCommit={onCommit}
          onCancel={onCancel}
        />
      );

      fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Changed' } });
      fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });

      expect(onCommit).not.toHaveBeenCalled();
      expect(onCancel).toHaveBeenCalled();
    });
  });

  describe('InlineSelectEditor', () => {
    const options = [
      { id: '', label: 'None' },
      { id: 'startup', label: 'Startup' },
      { id: 'agency', label: 'Agency' },
    ];

    it('commits the picked option', () => {
      const onCommit = vi.fn();
      render(
        <InlineSelectEditor
          initialValue="startup"
          ariaLabel="Company type"
          options={options}
          onCommit={onCommit}
          onCancel={() => {}}
        />
      );

      fireEvent.change(screen.getByRole('combobox', { name: 'Company type' }), {
        target: { value: 'agency' },
      });

      expect(onCommit).toHaveBeenCalledWith('agency');
    });

    it('cancels without committing when the same option is picked', () => {
      const onCommit = vi.fn();
      const onCancel = vi.fn();
      render(
        <InlineSelectEditor
          initialValue="startup"
          ariaLabel="Company type"
          options={options}
          onCommit={onCommit}
          onCancel={onCancel}
        />
      );

      fireEvent.change(screen.getByRole('combobox'), { target: { value: 'startup' } });

      expect(onCommit).not.toHaveBeenCalled();
      expect(onCancel).toHaveBeenCalled();
    });

    it('cancels on Escape', () => {
      const onCommit = vi.fn();
      const onCancel = vi.fn();
      render(
        <InlineSelectEditor
          initialValue="startup"
          ariaLabel="Company type"
          options={options}
          onCommit={onCommit}
          onCancel={onCancel}
        />
      );

      fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' });

      expect(onCommit).not.toHaveBeenCalled();
      expect(onCancel).toHaveBeenCalled();
    });
  });
});
