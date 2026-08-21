import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ResumeClean } from '@/components/resume/resume-clean';
import { ResumeModern } from '@/components/resume/resume-modern';
import { ResumeSkillsContent } from '@/components/resume/resume-skills';
import type { ResumeData } from '@/components/dashboard/resume-component';

vi.mock('@/lib/i18n', () => ({ useTranslations: () => ({ t: (k: string) => k }) }));

describe('ResumeSkillsContent grouped rendering', () => {
  it('renders one line per category with bold labels when groups are present', () => {
    render(
      <ResumeSkillsContent
        skills={['Python', 'React', 'Docker']}
        skillGroups={[
          { name: 'Languages', skills: ['Python'] },
          { name: 'Frontend', skills: ['React'] },
          { name: 'Cloud & DevOps', skills: ['Docker'] },
        ]}
        layout="comma"
      />
    );
    expect(screen.getByText(/^Languages:$/)).toBeInTheDocument();
    expect(screen.getByText(/^Frontend:$/)).toBeInTheDocument();
    expect(screen.getByText(/^Cloud & DevOps:$/)).toBeInTheDocument();
    expect(screen.getByText('Python')).toBeInTheDocument();
    expect(screen.getByText('React')).toBeInTheDocument();
    expect(screen.getByText('Docker')).toBeInTheDocument();
  });

  it('falls back to the flat layout when groups are absent', () => {
    const { container } = render(
      <ResumeSkillsContent skills={['Python', 'TypeScript']} layout="comma" />
    );
    expect(container.querySelector('.resume-skills-grouped')).toBeNull();
    expect(screen.getByText('Python, TypeScript')).toBeInTheDocument();
  });

  it('ignores groups with blank skills and blank entries inside groups', () => {
    render(
      <ResumeSkillsContent
        skills={['Python']}
        skillGroups={[
          { name: 'Languages', skills: ['Python', '', '  '] },
          { name: 'Empty', skills: [] },
          { name: 'Blank', skills: ['   '] },
        ]}
        layout="comma"
      />
    );
    expect(screen.getByText(/^Languages:$/)).toBeInTheDocument();
    expect(screen.queryByText(/^Empty:$/)).toBeNull();
    expect(screen.queryByText(/^Blank:$/)).toBeNull();
  });
});

describe('Grouped skills in templates', () => {
  const groupedData: ResumeData = {
    personalInfo: { name: 'Saurabh Rai', email: 'a@b.com' },
    additional: {
      technicalSkills: ['Python', 'React', 'Docker'],
      skillGroups: [
        { name: 'Languages', skills: ['Python'] },
        { name: 'Frontend', skills: ['React'] },
        { name: 'Cloud & DevOps', skills: ['Docker'] },
      ],
    },
  } as ResumeData;

  it('ResumeClean renders category labels and skills', () => {
    render(<ResumeClean data={groupedData} />);
    expect(screen.getByText(/^Languages:$/)).toBeInTheDocument();
    expect(screen.getByText(/^Frontend:$/)).toBeInTheDocument();
    expect(screen.getByText('Python')).toBeInTheDocument();
    expect(screen.getByText('React')).toBeInTheDocument();
  });

  it('ResumeModern renders category labels and skills', () => {
    render(<ResumeModern data={groupedData} />);
    expect(screen.getByText(/^Languages:$/)).toBeInTheDocument();
    expect(screen.getByText('Docker')).toBeInTheDocument();
  });
});
