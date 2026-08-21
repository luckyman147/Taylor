'use client';

import React from 'react';
import dynamic from 'next/dynamic';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';

// Lazy-load TipTap-based editor — keeps it out of the initial bundle.
const RichTextEditor = dynamic(
  () => import('@/components/ui/rich-text-editor').then((m) => m.RichTextEditor),
  {
    ssr: false,
    loading: () => (
      <div className="min-h-[100px] border border-ink bg-transparent" aria-busy="true" />
    ),
  }
);
import { Project } from '@/components/dashboard/resume-component';
import { AlignLeft, List, Plus, Trash2, Github, Globe } from 'lucide-react';
import { useTranslations } from '@/lib/i18n';
import { alignDescriptionStyles, toggleDescriptionStyle } from '@/lib/utils/description-styles';
import { AddProjectDialog } from '@/components/builder/add-project-dialog';

interface ProjectsFormProps {
  data: Project[];
  onChange: (data: Project[]) => void;
  outputLanguage: string;
}

export const ProjectsForm: React.FC<ProjectsFormProps> = ({
  data,
  onChange,
  outputLanguage,
}) => {
  const { t } = useTranslations();
  const [dialogOpen, setDialogOpen] = React.useState(false);

  const handleAdd = () => {
    const newId = Math.max(...data.map((d) => d.id), 0) + 1;
    onChange([
      ...data,
      {
        id: newId,
        name: '',
        role: '',
        years: '',
        github: '',
        website: '',
        description: [''],
        descriptionStyles: ['bullet'],
      },
    ]);
  };

  const handleAddFromDialog = (entry: Project) => {
    const newId = Math.max(...data.map((d) => d.id), 0) + 1;
    onChange([...data, { ...entry, id: newId }]);
  };

  const handleRemove = (id: number) => {
    onChange(data.filter((item) => item.id !== id));
  };

  const handleChange = (id: number, field: keyof Project, value: string | string[]) => {
    onChange(
      data.map((item) => {
        if (item.id === id) {
          return { ...item, [field]: value };
        }
        return item;
      })
    );
  };

  const handleDescriptionChange = (id: number, index: number, value: string) => {
    onChange(
      data.map((item) => {
        if (item.id === id) {
          const newDesc = [...(item.description || [])];
          newDesc[index] = value;
          return { ...item, description: newDesc };
        }
        return item;
      })
    );
  };

  const handleAddDescription = (id: number) => {
    onChange(
      data.map((item) => {
        if (item.id === id) {
          return {
            ...item,
            description: [...(item.description || []), ''],
            descriptionStyles: [...(item.descriptionStyles || []), 'bullet'],
          };
        }
        return item;
      })
    );
  };

  const handleToggleDescriptionStyle = (id: number, index: number) => {
    onChange(
      data.map((item) => {
        if (item.id === id) {
          return {
            ...item,
            descriptionStyles: toggleDescriptionStyle(
              item.description,
              item.descriptionStyles,
              index
            ),
          };
        }
        return item;
      })
    );
  };

  const handleRemoveDescription = (id: number, index: number) => {
    onChange(
      data.map((item) => {
        if (item.id === id) {
          const newDesc = [...(item.description || [])];
          newDesc.splice(index, 1);
          const newStyles = alignDescriptionStyles(item.description, item.descriptionStyles);
          newStyles.splice(index, 1);
          return { ...item, description: newDesc, descriptionStyles: newStyles };
        }
        return item;
      })
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setDialogOpen(true)}
          className="rounded-lg border-ink hover:bg-primary hover:text-white transition-colors"
        >
          <Plus className="w-4 h-4 mr-2" /> {t('builder.forms.projects.addProject')}
        </Button>
      </div>

      <div className="space-y-8">
        {data.map((item) => (
          <div
            key={item.id}
            className="rounded-2xl border border-[#e6e3dc] bg-white relative group p-6"
          >
            <Button
              variant="ghost"
              size="icon"
              className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity text-destructive hover:text-destructive hover:bg-destructive/10"
              onClick={() => handleRemove(item.id)}
              aria-label={t('a11y.removeItem')}
              title={t('a11y.removeItem')}
            >
              <Trash2 className="w-4 h-4" />
            </Button>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4 pr-8">
              <div className="space-y-2">
                <Label className=" text-xs uppercase tracking-wider text-steel-grey">
                  {t('builder.forms.projects.fields.projectName')}
                </Label>
                <Input
                  value={item.name || ''}
                  onChange={(e) => handleChange(item.id, 'name', e.target.value)}
                  placeholder={t('builder.forms.projects.placeholders.projectName')}
                  className="rounded-lg border-ink bg-white"
                />
              </div>
              <div className="space-y-2">
                <Label className=" text-xs uppercase tracking-wider text-steel-grey">
                  {t('builder.forms.projects.fields.role')}
                </Label>
                <Input
                  value={item.role || ''}
                  onChange={(e) => handleChange(item.id, 'role', e.target.value)}
                  placeholder={t('builder.forms.projects.placeholders.role')}
                  className="rounded-lg border-ink bg-white"
                />
              </div>
              <div className="space-y-2">
                <Label className=" text-xs uppercase tracking-wider text-steel-grey">
                  {t('builder.genericItemForm.fields.years')}{' '}
                  <span className="text-steel-grey">({t('common.optional')})</span>
                </Label>
                <Input
                  value={item.years || ''}
                  onChange={(e) => handleChange(item.id, 'years', e.target.value)}
                  placeholder={t('builder.forms.projects.placeholders.years')}
                  className="rounded-lg border-ink bg-white"
                />
              </div>
              <div className="space-y-2">
                <Label className=" text-xs uppercase tracking-wider text-steel-grey">
                  <Github className="w-3 h-3 inline mr-1" />
                  GitHub <span className="text-steel-grey">({t('common.optional')})</span>
                </Label>
                <Input
                  value={item.github || ''}
                  onChange={(e) => handleChange(item.id, 'github', e.target.value)}
                  placeholder={t('builder.forms.projects.placeholders.github')}
                  className="rounded-lg border-ink bg-white"
                />
              </div>
              <div className="space-y-2 md:col-span-2">
                <Label className=" text-xs uppercase tracking-wider text-steel-grey">
                  <Globe className="w-3 h-3 inline mr-1" />
                  {t('builder.forms.projects.fields.website')}{' '}
                  <span className="text-steel-grey">({t('common.optional')})</span>
                </Label>
                <Input
                  value={item.website || ''}
                  onChange={(e) => handleChange(item.id, 'website', e.target.value)}
                  placeholder={t('builder.forms.projects.placeholders.website')}
                  className="rounded-lg border-ink bg-white"
                />
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <Label className=" text-xs uppercase tracking-wider text-steel-grey">
                  {t('builder.genericItemForm.fields.descriptionPoints')}
                </Label>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleAddDescription(item.id)}
                  className="h-6 text-xs text-primary hover:text-blue-800 hover:bg-primary/5"
                >
                  <Plus className="w-3 h-3 mr-1" /> {t('builder.genericItemForm.actions.addPoint')}
                </Button>
              </div>
              {item.description?.map((desc, idx) => (
                <div key={idx} className="flex gap-2">
                  <div className="flex-1">
                    <RichTextEditor
                      value={desc}
                      onChange={(html) => handleDescriptionChange(item.id, idx, html)}
                      placeholder={t('builder.forms.projects.placeholders.description')}
                      minHeight="60px"
                    />
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleToggleDescriptionStyle(item.id, idx)}
                    className="h-[60px] w-8 text-muted-foreground hover:text-primary self-end"
                    aria-label={t('builder.genericItemForm.actions.togglePointStyle')}
                    title={t('builder.genericItemForm.actions.togglePointStyle')}
                  >
                    {item.descriptionStyles?.[idx] === 'plain' ? (
                      <AlignLeft className="w-3 h-3" />
                    ) : (
                      <List className="w-3 h-3" />
                    )}
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => handleRemoveDescription(item.id, idx)}
                    className="h-[60px] w-8 text-muted-foreground hover:text-destructive self-end"
                    aria-label={t('a11y.removeDescription')}
                    title={t('a11y.removeDescription')}
                  >
                    <Trash2 className="w-3 h-3" />
                  </Button>
                </div>
              ))}
            </div>
          </div>
        ))}

        {data.length === 0 && (
          <div className="text-center rounded-xl py-12 bg-paper-tint border border-dashed border-[#e6e3dc]">
            <p className=" text-sm text-steel-grey mb-4">
              {t('builder.genericItemForm.noEntries', { label: t('resume.sections.projects') })}
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDialogOpen(true)}
              className="rounded-full border-[#e6e3dc]"
            >
              <Plus className="w-4 h-4 mr-2" /> {t('builder.forms.projects.addFirstProject')}
            </Button>
          </div>
        )}
      </div>

      <AddProjectDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onAdd={handleAddFromDialog}
        outputLanguage={outputLanguage}
        existingNames={data.map((d) => d.name || '')}
      />
    </div>
  );
};
