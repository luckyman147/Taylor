import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ResumeBuilder } from '@/components/builder/resume-builder';
import type { ResumeData } from '@/components/dashboard/resume-component';
import type { TemplateSettings } from '@/lib/types/template-settings';

vi.mock('next/navigation', () => ({
  useSearchParams: () => ({ get: () => null }),
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('@/lib/i18n', () => {
  const t = (key: string) => key;
  return { useTranslations: () => ({ t }) };
});

vi.mock('@/lib/context/language-context', () => ({
  useLanguage: () => ({ uiLanguage: 'en', contentLanguage: 'en' }),
}));

vi.mock('@/components/common/resume_previewer_context', () => ({
  useResumePreview: () => ({ improvedData: null }),
}));

vi.mock('@/components/preview', () => ({
  PaginatedPreview: () => <div data-testid="preview" />,
}));

vi.mock('@/components/builder/resume-form', () => ({
  ResumeForm: ({
    resumeData,
    onUpdate,
  }: {
    resumeData: ResumeData;
    onUpdate: (data: ResumeData) => void;
  }) => (
    <textarea
      aria-label="summary"
      value={resumeData.summary ?? ''}
      onChange={(event) => onUpdate({ ...resumeData, summary: event.target.value })}
    />
  ),
}));

vi.mock('@/components/builder/formatting-controls', () => ({
  FormattingControls: ({
    settings,
    onChange,
  }: {
    settings: TemplateSettings;
    onChange: (settings: TemplateSettings) => void;
  }) => (
    <div>
      <span data-testid="page-size">{settings.pageSize}</span>
      <button
        type="button"
        onClick={() =>
          onChange({
            ...settings,
            pageSize: settings.pageSize === 'A4' ? 'LETTER' : 'A4',
          })
        }
      >
        change-design
      </button>
    </div>
  ),
}));

vi.mock('@/components/builder/regenerate-wizard', () => ({
  RegenerateWizard: () => null,
}));

describe('ResumeBuilder undo', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('undoes resume edits and disables at the bottom of the stack', () => {
    render(<ResumeBuilder />);

    const undo = screen.getByRole('button', { name: 'builder.actions.undo' });
    expect(undo).toBeDisabled();

    const summary = screen.getByLabelText('summary') as HTMLTextAreaElement;
    const initialSummary = summary.value;

    fireEvent.change(summary, { target: { value: 'Tailored summary' } });

    expect(summary.value).toBe('Tailored summary');
    expect(undo).toBeEnabled();

    fireEvent.click(undo);

    expect(summary.value).toBe(initialSummary);
    expect(undo).toBeDisabled();
  });

  it('allows undoing a reset', () => {
    render(<ResumeBuilder />);

    const summary = screen.getByLabelText('summary') as HTMLTextAreaElement;
    const initialSummary = summary.value;

    fireEvent.change(summary, { target: { value: 'Edited summary' } });
    fireEvent.click(screen.getByRole('button', { name: 'common.reset' }));

    expect(summary.value).toBe(initialSummary);

    fireEvent.click(screen.getByRole('button', { name: 'builder.actions.undo' }));
    expect(summary.value).toBe('Edited summary');
  });

  it('undoes design settings changes', () => {
    render(<ResumeBuilder />);

    const pageSize = screen.getByTestId('page-size');
    const initialPageSize = pageSize.textContent;

    fireEvent.click(screen.getByRole('button', { name: 'change-design' }));
    expect(pageSize.textContent).not.toBe(initialPageSize);

    fireEvent.click(screen.getByRole('button', { name: 'builder.actions.undo' }));
    expect(pageSize.textContent).toBe(initialPageSize);
  });
});
