'use client';

import { useState } from 'react';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2';
import Plus from 'lucide-react/dist/esm/icons/plus';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { useTranslations } from '@/lib/i18n';
import {
  seedProfileFromMaster,
  type ProfileBundle,
  type CareerProfile,
  type CareerSkill,
  type CareerEducation,
  type CareerProject,
  type CareerAchievement,
} from '@/lib/api/profile';

interface ImportPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preview: ProfileBundle;
  onImported: (profile: CareerProfile) => void;
}

export function ImportPreviewDialog({
  open,
  onOpenChange,
  preview,
  onImported,
}: ImportPreviewDialogProps) {
  const { t } = useTranslations();
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Editable local state — user can modify before confirming
  const [profile, setProfile] = useState(preview.profile);
  const [skills, setSkills] = useState(preview.skills);
  const [education, setEducation] = useState(preview.education);
  const [projects, setProjects] = useState(preview.projects);
  const [achievements, setAchievements] = useState(preview.achievements);

  const handleConfirm = async () => {
    setImporting(true);
    setError(null);
    try {
      // Seed profile from the uploaded resume (already parsed and stored)
      // For now, seed from master which was just uploaded
      const updated = await seedProfileFromMaster();
      onImported(updated);
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setImporting(false);
    }
  };

  const removeSkill = (id: string) => setSkills((s) => s.filter((sk) => sk.skill_id !== id));
  const removeEducation = (id: string) => setEducation((e) => e.filter((ed) => ed.education_id !== id));
  const removeProject = (id: string) => setProjects((p) => p.filter((pr) => pr.project_id !== id));
  const removeAchievement = (id: string) => setAchievements((a) => a.filter((ac) => ac.achievement_id !== id));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('profile.import.previewTitle') || 'Preview Imported Profile'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* Profile Info */}
          <Section title={t('profile.form.personalInfo') || 'Personal Info'}>
            <div className="grid grid-cols-2 gap-3">
              <Field
                label={t('profile.form.name') || 'Name'}
                value={profile.name ?? ''}
                onChange={(v) => setProfile((p) => ({ ...p, name: v || null }))}
              />
              <Field
                label={t('profile.form.title') || 'Title'}
                value={profile.title ?? ''}
                onChange={(v) => setProfile((p) => ({ ...p, title: v || null }))}
              />
              <Field
                label={t('profile.form.email') || 'Email'}
                value={profile.email ?? ''}
                onChange={(v) => setProfile((p) => ({ ...p, email: v || null }))}
              />
              <Field
                label={t('profile.form.phone') || 'Phone'}
                value={profile.phone ?? ''}
                onChange={(v) => setProfile((p) => ({ ...p, phone: v || null }))}
              />
              <Field
                label={t('profile.form.location') || 'Location'}
                value={profile.location ?? ''}
                onChange={(v) => setProfile((p) => ({ ...p, location: v || null }))}
              />
              <Field
                label={t('profile.form.linkedin') || 'LinkedIn'}
                value={profile.linkedin ?? ''}
                onChange={(v) => setProfile((p) => ({ ...p, linkedin: v || null }))}
              />
            </div>
            <div className="mt-3 space-y-1">
              <Label className="text-xs font-bold uppercase tracking-wide text-ink-soft">
                {t('profile.form.summary') || 'Summary'}
              </Label>
              <Textarea
                rows={3}
                value={profile.summary ?? ''}
                onChange={(e) => setProfile((p) => ({ ...p, summary: e.target.value || null }))}
              />
            </div>
          </Section>

          {/* Work Experience */}
          {profile.work_experience.length > 0 && (
            <Section title={t('profile.workExperience.title') || 'Work Experience'}>
              {profile.work_experience.map((exp, i) => (
                <div key={i} className="border border-[#e6e3dc] rounded-xl p-3 mb-2">
                  <p className="text-sm font-bold">{exp.role}{exp.company && <span className="font-normal text-ink-soft"> — {exp.company}</span>}</p>
                  {exp.years && <p className="text-xs text-ink-soft">{exp.years}</p>}
                  {exp.description.length > 0 && (
                    <ul className="mt-1 list-disc list-inside text-xs text-ink-soft space-y-0.5">
                      {exp.description.map((b, j) => <li key={j}>{b}</li>)}
                    </ul>
                  )}
                </div>
              ))}
            </Section>
          )}

          {/* Skills */}
          {skills.length > 0 && (
            <Section title={t('profile.skills.title') || 'Skills'}>
              <div className="flex flex-wrap gap-2">
                {skills.map((skill) => (
                  <span
                    key={skill.skill_id}
                    className="inline-flex items-center gap-1 rounded-full border border-[#e6e3dc] bg-secondary px-2.5 py-1 text-xs"
                  >
                    {skill.name}
                    {skill.proficiency && <span className="text-ink-soft">({skill.proficiency}/5)</span>}
                    <button onClick={() => removeSkill(skill.skill_id)} className="ml-0.5 text-ink-soft hover:text-destructive">
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            </Section>
          )}

          {/* Education */}
          {education.length > 0 && (
            <Section title={t('profile.tabs.education') || 'Education'}>
              {education.map((edu) => (
                <div key={edu.education_id} className="flex items-start justify-between border border-[#e6e3dc] rounded-xl p-3 mb-2">
                  <div>
                    <p className="text-sm font-bold">{edu.degree || 'Education'}{edu.institution && <span className="font-normal text-ink-soft"> — {edu.institution}</span>}</p>
                    {edu.years && <p className="text-xs text-ink-soft">{edu.years}</p>}
                  </div>
                  <button onClick={() => removeEducation(edu.education_id)} className="text-ink-soft hover:text-destructive shrink-0">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </Section>
          )}

          {/* Projects */}
          {projects.length > 0 && (
            <Section title={t('profile.tabs.projects') || 'Projects'}>
              {projects.map((proj) => (
                <div key={proj.project_id} className="flex items-start justify-between border border-[#e6e3dc] rounded-xl p-3 mb-2">
                  <div>
                    <p className="text-sm font-bold">{proj.name}{proj.role && <span className="font-normal text-ink-soft"> — {proj.role}</span>}</p>
                    {proj.languages.length > 0 && <p className="text-xs text-ink-soft">{proj.languages.join(', ')}</p>}
                  </div>
                  <button onClick={() => removeProject(proj.project_id)} className="text-ink-soft hover:text-destructive shrink-0">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </Section>
          )}

          {/* Achievements */}
          {achievements.length > 0 && (
            <Section title={t('profile.tabs.achievements') || 'Achievements'}>
              {achievements.map((ach) => (
                <div key={ach.achievement_id} className="flex items-start justify-between border border-[#e6e3dc] rounded-xl p-3 mb-2">
                  <div>
                    <p className="text-sm font-bold">{ach.title}{ach.date && <span className="font-normal text-ink-soft ml-1 text-xs">{ach.date}</span>}</p>
                    {ach.description && <p className="text-xs text-ink-soft mt-0.5">{ach.description}</p>}
                  </div>
                  <button onClick={() => removeAchievement(ach.achievement_id)} className="text-ink-soft hover:text-destructive shrink-0">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </Section>
          )}
        </div>

        {error && <p className="text-xs text-destructive mt-2">{error}</p>}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={importing}>
            {t('common.cancel') || 'Cancel'}
          </Button>
          <Button onClick={() => void handleConfirm()} disabled={importing}>
            {importing && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
            {t('profile.import.confirm') || 'Confirm Import'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-xs font-bold uppercase tracking-wide text-primary mb-2">{title}</h3>
      {children}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs font-bold uppercase tracking-wide text-ink-soft">{label}</Label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}
