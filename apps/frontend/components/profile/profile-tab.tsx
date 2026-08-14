'use client';

import React, { useEffect, useState } from 'react';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';
import Plus from 'lucide-react/dist/esm/icons/plus';
import Pencil from 'lucide-react/dist/esm/icons/pencil';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2';
import Sparkles from 'lucide-react/dist/esm/icons/sparkles';
import Upload from 'lucide-react/dist/esm/icons/upload';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { TagInput } from '@/components/ui/tag-input';
import { GitHubReposSection } from '@/components/profile/github-repos-section';
import { StringListSection } from '@/components/profile/string-list-section';
import { ResumeUploadDialog } from '@/components/dashboard/resume-upload-dialog';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { useTranslations } from '@/lib/i18n';
import {
  createCertification,
  createSkill,
  deleteCertification,
  deleteSkill,
  getProfile,
  getProfileSuggestions,
  seedProfileFromMaster,
  updateCertification,
  updateProfile,
  updateSkill,
  type CareerCertification,
  type CareerProfile,
  type CareerSkill,
  type ProfileBundle,
  type WorkExperienceItem,
} from '@/lib/api/profile';

interface ProfileTabProps {
  bundle: ProfileBundle;
  onProfileSaved: (profile: CareerProfile) => void;
  onSkillsChanged: (skills: CareerSkill[]) => void;
  onCertificationsChanged: (certifications: CareerCertification[]) => void;
}

type SuggestionField = 'career_goals' | 'target_roles' | 'target_locations';

function emptyToNull(value: string): string | null {
  return value.trim() === '' ? null : value.trim();
}

function ProficiencyBar({ value }: { value: number | null }) {
  if (value === null) return null;
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((level) => (
        <span
          key={level}
          className={`h-2 w-2 rounded-full ${level <= value ? 'bg-primary' : 'bg-[#e6e3dc]'}`}
        />
      ))}
    </div>
  );
}

