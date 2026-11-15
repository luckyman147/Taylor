import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { TagInput } from '@/components/ui/tag-input';

function rect(top: number): DOMRect {
  return {
    x: 0,
    y: top,
    top,
    left: 0,
    bottom: top + 20,
    right: 100,
    width: 100,
    height: 20,
    toJSON: () => ({}),
  } as DOMRect;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('TagInput sortable mode', () => {
  it('renders a drag handle per chip and keeps removal working', () => {
    const onChange = vi.fn();
    render(
      <TagInput
        value={['Python', 'React']}
        onChange={onChange}
        sortable
        dragLabel="Reorder skills"
      />
    );

    expect(screen.getAllByRole('button', { name: 'Reorder skills' })).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: 'Remove React' }));
    expect(onChange).toHaveBeenCalledWith(['Python']);
  });

  it('does not render drag handles when sortable is off', () => {
    render(<TagInput value={['Python']} onChange={vi.fn()} />);

    expect(screen.queryByRole('button', { name: 'Drag to reorder' })).toBeNull();
  });

  it('reorders chips with the keyboard sensor', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement
    ) {
      const text = this.textContent ?? '';
      if (text.includes('Python')) return rect(0);
      if (text.includes('React')) return rect(30);
      return rect(0);
    });

    const onChange = vi.fn();
    render(
      <TagInput
        value={['Python', 'React']}
        onChange={onChange}
        sortable
        dragLabel="Reorder skills"
      />
    );

    const [pythonHandle] = screen.getAllByRole('button', { name: 'Reorder skills' });

    await act(async () => {
      fireEvent.keyDown(pythonHandle, { code: 'Space', key: ' ' });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await act(async () => {
      fireEvent.keyDown(document, { code: 'ArrowDown', key: 'ArrowDown' });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await act(async () => {
      fireEvent.keyDown(document, { code: 'Space', key: ' ' });
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await waitFor(() => expect(onChange).toHaveBeenCalledWith(['React', 'Python']));
  });
});
