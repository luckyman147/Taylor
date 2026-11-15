import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { SkillsForm } from '@/components/builder/forms/skills-form';
import type { AdditionalInfo } from '@/components/dashboard/resume-component';

vi.mock('@/lib/i18n', () => ({
  useTranslations: () => ({
    t: (key: string) => key,
  }),
}));

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

describe('SkillsForm reordering', () => {
  it('reorders skill groups and keeps the flattened skills in sync', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement
    ) {
      const name =
        this instanceof HTMLInputElement ? this.value : this.querySelector('input')?.value;

      if (name === 'Frontend') return rect(0);
      if (name === 'Backend') return rect(200);
      return rect(0);
    });

    const onChange = vi.fn<(data: AdditionalInfo) => void>();
    render(
      <SkillsForm
        data={{
          technicalSkills: ['Python', 'Figma'],
          skillGroups: [
            { name: 'Frontend', skills: ['Python'] },
            { name: 'Backend', skills: ['Figma'] },
          ],
        }}
        onChange={onChange}
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
    expect(updated.skillGroups?.map((group) => group.name)).toEqual(['Backend', 'Frontend']);
    expect(updated.technicalSkills).toEqual(['Figma', 'Python']);
  });
});
