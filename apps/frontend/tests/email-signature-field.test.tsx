import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { EmailSignatureField } from '@/components/common/email-signature-field';
import type { CareerProfile } from '@/lib/api/profile';
import type { SignatureProfileSource } from '@/lib/utils/signature-html';

vi.mock('@/lib/i18n', () => ({
  useTranslations: () => ({
    t: (key: string) => key,
  }),
}));

const { getProfile } = vi.hoisted(() => ({
  getProfile: vi.fn(),
}));

vi.mock('@/lib/api/profile', () => ({
  getProfile,
}));

const profileFixture: CareerProfile = {
  profile_id: 'p1',
  name: 'Jane Doe',
  title: 'Engineer',
  email: 'jane@acme.test',
  phone: '+1 555 0100',
  location: null,
  website: 'https://acme.test',
  linkedin: 'https://linkedin.com/in/jane',
  github: null,
  summary: null,
  career_goals: [],
  target_roles: [],
  target_locations: [],
  target_salary_min: null,
  target_salary_max: null,
  work_experience: [{ role: 'Dev', company: 'Acme', location: null, years: null, description: [] }],
  languages: [],
  awards: [],
  source_resume_id: null,
  source_resume_title: null,
  avatar: 'https://cdn.example/jane.png',
  email_signature: null,
  created_at: '2025-01-01T00:00:00Z',
  updated_at: '2025-01-01T00:00:00Z',
};

function ControlledField({
  initial = '',
  profile,
}: {
  initial?: string;
  profile?: SignatureProfileSource | null;
}) {
  const [value, setValue] = useState(initial);
  const props = profile === undefined ? {} : { profile };
  return (
    <EmailSignatureField id="sig" value={value} onChange={setValue} showLabel={false} {...props} />
  );
}

function openEditor() {
  fireEvent.click(screen.getByRole('button', { name: 'emailSignature.edit' }));
}

function openDetails() {
  const toggle = screen.getByRole('button', { name: /emailSignature\.form\.details/ });
  if (toggle.getAttribute('aria-expanded') === 'false') {
    fireEvent.click(toggle);
  }
}

