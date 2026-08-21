import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ExperienceTab } from '@/components/profile/experience-tab';
import type { ProfileBundle } from '@/lib/api/profile';

vi.mock('@/lib/i18n', () => ({
  useTranslations: () => ({
    t: (key: string) => key,
  }),
}));

const { getSkillSuggestions, createSkill, getProfile } = vi.hoisted(() => ({
  getSkillSuggestions: vi.fn(),
  createSkill: vi.fn(),
  getProfile: vi.fn(),
}));

vi.mock('@/lib/api/profile', () => ({
  createSkill,
  deleteSkill: vi.fn(),
  getProfile,
  getSkillSuggestions,
  updateProfile: vi.fn(),
  updateSkill: vi.fn(),
}));

const bundle: ProfileBundle = {
  profile: {
    profile_id: 'p1',
    name: 'Jane',
    title: null,
    email: null,
    phone: null,
    location: null,
    website: null,
    linkedin: null,
    github: null,
    summary: null,
    career_goals: [],
    target_roles: [],
    target_locations: [],
    target_salary_min: null,
    target_salary_max: null,
    work_experience: [],
    languages: [],
    awards: [],
    source_resume_id: null,
    source_resume_title: null,
    created_at: '2025-01-01T00:00:00Z',
    updated_at: '2025-01-01T00:00:00Z',
  },
  skills: [
    {
      skill_id: 's1',
      name: 'Python',
      category: null,
      proficiency: null,
      years_experience: null,
      last_used: null,
      created_at: '2025-01-01T00:00:00Z',
      updated_at: '2025-01-01T00:00:00Z',
    },
  ],
  certifications: [],
  education: [],
  projects: [],
  achievements: [],
};

async function openDialog() {
  fireEvent.click(screen.getByText('profile.skills.suggestionsButton'));
  await screen.findByRole('dialog');
}

describe('ExperienceTab AI skill suggestions', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('opens the dialog and lists suggestions with reasons', async () => {
    getSkillSuggestions.mockResolvedValue({
      skills: [
        { name: 'Docker', reason: 'Your projects run in containers.', kind: 'remembered' },
      ],
      note: null,
    });
    render(<ExperienceTab bundle={bundle} onChanged={vi.fn()} />);

    await openDialog();

    expect(await screen.findByText('Docker')).toBeInTheDocument();
    expect(screen.getByText('Your projects run in containers.')).toBeInTheDocument();
    expect(getSkillSuggestions).toHaveBeenCalledTimes(1);
  });

  it('groups suggestions under remembered and learn-next headers', async () => {
    getSkillSuggestions.mockResolvedValue({
      skills: [
        { name: 'Docker', reason: 'Containers.', kind: 'remembered' },
        { name: 'RAG', reason: 'Unlocks LLM apps.', kind: 'learn_next' },
        { name: 'MCP', reason: 'Agent tooling.', kind: 'learn_next' },
      ],
      note: null,
    });
    render(<ExperienceTab bundle={bundle} onChanged={vi.fn()} />);

    await openDialog();

    expect(await screen.findByText('profile.skills.suggestionsGroupRemembered')).toBeInTheDocument();
    expect(screen.getByText('profile.skills.suggestionsGroupLearnNext')).toBeInTheDocument();
    expect(screen.getByText('Docker')).toBeInTheDocument();
    expect(screen.getByText('RAG')).toBeInTheDocument();
    expect(screen.getByText('MCP')).toBeInTheDocument();
  });

  it('adds a suggestion as a skill and removes it from the list', async () => {
    getSkillSuggestions.mockResolvedValue({
      skills: [
        { name: 'Docker', reason: 'Your projects run in containers.', kind: 'remembered' },
        { name: 'GraphQL', reason: 'Pairs with React.', kind: 'remembered' },
      ],
      note: null,
    });
    createSkill.mockResolvedValue({ skill_id: 's2' });
    getProfile.mockResolvedValue(bundle);
    const onChanged = vi.fn();
    render(<ExperienceTab bundle={bundle} onChanged={onChanged} />);

    await openDialog();
    fireEvent.click(
      (await screen.findAllByRole('button', { name: 'profile.skills.suggestAdd' }))[0]
    );

    await waitFor(() =>
      expect(createSkill).toHaveBeenCalledWith({
        name: 'Docker',
        category: null,
        proficiency: null,
        years_experience: null,
        last_used: null,
      })
    );
    await waitFor(() => expect(getProfile).toHaveBeenCalled());
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByText('Docker')).not.toBeInTheDocument());
    expect(screen.getByText('GraphQL')).toBeInTheDocument();
  });

  it('shows the backend note when suggestions are unavailable', async () => {
    const note = 'Skill suggestions are only available when an LLM is configured.';
    getSkillSuggestions.mockResolvedValue({ skills: [], note });
    render(<ExperienceTab bundle={bundle} onChanged={vi.fn()} />);

    await openDialog();

    expect(await screen.findByText(note)).toBeInTheDocument();
  });

  it('shows the error with a retry button on failure', async () => {
    getSkillSuggestions.mockRejectedValueOnce(new Error('boom'));
    getSkillSuggestions.mockResolvedValue({
      skills: [{ name: 'Docker', reason: 'Your projects run in containers.', kind: 'remembered' }],
      note: null,
    });
    render(<ExperienceTab bundle={bundle} onChanged={vi.fn()} />);

    await openDialog();
    expect(await screen.findByText('boom')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'common.retry' }));

    await waitFor(() => expect(getSkillSuggestions).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('Docker')).toBeInTheDocument();
  });
});