export function ProfileTab({
  bundle,
  onProfileSaved,
  onSkillsChanged,
  onCertificationsChanged,
}: ProfileTabProps) {
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
    work_experience: [] as WorkExperienceItem[],
    languages: [] as string[],
    awards: [] as string[],
  });
  const [savingProfile, setSavingProfile] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [listBusy, setListBusy] = useState<null | 'languages' | 'awards'>(null);
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
      work_experience: p.work_experience ?? [],
      languages: p.languages ?? [],
      awards: p.awards ?? [],
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
        work_experience: form.work_experience,
        languages: form.languages,
        awards: form.awards,
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
      const refreshed = await getProfile();
      onSkillsChanged(refreshed.skills);
      setProfileNotice(t('profile.form.seeded'));
    } catch (e) {
      setProfileError(e instanceof Error ? e.message : String(e));
    } finally {
      setSeeding(false);
    }
  };

  const saveList = async (key: 'languages' | 'awards', next: string[]) => {
    setListBusy(key);
    setProfileError(null);
    setProfileNotice(null);
    try {
      const updated = await updateProfile({ [key]: next });
      onProfileSaved(updated);
      setForm((f) => ({ ...f, [key]: next }));
      setProfileNotice(t('profile.form.saved'));
    } catch (e) {
      setProfileError(e instanceof Error ? e.message : String(e));
    } finally {
      setListBusy(null);
    }
  };

  const addListItem = (key: 'languages' | 'awards') => (value: string) => {
    const current = form[key];
    const exists = current.some((item) => item.toLowerCase() === value.toLowerCase());
    const next = exists ? current : [...current, value];
    void saveList(key, next);
  };

  const removeListItem = (key: 'languages' | 'awards') => (index: number) => {
    void saveList(
      key,
      form[key].filter((_, i) => i !== index)
    );
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

  // ---- Skills state ------------------------------------------------
  const [skillDialogOpen, setSkillDialogOpen] = useState(false);
  const [editingSkill, setEditingSkill] = useState<CareerSkill | null>(null);
  const [deleteSkillId, setDeleteSkillId] = useState<string | null>(null);
  const [skillError, setSkillError] = useState<string | null>(null);

  const openSkillDialog = (skill: CareerSkill | null) => {
    setEditingSkill(skill);
    setSkillError(null);
    setSkillDialogOpen(true);
  };

  const handleSkillSaved = async (payload: {
    name: string;
    category: string;
    proficiency: string;
    years_experience: string;
    last_used: string;
  }) => {
    setSkillError(null);
    try {
      if (editingSkill) {
        await updateSkill(editingSkill.skill_id, {
          name: payload.name,
          category: payload.category.trim() || null,
          proficiency: payload.proficiency ? Number(payload.proficiency) : null,
          years_experience: payload.years_experience ? Number(payload.years_experience) : null,
          last_used: payload.last_used.trim() || null,
        });
      } else {
        const names = payload.name
          .split(/[,;]/)
          .map((name) => name.trim())
          .filter(Boolean);
        const existing = new Set(bundle.skills.map((skill) => skill.name.toLowerCase()));
        for (const name of names) {
          if (existing.has(name.toLowerCase())) continue;
          await createSkill({
            name,
            category: payload.category.trim() || null,
            proficiency: payload.proficiency ? Number(payload.proficiency) : null,
            years_experience: payload.years_experience ? Number(payload.years_experience) : null,
            last_used: payload.last_used.trim() || null,
          });
          existing.add(name.toLowerCase());
        }
      }
      onSkillsChanged(await (await getProfile()).skills);
      setSkillDialogOpen(false);
    } catch (e) {
      setSkillError(e instanceof Error ? e.message : String(e));
    }
  };

  const confirmDeleteSkill = async () => {
    if (!deleteSkillId) return;
    await deleteSkill(deleteSkillId);
    onSkillsChanged((await getProfile()).skills);
    setDeleteSkillId(null);
  };

  // ---- Certifications state ------------------------------------------------
  const [certDialogOpen, setCertDialogOpen] = useState(false);
  const [editingCert, setEditingCert] = useState<CareerCertification | null>(null);
  const [deleteCertId, setDeleteCertId] = useState<string | null>(null);
  const [certError, setCertError] = useState<string | null>(null);

  const openCertDialog = (cert: CareerCertification | null) => {
    setEditingCert(cert);
    setCertError(null);
    setCertDialogOpen(true);
  };

  const handleCertSaved = async (payload: {
    name: string;
    issuer: string;
    date_obtained: string;
    url: string;
  }) => {
    setCertError(null);
    try {
      if (editingCert) {
        await updateCertification(editingCert.certification_id, {
          name: payload.name,
          issuer: payload.issuer.trim() || null,
          date_obtained: payload.date_obtained.trim() || null,
          url: payload.url.trim() || null,
        });
      } else {
        await createCertification({
          name: payload.name,
          issuer: payload.issuer.trim() || null,
          date_obtained: payload.date_obtained.trim() || null,
          url: payload.url.trim() || null,
        });
      }
      onCertificationsChanged((await getProfile()).certifications);
      setCertDialogOpen(false);
    } catch (e) {
      setCertError(e instanceof Error ? e.message : String(e));
    }
  };

  const confirmDeleteCert = async () => {
    if (!deleteCertId) return;
    await deleteCertification(deleteCertId);
    onCertificationsChanged((await getProfile()).certifications);
    setDeleteCertId(null);
  };

  // ---- Work experience state ------------------------------------------------
  const [workDialogOpen, setWorkDialogOpen] = useState(false);
  const [editingWork, setEditingWork] = useState<WorkExperienceItem | null>(null);
  const [editingWorkIdx, setEditingWorkIdx] = useState<number | null>(null);
  const [deleteWorkIdx, setDeleteWorkIdx] = useState<number | null>(null);
  const [workError, setWorkError] = useState<string | null>(null);

  const openWorkDialog = (entry: WorkExperienceItem | null, index: number | null = null) => {
    setEditingWork(entry);
    setEditingWorkIdx(index);
    setWorkError(null);
    setWorkDialogOpen(true);
  };

  const handleWorkSaved = (payload: WorkExperienceItem) => {
    setWorkError(null);
    setForm((f) => {
      const entries = [...f.work_experience];
      if (editingWorkIdx === null) {
        entries.push(payload);
      } else {
        entries[editingWorkIdx] = payload;
      }
      return { ...f, work_experience: entries };
    });
    setWorkDialogOpen(false);
  };

  const confirmDeleteWork = () => {
    if (deleteWorkIdx === null) return;
    setForm((f) => ({
      ...f,
      work_experience: f.work_experience.filter((_, i) => i !== deleteWorkIdx),
    }));
    setDeleteWorkIdx(null);
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

      {/* Work experience */}
      <section className="rounded-2xl border border-[#e6e3dc] bg-white p-5 shadow-sw-xs">
        <div className="mb-4 flex items-center justify-between">
          <div className="text-xs font-bold uppercase tracking-wide text-primary">
            {t('profile.workExperience.title')}
          </div>
          <Button size="sm" onClick={() => openWorkDialog(null)}>
            <Plus className="h-4 w-4" />
            {t('profile.workExperience.add')}
          </Button>
        </div>
        {form.work_experience.length === 0 ? (
          <p className="text-sm text-ink-soft">{t('profile.workExperience.empty')}</p>
        ) : (
          <div className="divide-y divide-[#f0ece4]">
            {form.work_experience.map((entry, idx) => (
              <div key={idx} className="flex items-start justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-ink">
                    {entry.role || entry.company}
                  </div>
                  <div className="truncate text-xs text-ink-soft">
                    {[entry.company, entry.location, entry.years].filter(Boolean).join(' · ')}
                  </div>
                  {entry.description.length > 0 && (
                    <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-ink-soft">
                      {entry.description.map((bullet, bulletIdx) => (
                        <li key={bulletIdx}>{bullet}</li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => openWorkDialog(entry, idx)}
                    aria-label={t('profile.workExperience.edit')}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setDeleteWorkIdx(idx)}
                    aria-label={t('profile.workExperience.delete')}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Skills */}
      <section className="rounded-2xl border border-[#e6e3dc] bg-white p-5 shadow-sw-xs">
        <div className="mb-4 flex items-center justify-between">
          <div className="text-xs font-bold uppercase tracking-wide text-primary">
            {t('profile.skills.title')}
          </div>
          <Button size="sm" onClick={() => openSkillDialog(null)}>
            <Plus className="h-4 w-4" />
            {t('profile.skills.add')}
          </Button>
        </div>
        {bundle.skills.length === 0 ? (
          <p className="text-sm text-ink-soft">{t('profile.skills.empty')}</p>
        ) : (
          <div className="divide-y divide-[#f0ece4]">
            {bundle.skills.map((skill) => (
              <div key={skill.skill_id} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-ink">{skill.name}</div>
                  <div className="truncate text-xs text-ink-soft">
                    {[skill.category, skill.years_experience, skill.last_used]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <ProficiencyBar value={skill.proficiency} />
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => openSkillDialog(skill)}
                    aria-label={t('profile.skills.edit')}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setDeleteSkillId(skill.skill_id)}
                    aria-label={t('profile.skills.delete')}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Languages */}
      <StringListSection
        title={t('profile.languages.title')}
        items={form.languages}
        emptyText={t('profile.languages.empty')}
        addPlaceholder={t('profile.languages.placeholder')}
        addLabel={t('profile.languages.add')}
        removeLabel={t('common.delete')}
        busy={listBusy === 'languages'}
        onAdd={addListItem('languages')}
        onRemove={removeListItem('languages')}
      />

      {/* Honors & awards */}
      <StringListSection
        title={t('profile.awards.title')}
        items={form.awards}
        emptyText={t('profile.awards.empty')}
        addPlaceholder={t('profile.awards.placeholder')}
        addLabel={t('profile.awards.add')}
        removeLabel={t('common.delete')}
        busy={listBusy === 'awards'}
        onAdd={addListItem('awards')}
        onRemove={removeListItem('awards')}
      />

      {/* Certifications */}
      <section className="rounded-2xl border border-[#e6e3dc] bg-white p-5 shadow-sw-xs">
        <div className="mb-4 flex items-center justify-between">
          <div className="text-xs font-bold uppercase tracking-wide text-primary">
            {t('profile.certifications.title')}
          </div>
          <Button size="sm" onClick={() => openCertDialog(null)}>
            <Plus className="h-4 w-4" />
            {t('profile.certifications.add')}
          </Button>
        </div>
        {bundle.certifications.length === 0 ? (
          <p className="text-sm text-ink-soft">{t('profile.certifications.empty')}</p>
        ) : (
          <div className="divide-y divide-[#f0ece4]">
            {bundle.certifications.map((cert) => (
              <div
                key={cert.certification_id}
                className="flex items-center justify-between gap-3 py-2.5"
              >
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-ink">{cert.name}</div>
                  <div className="truncate text-xs text-ink-soft">
                    {[cert.issuer, cert.date_obtained, cert.url].filter(Boolean).join(' · ')}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => openCertDialog(cert)}
                    aria-label={t('profile.certifications.edit')}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setDeleteCertId(cert.certification_id)}
                    aria-label={t('profile.certifications.delete')}
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* GitHub repositories */}
      <section className="rounded-2xl border border-[#e6e3dc] bg-white p-5 shadow-sw-xs">
        <div className="mb-4 text-xs font-bold uppercase tracking-wide text-primary">
          {t('profile.github.title')}
        </div>
        <GitHubReposSection />
      </section>

      {/* Skill dialog */}
      <SkillFormDialog
        open={skillDialogOpen}
        onOpenChange={setSkillDialogOpen}
        skill={editingSkill}
        error={skillError}
        onSubmit={handleSkillSaved}
      />
      {/* Certification dialog */}
      <CertificationFormDialog
        open={certDialogOpen}
        onOpenChange={setCertDialogOpen}
        certification={editingCert}
        error={certError}
        onSubmit={handleCertSaved}
      />
      {/* Work experience dialog */}
      <WorkExperienceDialog
        open={workDialogOpen}
        onOpenChange={setWorkDialogOpen}
        entry={editingWork}
        error={workError}
        onSubmit={handleWorkSaved}
      />
      {/* Delete confirmations */}
      <ConfirmDialog
        open={deleteSkillId !== null}
        onOpenChange={(open) => !open && setDeleteSkillId(null)}
        title={t('profile.skills.deleteTitle')}
        description={t('profile.skills.deleteDescription')}
        confirmLabel={t('common.delete')}
        onConfirm={() => void confirmDeleteSkill()}
      />
      <ConfirmDialog
        open={deleteCertId !== null}
        onOpenChange={(open) => !open && setDeleteCertId(null)}
        title={t('profile.certifications.deleteTitle')}
        description={t('profile.certifications.deleteDescription')}
        confirmLabel={t('common.delete')}
        onConfirm={() => void confirmDeleteCert()}
      />
      <ConfirmDialog
        open={deleteWorkIdx !== null}
        onOpenChange={(open) => !open && setDeleteWorkIdx(null)}
        title={t('profile.workExperience.deleteTitle')}
        description={t('profile.workExperience.deleteDescription')}
        confirmLabel={t('common.delete')}
        onConfirm={confirmDeleteWork}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Skill add/edit dialog
// ---------------------------------------------------------------------------

interface SkillFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  skill: CareerSkill | null;
  error: string | null;
  onSubmit: (payload: {
    name: string;
    category: string;
    proficiency: string;
    years_experience: string;
    last_used: string;
  }) => Promise<void>;
}

function validateProficiency(value: string): boolean {
  if (value === '') return true;
  const n = Number(value);
  return Number.isInteger(n) && n >= 1 && n <= 5;
}

function SkillFormDialog({ open, onOpenChange, skill, error, onSubmit }: SkillFormDialogProps) {
  const { t } = useTranslations();
  const editing = Boolean(skill);
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [proficiency, setProficiency] = useState('');
  const [yearsExperience, setYearsExperience] = useState('');
  const [lastUsed, setLastUsed] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [validation, setValidation] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(skill?.name ?? '');
    setCategory(skill?.category ?? '');
    setProficiency(
      skill?.proficiency !== null && skill?.proficiency !== undefined
        ? String(skill.proficiency)
        : ''
    );
    setYearsExperience(
      skill?.years_experience !== null && skill?.years_experience !== undefined
        ? String(skill.years_experience)
        : ''
    );
    setLastUsed(skill?.last_used ?? '');
    setValidation(null);
  }, [open, skill]);

  const handleSubmit = async () => {
    if (!name.trim()) {
      setValidation(t('profile.skills.nameRequired'));
      return;
    }
    if (!validateProficiency(proficiency)) {
      setValidation(t('profile.skills.invalidProficiency'));
      return;
    }
    setSubmitting(true);
    setValidation(null);
    await onSubmit({
      name: name.trim(),
      category,
      proficiency,
      years_experience: yearsExperience,
      last_used: lastUsed,
    });
    setSubmitting(false);
  };

  const errorText = validation ?? error;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg p-0 gap-0 overflow-hidden">
        <DialogHeader className="border-b border-[#e6e3dc] bg-white p-6">
          <DialogTitle>
            {editing ? t('profile.skills.editTitle') : t('profile.skills.addTitle')}
          </DialogTitle>
          <DialogDescription>{t('profile.skills.formDescription')}</DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] space-y-4 overflow-y-auto p-6">
          <div className="space-y-1">
            <Label>{t('profile.skills.name')}</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>{t('profile.skills.category')}</Label>
              <Input
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder={t('profile.skills.optional')}
              />
            </div>
            <div className="space-y-1">
              <Label>{t('profile.skills.lastUsed')}</Label>
              <Input
                value={lastUsed}
                onChange={(e) => setLastUsed(e.target.value)}
                placeholder="2024 or 2024-06"
              />
            </div>
            <div className="space-y-1">
              <Label>{t('profile.skills.proficiency')}</Label>
              <Input
                type="number"
                min={1}
                max={5}
                value={proficiency}
                onChange={(e) => setProficiency(e.target.value)}
                placeholder="1–5"
              />
            </div>
            <div className="space-y-1">
              <Label>{t('profile.skills.yearsExperience')}</Label>
              <Input
                type="number"
                min={0}
                value={yearsExperience}
                onChange={(e) => setYearsExperience(e.target.value)}
              />
            </div>
          </div>
          {errorText && <p className="text-xs text-destructive">{errorText}</p>}
        </div>
        <DialogFooter className="flex-row justify-end gap-3 border-t border-[#e6e3dc] bg-secondary p-4">
          <Button onClick={() => void handleSubmit()} disabled={submitting}>
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : editing ? (
              t('profile.skills.save')
            ) : (
              t('profile.skills.add')
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Certification add/edit dialog
// ---------------------------------------------------------------------------

interface CertificationFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  certification: CareerCertification | null;
  error: string | null;
  onSubmit: (payload: {
    name: string;
    issuer: string;
    date_obtained: string;
    url: string;
  }) => Promise<void>;
}

function CertificationFormDialog({
  open,
  onOpenChange,
  certification,
  error,
  onSubmit,
}: CertificationFormDialogProps) {
  const { t } = useTranslations();
  const editing = Boolean(certification);
  const [name, setName] = useState('');
  const [issuer, setIssuer] = useState('');
  const [dateObtained, setDateObtained] = useState('');
  const [url, setUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [validation, setValidation] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(certification?.name ?? '');
    setIssuer(certification?.issuer ?? '');
    setDateObtained(certification?.date_obtained ?? '');
    setUrl(certification?.url ?? '');
    setValidation(null);
  }, [open, certification]);

  const handleSubmit = async () => {
    if (!name.trim()) {
      setValidation(t('profile.certifications.nameRequired'));
      return;
    }
    if (dateObtained.trim() !== '' && !/^\d{4}(-\d{2})?$/.test(dateObtained.trim())) {
      setValidation(t('profile.certifications.invalidDate'));
      return;
    }
    setSubmitting(true);
    setValidation(null);
    await onSubmit({
      name: name.trim(),
      issuer,
      date_obtained: dateObtained,
      url,
    });
    setSubmitting(false);
  };

  const errorText = validation ?? error;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg p-0 gap-0 overflow-hidden">
        <DialogHeader className="border-b border-[#e6e3dc] bg-white p-6">
          <DialogTitle>
            {editing ? t('profile.certifications.editTitle') : t('profile.certifications.addTitle')}
          </DialogTitle>
          <DialogDescription>{t('profile.certifications.formDescription')}</DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] space-y-4 overflow-y-auto p-6">
          <div className="space-y-1">
            <Label>{t('profile.certifications.name')}</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>{t('profile.certifications.issuer')}</Label>
              <Input
                value={issuer}
                onChange={(e) => setIssuer(e.target.value)}
                placeholder={t('profile.certifications.optional')}
              />
            </div>
            <div className="space-y-1">
              <Label>{t('profile.certifications.dateObtained')}</Label>
              <Input
                value={dateObtained}
                onChange={(e) => setDateObtained(e.target.value)}
                placeholder="2024 or 2024-03"
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label>{t('profile.certifications.url')}</Label>
            <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
          </div>
          {errorText && <p className="text-xs text-destructive">{errorText}</p>}
        </div>
        <DialogFooter className="flex-row justify-end gap-3 border-t border-[#e6e3dc] bg-secondary p-4">
          <Button onClick={() => void handleSubmit()} disabled={submitting}>
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : editing ? (
              t('profile.certifications.save')
            ) : (
              t('profile.certifications.add')
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Work experience add/edit dialog
// ---------------------------------------------------------------------------

interface WorkExperienceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entry: WorkExperienceItem | null;
  error: string | null;
  onSubmit: (payload: WorkExperienceItem) => void;
}

function WorkExperienceDialog({
  open,
  onOpenChange,
  entry,
  error,
  onSubmit,
}: WorkExperienceDialogProps) {
  const { t } = useTranslations();
  const editing = Boolean(entry);
  const [role, setRole] = useState('');
  const [company, setCompany] = useState('');
  const [location, setLocation] = useState('');
  const [years, setYears] = useState('');
  const [descriptionText, setDescriptionText] = useState('');
  const [validation, setValidation] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setRole(entry?.role ?? '');
    setCompany(entry?.company ?? '');
    setLocation(entry?.location ?? '');
    setYears(entry?.years ?? '');
    setDescriptionText((entry?.description ?? []).join('\n'));
    setValidation(null);
  }, [open, entry]);

  const handleSubmit = () => {
    if (!role.trim() && !company.trim()) {
      setValidation(t('profile.workExperience.roleRequired'));
      return;
    }
    onSubmit({
      role: role.trim(),
      company: company.trim() || null,
      location: location.trim() || null,
      years: years.trim() || null,
      description: descriptionText
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean),
    });
  };

  const errorText = validation ?? error;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg p-0 gap-0 overflow-hidden">
        <DialogHeader className="border-b border-[#e6e3dc] bg-white p-6">
          <DialogTitle>
            {editing ? t('profile.workExperience.editTitle') : t('profile.workExperience.addTitle')}
          </DialogTitle>
          <DialogDescription>{t('profile.workExperience.formDescription')}</DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] space-y-4 overflow-y-auto p-6">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>{t('profile.workExperience.role')}</Label>
              <Input value={role} onChange={(e) => setRole(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>{t('profile.workExperience.company')}</Label>
              <Input value={company} onChange={(e) => setCompany(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>{t('profile.workExperience.location')}</Label>
              <Input value={location} onChange={(e) => setLocation(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>{t('profile.workExperience.years')}</Label>
              <Input
                value={years}
                onChange={(e) => setYears(e.target.value)}
                placeholder="2021 – Present"
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label>{t('profile.workExperience.description')}</Label>
            <Textarea
              rows={4}
              value={descriptionText}
              onChange={(e) => setDescriptionText(e.target.value)}
              placeholder={t('profile.workExperience.descriptionPlaceholder')}
            />
          </div>
          {errorText && <p className="text-xs text-destructive">{errorText}</p>}
        </div>
        <DialogFooter className="flex-row justify-end gap-3 border-t border-[#e6e3dc] bg-secondary p-4">
          <Button onClick={handleSubmit}>
            {editing ? t('profile.workExperience.save') : t('profile.workExperience.add')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
