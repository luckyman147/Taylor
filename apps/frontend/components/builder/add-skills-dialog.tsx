'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
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
import { Check, ChevronDown, ChevronRight, Loader2, Search, Zap } from 'lucide-react';
import { CareerSkill, getProfile } from '@/lib/api/profile';
import { useTranslations } from '@/lib/i18n';

interface AddSkillsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (skills: Array<{ name: string; category: string | null }>) => void;
  existingSkills: string[];
}

type ViewMode = 'grouped' | 'list';

export const AddSkillsDialog: React.FC<AddSkillsDialogProps> = ({
  open,
  onOpenChange,
  onAdd,
  existingSkills,
}) => {
  const { t } = useTranslations();

  const [skills, setSkills] = useState<CareerSkill[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<ViewMode>('grouped');
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  const reset = useCallback(() => {
    setSkills([]);
    setLoading(false);
    setLoadError(null);
    setQuery('');
    setSelected(new Set());
    setViewMode('grouped');
    setCollapsedGroups(new Set());
  }, []);

  const loadSkills = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const profile = await getProfile();
      setSkills(profile.skills ?? []);
    } catch {
      setLoadError(t('builder.skillsDialog.loadError'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (open) {
      reset();
      loadSkills();
    }
  }, [open, reset, loadSkills]);

  const existing = useMemo(
    () => new Set(existingSkills.map((s) => s.trim().toLowerCase()).filter(Boolean)),
    [existingSkills]
  );

  const available = useMemo(
    () => skills.filter((s) => !existing.has(s.name.trim().toLowerCase())),
    [skills, existing]
  );

  const filtered = useMemo(() => {
    if (!query.trim()) return available;
    const q = query.trim().toLowerCase();
    return available.filter((s) => s.name.toLowerCase().includes(q));
  }, [available, query]);

  const grouped = useMemo(() => {
    const groups = new Map<string, CareerSkill[]>();
    for (const skill of filtered) {
      const category = skill.category?.trim() || t('builder.skillsDialog.uncategorized');
      if (!groups.has(category)) groups.set(category, []);
      groups.get(category)!.push(skill);
    }
    return Array.from(groups.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered, t]);

  const toggleSkill = (name: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  };

  const toggleGroup = (category: string) => {
    const groupSkills = grouped.find(([cat]) => cat === category)?.[1] ?? [];
    const allSelected = groupSkills.every((s) => selected.has(s.name));
    setSelected((prev) => {
      const next = new Set(prev);
      for (const skill of groupSkills) {
        if (allSelected) {
          next.delete(skill.name);
        } else {
          next.add(skill.name);
        }
      }
      return next;
    });
  };

  const toggleGroupCollapse = (category: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  };

  const handleAdd = () => {
    const selectedSkills = available.filter((s) => selected.has(s.name));
    onAdd(selectedSkills.map((s) => ({ name: s.name, category: s.category })));
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px] rounded-2xl p-0 gap-0 overflow-hidden max-h-[85vh] flex flex-col">
        <DialogHeader className="p-6 pb-4 border-b border-[#e6e3dc]">
          <DialogTitle className="font-sans text-xl font-bold uppercase tracking-tight">
            {t('builder.skillsDialog.title')}
          </DialogTitle>
          <DialogDescription className="mt-2 text-xs text-ink-soft">
            {t('builder.skillsDialog.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {loading && (
            <div className="flex items-center justify-center gap-3 py-12 text-sm text-steel-grey">
              <Loader2 className="w-4 h-4 animate-spin" />
              {t('builder.skillsDialog.loading')}
            </div>
          )}

          {!loading && loadError && (
            <div className="py-8 text-center space-y-4">
              <p className="text-sm text-steel-grey">{loadError}</p>
              <Button
                variant="outline"
                size="sm"
                onClick={loadSkills}
                className="rounded-full"
              >
                {t('builder.skillsDialog.retry')}
              </Button>
            </div>
          )}

          {!loading && !loadError && (
            <>
              {available.length === 0 && skills.length > 0 ? (
                <div className="text-center rounded-2xl border border-dashed border-[#e6e3dc] bg-paper-tint py-10 px-6 space-y-3">
                  <p className="text-sm text-steel-grey">
                    {t('builder.skillsDialog.allAdded')}
                  </p>
                  <p className="text-xs text-steel-grey">
                    {t('builder.skillsDialog.allAddedHint')}
                  </p>
                  <Link
                    href="/profile"
                    className="inline-flex items-center justify-center rounded-full border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground"
                  >
                    {t('builder.skillsDialog.goToProfile')}
                  </Link>
                </div>
              ) : skills.length === 0 && !loading ? (
                <div className="text-center rounded-2xl border border-dashed border-[#e6e3dc] bg-paper-tint py-10 px-6 space-y-3">
                  <p className="text-sm text-steel-grey">
                    {t('builder.skillsDialog.noSkills')}
                  </p>
                  <p className="text-xs text-steel-grey">
                    {t('builder.skillsDialog.noSkillsHint')}
                  </p>
                  <Link
                    href="/profile"
                    className="inline-flex items-center justify-center rounded-full border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground"
                  >
                    {t('builder.skillsDialog.goToProfile')}
                  </Link>
                </div>
              ) : (
                <>
                  <div className="flex items-center gap-3">
                    <div className="relative flex-1">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-steel-grey" />
                      <Input
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder={t('builder.skillsDialog.searchPlaceholder')}
                        className="pl-9 border-[#c9c5bc] focus:border-primary rounded-lg"
                      />
                    </div>
                    <div className="flex gap-1 rounded-lg border border-[#e6e3dc] bg-secondary p-0.5">
                      <Button
                        type="button"
                        variant={viewMode === 'grouped' ? 'default' : 'ghost'}
                        size="sm"
                        onClick={() => setViewMode('grouped')}
                        className="rounded-md px-3 h-8 text-xs"
                      >
                        {t('builder.skillsDialog.grouped')}
                      </Button>
                      <Button
                        type="button"
                        variant={viewMode === 'list' ? 'default' : 'ghost'}
                        size="sm"
                        onClick={() => setViewMode('list')}
                        className="rounded-md px-3 h-8 text-xs"
                      >
                        {t('builder.skillsDialog.list')}
                      </Button>
                    </div>
                  </div>

                  {filtered.length === 0 ? (
                    <div className="text-center py-8 text-sm text-steel-grey">
                      {t('builder.skillsDialog.allAdded')}
                    </div>
                  ) : viewMode === 'grouped' ? (
                    <div className="space-y-3 max-h-[350px] overflow-y-auto pr-1">
                      {grouped.map(([category, groupSkills]) => {
                        const allSelected = groupSkills.every((s) => selected.has(s.name));
                        const someSelected = groupSkills.some((s) => selected.has(s.name));
                        const isCollapsed = collapsedGroups.has(category);

                        return (
                          <div
                            key={category}
                            className="rounded-2xl border border-[#e6e3dc] bg-white overflow-hidden"
                          >
                            <div className="flex items-center gap-3 px-4 py-3 bg-secondary/50">
                              <button
                                type="button"
                                onClick={() => toggleGroupCollapse(category)}
                                className="text-steel-grey hover:text-ink transition-colors"
                              >
                                {isCollapsed ? (
                                  <ChevronRight className="w-4 h-4" />
                                ) : (
                                  <ChevronDown className="w-4 h-4" />
                                )}
                              </button>
                              <button
                                type="button"
                                onClick={() => toggleGroup(category)}
                                className="flex items-center gap-2 flex-1 text-left"
                              >
                                <div
                                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors ${
                                    allSelected
                                      ? 'border-primary bg-primary text-white'
                                      : someSelected
                                        ? 'border-primary bg-primary/20 text-primary'
                                        : 'border-[#c9c5bc] bg-white'
                                  }`}
                                >
                                  {allSelected && <Check className="w-3 h-3" />}
                                  {someSelected && !allSelected && (
                                    <div className="h-1.5 w-1.5 rounded-sm bg-primary" />
                                  )}
                                </div>
                                <span className="text-sm font-semibold text-ink">{category}</span>
                                <span className="text-xs text-steel-grey">
                                  ({groupSkills.length})
                                </span>
                              </button>
                            </div>
                            {!isCollapsed && (
                              <div className="flex flex-wrap gap-2 p-4 pt-2">
                                {groupSkills.map((skill) => (
                                  <button
                                    key={skill.skill_id}
                                    type="button"
                                    onClick={() => toggleSkill(skill.name)}
                                    className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-all ${
                                      selected.has(skill.name)
                                        ? 'border-primary bg-primary/10 text-primary'
                                        : 'border-[#e6e3dc] bg-white text-ink hover:border-primary hover:bg-paper-tint'
                                    }`}
                                  >
                                    {selected.has(skill.name) && <Check className="w-3 h-3" />}
                                    {skill.name}
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2 max-h-[350px] overflow-y-auto pr-1">
                      {filtered.map((skill) => (
                        <button
                          key={skill.skill_id}
                          type="button"
                          onClick={() => toggleSkill(skill.name)}
                          className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-all ${
                            selected.has(skill.name)
                              ? 'border-primary bg-primary/10 text-primary'
                              : 'border-[#e6e3dc] bg-white text-ink hover:border-primary hover:bg-paper-tint'
                          }`}
                        >
                          {selected.has(skill.name) && <Check className="w-3 h-3" />}
                          {skill.name}
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>

        <DialogFooter className="flex-row justify-end gap-3 border-t border-[#e6e3dc] bg-secondary p-4">
          <DialogClose asChild>
            <Button variant="outline" className="rounded-full">
              {t('common.cancel')}
            </Button>
          </DialogClose>
          <Button
            onClick={handleAdd}
            disabled={selected.size === 0}
            className="rounded-full"
          >
            <Zap className="w-4 h-4 mr-2" />
            {t('builder.skillsDialog.addSelected', { count: selected.size })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
