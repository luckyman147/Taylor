import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ResumeLatex } from '@/components/resume/resume-latex';
import type { ResumeData } from '@/components/dashboard/resume-component';

vi.mock('@/lib/i18n', () => ({ useTranslations: () => ({ t: (k: string) => k }) }));

const data: ResumeData = {
  personalInfo: {
    name: 'Saurabh Rai',
    location: 'Delhi, India',
    email: 'a@b.com',
    website: 'portfolio.com',
  },
  workExperience: [
    {
      id: 1,
      title: 'DevRel Engineer',
      company: 'Apideck',
      location: 'Remote',
      years: '2025-Present',
      description: ['Lead client demos.'],
    },
  ],
  additional: { technicalSkills: ['Python', '', 'TypeScript'] },
} as ResumeData;

describe('ResumeLatex', () => {
  it('renders name, company-first entry, role and a bullet', () => {
    render(<ResumeLatex data={data} />);
    expect(screen.getByText('Saurabh Rai')).toBeInTheDocument();
    expect(screen.getByText('Delhi, India')).toBeInTheDocument();
    expect(screen.getByText('Apideck')).toBeInTheDocument();
    expect(screen.getByText('DevRel Engineer')).toBeInTheDocument();
    expect(screen.getByText('Lead client demos.')).toBeInTheDocument();
  });

  it('drops blank additional entries (issue #763 parity)', () => {
    render(<ResumeLatex data={data} />);
    expect(screen.getByText(/Python, TypeScript/)).toBeInTheDocument();
  });

  it('shows the full value by default and the label only in label mode', () => {
    const { rerender } = render(<ResumeLatex data={data} />);
    expect(screen.getByRole('link', { name: 'a@b.com' })).toHaveAttribute('href', 'mailto:a@b.com');
    expect(screen.getByRole('link', { name: 'portfolio.com' })).toHaveAttribute(
      'href',
      'https://portfolio.com'
    );

    rerender(
      <ResumeLatex
        data={
          {
            ...data,
            personalInfo: {
              ...data.personalInfo,
              email: 'a@b.com',
              website: 'portfolio.com',
              contactDisplay: { email: 'label', website: 'label' },
            },
          } as ResumeData
        }
      />
    );
    expect(screen.getByRole('link', { name: 'Email' })).toHaveAttribute('href', 'mailto:a@b.com');
    expect(screen.queryByRole('link', { name: 'a@b.com' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Website' })).toHaveAttribute(
      'href',
      'https://portfolio.com'
    );
    expect(screen.queryByRole('link', { name: 'portfolio.com' })).not.toBeInTheDocument();
  });
});