describe('EmailSignatureField', () => {
  it('shows a trigger button and opens the editor modal', () => {
    render(<ControlledField profile={null} />);
    const trigger = screen.getByRole('button', { name: 'emailSignature.edit' });
    expect(trigger).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: 'emailSignature.form.layout.stacked' })).toBeNull();

    openEditor();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'emailSignature.form.layout.stacked' })).toBeChecked();
    expect(screen.getByRole('button', { name: 'emailSignature.form.bold' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(screen.queryByLabelText('emailSignature.modes.html')?.closest('.hidden')).toBeTruthy();
  });

  it('has no free-form logo URL field (photo comes from profile avatar)', () => {
    render(<ControlledField profile={null} />);
    openEditor();
    expect(screen.queryByLabelText('emailSignature.form.logo')).toBeNull();
    // Photo toggle exists; disabled when no avatar available.
    expect(screen.getByRole('button', { name: 'emailSignature.form.usePhoto' })).toBeDisabled();
  });

  it('switches to HTML tab and keeps shared value editable', () => {
    render(<ControlledField initial="<p>hi</p>" profile={null} />);
    openEditor();
    fireEvent.click(screen.getByRole('button', { name: 'emailSignature.modes.html' }));
    const textarea = screen.getByLabelText('emailSignature.modes.html');
    expect(textarea).not.toHaveClass('hidden');
    expect(textarea).toHaveValue('<p>hi</p>');
    fireEvent.change(textarea, { target: { value: '<p>edited</p>' } });
    expect(textarea).toHaveValue('<p>edited</p>');
  });

  it('regenerates HTML when visual fields change', () => {
    render(<ControlledField profile={null} />);
    openEditor();
    openDetails();
    fireEvent.change(screen.getByLabelText('emailSignature.form.name'), {
      target: { value: 'Ada Lovelace' },
    });
    expect(screen.getAllByText(/Ada Lovelace/).length).toBeGreaterThan(0);
  });

  it('toggles bold/italic/underline and divider design tools', () => {
    render(<ControlledField profile={null} />);
    openEditor();
    const bold = screen.getByRole('button', { name: 'emailSignature.form.bold' });
    const italic = screen.getByRole('button', { name: 'emailSignature.form.italic' });
    const underline = screen.getByRole('button', { name: 'emailSignature.form.underline' });
    const divider = screen.getByRole('button', { name: 'emailSignature.form.divider' });
    expect(bold).toHaveAttribute('aria-pressed', 'true');
    expect(italic).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(italic);
    fireEvent.click(underline);
    fireEvent.click(divider);
    expect(italic).toHaveAttribute('aria-pressed', 'true');
    expect(underline).toHaveAttribute('aria-pressed', 'true');
    expect(divider).toHaveAttribute('aria-pressed', 'true');

    openDetails();
    fireEvent.change(screen.getByLabelText('emailSignature.form.name'), {
      target: { value: 'Style Test' },
    });
    const nameSpan = screen.getAllByText(/Style Test/)[0];
    const style = nameSpan.getAttribute('style') || nameSpan.outerHTML;
    expect(style).toContain('font-style:italic');
    expect(style).toContain('text-decoration:underline');
  });

  it('groups Visual controls into Layout / Style / Position sections', () => {
    render(<ControlledField profile={null} />);
    openEditor();
    expect(screen.getByLabelText('emailSignature.form.sections.layout')).toBeInTheDocument();
    expect(screen.getByLabelText('emailSignature.form.sections.style')).toBeInTheDocument();
    expect(screen.getByLabelText('emailSignature.form.sections.position')).toBeInTheDocument();
    // Position & spacing controls
    expect(
      screen.getByRole('radiogroup', { name: 'emailSignature.form.spacing.label' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('radiogroup', { name: 'emailSignature.form.padding' })
    ).toBeInTheDocument();
    // Text align radiogroup with three options
    const alignGroup = screen.getByRole('radiogroup', {
      name: 'emailSignature.form.align.label',
    });
    expect(alignGroup).toBeInTheDocument();
    fireEvent.click(screen.getByRole('radio', { name: 'emailSignature.form.align.center' }));
    expect(screen.getByRole('radio', { name: 'emailSignature.form.align.center' })).toBeChecked();
  });

  it('exposes name size and photo position controls and regenerates HTML', async () => {
    render(<ControlledField profile={profileFixture} />);
    openEditor();
    await waitFor(() => {
      expect(screen.getByLabelText('emailSignature.form.name')).toHaveValue('Jane Doe');
    });
    // Photo position appears once the avatar is seeded as photo.
    fireEvent.click(
      screen.getByRole('radio', {
        name: 'emailSignature.form.photoPosition.label emailSignature.form.photoPosition.left',
      })
    );
    fireEvent.click(
      screen.getByRole('radio', { name: 'emailSignature.form.nameSize 22px' })
    );
    await waitFor(() => {
      expect(screen.getAllByText(/Jane Doe/).length).toBeGreaterThan(0);
    });
    const nameSpan = screen.getAllByText(/Jane Doe/)[0];
    expect(nameSpan.getAttribute('style') || '').toContain('font-size:22px');
    // Side photo → table layout in the preview.
    expect(screen.getAllByRole('table').length).toBeGreaterThan(0);
  });

  it('re-parses shared HTML when returning from HTML to Visual', async () => {
    render(<ControlledField profile={null} />);
    openEditor();
    fireEvent.click(screen.getByRole('button', { name: 'emailSignature.modes.html' }));
    const textarea = screen.getByLabelText('emailSignature.modes.html');
    fireEvent.change(textarea, {
      target: { value: '<p><span style="color:#ff0000;font-weight:700">Grace Hopper</span></p>' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'emailSignature.modes.visual' }));
    openDetails();
    await waitFor(() => {
      expect(screen.getByLabelText('emailSignature.form.name')).toHaveValue('Grace Hopper');
    });
  });

  it('auto-seeds identity from the provided profile when signature is empty', async () => {
    render(<ControlledField profile={profileFixture} />);
    openEditor();
    await waitFor(() => {
      expect(screen.getByLabelText('emailSignature.form.name')).toHaveValue('Jane Doe');
    });
    expect(screen.getByLabelText('emailSignature.form.email')).toHaveValue('jane@acme.test');
    expect(screen.getByLabelText('emailSignature.form.company')).toHaveValue('Acme');
    expect(screen.getByRole('radio', { name: 'emailSignature.form.layout.stacked' })).toBeChecked();
    expect(screen.getAllByText(/Jane Doe/).length).toBeGreaterThan(0);
    // Avatar is used as photo — enabled and pressed after seed.
    const photoBtn = screen.getByRole('button', { name: 'emailSignature.form.usePhoto' });
    expect(photoBtn).not.toBeDisabled();
    expect(photoBtn).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getAllByRole('img').length).toBeGreaterThan(0);
  });

  it('does not overwrite an existing signature with profile seed', async () => {
    render(
      <ControlledField initial="<p><strong>Custom Sig</strong></p>" profile={profileFixture} />
    );
    openEditor();
    await new Promise((r) => setTimeout(r, 30));
    openDetails();
    expect(screen.getByLabelText('emailSignature.form.name')).toHaveValue('Custom Sig');
  });

  it('fetches profile when no profile prop is passed (Settings path)', async () => {
    getProfile.mockResolvedValueOnce({ profile: profileFixture });
    render(<ControlledField />);
    openEditor();
    await waitFor(() => {
      expect(getProfile).toHaveBeenCalled();
      expect(screen.getByLabelText('emailSignature.form.name')).toHaveValue('Jane Doe');
    });
  });
});
