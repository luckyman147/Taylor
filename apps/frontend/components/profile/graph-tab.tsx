'use client';

import React, { useEffect, useState } from 'react';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';
import Pencil from 'lucide-react/dist/esm/icons/pencil';
import Plus from 'lucide-react/dist/esm/icons/plus';
import Search from 'lucide-react/dist/esm/icons/search';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useTranslations } from '@/lib/i18n';
import {
  createAchievement,
  createCertification,
  createEducation,
  createProject,
  deleteAchievement,
  deleteCertification,
  deleteEducation,
  deleteProject,
  getProfile,
  updateAchievement,
  updateCertification,
  updateEducation,
  updateProject,
  updateProfile,
  type CareerAchievement,
  type CareerCertification,
  type CareerEducation,
  type CareerProject,
  type ProfileBundle,
} from '@/lib/api/profile';
import { GitHubImportButton } from '@/components/profile/github-import-button';
import { StringListSection } from '@/components/profile/string-list-section';

export type GraphSection = 'education' | 'projects' | 'achievements';

interface GraphTabProps {
  bundle: ProfileBundle;
  section: GraphSection;
  onChanged: (bundle: ProfileBundle) => void;
}

export function GraphTab({ bundle, section, onChanged }: GraphTabProps) {
  const { t } = useTranslations();
  const [listBusy, setListBusy] = useState<null | 'languages' | 'awards'>(null);

  // ---- Shared dialog plumbing ---------------------------------------------
  const [dialog, setDialog] = useState<{
    kind: 'education' | 'projects' | 'achievements';
    item: unknown | null;
  } | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{
    kind: 'education' | 'projects' | 'achievements' | 'certifications';
    id: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [importNotice, setImportNotice] = useState<string | null>(null);
  const [expandedReadmes, setExpandedReadmes] = useState<Set<string>>(new Set());
  const [projectSearch, setProjectSearch] = useState('');

  const refresh = async () => {
    onChanged(await getProfile());
  };

  const handleSaved = async (payload: unknown) => {
    setError(null);
    try {
      if (!dialog) return;
      const { kind, item } = dialog;
      if (kind === 'education') {
        const p = payload as {
          institution: string;
          degree: string;
          years: string;
          description: string;
        };
        if (item) {
          await updateEducation((item as CareerEducation).education_id, {
            institution: p.institution.trim(),
            degree: p.degree.trim() || null,
            years: p.years.trim() || null,
            description: p.description.trim() || null,
          });
        } else {
          await createEducation({
            institution: p.institution.trim(),
            degree: p.degree.trim() || null,
            years: p.years.trim() || null,
            description: p.description.trim() || null,
          });
        }
      } else if (kind === 'projects') {
        const p = payload as {
          name: string;
          role: string;
          years: string;
          github: string;
          website: string;
          description: string[];
        };
        if (item) {
          await updateProject((item as CareerProject).project_id, {
            name: p.name.trim(),
            role: p.role.trim() || null,
            years: p.years.trim() || null,
            github: p.github.trim() || null,
            website: p.website.trim() || null,
            description: p.description,
          });
        } else {
          await createProject({
            name: p.name.trim(),
            role: p.role.trim() || null,
            years: p.years.trim() || null,
            github: p.github.trim() || null,
            website: p.website.trim() || null,
            description: p.description,
          });
        }
      } else {
        const p = payload as { title: string; description: string; date: string };
        if (item) {
          await updateAchievement((item as CareerAchievement).achievement_id, {
            title: p.title.trim(),
            description: p.description.trim() || null,
            date: p.date.trim() || null,
          });
        } else {
          await createAchievement({
            title: p.title.trim(),
            description: p.description.trim() || null,
            date: p.date.trim() || null,
          });
        }
      }
      await refresh();
      setDialog(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const [deleting, setDeleting] = useState(false);

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const { kind, id } = deleteTarget;
    setDeleting(true);
    setError(null);
    try {
      if (kind === 'education') await deleteEducation(id);
      else if (kind === 'projects') await deleteProject(id);
      else if (kind === 'achievements') await deleteAchievement(id);
      else await deleteCertification(id);
      await refresh();
      setDeleteTarget(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleting(false);
    }
  };

  const openDialog = (kind: 'education' | 'projects' | 'achievements', item: unknown | null) => {
    setError(null);
    setDialog({ kind, item });
  };

  const saveAwards = async (next: string[]) => {
    setListBusy('awards');
    try {
      await updateProfile({ awards: next });
      await refresh();
    } finally {
      setListBusy(null);
    }
  };

  const saveLanguages = async (next: string[]) => {
    setListBusy('languages');
    try {
      await updateProfile({ languages: next });
      await refresh();
    } finally {
      setListBusy(null);
    }
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
      await refresh();
      setCertDialogOpen(false);
    } catch (e) {
      setCertError(e instanceof Error ? e.message : String(e));
    }
  };

  const confirmDeleteCert = async () => {
    if (!deleteCertId) return;
    await deleteCertification(deleteCertId);
    await refresh();
    setDeleteCertId(null);
  };

  const renderRow = (kind: 'education' | 'projects' | 'achievements', item: unknown) => {
    if (kind === 'education') {
      const e = item as CareerEducation;
      return (
        <div key={e.education_id} className="flex items-center justify-between gap-3 py-2.5">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-ink">{e.institution}</div>
            <div className="truncate text-xs text-ink-soft">
              {[e.degree, e.years].filter(Boolean).join(' · ')}
            </div>
          </div>
          <RowActions
            editLabel={t('profile.education.edit')}
            deleteLabel={t('profile.education.delete')}
            onEdit={() => openDialog('education', e)}
            onDelete={() => setDeleteTarget({ kind: 'education', id: e.education_id })}
          />
        </div>
      );
    }
    if (kind === 'projects') {
      const p = item as CareerProject;
      const readmeOpen = expandedReadmes.has(p.project_id);
      const toggleReadme = () => {
        setExpandedReadmes((prev) => {
          const next = new Set(prev);
          if (next.has(p.project_id)) next.delete(p.project_id);
          else next.add(p.project_id);
          return next;
        });
      };
      return (
        <div key={p.project_id} className="py-2.5">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-ink">{p.name}</div>
              <div className="truncate text-xs text-ink-soft">
                {[p.role, p.years, p.github, p.website].filter(Boolean).join(' · ')}
              </div>
              {p.languages.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {p.languages.slice(0, 5).map((lang) => (
                    <span
                      key={lang}
                      className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-600"
                    >
                      {lang}
                    </span>
                  ))}
                </div>
              )}
              {p.readme && (
                <button
                  onClick={toggleReadme}
                  className="mt-1 text-xs text-primary hover:underline"
                >
                  {readmeOpen ? t('profile.github.hideReadme') : t('profile.github.showReadme')}
                </button>
              )}
            </div>
            <RowActions
              editLabel={t('profile.projects.edit')}
              deleteLabel={t('profile.projects.delete')}
              onEdit={() => openDialog('projects', p)}
              onDelete={() => setDeleteTarget({ kind: 'projects', id: p.project_id })}
            />
          </div>
          {readmeOpen && p.readme && (
            <pre className="mt-2 max-h-40 overflow-y-auto overflow-x-auto whitespace-pre-wrap rounded-xl border border-[#e6e3dc] bg-secondary/30 p-3 text-[10px]">
              {p.readme}
            </pre>
          )}
        </div>
      );
    }
    const a = item as CareerAchievement;
    return (
      <div key={a.achievement_id} className="flex items-center justify-between gap-3 py-2.5">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-ink">{a.title}</div>
          <div className="truncate text-xs text-ink-soft">
            {[a.date, a.description].filter(Boolean).join(' · ')}
          </div>
        </div>
        <RowActions
          editLabel={t('profile.achievements.edit')}
          deleteLabel={t('profile.achievements.delete')}
          onEdit={() => openDialog('achievements', a)}
          onDelete={() => setDeleteTarget({ kind: 'achievements', id: a.achievement_id })}
        />
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {section === 'education' && (
        <>
          <section className="rounded-2xl border border-[#e6e3dc] bg-white p-5 shadow-sw-xs">
            <div className="mb-4 flex items-center justify-between">
              <div className="text-xs font-bold uppercase tracking-wide text-primary">
                {t('profile.education.title')}
              </div>
              <Button size="sm" onClick={() => openDialog('education', null)}>
                <Plus className="h-4 w-4" />
                {t('profile.education.add')}
              </Button>
            </div>
            {bundle.education.length === 0 ? (
              <p className="text-sm text-ink-soft">{t('profile.education.empty')}</p>
            ) : (
              <div className="divide-y divide-[#f0ece4]">
                {bundle.education.map((e) => renderRow('education', e))}
              </div>
            )}
          </section>

          <StringListSection
            title={t('profile.languages.title')}
            items={bundle.profile.languages}
            emptyText={t('profile.languages.empty')}
            addPlaceholder={t('profile.languages.placeholder')}
            addLabel={t('profile.languages.add')}
            removeLabel={t('common.delete')}
            busy={listBusy === 'languages'}
            onAdd={(value) => void saveLanguages([...bundle.profile.languages, value])}
            onRemove={(index) =>
              void saveLanguages(bundle.profile.languages.filter((_, i) => i !== index))
            }
          />
        </>
      )}

      {section === 'projects' && (
        <>
          <section className="rounded-2xl border border-[#e6e3dc] bg-white p-5 shadow-sw-xs">
            <div className="mb-4 flex items-center justify-between">
              <div className="text-xs font-bold uppercase tracking-wide text-primary">
                {t('profile.projects.title')}
              </div>
              <div className="flex items-center gap-2">
                <GitHubImportButton
                  onImported={async (result) => {
                    setImportNotice(
                      t('profile.projects.imported', { count: String(result.total) })
                    );
                    await refresh();
                    setTimeout(() => setImportNotice(null), 5000);
                  }}
                />
                <Button size="sm" onClick={() => openDialog('projects', null)}>
                  <Plus className="h-4 w-4" />
                  {t('profile.projects.add')}
                </Button>
              </div>
            </div>
            {importNotice && (
              <p className="mb-3 text-xs text-green-700">
                {importNotice} — {t('profile.projects.importHint')}
              </p>
            )}
            {bundle.projects.length > 0 && (
              <div className="relative mb-3">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft" />
                <Input
                  placeholder={t('profile.projects.search')}
                  value={projectSearch}
                  onChange={(e) => setProjectSearch(e.target.value)}
                  className="h-9 rounded-xl border-[#e6e3dc] pl-9 text-xs"
                />
              </div>
            )}
            {bundle.projects.length === 0 ? (
              <p className="text-sm text-ink-soft">{t('profile.projects.empty')}</p>
            ) : (
              (() => {
                const filtered = projectSearch.trim()
                  ? bundle.projects.filter((p) => {
                      const q = projectSearch.toLowerCase();
                      return (
                        p.name.toLowerCase().includes(q) ||
                        (p.role && p.role.toLowerCase().includes(q)) ||
                        (p.github && p.github.toLowerCase().includes(q)) ||
                        (p.website && p.website.toLowerCase().includes(q)) ||
                        (p.description && p.description.some((d) => d.toLowerCase().includes(q))) ||
                        (p.languages && p.languages.some((l) => l.toLowerCase().includes(q)))
                      );
                    })
                  : bundle.projects;
                return filtered.length === 0 ? (
                  <p className="text-sm text-ink-soft">{t('profile.projects.noResults')}</p>
                ) : (
                  <div className="divide-y divide-[#f0ece4]">
                    {filtered.map((p) => renderRow('projects', p))}
                  </div>
                );
              })()
            )}
          </section>
        </>
      )}

      {section === 'achievements' && (
        <>
          <section className="rounded-2xl border border-[#e6e3dc] bg-white p-5 shadow-sw-xs">
            <div className="mb-4 flex items-center justify-between">
              <div className="text-xs font-bold uppercase tracking-wide text-primary">
                {t('profile.achievements.title')}
              </div>
              <Button size="sm" onClick={() => openDialog('achievements', null)}>
                <Plus className="h-4 w-4" />
                {t('profile.achievements.add')}
              </Button>
            </div>
            {bundle.achievements.length === 0 ? (
              <p className="text-sm text-ink-soft">{t('profile.achievements.empty')}</p>
            ) : (
              <div className="divide-y divide-[#f0ece4]">
                {bundle.achievements.map((a) => renderRow('achievements', a))}
              </div>
            )}
          </section>

          <StringListSection
            title={t('profile.awards.title')}
            items={bundle.profile.awards}
            emptyText={t('profile.awards.empty')}
            addPlaceholder={t('profile.awards.placeholder')}
            addLabel={t('profile.awards.add')}
            removeLabel={t('common.delete')}
            busy={listBusy === 'awards'}
            onAdd={(value) => void saveAwards([...bundle.profile.awards, value])}
            onRemove={(index) =>
              void saveAwards(bundle.profile.awards.filter((_, i) => i !== index))
            }
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
                    <RowActions
                      editLabel={t('profile.certifications.edit')}
                      deleteLabel={t('profile.certifications.delete')}
                      onEdit={() => openCertDialog(cert)}
                      onDelete={() => setDeleteCertId(cert.certification_id)}
                    />
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}

      <GraphFormDialog
        dialog={dialog}
        error={error}
        onOpenChange={(open) => !open && setDialog(null)}
        onSubmit={handleSaved}
      />
      <CertificationFormDialog
        open={certDialogOpen}
        onOpenChange={setCertDialogOpen}
        certification={editingCert}
        error={certError}
        onSubmit={handleCertSaved}
      />
      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={
          deleteTarget?.kind === 'education'
            ? t('profile.education.deleteTitle')
            : deleteTarget?.kind === 'projects'
              ? t('profile.projects.deleteTitle')
              : deleteTarget?.kind === 'achievements'
                ? t('profile.achievements.deleteTitle')
                : t('profile.certifications.deleteTitle')
        }
        description={
          deleteTarget?.kind === 'education'
            ? t('profile.education.deleteDescription')
            : deleteTarget?.kind === 'projects'
              ? t('profile.projects.deleteDescription')
              : deleteTarget?.kind === 'achievements'
                ? t('profile.achievements.deleteDescription')
                : t('profile.certifications.deleteDescription')
        }
        confirmLabel={t('common.delete')}
        confirmLoading={deleting}
        onConfirm={() => void confirmDelete()}
      />
      <ConfirmDialog
        open={deleteCertId !== null}
        onOpenChange={(open) => !open && setDeleteCertId(null)}
        title={t('profile.certifications.deleteTitle')}
        description={t('profile.certifications.deleteDescription')}
        confirmLabel={t('common.delete')}
        onConfirm={() => void confirmDeleteCert()}
      />
    </div>
  );
}

function RowActions({
  editLabel,
  deleteLabel,
  onEdit,
  onDelete,
}: {
  editLabel: string;
  deleteLabel: string;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <Button variant="ghost" size="sm" onClick={onEdit} aria-label={editLabel}>
        <Pencil className="h-4 w-4" />
      </Button>
      <Button variant="ghost" size="sm" onClick={onDelete} aria-label={deleteLabel}>
        <Trash2 className="h-4 w-4 text-destructive" />
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Graph node add/edit dialog (one form per node kind)
// ---------------------------------------------------------------------------

interface GraphFormDialogProps {
  dialog: { kind: 'education' | 'projects' | 'achievements'; item: unknown | null } | null;
  error: string | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (payload: unknown) => Promise<void>;
}

function GraphFormDialog({ dialog, error, onOpenChange, onSubmit }: GraphFormDialogProps) {
  const { t } = useTranslations();
  const kind = dialog?.kind ?? 'education';
  const editing = Boolean(dialog?.item);
  const education = dialog?.item as CareerEducation | null;
  const project = dialog?.item as CareerProject | null;
  const achievement = dialog?.item as CareerAchievement | null;

  const [institution, setInstitution] = useState('');
  const [degree, setDegree] = useState('');
  const [years, setYears] = useState('');
  const [description, setDescription] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [github, setGithub] = useState('');
  const [website, setWebsite] = useState('');
  const [bulletDraft, setBulletDraft] = useState('');
  const [bullets, setBullets] = useState<string[]>([]);
  const [title, setTitle] = useState('');
  const [date, setDate] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [validation, setValidation] = useState<string | null>(null);

  useEffect(() => {
    if (!dialog) return;
    setInstitution(education?.institution ?? '');
    setDegree(education?.degree ?? '');
    setYears(education?.years ?? '');
    setDescription(education?.description ?? '');
    setName(project?.name ?? '');
    setRole(project?.role ?? '');
    setGithub(project?.github ?? '');
    setWebsite(project?.website ?? '');
    setBullets(project?.description ?? []);
    setTitle(achievement?.title ?? '');
    setDate(achievement?.date ?? '');
    setValidation(null);
  }, [dialog, education, project, achievement]);

  const addBullet = () => {
    const value = bulletDraft.trim();
    if (!value) return;
    setBullets((prev) => [...prev, value]);
    setBulletDraft('');
  };

  const submit = async () => {
    if (kind === 'education' && !institution.trim()) {
      setValidation(t('profile.education.institutionRequired'));
      return;
    }
    if (kind === 'projects' && !name.trim()) {
      setValidation(t('profile.projects.nameRequired'));
      return;
    }
    if (kind === 'achievements') {
      if (!title.trim()) {
        setValidation(t('profile.achievements.titleRequired'));
        return;
      }
      if (date.trim() !== '' && !/^\d{4}(-\d{2})?$/.test(date.trim())) {
        setValidation(t('profile.achievements.invalidDate'));
        return;
      }
    }
    setSubmitting(true);
    setValidation(null);
    try {
      if (kind === 'education') {
        await onSubmit({ institution, degree, years, description });
      } else if (kind === 'projects') {
        await onSubmit({ name, role, years, github, website, description: bullets });
      } else {
        await onSubmit({ title, description, date });
      }
    } finally {
      setSubmitting(false);
    }
  };

  const errorText = validation ?? error;
  const titleKey =
    kind === 'education'
      ? editing
        ? 'profile.education.editTitle'
        : 'profile.education.addTitle'
      : kind === 'projects'
        ? editing
          ? 'profile.projects.editTitle'
          : 'profile.projects.addTitle'
        : editing
          ? 'profile.achievements.editTitle'
          : 'profile.achievements.addTitle';
  const descriptionKey =
    kind === 'education'
      ? 'profile.education.formDescription'
      : kind === 'projects'
        ? 'profile.projects.formDescription'
        : 'profile.achievements.formDescription';
  const addKey =
    kind === 'education'
      ? 'profile.education.add'
      : kind === 'projects'
        ? 'profile.projects.add'
        : 'profile.achievements.add';

  return (
    <Dialog open={dialog !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg p-0 gap-0 overflow-hidden">
        <DialogHeader className="border-b border-[#e6e3dc] bg-white p-6">
          <DialogTitle>{t(titleKey)}</DialogTitle>
          <DialogDescription>{t(descriptionKey)}</DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] space-y-4 overflow-y-auto p-6">
          {kind === 'education' && (
            <>
              <div className="space-y-1">
                <Label>{t('profile.education.institution')}</Label>
                <Input value={institution} onChange={(e) => setInstitution(e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>{t('profile.education.degree')}</Label>
                  <Input
                    value={degree}
                    onChange={(e) => setDegree(e.target.value)}
                    placeholder={t('profile.education.optional')}
                  />
                </div>
                <div className="space-y-1">
                  <Label>{t('profile.education.years')}</Label>
                  <Input
                    value={years}
                    onChange={(e) => setYears(e.target.value)}
                    placeholder={t('profile.education.optional')}
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label>{t('profile.education.description')}</Label>
                <Input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={t('profile.education.optional')}
                />
              </div>
            </>
          )}
          {kind === 'projects' && (
            <>
              <div className="space-y-1">
                <Label>{t('profile.projects.name')}</Label>
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>{t('profile.projects.role')}</Label>
                  <Input
                    value={role}
                    onChange={(e) => setRole(e.target.value)}
                    placeholder={t('profile.projects.optional')}
                  />
                </div>
                <div className="space-y-1">
                  <Label>{t('profile.projects.years')}</Label>
                  <Input
                    value={years}
                    onChange={(e) => setYears(e.target.value)}
                    placeholder={t('profile.projects.optional')}
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>{t('profile.projects.github')}</Label>
                  <Input
                    value={github}
                    onChange={(e) => setGithub(e.target.value)}
                    placeholder="https://github.com/…"
                  />
                </div>
                <div className="space-y-1">
                  <Label>{t('profile.projects.website')}</Label>
                  <Input
                    value={website}
                    onChange={(e) => setWebsite(e.target.value)}
                    placeholder={t('profile.projects.optional')}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>{t('profile.projects.description')}</Label>
                {bullets.length === 0 ? (
                  <p className="text-sm text-ink-soft">{t('profile.projects.descriptionEmpty')}</p>
                ) : (
                  <ul className="space-y-1">
                    {bullets.map((bullet, idx) => (
                      <li
                        key={`${bullet}-${idx}`}
                        className="flex items-center justify-between gap-2 rounded-lg border border-[#e6e3dc] bg-paper-tint px-3 py-1.5 text-sm text-ink"
                      >
                        <span>{bullet}</span>
                        <button
                          type="button"
                          onClick={() => setBullets((prev) => prev.filter((_, i) => i !== idx))}
                          aria-label={t('profile.projects.descriptionRemove')}
                          className="text-steel-grey transition-colors hover:text-destructive"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <div className="flex items-center gap-2">
                  <Input
                    value={bulletDraft}
                    onChange={(e) => setBulletDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addBullet();
                      }
                    }}
                    placeholder={t('profile.projects.descriptionAdd')}
                  />
                  <Button size="sm" onClick={addBullet} disabled={bulletDraft.trim() === ''}>
                    <Plus className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </>
          )}
          {kind === 'achievements' && (
            <>
              <div className="space-y-1">
                <Label>{t('profile.achievements.titleLabel')}</Label>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>{t('profile.achievements.description')}</Label>
                <Input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder={t('profile.achievements.optional')}
                />
              </div>
              <div className="space-y-1">
                <Label>{t('profile.achievements.date')}</Label>
                <Input
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  placeholder="2024 or 2024-03"
                />
              </div>
            </>
          )}
          {errorText && <p className="text-xs text-destructive">{errorText}</p>}
        </div>
        <DialogFooter className="flex-row justify-end gap-3 border-t border-[#e6e3dc] bg-secondary p-4">
          <Button onClick={() => void submit()} disabled={submitting}>
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : editing ? (
              t('common.save')
            ) : (
              t(addKey)
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
