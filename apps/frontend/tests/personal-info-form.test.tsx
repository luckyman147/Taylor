import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { PersonalInfoForm } from '@/components/builder/forms/personal-info-form';
import type { PersonalInfo } from '@/components/dashboard/resume-component';

// Components call useTranslations(); return the key so we can match deterministically.
vi.mock('@/lib/i18n', () => ({
  useTranslations: () => ({
    t: (key: string) => key,
  }),
}));

const switchName = (field: string) => `${field}: builder.personalInfoForm.displayAsLink`;

describe('PersonalInfoForm contact display toggles', () => {
  it('turns on label mode for email', () => {
    const onChange = vi.fn<(data: PersonalInfo) => void>();
    const data: PersonalInfo = { name: 'John', email: 'john@example.com' };

    render(<PersonalInfoForm data={data} onChange={onChange} />);

    fireEvent.click(screen.getByRole('switch', { name: switchName('email') }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].contactDisplay).toEqual({ email: 'label' });
    expect(onChange.mock.calls[0][0].email).toBe('john@example.com');
  });

  it('turns off label mode and drops the stale entry', () => {
    const onChange = vi.fn<(data: PersonalInfo) => void>();
    const data: PersonalInfo = {
      name: 'John',
      linkedin: 'linkedin.com/in/john',
      contactDisplay: { linkedin: 'label', email: 'label' },
    };

    render(<PersonalInfoForm data={data} onChange={onChange} />);

    fireEvent.click(screen.getByRole('switch', { name: switchName('linkedin') }));

    expect(onChange.mock.calls[0][0].contactDisplay).toEqual({ email: 'label' });
  });

  it('keeps other fields untouched when toggling one field', () => {
    const onChange = vi.fn<(data: PersonalInfo) => void>();
    const data: PersonalInfo = { name: 'John', phone: '+1 555', email: 'j@x.com' };

    render(<PersonalInfoForm data={data} onChange={onChange} />);

    fireEvent.click(screen.getByRole('switch', { name: switchName('phone') }));

    expect(onChange.mock.calls[0][0].name).toBe('John');
    expect(onChange.mock.calls[0][0].phone).toBe('+1 555');
    expect(onChange.mock.calls[0][0].email).toBe('j@x.com');
  });
});
