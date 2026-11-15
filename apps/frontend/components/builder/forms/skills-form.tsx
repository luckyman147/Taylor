'use client';

import React, { useState } from 'react';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { TagInput } from '@/components/ui/tag-input';
import { Plus, Trash2, Layers, List, User } from 'lucide-react';
import { AdditionalInfo, SkillGroup } from '@/components/dashboard/resume-component';
import { AddSkillsDialog } from '../add-skills-dialog';
import { DraggableListItem } from '../draggable-list-item';
import { useTranslations } from '@/lib/i18n';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  DragEndEvent,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';

interface SkillsFormProps {
  data: AdditionalInfo;
  onChange: (data: AdditionalInfo) => void;
}

type SkillsMode = 'list' | 'grouped';

export const SkillsForm: React.FC<SkillsFormProps> = ({ data, onChange }) => {
  const { t } = useTranslations();

  const [dialogOpen, setDialogOpen] = useState(false);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const technicalSkills = data.technicalSkills ?? [];
  const skillGroups = data.skillGroups ?? [];

  const handleGroupDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (!over || active.id === over.id) return;

    const oldIndex = Number(active.id);
    const newIndex = Number(over.id);

    if (
      !Number.isInteger(oldIndex) ||
      !Number.isInteger(newIndex) ||
      oldIndex < 0 ||
      newIndex < 0 ||
      oldIndex >= skillGroups.length ||
      newIndex >= skillGroups.length
    ) {
      return;
    }

    const updated = arrayMove(skillGroups, oldIndex, newIndex);
    onChange({
      ...data,
      skillGroups: updated,
      technicalSkills: updated.flatMap((group) => group.skills),
    });
  };

  const mode: SkillsMode = skillGroups.length > 0 ? 'grouped' : 'list';

  const handleModeChange = (newMode: SkillsMode) => {
    if (newMode === mode) return;

    if (newMode === 'list') {
      const allSkills = skillGroups.flatMap((g) => g.skills);
      onChange({
        ...data,
        technicalSkills: allSkills.length > 0 ? allSkills : technicalSkills,
        skillGroups: [],
      });
    } else {
      const flatSkills = technicalSkills.length > 0 ? technicalSkills : [];
      onChange({
        ...data,
        technicalSkills: flatSkills,
        skillGroups: flatSkills.length > 0 ? [{ name: '', skills: flatSkills }] : [],
      });
    }
  };

  const handleListChange = (skills: string[]) => {
    onChange({
      ...data,
      technicalSkills: skills,
      skillGroups: [],
    });
  };

  const handleGroupChange = (index: number, updates: Partial<SkillGroup>) => {
    const updated = skillGroups.map((g, i) => (i === index ? { ...g, ...updates } : g));
    onChange({
      ...data,
      skillGroups: updated,
      technicalSkills: updated.flatMap((g) => g.skills),
    });
  };

  const handleGroupSkillsChange = (index: number, skills: string[]) => {
    handleGroupChange(index, { skills });
  };

  const addGroup = () => {
    onChange({
      ...data,
      skillGroups: [...skillGroups, { name: '', skills: [] }],
    });
  };

  const removeGroup = (index: number) => {
    const updated = skillGroups.filter((_, i) => i !== index);
    onChange({
      ...data,
      skillGroups: updated,
      technicalSkills: updated.flatMap((g) => g.skills),
    });
  };

  const handleAddFromProfile = (newSkills: Array<{ name: string; category: string | null }>) => {
    if (mode === 'list') {
      const existing = new Set(technicalSkills.map((s) => s.toLowerCase()));
      const toAdd = newSkills.filter((s) => !existing.has(s.name.toLowerCase()));
      if (toAdd.length === 0) return;
      onChange({
        ...data,
        technicalSkills: [...technicalSkills, ...toAdd.map((s) => s.name)],
        skillGroups: [],
      });
    } else {
      const allSkills = skillGroups.flatMap((g) => g.skills);
      const existing = new Set(allSkills.map((s) => s.toLowerCase()));
      const toAdd = newSkills.filter((s) => !existing.has(s.name.toLowerCase()));
      if (toAdd.length === 0) return;

      const groupedByCategory = new Map<string, string[]>();
      for (const skill of toAdd) {
        const category = skill.category?.trim() || '';
        if (!groupedByCategory.has(category)) groupedByCategory.set(category, []);
        groupedByCategory.get(category)!.push(skill.name);
      }

      const updatedGroups = [...skillGroups];
      for (const [category, skillNames] of groupedByCategory) {
        const matchIndex = updatedGroups.findIndex(
          (g) => g.name.trim().toLowerCase() === category.toLowerCase()
        );
        if (matchIndex >= 0) {
          updatedGroups[matchIndex] = {
            ...updatedGroups[matchIndex],
            skills: [...updatedGroups[matchIndex].skills, ...skillNames],
          };
        } else {
          updatedGroups.push({ name: category, skills: skillNames });
        }
      }

      onChange({
        ...data,
        technicalSkills: updatedGroups.flatMap((g) => g.skills),
        skillGroups: updatedGroups,
      });
    }
  };

  return (
    <div className="space-y-6">
      <p className=" text-xs uppercase tracking-wider text-primary">
        {t('builder.skillsForm.instructions')}
      </p>

      <div className="flex gap-2">
        <Button
          type="button"
          variant={mode === 'list' ? 'default' : 'outline'}
          size="sm"
          onClick={() => handleModeChange('list')}
          className="rounded-lg"
        >
          <List className="w-4 h-4 mr-2" />
          {t('builder.skillsForm.listMode')}
        </Button>
        <Button
          type="button"
          variant={mode === 'grouped' ? 'default' : 'outline'}
          size="sm"
          onClick={() => handleModeChange('grouped')}
          className="rounded-lg"
        >
          <Layers className="w-4 h-4 mr-2" />
          {t('builder.skillsForm.groupedMode')}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setDialogOpen(true)}
          className="rounded-lg border-ink hover:bg-primary hover:text-white transition-colors"
        >
          <User className="w-4 h-4 mr-2" />
          {t('builder.skillsForm.addFromProfile')}
        </Button>
      </div>

      {mode === 'list' ? (
        <div className="space-y-2">
          <Label className=" text-xs uppercase tracking-wider text-steel-grey">
            {t('resume.additional.technicalSkills')}
          </Label>
          <TagInput
            value={technicalSkills}
            onChange={handleListChange}
            placeholder={t('builder.additionalForm.placeholders.technicalSkills')}
            sortable
            dragLabel={t('builder.sectionOrder.dragToReorder')}
          />
        </div>
      ) : (
        <div className="space-y-4">
          <DndContext
            id="skill-group-items"
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragEnd={handleGroupDragEnd}
          >
            <SortableContext
              items={skillGroups.map((_, groupIndex) => groupIndex)}
              strategy={verticalListSortingStrategy}
            >
              {skillGroups.map((group, index) => (
                <DraggableListItem key={index} id={index}>
                  <div className="rounded-2xl border border-[#e6e3dc] bg-white relative group p-4 space-y-3">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity text-destructive hover:text-destructive hover:bg-destructive/10"
                      onClick={() => removeGroup(index)}
                      aria-label={t('a11y.removeItem')}
                      title={t('a11y.removeItem')}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>

                    <div className="space-y-2 pr-8">
                      <Label className="text-xs uppercase tracking-wider text-steel-grey">
                        {t('builder.skillsForm.groupName')}
                      </Label>
                      <Input
                        value={group.name}
                        onChange={(e) => handleGroupChange(index, { name: e.target.value })}
                        placeholder={t('builder.skillsForm.groupNamePlaceholder')}
                        className="rounded-lg border-ink bg-white"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label className="text-xs uppercase tracking-wider text-steel-grey">
                        {t('resume.additional.technicalSkills')}
                      </Label>
                      <TagInput
                        value={group.skills}
                        onChange={(skills) => handleGroupSkillsChange(index, skills)}
                        placeholder={t('builder.skillsForm.skillPlaceholder')}
                        sortable
                        dragLabel={t('builder.sectionOrder.dragToReorder')}
                      />
                    </div>
                  </div>
                </DraggableListItem>
              ))}
            </SortableContext>
          </DndContext>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={addGroup}
            className="rounded-lg border-ink hover:bg-primary hover:text-white transition-colors"
          >
            <Plus className="w-4 h-4 mr-2" />
            {t('builder.skillsForm.addGroup')}
          </Button>
        </div>
      )}

      <AddSkillsDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onAdd={handleAddFromProfile}
        existingSkills={mode === 'list' ? technicalSkills : skillGroups.flatMap((g) => g.skills)}
      />
    </div>
  );
};
