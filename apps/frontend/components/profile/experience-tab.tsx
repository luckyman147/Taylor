'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';
import Pencil from 'lucide-react/dist/esm/icons/pencil';
import Plus from 'lucide-react/dist/esm/icons/plus';
import Search from 'lucide-react/dist/esm/icons/search';
import Sparkles from 'lucide-react/dist/esm/icons/sparkles';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dropdown } from '@/components/ui/dropdown';
import { Textarea } from '@/components/ui/textarea';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
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
  createSkill,
  deleteSkill,
  getProfile,
  getSkillSuggestions,
  updateProfile,
  updateSkill,
  type CareerSkill,
  type ProfileBundle,
  type SkillSuggestion,
  type WorkExperienceItem,
} from '@/lib/api/profile';

interface ExperienceTabProps {
  bundle: ProfileBundle;
  onChanged: (bundle: ProfileBundle) => void;
}

/** Standard skill categories (mirrors backend `_SKILL_CATEGORIES`). */
const SKILL_CATEGORY_OPTIONS = [
  { id: '', label: 'None' },
  { id: 'Languages', label: 'Languages' },
  { id: 'Frontend', label: 'Frontend' },
  { id: 'Backend', label: 'Backend' },
  { id: 'Databases', label: 'Databases' },
  { id: 'Cloud & DevOps', label: 'Cloud & DevOps' },
  { id: 'Architecture', label: 'Architecture' },
  { id: 'AI/LLM', label: 'AI/LLM' },
  { id: 'Tools', label: 'Tools' },
];

/** Known tech skills for autocomplete suggestions (mirrors backend skill_presentation.py). */
const KNOWN_SKILLS: string[] = [
  'Python',
  'JavaScript',
  'TypeScript',
  'Java',
  'C',
  'C++',
  'C#',
  'Go',
  'Golang',
  'Rust',
  'Ruby',
  'PHP',
  'Swift',
  'Kotlin',
  'Dart',
  'Scala',
  'SQL',
  'React',
  'React.js',
  'ReactJS',
  'Next.js',
  'NextJS',
  'Vue',
  'Vue.js',
  'Angular',
  'Svelte',
  'Flutter',
  'React Native',
  'Tailwind CSS',
  'Tailwind',
  'CSS',
  'CSS3',
  'HTML',
  'HTML5',
  'Redux',
  'Zustand',
  'jQuery',
  'Bootstrap',
  'Webpack',
  'Vite',
  'Framer Motion',
  'RxJS',
  'Node.js',
  'NodeJS',
  'Express',
  'Express.js',
  'NestJS',
  'Django',
  'FastAPI',
  'Flask',
  'Spring Boot',
  'Spring',
  '.NET',
  '.NET Framework',
  'ASP.NET Core',
  'ASP.NET',
  'Ruby on Rails',
  'Laravel',
  'Symfony',
  'GraphQL',
  'REST',
  'REST API',
  'gRPC',
  'PostgreSQL',
  'Postgres',
  'MySQL',
  'SQLite',
  'SQL Server',
  'MongoDB',
  'Redis',
  'Elasticsearch',
  'DynamoDB',
  'Firebase',
  'Supabase',
  'Prisma',
  'TypeORM',
  'SQLAlchemy',
  'Cassandra',
  'AWS',
  'AWS Lambda',
  'Azure',
  'Google Cloud',
  'GCP',
  'Docker',
  'Kubernetes',
  'K8s',
  'Terraform',
  'GitHub Actions',
  'CI/CD',
  'Jenkins',
  'Ansible',
  'Nginx',
  'Serverless',
  'Vercel',
  'Netlify',
  'Helm',
  'Microservices',
  'Clean Architecture',
  'Design Patterns',
  'SOLID',
  'Event-Driven',
  'Message Queues',
  'Kafka',
  'RabbitMQ',
  'System Design',
  'Monorepo',
  'API Design',
  'Domain-Driven Design',
  'DDD',
  'CQRS',
  'MVC',
  'Machine Learning',
  'ML',
  'Deep Learning',
  'LLM',
  'LangChain',
  'LangGraph',
  'RAG',
  'OpenAI',
  'PyTorch',
  'TensorFlow',
  'Hugging Face',
  'Fine-Tuning',
  'Prompt Engineering',
  'Vector Databases',
  'Agents',
  'Data Science',
  'Git',
  'GitHub',
  'GitLab',
  'Bitbucket',
  'Linux',
  'Bash',
  'Postman',
  'Jira',
  'Figma',
  'VS Code',
  'WebStorm',
  'npm',
  'Yarn',
  'pnpm',
  'Docker Compose',
  'Playwright',
  'Jest',
  'Cypress',
  'Pytest',
  'ESLint',
  'Prettier',
  'Agile',
  'Scrum',
  'Testing',
];

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

