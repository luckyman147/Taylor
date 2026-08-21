import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ProjectsForm } from '@/components/builder/forms/projects-form';
import type { Project } from '@/components/dashboard/resume-component';

vi.mock('@/lib/i18n', () => ({
  useTranslations: () => ({
    t: (key: string) => key,
  }),
}));

// Render a plain textarea instead of the lazily-loaded TipTap editor.
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

function project(id: number, name: string, description: string[]): Project {
  return {
    id,
    name,
    role: '',
    years: '',
    github: '',
    website: '',
    description,
    descriptionStyles: ['bullet'],
  } as Project;
}

const firstBulletTextarea = () =>
  screen.getAllByRole('textbox', { name: 'builder.forms.projects.placeholders.description' })[0];

describe('ProjectsForm id targeting', () => {
  it('editing a bullet with duplicate ids updates every project sharing that id', () => {
    const onChange = vi.fn<(data: Project[]) => void>();
    render(
      <ProjectsForm
        data={[project(0, 'Alpha', ['Alpha bullet']), project(0, 'Beta', ['Beta bullet'])]}
        onChange={onChange}
        outputLanguage="en"
      />
    );

    fireEvent.change(firstBulletTextarea(), { target: { value: 'edited' } });

    const result = onChange.mock.calls[0][0];
    // Documents the data dependency: the form targets entries by `item.id`, so
    // entries with a shared id (LLM defaults / pre-fix payloads) all change.
    expect(result[0].description).toEqual(['edited']);
    expect(result[1].description).toEqual(['edited']);
  });

  it('editing a bullet changes only that project when ids are unique', () => {
    const onChange = vi.fn<(data: Project[]) => void>();
    render(
      <ProjectsForm
        data={[project(1, 'Alpha', ['Alpha bullet']), project(2, 'Beta', ['Beta bullet'])]}
        onChange={onChange}
        outputLanguage="en"
      />
    );

    fireEvent.change(firstBulletTextarea(), { target: { value: 'Alpha edited' } });

    const result = onChange.mock.calls[0][0];
    expect(result[0].description).toEqual(['Alpha edited']);
    expect(result[1].description).toEqual(['Beta bullet']);
  });
});
