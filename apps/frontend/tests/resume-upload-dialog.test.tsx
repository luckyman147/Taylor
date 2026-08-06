import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ResumeUploadDialog } from '@/components/dashboard/resume-upload-dialog';

vi.mock('@/lib/i18n', () => ({
  useTranslations: () => ({
    t: (key: string) => key,
  }),
}));

vi.mock('@/hooks/use-file-upload', () => {
  const noop = () => {};
  return {
    formatBytes: (n: number) => `${n} bytes`,
    useFileUpload: () => [
      { files: [], isDragging: false, errors: [], isUploadingGlobal: false },
      {
        getInputProps: () => ({}),
        openFileDialog: noop,
        removeFile: noop,
        handleDragEnter: noop,
        handleDragLeave: noop,
        handleDragOver: noop,
        handleDrop: noop,
      },
    ],
  };
});

describe('ResumeUploadDialog', () => {
  it('renders the save-as-master toggle and flips it on click', () => {
    render(<ResumeUploadDialog open onOpenChange={() => {}} />);

    const toggle = screen.getByRole('switch');
    expect(toggle).toHaveAttribute('aria-checked', 'false');

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-checked', 'true');
  });

  it('respects defaultAsMaster', () => {
    render(<ResumeUploadDialog open onOpenChange={() => {}} defaultAsMaster />);

    expect(screen.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
  });
});