export function ExperienceTab({ bundle, onChanged }: ExperienceTabProps) {
  const { t } = useTranslations();

  // ---- Work experience ------------------------------------------------------
  const [workDialogOpen, setWorkDialogOpen] = useState(false);
  const [editingWork, setEditingWork] = useState<WorkExperienceItem | null>(null);
  const [editingWorkIdx, setEditingWorkIdx] = useState<number | null>(null);
  const [deleteWorkIdx, setDeleteWorkIdx] = useState<number | null>(null);
  const [workError, setWorkError] = useState<string | null>(null);
  const [workBusy, setWorkBusy] = useState(false);

  const openWorkDialog = (entry: WorkExperienceItem | null, index: number | null = null) => {
    setEditingWork(entry);
    setEditingWorkIdx(index);
    setWorkError(null);
    setWorkDialogOpen(true);
  };

  const saveWorkExperience = async (entries: WorkExperienceItem[]) => {
    setWorkBusy(true);
    try {
      await updateProfile({ work_experience: entries });
      onChanged(await getProfile());
    } catch (e) {
      setWorkError(e instanceof Error ? e.message : String(e));
    } finally {
      setWorkBusy(false);
    }
  };

  const handleWorkSaved = (payload: WorkExperienceItem) => {
    setWorkError(null);
    const entries = [...bundle.profile.work_experience];
    if (editingWorkIdx === null) {
      entries.push(payload);
    } else {
      entries[editingWorkIdx] = payload;
    }
    void saveWorkExperience(entries);
    setWorkDialogOpen(false);
  };

  const confirmDeleteWork = () => {
    if (deleteWorkIdx === null) return;
    const entries = bundle.profile.work_experience.filter((_, i) => i !== deleteWorkIdx);
    void saveWorkExperience(entries);
    setDeleteWorkIdx(null);
  };

  // ---- Skills ---------------------------------------------------------------
  const [skillDialogOpen, setSkillDialogOpen] = useState(false);
  const [editingSkill, setEditingSkill] = useState<CareerSkill | null>(null);
  const [deleteSkillId, setDeleteSkillId] = useState<string | null>(null);
  const [skillError, setSkillError] = useState<string | null>(null);
  const [skillSearch, setSkillSearch] = useState('');

  const searchLower = skillSearch.trim().toLowerCase();
  const visibleSkills = searchLower
    ? bundle.skills.filter((skill) => skill.name.toLowerCase().includes(searchLower))
    : bundle.skills;

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
        const duplicate = names.find((name) => existing.has(name.toLowerCase()));
        if (duplicate) {
          setSkillError(t('profile.skills.alreadyExists', { name: duplicate }));
          return;
        }
        for (const name of names) {
          await createSkill({
            name,
            category: payload.category.trim() || null,
            proficiency: payload.proficiency ? Number(payload.proficiency) : null,
            years_experience: payload.years_experience ? Number(payload.years_experience) : null,
            last_used: payload.last_used.trim() || null,
          });
        }
      }
      onChanged(await getProfile());
      setSkillDialogOpen(false);
    } catch (e) {
      setSkillError(e instanceof Error ? e.message : String(e));
    }
  };

  const confirmDeleteSkill = async () => {
    if (!deleteSkillId) return;
    await deleteSkill(deleteSkillId);
    onChanged(await getProfile());
    setDeleteSkillId(null);
  };

  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [suggestError, setSuggestError] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<SkillSuggestion[]>([]);
  const [suggestNote, setSuggestNote] = useState<string | null>(null);
  const [suggestBusyName, setSuggestBusyName] = useState<string | null>(null);

  const openSuggestDialog = async () => {
    setSuggestOpen(true);
    setSuggestLoading(true);
    setSuggestError(null);
    setSuggestNote(null);
    setSuggestions([]);
    try {
      const res = await getSkillSuggestions();
      setSuggestions(res.skills);
      setSuggestNote(res.note);
    } catch (e) {
      setSuggestError(e instanceof Error ? e.message : String(e));
    } finally {
      setSuggestLoading(false);
    }
  };

  const addSuggestedSkill = async (name: string) => {
    setSuggestBusyName(name);
    setSuggestError(null);
    try {
      await createSkill({
        name,
        category: null,
        proficiency: null,
        years_experience: null,
        last_used: null,
      });
      onChanged(await getProfile());
      setSuggestions((prev) => prev.filter((skill) => skill.name !== name));
    } catch (e) {
      setSuggestError(e instanceof Error ? e.message : String(e));
    } finally {
      setSuggestBusyName(null);
    }
  };

  return (
    <div className="space-y-6">
      {/* Work experience */}
      <section className="rounded-2xl border border-[#e6e3dc] bg-white p-5 shadow-sw-xs">
        <div className="mb-4 flex items-center justify-between">
          <div className="text-xs font-bold uppercase tracking-wide text-primary">
            {t('profile.workExperience.title')}
          </div>
          <Button size="sm" onClick={() => openWorkDialog(null)} disabled={workBusy}>
            <Plus className="h-4 w-4" />
            {t('profile.workExperience.add')}
          </Button>
        </div>
        {bundle.profile.work_experience.length === 0 ? (
          <p className="text-sm text-ink-soft">{t('profile.workExperience.empty')}</p>
        ) : (
          <div className="divide-y divide-[#f0ece4]">
            {bundle.profile.work_experience.map((entry, idx) => (
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
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void openSuggestDialog()}
              disabled={suggestLoading}
            >
              <Sparkles className="h-4 w-4" />
              {t('profile.skills.suggestionsButton')}
            </Button>
            <Button size="sm" onClick={() => openSkillDialog(null)}>
              <Plus className="h-4 w-4" />
              {t('profile.skills.add')}
            </Button>
          </div>
        </div>
        {bundle.skills.length === 0 ? (
          <p className="text-sm text-ink-soft">{t('profile.skills.empty')}</p>
        ) : (
          <>
            <div className="relative mb-4">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft" />
              <Input
                value={skillSearch}
                onChange={(e) => setSkillSearch(e.target.value)}
                placeholder={t('profile.skills.searchPlaceholder')}
                className="pl-9"
                aria-label={t('profile.skills.searchPlaceholder')}
              />
            </div>
            {visibleSkills.length === 0 ? (
              <p className="text-sm text-ink-soft">{t('profile.skills.noResults')}</p>
            ) : (
              <div className="divide-y divide-[#f0ece4]">
                {visibleSkills.map((skill) => (
                  <div
                    key={skill.skill_id}
                    className="flex items-center justify-between gap-3 py-2.5"
                  >
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
          </>
        )}
      </section>

      {/* Dialogs */}
      <WorkExperienceDialog
        open={workDialogOpen}
        onOpenChange={setWorkDialogOpen}
        entry={editingWork}
        error={workError}
        onSubmit={handleWorkSaved}
      />
      <SkillFormDialog
        open={skillDialogOpen}
        onOpenChange={setSkillDialogOpen}
        skill={editingSkill}
        existingSkills={bundle.skills.map((s) => s.name)}
        error={skillError}
        onSubmit={handleSkillSaved}
      />
      <ConfirmDialog
        open={deleteWorkIdx !== null}
        onOpenChange={(open) => !open && setDeleteWorkIdx(null)}
        title={t('profile.workExperience.deleteTitle')}
        description={t('profile.workExperience.deleteDescription')}
        confirmLabel={t('common.delete')}
        onConfirm={confirmDeleteWork}
      />
      <ConfirmDialog
        open={deleteSkillId !== null}
        onOpenChange={(open) => !open && setDeleteSkillId(null)}
        title={t('profile.skills.deleteTitle')}
        description={t('profile.skills.deleteDescription')}
        confirmLabel={t('common.delete')}
        onConfirm={() => void confirmDeleteSkill()}
      />
      <SkillSuggestionsDialog
        open={suggestOpen}
        onOpenChange={setSuggestOpen}
        loading={suggestLoading}
        error={suggestError}
        suggestions={suggestions}
        note={suggestNote}
        busyName={suggestBusyName}
        onAdd={(name) => void addSuggestedSkill(name)}
        onRetry={() => void openSuggestDialog()}
      />
    </div>
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

// ---------------------------------------------------------------------------
// Skill add/edit dialog
// ---------------------------------------------------------------------------

interface SkillFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  skill: CareerSkill | null;
  existingSkills: string[];
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

function SkillFormDialog({
  open,
  onOpenChange,
  skill,
  existingSkills,
  error,
  onSubmit,
}: SkillFormDialogProps) {
  const { t } = useTranslations();
  const editing = Boolean(skill);
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [proficiency, setProficiency] = useState('');
  const [yearsExperience, setYearsExperience] = useState('');
  const [lastUsed, setLastUsed] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [validation, setValidation] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [highlightIdx, setHighlightIdx] = useState(-1);
  const nameRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);

  const existingSet = React.useMemo(
    () => new Set(existingSkills.map((s) => s.toLowerCase())),
    [existingSkills]
  );

  const isDuplicate = name.trim() !== '' && !editing && existingSet.has(name.trim().toLowerCase());

  const computeSuggestions = useCallback(
    (query: string) => {
      if (!query.trim()) {
        setSuggestions([]);
        return;
      }
      const q = query.toLowerCase();
      const existingSetLocal = new Set(existingSkills.map((s) => s.toLowerCase()));
      const matches = KNOWN_SKILLS.filter(
        (s) => s.toLowerCase().includes(q) && !existingSetLocal.has(s.toLowerCase())
      ).slice(0, 8);
      setSuggestions(matches);
      setHighlightIdx(-1);
    },
    [existingSkills]
  );

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
    setSuggestions([]);
    setHighlightIdx(-1);
  }, [open, skill]);

  const handleNameKeyDown = (e: React.KeyboardEvent) => {
    if (suggestions.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightIdx((prev) => (prev < suggestions.length - 1 ? prev + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightIdx((prev) => (prev > 0 ? prev - 1 : suggestions.length - 1));
    } else if (e.key === 'Enter' && highlightIdx >= 0) {
      e.preventDefault();
      setName(suggestions[highlightIdx]);
      setSuggestions([]);
      setHighlightIdx(-1);
    } else if (e.key === 'Escape') {
      setSuggestions([]);
      setHighlightIdx(-1);
    }
  };

  // Include the current category when it is not one of the standard options,
  // so editing a legacy/custom category keeps its value visible.
  const categoryOptions = SKILL_CATEGORY_OPTIONS.some((o) => o.id === category)
    ? SKILL_CATEGORY_OPTIONS
    : [{ id: category, label: category || 'None' }, ...SKILL_CATEGORY_OPTIONS];

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
            <div className="relative">
              <Input
                ref={nameRef}
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  computeSuggestions(e.target.value);
                }}
                onKeyDown={handleNameKeyDown}
                onBlur={() => setTimeout(() => setSuggestions([]), 150)}
                autoComplete="off"
              />
              {suggestions.length > 0 && (
                <div
                  ref={suggestionsRef}
                  className="absolute left-0 right-0 top-full z-50 mt-1 max-h-48 overflow-y-auto rounded-xl border border-[#e6e3dc] bg-white shadow-sw-md"
                >
                  {suggestions.map((s, i) => (
                    <button
                      key={s}
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setName(s);
                        setSuggestions([]);
                      }}
                      onMouseEnter={() => setHighlightIdx(i)}
                      className={`flex w-full items-center px-3 py-2 text-left text-sm transition-colors ${
                        i === highlightIdx
                          ? 'bg-primary/10 text-primary'
                          : 'text-ink hover:bg-secondary/60'
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </div>
            {isDuplicate && (
              <p className="text-xs text-amber-600">
                {t('profile.skills.duplicateWarning', { name: name.trim() })}
              </p>
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>{t('profile.skills.category')}</Label>
              <Dropdown
                options={categoryOptions}
                value={category}
                onChange={setCategory}
                triggerClassName="h-10 rounded-lg px-3 py-0"
              />
            </div>
            <div className="space-y-1">
              <Label>{t('profile.skills.lastUsed')}</Label>
              <Input type="month" value={lastUsed} onChange={(e) => setLastUsed(e.target.value)} />
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
// AI skill suggestions dialog
// ---------------------------------------------------------------------------

interface SkillSuggestionsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  loading: boolean;
  error: string | null;
  suggestions: SkillSuggestion[];
  note: string | null;
  busyName: string | null;
  onAdd: (name: string) => void;
  onRetry: () => void;
}

function SkillSuggestionsDialog({
  open,
  onOpenChange,
  loading,
  error,
  suggestions,
  note,
  busyName,
  onAdd,
  onRetry,
}: SkillSuggestionsDialogProps) {
  const { t } = useTranslations();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b border-[#e6e3dc] bg-white p-6">
          <DialogTitle>
            <span className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              {t('profile.skills.suggestionsTitle')}
            </span>
          </DialogTitle>
          <DialogDescription>{t('profile.skills.suggestionsDescription')}</DialogDescription>
        </DialogHeader>
        <div className="max-h-[70vh] space-y-4 overflow-y-auto p-6">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-ink-soft">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t('profile.skills.suggestionsLoading')}
            </div>
          ) : error ? (
            <p className="text-sm text-destructive">{error}</p>
          ) : note ? (
            <p className="text-sm text-ink-soft">{note}</p>
          ) : suggestions.length === 0 ? (
            <p className="text-sm text-ink-soft">{t('profile.skills.suggestionsEmpty')}</p>
          ) : (
            <div className="space-y-4">
              {(['remembered', 'learn_next'] as const).map((kind) => {
                const group = suggestions.filter((s) => s.kind === kind);
                if (group.length === 0) return null;
                return (
                  <div key={kind}>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-primary">
                      {kind === 'remembered'
                        ? t('profile.skills.suggestionsGroupRemembered')
                        : t('profile.skills.suggestionsGroupLearnNext')}
                    </p>
                    <div className="mt-1 divide-y divide-[#f0ece4]">
                      {group.map((suggestion) => (
                        <div
                          key={suggestion.name}
                          className="flex items-center justify-between gap-3 py-2.5"
                        >
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-ink">{suggestion.name}</div>
                            {suggestion.reason && (
                              <p className="mt-0.5 text-xs text-ink-soft">{suggestion.reason}</p>
                            )}
                          </div>
                          <Button
                            size="sm"
                            onClick={() => onAdd(suggestion.name)}
                            disabled={busyName !== null}
                            aria-label={t('profile.skills.suggestAdd', {
                              name: suggestion.name,
                            })}
                          >
                            {busyName === suggestion.name ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Plus className="h-4 w-4" />
                            )}
                            {t('profile.skills.add')}
                          </Button>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        <DialogFooter className="flex-row justify-end gap-3 border-t border-[#e6e3dc] bg-secondary p-4">
          {error && (
            <Button variant="outline" onClick={onRetry} disabled={loading}>
              <Sparkles className="h-4 w-4" />
              {t('common.retry')}
            </Button>
          )}
          <Button onClick={() => onOpenChange(false)}>{t('common.close')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
