'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  ArrowLeft,
  BookOpen,
  Check,
  FileText,
  Loader2,
  Plus,
  Search,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { Project } from '@/components/dashboard/resume-component';
import { CareerProject, getProfile } from '@/lib/api/profile';
import { generateProjectBullets } from '@/lib/api/enrichment';
import { useTranslations } from '@/lib/i18n';

interface AddProjectDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (entry: Project) => void;
  outputLanguage: string;
  existingNames: string[];
}

/**
 * AddProjectDialog Component
 *
 * Dialog for adding a project from the user's career profile.
 * The AI generates resume bullet points from the project's README
 * (or from a short user prompt when no README exists).
 */
export const AddProjectDialog: React.FC<AddProjectDialogProps> = ({
  open,
  onOpenChange,
  onAdd,
  outputLanguage,
  existingNames,
}) => {
  const { t } = useTranslations();

  const [projects, setProjects] = useState<CareerProject[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<CareerProject | null>(null);
  const [prompt, setPrompt] = useState('');
  const [bullets, setBullets] = useState<string[]>([]);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  const reset = useCallback(() => {
    setProjects([]);
    setLoading(false);
    setLoadError(null);
    setQuery('');
    setSelected(null);
    setPrompt('');
    setBullets([]);
    setGenerating(false);
    setGenerateError(null);
    setShowAll(false);
  }, []);

  const loadProjects = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const profile = await getProfile();
      setProjects(profile.projects ?? []);
    } catch {
      setLoadError(t('builder.projectsDialog.loadError'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (open) {
      reset();
      loadProjects();
    }
  }, [open, reset, loadProjects]);

  const existing = new Set(existingNames.map((n) => n.trim().toLowerCase()).filter(Boolean));

  const available = projects
    .filter((p) => !existing.has(p.name.trim().toLowerCase()))
    .sort((a, b) => {
      const aHasReadme = Boolean(a.readme && a.readme.trim());
      const bHasReadme = Boolean(b.readme && b.readme.trim());
      if (aHasReadme !== bHasReadme) return aHasReadme ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

  const filtered = query.trim()
    ? available.filter(
        (p) =>
          p.name.toLowerCase().includes(query.trim().toLowerCase()) ||
          (p.role ?? '').toLowerCase().includes(query.trim().toLowerCase())
      )
    : available;

  const visibleProjects = showAll ? filtered : filtered.slice(0, 6);

  const hasReadme = Boolean(selected?.readme && selected.readme.trim());

  const handleGenerate = async () => {
    if (!selected || generating) return;
    setGenerating(true);
    setGenerateError(null);
    try {
      const result = await generateProjectBullets({
        name: selected.name,
        role: selected.role,
        years: selected.years,
        github: selected.github,
        website: selected.website,
        description: selected.description,
        languages: selected.languages,
        readme: selected.readme,
        prompt: prompt.trim() || undefined,
        output_language: outputLanguage,
      });
      setBullets(result.bullets);
    } catch {
      setGenerateError(t('builder.projectsDialog.generateError'));
    } finally {
      setGenerating(false);
    }
  };

  const handleRemoveBullet = (index: number) => {
    setBullets((prev) => prev.filter((_, i) => i !== index));
  };

  const handleAddToResume = () => {
    if (!selected) return;
    const description = bullets.length > 0 ? bullets : [''];
    onAdd({
      id: 0,
      name: selected.name,
      role: selected.role ?? '',
      years: selected.years ?? '',
      github: selected.github ?? '',
      website: selected.website ?? '',
      description,
      descriptionStyles: description.map(() => 'bullet'),
    });
    onOpenChange(false);
  };

  const handleStartFromScratch = () => {
    onAdd({
      id: 0,
      name: '',
      role: '',
      years: '',
      github: '',
      website: '',
      description: [''],
      descriptionStyles: ['bullet'],
    });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px] rounded-2xl p-0 gap-0 overflow-hidden max-h-[85vh] flex flex-col">
        <DialogHeader className="p-6 pb-4 border-b border-[#e6e3dc]">
          <DialogTitle className="font-sans text-xl font-bold uppercase tracking-tight">
            {t('builder.projectsDialog.title')}
          </DialogTitle>
          <DialogDescription className="mt-2 text-xs text-ink-soft">
            {t('builder.projectsDialog.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {loading && (
            <div className="flex items-center justify-center gap-3 py-12 text-sm text-steel-grey">
              <Loader2 className="w-4 h-4 animate-spin" />
              {t('builder.projectsDialog.loading')}
            </div>
          )}

          {!loading && loadError && (
            <div className="py-8 text-center space-y-4">
              <p className="text-sm text-steel-grey">{loadError}</p>
              <Button variant="outline" size="sm" onClick={loadProjects} className="rounded-full">
                {t('builder.projectsDialog.retry')}
              </Button>
            </div>
          )}

          {!loading && !loadError && !selected && (
            <>
              <div className="space-y-2">
                <Label className="text-xs uppercase tracking-wider text-ink-soft">
                  {t('builder.projectsDialog.profileProjects')}
                </Label>
                {projects.length > 0 && (
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-steel-grey" />
                    <Input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder={t('builder.projectsDialog.searchPlaceholder')}
                      className="pl-9 border-[#c9c5bc] focus:border-primary rounded-lg"
                    />
                  </div>
                )}
              </div>

              {available.length === 0 ? (
                <div className="text-center rounded-2xl border border-dashed border-[#e6e3dc] bg-paper-tint py-10 px-6 space-y-3">
                  <p className="text-sm text-steel-grey">{t('builder.projectsDialog.allAdded')}</p>
                  <p className="text-xs text-steel-grey">
                    {t('builder.projectsDialog.allAddedHint')}
                  </p>
                  <Link
                    href="/profile"
                    className="inline-flex items-center justify-center rounded-full border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground"
                  >
                    {t('builder.projectsDialog.goToProfile')}
                  </Link>
                </div>
              ) : (
                <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
                  {visibleProjects.map((project) => (
                    <button
                      key={project.project_id}
                      type="button"
                      onClick={() => setSelected(project)}
                      className="w-full rounded-2xl border border-[#e6e3dc] bg-white p-4 text-left transition-all hover:border-primary hover:bg-paper-tint"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-3">
                          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[#e6e3dc] bg-paper-tint text-ink-soft">
                            <FileText className="w-4 h-4" />
                          </div>
                          <div className="min-w-0">
                            <div className="text-sm font-semibold text-ink truncate">
                              {project.name}
                            </div>
                            {project.role && (
                              <div className="text-xs text-steel-grey truncate">{project.role}</div>
                            )}
                            <div className="mt-1 flex flex-wrap items-center gap-1.5">
                              {project.languages.slice(0, 3).map((lang) => (
                                <span
                                  key={lang}
                                  className="rounded-full bg-paper-tint border border-[#e6e3dc] px-2 py-0.5 text-[10px] text-steel-grey"
                                >
                                  {lang}
                                </span>
                              ))}
                            </div>
                          </div>
                        </div>
                        {project.readme && project.readme.trim() ? (
                          <span className="flex shrink-0 items-center gap-1 rounded-full bg-primary/10 text-primary px-2.5 py-1 text-[10px] font-semibold">
                            <BookOpen className="w-3 h-3" />
                            {t('builder.projectsDialog.readmeAvailable')}
                          </span>
                        ) : (
                          <span className="flex shrink-0 items-center rounded-full bg-paper-tint text-steel-grey px-2.5 py-1 text-[10px]">
                            {t('builder.projectsDialog.noReadme')}
                          </span>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {!query.trim() && filtered.length > 6 && (
                <button
                  type="button"
                  onClick={() => setShowAll((prev) => !prev)}
                  className="w-full rounded-full border border-[#e6e3dc] bg-white py-2 text-xs font-semibold text-primary hover:bg-paper-tint transition-colors"
                >
                  {showAll
                    ? t('builder.projectsDialog.showLess')
                    : t('builder.projectsDialog.showAll', { count: filtered.length - 6 })}
                </button>
              )}

              <button
                type="button"
                onClick={handleStartFromScratch}
                className="w-full rounded-2xl border border-dashed border-[#e6e3dc] p-4 text-left transition-all hover:border-primary hover:bg-paper-tint"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[#e6e3dc] bg-white text-ink-soft">
                    <Plus className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-ink">
                      {t('builder.projectsDialog.startFromScratch')}
                    </div>
                    <div className="text-xs text-steel-grey">
                      {t('builder.projectsDialog.startFromScratchHint')}
                    </div>
                  </div>
                </div>
              </button>
            </>
          )}

          {!loading && !loadError && selected && (
            <div className="space-y-5">
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setSelected(null);
                    setBullets([]);
                    setPrompt('');
                    setGenerateError(null);
                  }}
                  className="text-steel-grey hover:text-ink"
                >
                  <ArrowLeft className="w-4 h-4 mr-1" />
                  {t('builder.projectsDialog.back')}
                </Button>
                <div className="min-w-0">
                  <div className="text-sm font-bold text-ink truncate">{selected.name}</div>
                  {selected.role && (
                    <div className="text-xs text-steel-grey truncate">{selected.role}</div>
                  )}
                </div>
              </div>

              {hasReadme && (
                <div className="space-y-2">
                  <Label className="text-xs uppercase tracking-wider text-ink-soft">
                    {t('builder.projectsDialog.readmeLabel')}
                  </Label>
                  <div className="rounded-xl border border-[#e6e3dc] bg-paper-tint p-4 max-h-[160px] overflow-y-auto text-xs text-steel-grey whitespace-pre-wrap font-mono">
                    {selected!.readme!.slice(0, 600)}
                    {selected!.readme!.length > 600 ? '…' : ''}
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <Label className="text-xs uppercase tracking-wider text-ink-soft">
                  {t('builder.projectsDialog.promptLabel')}
                </Label>
                <textarea
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder={t('builder.projectsDialog.promptPlaceholder')}
                  rows={3}
                  className="w-full rounded-xl border border-[#c9c5bc] bg-white p-3 text-sm focus:border-primary focus:ring-1 focus:ring-primary outline-none"
                />
                <p className="text-[11px] text-steel-grey">
                  {t('builder.projectsDialog.promptHint')}
                </p>
              </div>

              <Button
                onClick={handleGenerate}
                disabled={generating || (!hasReadme && !prompt.trim())}
                className="w-full rounded-xl"
              >
                {generating ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    {t('builder.projectsDialog.generating')}
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4 mr-2" />
                    {bullets.length > 0
                      ? t('builder.projectsDialog.regenerate')
                      : t('builder.projectsDialog.generate')}
                  </>
                )}
              </Button>

              {generateError && (
                <p className="text-xs text-destructive text-center">{generateError}</p>
              )}

              {bullets.length > 0 && (
                <div className="space-y-2">
                  <Label className="text-xs uppercase tracking-wider text-ink-soft">
                    {t('builder.projectsDialog.previewTitle')}
                  </Label>
                  <div className="space-y-2">
                    {bullets.map((bullet, idx) => (
                      <div
                        key={idx}
                        className="group flex items-start gap-2 rounded-xl border border-[#e6e3dc] bg-white p-3"
                      >
                        <Check className="w-4 h-4 mt-0.5 shrink-0 text-primary" />
                        <p className="flex-1 text-sm text-ink">{bullet}</p>
                        <button
                          type="button"
                          onClick={() => handleRemoveBullet(idx)}
                          className="opacity-0 group-hover:opacity-100 transition-opacity text-steel-grey hover:text-destructive"
                          aria-label={t('a11y.removeItem')}
                          title={t('a11y.removeItem')}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        <DialogFooter className="flex-row justify-end gap-3 border-t border-[#e6e3dc] bg-secondary p-4">
          <DialogClose asChild>
            <Button variant="outline" className="rounded-full">
              {t('common.cancel')}
            </Button>
          </DialogClose>
          <Button
            onClick={handleAddToResume}
            disabled={!selected || bullets.length === 0}
            className="rounded-full"
          >
            <Plus className="w-4 h-4 mr-2" />
            {t('builder.projectsDialog.addToResume')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
