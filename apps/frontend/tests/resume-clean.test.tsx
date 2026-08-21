import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ResumeClean } from '@/components/resume/resume-clean';
import type { ResumeData } from '@/components/dashboard/resume-component';

vi.mock('@/lib/i18n', () => ({ useTranslations: () => ({ t: (k: string) => k }) }));

const data: ResumeData = {
  personalInfo: { name: 'Saurabh Rai', email: 'a@b.com', phone: '+91-700' },
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
  additional: { technicalSkills: ['Python', 'TypeScript'] },
} as ResumeData;

describe('ResumeClean', () => {
  it('renders name, company, role and a bullet', () => {
    render(<ResumeClean data={data} />);
    expect(screen.getByText('Saurabh Rai')).toBeInTheDocument();
    expect(screen.getByText('Apideck')).toBeInTheDocument();
    expect(screen.getByText('DevRel Engineer')).toBeInTheDocument();
    expect(screen.getByText('Lead client demos.')).toBeInTheDocument();
  });

  it('renders full contact values by default', () => {
    render(<ResumeClean data={data} />);
    expect(screen.getByRole('link', { name: 'a@b.com' })).toHaveAttribute('href', 'mailto:a@b.com');
  });

  it('renders a short hypertext label when contactDisplay is label mode', () => {
    render(
      <ResumeClean
        data={
          {
            ...data,
            personalInfo: {
              ...data.personalInfo,
              email: 'a@b.com',
              contactDisplay: { email: 'label' },
            },
          } as ResumeData
        }
      />
    );
    expect(screen.getByRole('link', { name: 'Email' })).toHaveAttribute('href', 'mailto:a@b.com');
    expect(screen.queryByRole('link', { name: 'a@b.com' })).not.toBeInTheDocument();
  });
});
