import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ProjectsForm } from '@/components/builder/forms/projects-form';
import type { Project } from '@/components/dashboard/resume-component';

vi.mock('@/lib/i18n', () => ({
  useTranslations: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('next/dynamic', () => ({
  __esModule: true,
  default:
    () =>
    ({
      value,
      onChange,
      placeholder,
    }: {
      value?: string;
      onChange?: (value: string) => void;
      placeholder?: string;
    }) => (
      <textarea
        aria-label={placeholder ?? 'description'}
        value={value ?? ''}
        onChange={(e) => onChange?.(e.target.value)}
      />
    ),
}));

function project(id: number, name: string): Project {
  return {
    id,
    name,
    role: '',
    years: '',
    github: '',
    website: '',
    description: ['bullet'],
    descriptionStyles: ['bullet'],
  } as Project;
}

function rect(top: number): DOMRect {
  return {
    x: 0,
    y: top,
    top,
    left: 0,
    bottom: top + 100,
    right: 400,
    width: 400,
    height: 100,
    toJSON: () => ({}),
  } as DOMRect;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ProjectsForm reordering', () => {
  it('reorders project cards with the keyboard sensor', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement
    ) {
      const name =
        this instanceof HTMLInputElement ? this.value : this.querySelector('input')?.value;

      if (name === 'Alpha') return rect(0);
      if (name === 'Beta') return rect(200);
      return rect(0);
    });

    const onChange = vi.fn<(data: Project[]) => void>();
    render(
      <ProjectsForm
        data={[project(1, 'Alpha'), project(2, 'Beta')]}
        onChange={onChange}
        outputLanguage="en"
      />
    );

    const [firstHandle] = screen.getAllByTitle('Drag to reorder');

    await act(async () => {
      fireEvent.keyDown(firstHandle, { code: 'Space', key: ' ' });
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

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledTimes(1);
    });

    const updated = onChange.mock.calls[0][0];
    expect(updated.map((item) => item.name)).toEqual(['Beta', 'Alpha']);
  });
});
