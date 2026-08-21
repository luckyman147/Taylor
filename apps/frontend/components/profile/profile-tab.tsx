'use client';

import React, { useEffect, useState } from 'react';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';
import Sparkles from 'lucide-react/dist/esm/icons/sparkles';
import Upload from 'lucide-react/dist/esm/icons/upload';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { TagInput } from '@/components/ui/tag-input';
import { ResumeUploadDialog } from '@/components/dashboard/resume-upload-dialog';
import { useTranslations } from '@/lib/i18n';
import {
  getProfileSuggestions,
  seedProfileFromMaster,
  updateProfile,
  type CareerProfile,
  type ProfileBundle,
} from '@/lib/api/profile';

interface ProfileTabProps {
  bundle: ProfileBundle;
  onProfileSaved: (profile: CareerProfile) => void;
}

type SuggestionField = 'career_goals' | 'target_roles' | 'target_locations';

function emptyToNull(value: string): string | null {
  return value.trim() === '' ? null : value.trim();
}

export function ProfileTab({ bundle, onProfileSaved }: ProfileTabProps) {
  const { t } = useTranslations();

  // ---- Profile form state ------------------------------------------------
  const [form, setForm] = useState({
    name: '',
    title: '',
    email: '',
    phone: '',
    location: '',
    website: '',
    linkedin: '',
    github: '',
    summary: '',
    career_goals: [] as string[],
    target_roles: [] as string[],
    target_locations: [] as string[],
    target_salary_min: '',
    target_salary_max: '',
  });
  const [savingProfile, setSavingProfile] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [profileNotice, setProfileNotice] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<Record<SuggestionField, string[]>>({
    career_goals: [],
    target_roles: [],
    target_locations: [],
  });

  useEffect(() => {
    let cancelled = false;
    void Promise.all(
      (['career_goals', 'target_roles', 'target_locations'] as const).map((field) =>
        getProfileSuggestions(field).then((data) => ({ field, items: data.suggestions }))
      )
    )
      .then((results) => {
        if (cancelled) return;
        setSuggestions({
          career_goals: [],
          target_roles: [],
          target_locations: [],
          ...Object.fromEntries(results.map((r) => [r.field, r.items])),
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const p = bundle.profile;
    setForm({
      name: p.name ?? '',
      title: p.title ?? '',
      email: p.email ?? '',
      phone: p.phone ?? '',
      location: p.location ?? '',
      website: p.website ?? '',
      linkedin: p.linkedin ?? '',
      github: p.github ?? '',
      summary: p.summary ?? '',
      career_goals: p.career_goals ?? [],
      target_roles: p.target_roles ?? [],
      target_locations: p.target_locations ?? [],
      target_salary_min: p.target_salary_min === null ? '' : String(p.target_salary_min),
      target_salary_max: p.target_salary_max === null ? '' : String(p.target_salary_max),
    });
    setProfileNotice(null);
    setProfileError(null);
  }, [bundle.profile]);

  const saveProfile = async () => {
    setSavingProfile(true);
    setProfileError(null);
    setProfileNotice(null);
    const salaryMin = form.target_salary_min.trim() ? Number(form.target_salary_min) : null;
    const salaryMax = form.target_salary_max.trim() ? Number(form.target_salary_max) : null;
    try {
      const updated = await updateProfile({
        name: emptyToNull(form.name),
        title: emptyToNull(form.title),
        email: emptyToNull(form.email),
        phone: emptyToNull(form.phone),
        location: emptyToNull(form.location),
        website: emptyToNull(form.website),
        linkedin: emptyToNull(form.linkedin),
        github: emptyToNull(form.github),
        summary: emptyToNull(form.summary),
        career_goals: form.career_goals,
        target_roles: form.target_roles,
        target_locations: form.target_locations,
        target_salary_min: salaryMin,
        target_salary_max: salaryMax,
      });
      onProfileSaved(updated);
      setProfileNotice(t('profile.form.saved'));
    } catch (e) {
      setProfileError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingProfile(false);
    }
  };

  const seedFromResume = async () => {
    setSeeding(true);
    setProfileError(null);
    setProfileNotice(null);
    try {
      const updated = await seedProfileFromMaster();
      onProfileSaved(updated);
      setProfileNotice(t('profile.form.seeded'));
    } catch (e) {
      setProfileError(e instanceof Error ? e.message : String(e));
    } finally {
      setSeeding(false);
    }
  };

  const saveLocation = async () => {
    setSavingProfile(true);
    setProfileError(null);
    setProfileNotice(null);
    try {
      const updated = await updateProfile({ location: emptyToNull(form.location) });
      onProfileSaved(updated);
      setProfileNotice(t('profile.form.saved'));
    } catch (e) {
      setProfileError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingProfile(false);
    }
  };

  return (
    <div className="space-y-5 pb-8">
      {/* Provision */}
      <section className="rounded-2xl border border-[#e6e3dc] bg-white p-5 shadow-sw-xs">
        <div className="mb-4 flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-primary">
          <Sparkles className="h-4 w-4" />
          {t('profile.form.provision')}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={() => void seedFromResume()}
            disabled={seeding}
          >
            {seeding && <Loader2 className="h-4 w-4 animate-spin" />}
            {t('profile.form.seedFromMaster')}
          </Button>
          <ResumeUploadDialog
            defaultAsMaster={false}
            onUploadComplete={() => setProfileNotice(t('profile.form.uploaded'))}
            trigger={
              <Button variant="outline" size="sm">
                <Upload className="h-4 w-4" />
                {t('profile.form.uploadDesktop')}
              </Button>
            }
          />
          <span className="text-xs text-ink-soft">{t('profile.form.seedHint')}</span>
        </div>
        {profileNotice && <p className="mt-3 text-xs text-green-700">{profileNotice}</p>}
        {profileError && <p className="mt-3 text-xs text-destructive">{profileError}</p>}
      </section>

      {/* Personal info */}
      <section className="rounded-2xl border border-[#e6e3dc] bg-white p-5 shadow-sw-xs">
        <div className="mb-4 text-xs font-bold uppercase tracking-wide text-primary">
          {t('profile.form.personalInfo')}
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
          {(
            [
              ['name', t('profile.form.name')],
              ['title', t('profile.form.title')],
              ['email', t('profile.form.email')],
              ['phone', t('profile.form.phone')],
              ['location', t('profile.form.location')],
              ['website', t('profile.form.website')],
              ['linkedin', t('profile.form.linkedin')],
              ['github', t('profile.form.github')],
            ] as const
          ).map(([key, label]) => (
            <div key={key} className="space-y-1">
              <Label htmlFor={`profile-${key}`}>{label}</Label>
              <Input
                id={`profile-${key}`}
                value={form[key]}
                onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
              />
            </div>
          ))}
        </div>

        <div className="mt-4 space-y-1">
          <Label htmlFor="profile-summary">{t('profile.form.summary')}</Label>
          <Textarea
            id="profile-summary"
            rows={3}
            value={form.summary}
            onChange={(e) => setForm((f) => ({ ...f, summary: e.target.value }))}
          />
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-3">
          <div className="space-y-1">
            <Label htmlFor="profile-career-goals">{t('profile.form.careerGoals')}</Label>
            <TagInput
              id="profile-career-goals"
              value={form.career_goals}
              onChange={(tags) => setForm((f) => ({ ...f, career_goals: tags }))}
              placeholder={t('profile.form.tagPlaceholder')}
              suggestions={suggestions.career_goals}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="profile-target-roles">{t('profile.form.targetRoles')}</Label>
            <TagInput
              id="profile-target-roles"
              value={form.target_roles}
              onChange={(tags) => setForm((f) => ({ ...f, target_roles: tags }))}
              placeholder={t('profile.form.tagPlaceholder')}
              suggestions={suggestions.target_roles}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="profile-target-locations">{t('profile.form.targetLocations')}</Label>
            <TagInput
              id="profile-target-locations"
              value={form.target_locations}
              onChange={(tags) => setForm((f) => ({ ...f, target_locations: tags }))}
              placeholder={t('profile.form.tagPlaceholder')}
              suggestions={suggestions.target_locations}
            />
          </div>
          <div className="grid grid-cols-2 gap-3 lg:col-span-3">
            <div className="space-y-1">
              <Label htmlFor="profile-salary-min">{t('profile.form.salaryMin')}</Label>
              <Input
                id="profile-salary-min"
                type="number"
                min={0}
                value={form.target_salary_min}
                onChange={(e) => setForm((f) => ({ ...f, target_salary_min: e.target.value }))}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="profile-salary-max">{t('profile.form.salaryMax')}</Label>
              <Input
                id="profile-salary-max"
                type="number"
                min={0}
                value={form.target_salary_max}
                onChange={(e) => setForm((f) => ({ ...f, target_salary_max: e.target.value }))}
              />
            </div>
          </div>
        </div>

        <div className="mt-4 flex justify-end">
          <Button onClick={() => void saveProfile()} disabled={savingProfile}>
            {savingProfile ? <Loader2 className="h-4 w-4 animate-spin" /> : t('profile.form.save')}
          </Button>
        </div>
      </section>

      {/* Current location */}
      <section className="rounded-2xl border border-[#e6e3dc] bg-white p-5 shadow-sw-xs">
        <div className="mb-4 text-xs font-bold uppercase tracking-wide text-primary">
          {t('profile.currentLocation.title')}
        </div>
        <div className="flex items-end gap-3">
          <div className="flex-1 space-y-1">
            <Label htmlFor="profile-current-location">{t('profile.form.location')}</Label>
            <Input
              id="profile-current-location"
              value={form.location}
              onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
              placeholder={t('profile.currentLocation.placeholder')}
            />
          </div>
          <Button onClick={() => void saveLocation()} disabled={savingProfile}>
            {savingProfile ? <Loader2 className="h-4 w-4 animate-spin" /> : t('profile.form.save')}
          </Button>
        </div>
      </section>
    </div>
  );
}
