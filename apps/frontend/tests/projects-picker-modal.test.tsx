import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ProjectsPickerModal } from '@/components/tailor/projects-picker-modal';
import type { ProjectSuggestion } from '@/lib/api/resume';

vi.mock('@/lib/i18n', () => ({
  useTranslations: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@/components/tailor/job-dna-panel', () => ({
  JobDnaPanel: () => null,
}));
vi.mock('@/components/tailor/red-flags-panel', () => ({
  RedFlagsPanel: () => null,
}));
vi.mock('@/components/tailor/hiring-probability-panel', () => ({
  HiringProbabilityPanel: () => null,
}));

function suggestion(name: string, score: number): ProjectSuggestion {
  return {
    name,
    role: 'Developer',
    years: '2024',
    github: null,
    website: null,
    score,
    already_in_resume: false,
    description: [`Worked on ${name}`],
  };
}

const suggestions = [
  suggestion('Project A', 9),
  suggestion('Project B', 7),
  suggestion('Project C', 5),
];

function renderPicker() {
  const props = {
    isOpen: true,
    isFetching: false,
    isTailoring: false,
    suggestions,
    jobId: null,
    onClose: vi.fn(),
    onTailor: vi.fn(),
    onKeepCurrent: vi.fn(),
  };
  render(<ProjectsPickerModal {...props} />);
  return props;
}

describe('ProjectsPickerModal project modes', () => {
  it('keeps the current projects by default', () => {
    const props = renderPicker();

    fireEvent.click(
      screen.getByRole('button', { name: 'tailor.projectsPicker.tailorWithCurrent' })
    );

    expect(props.onKeepCurrent).toHaveBeenCalledTimes(1);
    expect(props.onTailor).not.toHaveBeenCalled();
  });

  it('replaces only after choosing projects explicitly', () => {
    const props = renderPicker();

    fireEvent.click(screen.getByRole('radio', { name: /modeChoose/ }));
    fireEvent.click(screen.getByRole('button', { name: /Project A/ }));
    fireEvent.click(
      screen.getByRole('button', { name: 'tailor.projectsPicker.tailorWithSelection' })
    );

    expect(props.onTailor).toHaveBeenCalledWith(['Project A']);
    expect(props.onKeepCurrent).not.toHaveBeenCalled();
  });

  it('keeps the current projects when keep mode is selected', () => {
    const props = renderPicker();

    fireEvent.click(screen.getByRole('radio', { name: /modeKeep/ }));
    fireEvent.click(
      screen.getByRole('button', { name: 'tailor.projectsPicker.tailorWithCurrent' })
    );

    expect(props.onKeepCurrent).toHaveBeenCalledTimes(1);
    expect(props.onTailor).not.toHaveBeenCalled();
  });
});
