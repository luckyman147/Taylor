'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { RetroTabs } from '@/components/ui/retro-tabs';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Dropdown, type DropdownOption } from '@/components/ui/dropdown';
import {
  RotateCcw,
  GripVertical,
  Pencil,
  Eye,
  EyeOff,
  Trash2,
  Check,
  X,
  ChevronDown,
  Minus,
  Plus,
  Briefcase,
  GraduationCap,
} from 'lucide-react';
import {
  type TemplateSettings,
  type TemplateType,
  type PageSize,
  type SpacingLevel,
  type HeaderFontFamily,
  type BodyFontFamily,
  type AccentColor,
  type TextAlign,
  type DateRangeFormat,
  type MarginUnit,
  type WorkShowBy,
  type WorkDatesBy,
  type WorkLocationBy,
  type EducationShowBy,
  type EducationLayout,
  type WorkExperienceSettings,
  type EducationSettings,
  type AdvancedSettings,
  type BulletMarker,
  type ListSeparator,
  type TextStyleTarget,
  type TextWeightOption,
  type TextTransformOption,
  DEFAULT_TEMPLATE_SETTINGS,
  applyTemplatePreset,
  SECTION_SPACING_MAP,
  ITEM_SPACING_MAP,
  FONT_SIZE_MAP,
  HEADER_SCALE_MAP,
  COMPACT_MULTIPLIER,
  COMPACT_LINE_HEIGHT_MULTIPLIER,
  TEMPLATE_OPTIONS,
  PAGE_SIZE_INFO,
  ACCENT_COLOR_MAP,
} from '@/lib/types/template-settings';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { TemplateThumbnail } from './template-selector';
import { getSectionIconElement } from './section-header';
import { AddSectionButton } from './add-section-dialog';
import {
  getAllSections,
  reorderSections,
  renameSection,
  toggleSectionVisibility,
  deleteSection,
  addCustomSectionToData,
} from '@/lib/utils/section-helpers';
import type { ResumeData, SectionMeta, SectionType } from '@/components/dashboard/resume-component';
import { useTranslations } from '@/lib/i18n';

interface FormattingControlsProps {
  settings: TemplateSettings;
  onChange: (settings: TemplateSettings) => void;
  resumeData: ResumeData;
  onResumeDataUpdate: (data: ResumeData) => void;
}

type DesignNav = 'presentation' | 'sections' | 'settings' | 'advanced';

const TEXT_STYLE_TARGETS: TextStyleTarget[] = [
  'bodyCopy',
  'primaryHeading',
  'secondaryHeading',
  'sectionTitle',
  'fullName',
  'minorCopy',
];

const TEXT_WEIGHT_OPTIONS: TextWeightOption[] = ['light', 'regular', 'bold', 'extralight'];

const TEXT_TRANSFORM_OPTIONS: TextTransformOption[] = ['uppercase', 'as-written', 'capitalize'];

const BULLET_MARKER_OPTIONS: BulletMarker[] = ['•', '*', '-', '>>', '->'];

const LIST_SEPARATOR_OPTIONS: ListSeparator[] = ['*', '-', ',', '|'];

const VERTICAL_SPACING_KEYS: Array<keyof AdvancedSettings['verticalSpacing']> = [
  'betweenSections',
  'titlesContent',
  'primarySecondaryHeadings',
  'contentBlocks',
  'listItems',
];

const BORDER_KEYS: Array<keyof AdvancedSettings['borders']> = [
  'aboveHeader',
  'belowHeader',
  'sectionTitles',
];

/**
 * Formatting Controls Panel (Design)
 *
 * Organizes resume design controls into four navigations:
 * - Presentation: templates, font/spacing controls, alignments & layouts, page setup
 * - Sections: drag & drop order + rename + visibility management of resume sections
 * - Settings: work experience / education entry field arrangement
 * - Advanced: advanced styles (accent, options) and text sizes
 */
export const FormattingControls: React.FC<FormattingControlsProps> = ({
  settings,
  onChange,
  resumeData,
  onResumeDataUpdate,
}) => {
  const { t } = useTranslations();
  const [activeNav, setActiveNav] = useState<DesignNav>('presentation');
  const compactMultiplier = settings.compactMode ? COMPACT_MULTIPLIER : 1;
  const sectionGapRem =
    parseFloat(SECTION_SPACING_MAP[settings.spacing.section]) * compactMultiplier;
  const itemGapRem = parseFloat(ITEM_SPACING_MAP[settings.spacing.item]) * compactMultiplier;
  const lineHeightFactor = settings.compactMode ? COMPACT_LINE_HEIGHT_MULTIPLIER : 1;
  const lineHeightValue = (settings.lineHeight / 100) * lineHeightFactor;
  const listLineHeightValue = (settings.listLineHeight / 100) * lineHeightFactor;

  const formatRem = (value: number) =>
    `${value.toFixed(2).replace(/\.00$/, '').replace(/0$/, '')}rem`;

  const handleTemplateChange = (template: TemplateType) => {
    onChange(applyTemplatePreset(settings, template));
  };

  const handlePageSizeChange = (pageSize: PageSize) => {
    onChange({ ...settings, pageSize });
  };

  const handleMarginChange = (key: keyof TemplateSettings['margins'], value: number) => {
    onChange({
      ...settings,
      margins: { ...settings.margins, [key]: value },
    });
  };

  const handleMarginUnitChange = (marginUnit: MarginUnit) => {
    onChange({ ...settings, marginUnit });
  };

  const handleLineHeightChange = (lineHeight: number) => {
    onChange({ ...settings, lineHeight });
  };

  const handleListLineHeightChange = (listLineHeight: number) => {
    onChange({ ...settings, listLineHeight });
  };

  const handleDateFormatChange = (dateFormat: DateRangeFormat) => {
    onChange({ ...settings, dateFormat });
  };

  const handleAlignmentChange = (key: keyof TemplateSettings['alignment'], value: TextAlign) => {
    onChange({
      ...settings,
      alignment: { ...settings.alignment, [key]: value },
    });
  };

  const handleWorkSettingsChange = (
    key: keyof WorkExperienceSettings,
    value: WorkShowBy | WorkDatesBy | WorkLocationBy
  ) => {
    onChange({
      ...settings,
      workExperience: { ...settings.workExperience, [key]: value },
    });
  };

  const handleEducationSettingsChange = (
    key: keyof EducationSettings,
    value: EducationShowBy | EducationLayout
  ) => {
    onChange({
      ...settings,
      education: { ...settings.education, [key]: value },
    });
  };

  const handleSpacingChange = (key: keyof TemplateSettings['spacing'], value: SpacingLevel) => {
    onChange({
      ...settings,
      spacing: { ...settings.spacing, [key]: value },
    });
  };

  const handleFontChange = (key: keyof TemplateSettings['fontSize'], value: SpacingLevel) => {
    onChange({
      ...settings,
      fontSize: { ...settings.fontSize, [key]: value },
    });
  };

  const handleHeaderFontChange = (headerFont: HeaderFontFamily) => {
    onChange({
      ...settings,
      fontSize: { ...settings.fontSize, headerFont },
    });
  };

  const handleBodyFontChange = (bodyFont: BodyFontFamily) => {
    onChange({
      ...settings,
      fontSize: { ...settings.fontSize, bodyFont },
    });
  };

  const handleCompactModeToggle = () => {
    onChange({ ...settings, compactMode: !settings.compactMode });
  };

  const handleShowContactIconsToggle = () => {
    onChange({ ...settings, showContactIcons: !settings.showContactIcons });
  };

  const handleBulletMarkerChange = (bulletMarker: BulletMarker) => {
    onChange({ ...settings, advanced: { ...settings.advanced, bulletMarker } });
  };

  const handleListSeparatorChange = (listSeparator: ListSeparator) => {
    onChange({ ...settings, advanced: { ...settings.advanced, listSeparator } });
  };

  const handleTextSizeChange = (target: TextStyleTarget, value: number) => {
    onChange({
      ...settings,
      advanced: {
        ...settings.advanced,
        textSizes: { ...settings.advanced.textSizes, [target]: value },
      },
    });
  };

  const handleTextWeightChange = (target: TextStyleTarget, value: TextWeightOption) => {
    onChange({
      ...settings,
      advanced: {
        ...settings.advanced,
        textWeights: { ...settings.advanced.textWeights, [target]: value },
      },
    });
  };

  const handleTextTransformChange = (target: TextStyleTarget, value: TextTransformOption) => {
    onChange({
      ...settings,
      advanced: {
        ...settings.advanced,
        textTransforms: { ...settings.advanced.textTransforms, [target]: value },
      },
    });
  };

  const handleVspaceChange = (key: keyof AdvancedSettings['verticalSpacing'], value: number) => {
    onChange({
      ...settings,
      advanced: {
        ...settings.advanced,
        verticalSpacing: { ...settings.advanced.verticalSpacing, [key]: value },
      },
    });
  };

  const handleBorderToggle = (key: keyof AdvancedSettings['borders']) => {
    onChange({
      ...settings,
      advanced: {
        ...settings.advanced,
        borders: {
          ...settings.advanced.borders,
          [key]: {
            ...settings.advanced.borders[key],
            enabled: !settings.advanced.borders[key].enabled,
          },
        },
      },
    });
  };

  const handleBorderThicknessChange = (key: keyof AdvancedSettings['borders'], value: number) => {
    onChange({
      ...settings,
      advanced: {
        ...settings.advanced,
        borders: {
          ...settings.advanced.borders,
          [key]: { ...settings.advanced.borders[key], thickness: value },
        },
      },
    });
  };

  const handleAccentColorChange = (accentColor: AccentColor) => {
    onChange({ ...settings, accentColor, customAccentColor: null });
  };

  const handleCustomAccentChange = (hex: string) => {
    onChange({ ...settings, customAccentColor: hex || null });
  };

  const handleReset = () => {
    onChange(DEFAULT_TEMPLATE_SETTINGS);
  };

  const templateLabels = React.useMemo(
    () => ({
      'swiss-single': {
        name: t('builder.formatting.templates.swissSingle.name'),
        description: t('builder.formatting.templates.swissSingle.description'),
      },
      'swiss-two-column': {
        name: t('builder.formatting.templates.swissTwoColumn.name'),
        description: t('builder.formatting.templates.swissTwoColumn.description'),
      },
      modern: {
        name: t('builder.formatting.templates.modern.name'),
        description: t('builder.formatting.templates.modern.description'),
      },
      'modern-two-column': {
        name: t('builder.formatting.templates.modernTwoColumn.name'),
        description: t('builder.formatting.templates.modernTwoColumn.description'),
      },
      latex: {
        name: t('builder.formatting.templates.latex.name'),
        description: t('builder.formatting.templates.latex.description'),
      },
      clean: {
        name: t('builder.formatting.templates.clean.name'),
        description: t('builder.formatting.templates.clean.description'),
      },
      vivid: {
        name: t('builder.formatting.templates.vivid.name'),
        description: t('builder.formatting.templates.vivid.description'),
      },
    }),
    [t]
  );

  const getFontLabel = (font: HeaderFontFamily | BodyFontFamily) => {
    if (font === 'sans-serif') return t('builder.formatting.fontNames.sans');
    if (font === 'serif') return t('builder.formatting.fontNames.serif');
    if (font === 'times-roman') return t('builder.formatting.fontNames.timesRoman');
    return t('builder.formatting.fontNames.mono');
  };

  const fontOptions: DropdownOption[] = (
    ['serif', 'sans-serif', 'mono', 'times-roman'] as HeaderFontFamily[]
  ).map((font) => ({ id: font, label: getFontLabel(font) }));

  const dateFormatOptions: DropdownOption[] = (
    ['short', 'long', 'mmmyyyy', 'years'] as DateRangeFormat[]
  ).map((format) => ({ id: format, label: t(`builder.formatting.dateFormats.${format}`) }));

  const workShowByPreviewOptions: PreviewOption[] = [
    {
      id: 'company',
      label: t('builder.formatting.workShowByOptions.company'),
      preview: (
        <MiniEntry>
          <MiniRow bold>Company</MiniRow>
          <MiniRow muted>Position</MiniRow>
        </MiniEntry>
      ),
    },
    {
      id: 'position',
      label: t('builder.formatting.workShowByOptions.position'),
      preview: (
        <MiniEntry>
          <MiniRow bold>Position</MiniRow>
          <MiniRow muted>Company</MiniRow>
        </MiniEntry>
      ),
    },
  ];

  const workDatesByPreviewOptions: PreviewOption[] = [
    {
      id: 'company',
      label: t('builder.formatting.workDatesByOptions.company'),
      preview: (
        <MiniEntry>
          <MiniRow bold right={t('builder.previewSelectors.metaSample')}>
            Position
          </MiniRow>
          <MiniRow muted>Company</MiniRow>
        </MiniEntry>
      ),
    },
    {
      id: 'position',
      label: t('builder.formatting.workDatesByOptions.position'),
      preview: (
        <MiniEntry>
          <MiniRow bold>Position</MiniRow>
          <MiniRow muted right={t('builder.previewSelectors.metaSample')}>
            Company
          </MiniRow>
        </MiniEntry>
      ),
    },
    {
      id: 'both',
      label: t('builder.formatting.workDatesByOptions.both'),
      preview: (
        <MiniEntry>
          <MiniRow bold right={t('builder.previewSelectors.metaSample')}>
            Position
          </MiniRow>
          <MiniRow muted right={t('builder.previewSelectors.metaSample')}>
            Company
          </MiniRow>
        </MiniEntry>
      ),
    },
  ];

  const workLocationByPreviewOptions: PreviewOption[] = [
    {
      id: 'company',
      label: t('builder.formatting.workLocationByOptions.company'),
      preview: (
        <MiniEntry>
          <MiniRow bold>Position</MiniRow>
          <MiniRow muted right={t('builder.previewSelectors.locationSample')}>
            Company
          </MiniRow>
        </MiniEntry>
      ),
    },
    {
      id: 'position',
      label: t('builder.formatting.workLocationByOptions.position'),
      preview: (
        <MiniEntry>
          <MiniRow bold right={t('builder.previewSelectors.locationSample')}>
            Position
          </MiniRow>
          <MiniRow muted>Company</MiniRow>
        </MiniEntry>
      ),
    },
    {
      id: 'none',
      label: t('builder.formatting.workLocationByOptions.none'),
      preview: (
        <MiniEntry>
          <MiniRow bold>Position</MiniRow>
          <MiniRow muted>Company</MiniRow>
        </MiniEntry>
      ),
    },
  ];

  const educationShowByPreviewOptions: PreviewOption[] = [
    {
      id: 'degree',
      label: t('builder.formatting.educationShowByOptions.degree'),
      preview: (
        <MiniEntry>
          <MiniRow bold>Degree</MiniRow>
          <MiniRow muted>Institution</MiniRow>
        </MiniEntry>
      ),
    },
    {
      id: 'institution',
      label: t('builder.formatting.educationShowByOptions.institution'),
      preview: (
        <MiniEntry>
          <MiniRow bold>Institution</MiniRow>
          <MiniRow muted>Degree</MiniRow>
        </MiniEntry>
      ),
    },
  ];

  const educationLayoutPreviewOptions: PreviewOption[] = [
    {
      id: 'stacked',
      label: t('builder.formatting.educationLayoutOptions.stacked'),
      preview: (
        <MiniEntry>
          <MiniRow bold>Degree</MiniRow>
          <MiniRow muted>Institution</MiniRow>
        </MiniEntry>
      ),
    },
    {
      id: 'inline',
      label: t('builder.formatting.educationLayoutOptions.inline'),
      preview: (
        <MiniEntry>
          <MiniRow bold stackedSuffix="Institution">
            Degree
          </MiniRow>
        </MiniEntry>
      ),
    },
  ];

  const marginOptions: DropdownOption[] = [
    { id: 'mm', label: t('builder.formatting.marginUnits.mm') },
    { id: 'percent', label: t('builder.formatting.marginUnits.percent') },
  ];

  const isAccentTemplate =
    settings.template === 'modern' ||
    settings.template === 'modern-two-column' ||
    settings.template === 'vivid' ||
    settings.template === 'latex';

  const allSections = getAllSections(resumeData);

  const handleSectionMetaUpdate = (sections: SectionMeta[]) => {
    onResumeDataUpdate({ ...resumeData, sectionMeta: sections });
  };

  const handleAddSection = (displayName: string, sectionType: SectionType) => {
    onResumeDataUpdate(addCustomSectionToData(resumeData, displayName, sectionType));
  };

  return (
    <div className="overflow-hidden rounded-2xl border border-[#e6e3dc] bg-white shadow-sw-xs">
      {/* Design Navs */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#e6e3dc] bg-white p-3">
        <RetroTabs
          activeTab={activeNav}
          onTabChange={(id) => setActiveNav(id as DesignNav)}
          tabs={[
            { id: 'presentation', label: t('builder.designTabs.presentation') },
            { id: 'sections', label: t('builder.designTabs.sections') },
            { id: 'settings', label: t('builder.designTabs.settings') },
            { id: 'advanced', label: t('builder.designTabs.advanced') },
          ]}
          className="w-full md:w-auto"
        />
      </div>

      <div className="space-y-6 p-4 md:p-5">
        {/* ============ PRESENTATION ============ */}
        {activeNav === 'presentation' && (
          <>
            {/* Templates */}
            <CollapsibleGroup title={t('builder.formatting.template')}>
              <div className="flex flex-wrap gap-3">
                {TEMPLATE_OPTIONS.map((template) => (
                  <button
                    key={template.id}
                    onClick={() => handleTemplateChange(template.id)}
                    className={`group flex flex-col items-center rounded-xl border p-2 transition-all ${
                      settings.template === template.id
                        ? 'border-primary bg-primary/5 shadow-sw-xs ring-2 ring-primary ring-offset-1'
                        : 'border-[#e6e3dc] bg-white hover:border-primary hover:bg-paper-tint'
                    }`}
                    title={templateLabels[template.id].description}
                  >
                    <div className="w-12 h-16 mb-1.5 flex items-center justify-center">
                      <TemplateThumbnail
                        type={template.id}
                        isActive={settings.template === template.id}
                      />
                    </div>
                    <span
                      className={` text-[9px] uppercase tracking-wider font-bold ${
                        settings.template === template.id ? 'text-primary' : 'text-ink-soft'
                      }`}
                    >
                      {templateLabels[template.id].name}
                    </span>
                  </button>
                ))}
              </div>
            </CollapsibleGroup>

            {/* Styling */}
            <CollapsibleGroup title={t('builder.designGroups.styling')}>
              <CollapsibleGroup variant="subheading" title={t('builder.formatting.typography')}>
                <div className="space-y-3">
                  <Dropdown
                    options={fontOptions}
                    value={settings.fontSize.headerFont}
                    onChange={(v) => handleHeaderFontChange(v as HeaderFontFamily)}
                    label={t('builder.formatting.headerFontFamily')}
                  />
                  <Dropdown
                    options={fontOptions}
                    value={settings.fontSize.bodyFont}
                    onChange={(v) => handleBodyFontChange(v as BodyFontFamily)}
                    label={t('builder.formatting.bodyFontFamily')}
                  />
                  <Dropdown
                    options={dateFormatOptions}
                    value={settings.dateFormat}
                    onChange={(v) => handleDateFormatChange(v as DateRangeFormat)}
                    label={t('builder.formatting.dateFormat')}
                  />
                </div>
              </CollapsibleGroup>

              <CollapsibleGroup
                variant="subheading"
                title={t('builder.designGroups.heightsPaddings')}
              >
                <div className="space-y-3">
                  <PercentSlider
                    label={t('builder.formatting.lineHeight')}
                    value={settings.lineHeight}
                    onChange={handleLineHeightChange}
                  />
                  <PercentSlider
                    label={t('builder.formatting.listLineHeight')}
                    value={settings.listLineHeight}
                    onChange={handleListLineHeightChange}
                  />
                </div>
              </CollapsibleGroup>

              {isAccentTemplate && (
                <CollapsibleGroup variant="subheading" title={t('builder.formatting.accentColor')}>
                  <div className="flex flex-wrap gap-2">
                    {(Object.keys(ACCENT_COLOR_MAP) as AccentColor[]).map((color) => (
                      <button
                        key={color}
                        onClick={() => handleAccentColorChange(color)}
                        className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs transition-all ${
                          settings.accentColor === color && !settings.customAccentColor
                            ? 'border-primary bg-primary/5 shadow-sw-xs ring-1 ring-primary'
                            : 'border-[#e6e3dc] bg-white hover:bg-paper-tint'
                        }`}
                        title={t(`builder.formatting.accentColors.${color}`)}
                      >
                        <span
                          className="h-4 w-4 rounded-full border border-steel-grey"
                          style={{ backgroundColor: ACCENT_COLOR_MAP[color].primary }}
                        />
                        <span>{t(`builder.formatting.accentColors.${color}`)}</span>
                      </button>
                    ))}
                    <label
                      className={`flex items-center gap-2 rounded-xl border px-3 py-2 text-xs transition-all ${
                        settings.customAccentColor
                          ? 'border-primary bg-primary/5 shadow-sw-xs ring-1 ring-primary'
                          : 'border-[#e6e3dc] bg-white hover:bg-paper-tint'
                      }`}
                    >
                      <input
                        type="color"
                        value={settings.customAccentColor || '#1D4ED8'}
                        onChange={(e) => handleCustomAccentChange(e.target.value)}
                        className="h-5 w-5 cursor-pointer rounded border-0 bg-transparent p-0"
                      />
                      <span>{t('builder.formatting.accentColors.custom')}</span>
                    </label>
                  </div>
                </CollapsibleGroup>
              )}
            </CollapsibleGroup>

            {/* Alignments & Layouts */}
            <CollapsibleGroup title={t('builder.designGroups.alignmentsLayouts')}>
              <div className="space-y-3">
                <AlignmentSelector
                  label={t('builder.formatting.headerAlignment')}
                  value={settings.alignment.header}
                  onChange={(v) => handleAlignmentChange('header', v)}
                />
                <AlignmentSelector
                  label={t('builder.formatting.dateAlignment')}
                  value={settings.alignment.date}
                  onChange={(v) => handleAlignmentChange('date', v)}
                />
                <AlignmentSelector
                  label={t('builder.formatting.locationAlignment')}
                  value={settings.alignment.location}
                  onChange={(v) => handleAlignmentChange('location', v)}
                />
              </div>
            </CollapsibleGroup>

            {/* Page Setup */}
            <CollapsibleGroup title={t('builder.designGroups.pageSetup')}>
              <div className="flex gap-2 mb-4">
                {(Object.keys(PAGE_SIZE_INFO) as PageSize[]).map((size) => (
                  <button
                    key={size}
                    onClick={() => handlePageSizeChange(size)}
                    className={`flex-1 rounded-xl border px-3 py-2 text-xs transition-all ${
                      settings.pageSize === size
                        ? 'border-primary bg-primary/5 text-primary shadow-sw-xs ring-1 ring-primary'
                        : 'border-[#e6e3dc] bg-white text-ink-soft hover:bg-paper-tint hover:border-primary'
                    }`}
                    title={PAGE_SIZE_INFO[size].dimensions}
                  >
                    <div className="font-bold">
                      {size === 'A4' ? 'A4' : t('builder.pageSize.usLetter')}
                    </div>
                    <div className="text-[9px] opacity-70">{PAGE_SIZE_INFO[size].dimensions}</div>
                  </button>
                ))}
              </div>

              <div className="mb-4">
                <Dropdown
                  options={marginOptions}
                  value={settings.marginUnit}
                  onChange={(v) => handleMarginUnitChange(v as MarginUnit)}
                  label={t('builder.formatting.marginUnit')}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <MarginSlider
                  label={t('builder.formatting.margin.top')}
                  value={settings.margins.top}
                  onChange={(v) => handleMarginChange('top', v)}
                  unit={settings.marginUnit}
                />
                <MarginSlider
                  label={t('builder.formatting.margin.bottom')}
                  value={settings.margins.bottom}
                  onChange={(v) => handleMarginChange('bottom', v)}
                  unit={settings.marginUnit}
                />
                <MarginSlider
                  label={t('builder.formatting.margin.left')}
                  value={settings.margins.left}
                  onChange={(v) => handleMarginChange('left', v)}
                  unit={settings.marginUnit}
                />
                <MarginSlider
                  label={t('builder.formatting.margin.right')}
                  value={settings.margins.right}
                  onChange={(v) => handleMarginChange('right', v)}
                  unit={settings.marginUnit}
                />
              </div>
            </CollapsibleGroup>

            {/* Controls: Heights & Paddings */}
            <CollapsibleGroup title={t('builder.designGroups.controls')}>
              <div className="space-y-3">
                <SpacingStepper
                  label={t('builder.formatting.spacingSection')}
                  value={settings.spacing.section}
                  onChange={(v) => handleSpacingChange('section', v)}
                />
                <SpacingStepper
                  label={t('builder.formatting.spacingItems')}
                  value={settings.spacing.item}
                  onChange={(v) => handleSpacingChange('item', v)}
                />
                <SpacingStepper
                  label={t('builder.formatting.padding')}
                  value={settings.spacing.padding}
                  onChange={(v) => handleSpacingChange('padding', v)}
                />
              </div>
            </CollapsibleGroup>
          </>
        )}

        {/* ============ SECTIONS ============ */}
        {activeNav === 'sections' && (
          <SectionOrderList
            sections={allSections}
            onReorder={(ids) => handleSectionMetaUpdate(reorderSections(allSections, ids))}
            onRename={(id, name) => handleSectionMetaUpdate(renameSection(allSections, id, name))}
            onToggleVisibility={(id) =>
              handleSectionMetaUpdate(toggleSectionVisibility(allSections, id))
            }
            onDelete={(id) => {
              const { sectionMeta, customSections } = deleteSection(resumeData, id);
              onResumeDataUpdate({ ...resumeData, sectionMeta, customSections });
            }}
            onAdd={handleAddSection}
          />
        )}

        {/* ============ SETTINGS ============ */}
        {activeNav === 'settings' && (
          <>
            <CollapsibleGroup
              icon={Briefcase}
              title={t('builder.designGroups.workExperienceSettings')}
            >
              <div className="space-y-3">
                <PreviewSelector
                  label={t('builder.formatting.workLocationBy')}
                  value={settings.workExperience.locationBy}
                  options={workLocationByPreviewOptions}
                  onChange={(v) => handleWorkSettingsChange('locationBy', v as WorkLocationBy)}
                />
                <PreviewSelector
                  label={t('builder.formatting.workShowBy')}
                  value={settings.workExperience.showBy}
                  options={workShowByPreviewOptions}
                  onChange={(v) => handleWorkSettingsChange('showBy', v as WorkShowBy)}
                />
                <PreviewSelector
                  label={t('builder.formatting.workDatesBy')}
                  value={settings.workExperience.datesBy}
                  options={workDatesByPreviewOptions}
                  onChange={(v) => handleWorkSettingsChange('datesBy', v as WorkDatesBy)}
                />
              </div>
            </CollapsibleGroup>

            <CollapsibleGroup
              icon={GraduationCap}
              title={t('builder.designGroups.educationSettings')}
            >
              <div className="space-y-3">
                <PreviewSelector
                  label={t('builder.formatting.educationShowBy')}
                  value={settings.education.showBy}
                  options={educationShowByPreviewOptions}
                  onChange={(v) => handleEducationSettingsChange('showBy', v as EducationShowBy)}
                />
                <PreviewSelector
                  label={t('builder.formatting.educationLayout')}
                  value={settings.education.layout}
                  options={educationLayoutPreviewOptions}
                  onChange={(v) => handleEducationSettingsChange('layout', v as EducationLayout)}
                />
              </div>
            </CollapsibleGroup>
          </>
        )}

        {/* ============ ADVANCED ============ */}
        {activeNav === 'advanced' && (
          <>
            {/* Advanced Styles */}
            <CollapsibleGroup title={t('builder.designGroups.advancedStyles')}>
              <CollapsibleGroup variant="subheading" title={t('builder.formatting.bulletMarker')}>
                <GlyphPicker
                  options={BULLET_MARKER_OPTIONS}
                  value={settings.advanced.bulletMarker}
                  onChange={(v) => handleBulletMarkerChange(v as BulletMarker)}
                  glyphLabel={(m) => (m === '•' ? '•' : t(`builder.formatting.markerOptions.${m}`))}
                />
              </CollapsibleGroup>
              <CollapsibleGroup variant="subheading" title={t('builder.formatting.listSeparator')}>
                <GlyphPicker
                  options={LIST_SEPARATOR_OPTIONS}
                  value={settings.advanced.listSeparator}
                  onChange={(v) => handleListSeparatorChange(v as ListSeparator)}
                  glyphLabel={(s) => t(`builder.formatting.separatorOptions.${s}`)}
                />
              </CollapsibleGroup>
              <CollapsibleGroup variant="subheading" title={t('builder.formatting.options')}>
                <div className="space-y-3">
                  <SwitchRow
                    checked={settings.compactMode}
                    onChange={handleCompactModeToggle}
                    label={t('builder.formatting.compactMode')}
                  />
                  <SwitchRow
                    checked={settings.showContactIcons}
                    onChange={handleShowContactIconsToggle}
                    label={t('builder.formatting.contactIcons')}
                  />
                </div>
              </CollapsibleGroup>
            </CollapsibleGroup>

            {/* Text Sizes */}
            <CollapsibleGroup title={t('builder.designGroups.textSizes')}>
              <div className="space-y-3">
                <SpacingSelector
                  label={t('builder.formatting.baseFontSize')}
                  value={settings.fontSize.base}
                  onChange={(v) => handleFontChange('base', v)}
                />
                <SpacingSelector
                  label={t('builder.formatting.headerScale')}
                  value={settings.fontSize.headerScale}
                  onChange={(v) => handleFontChange('headerScale', v)}
                />
              </div>

              <div className="mt-4 space-y-1">
                {TEXT_STYLE_TARGETS.map((target) => (
                  <PtStepper
                    key={target}
                    label={t(`builder.formatting.elementNames.${target}`)}
                    value={settings.advanced.textSizes[target]}
                    min={6}
                    max={40}
                    step={0.5}
                    unit={t('builder.formatting.ptUnit')}
                    onChange={(v) => handleTextSizeChange(target, v)}
                  />
                ))}
              </div>

              <div className="mt-4 rounded-xl bg-paper-tint p-3 space-y-1">
                <h4 className=" text-[10px] font-bold uppercase tracking-wider text-ink-soft mb-2">
                  {t('builder.formatting.effectiveOutput')}
                </h4>
                <div className=" text-[10px] text-ink-soft space-y-1">
                  <div title={t('builder.formatting.margins')}>
                    {t('builder.formatting.effectiveMargins', {
                      top: settings.margins.top,
                      bottom: settings.margins.bottom,
                      left: settings.margins.left,
                      right: settings.margins.right,
                    })}
                  </div>
                  <div>
                    {t('builder.formatting.effectiveSectionGap')}: {formatRem(sectionGapRem)}
                  </div>
                  <div>
                    {t('builder.formatting.effectiveItemGap')}: {formatRem(itemGapRem)}
                  </div>
                  <div>
                    {t('builder.formatting.effectiveLineHeight')}: {lineHeightValue.toFixed(2)}
                  </div>
                  <div>
                    {t('builder.formatting.effectiveListLineHeight')}:{' '}
                    {listLineHeightValue.toFixed(2)}
                  </div>
                  <div>
                    {t('builder.formatting.effectiveBaseFont')}:{' '}
                    {FONT_SIZE_MAP[settings.fontSize.base]}
                  </div>
                  <div>
                    {t('builder.formatting.effectiveHeaderScale')}:{' '}
                    {HEADER_SCALE_MAP[settings.fontSize.headerScale]}x
                  </div>
                  <div>
                    {t('builder.formatting.effectiveHeaderFont')}:{' '}
                    {getFontLabel(settings.fontSize.headerFont)}
                  </div>
                  <div>
                    {t('builder.formatting.effectiveBodyFont')}:{' '}
                    {getFontLabel(settings.fontSize.bodyFont)}
                  </div>
                </div>
                {settings.compactMode && (
                  <div className=" text-[10px] text-steel-grey mt-2">
                    {t('builder.formatting.compactHint')}
                  </div>
                )}
              </div>

              <Button variant="outline" size="sm" onClick={handleReset} className="w-full mt-3">
                <RotateCcw className="w-3 h-3" />
                {t('builder.formatting.resetDefaults')}
              </Button>
            </CollapsibleGroup>

            {/* Text Weights */}
            <CollapsibleGroup title={t('builder.designGroups.textWeights')}>
              <div className="space-y-3">
                {TEXT_STYLE_TARGETS.map((target) => (
                  <OptionSelect
                    key={target}
                    label={t(`builder.formatting.elementNames.${target}`)}
                    value={settings.advanced.textWeights[target]}
                    options={TEXT_WEIGHT_OPTIONS}
                    optionLabel={(w) => t(`builder.formatting.weightOptions.${w}`)}
                    onChange={(v) => handleTextWeightChange(target, v as TextWeightOption)}
                  />
                ))}
              </div>
            </CollapsibleGroup>

            {/* Text Transformations */}
            <CollapsibleGroup title={t('builder.designGroups.textTransformations')}>
              <div className="space-y-3">
                {TEXT_STYLE_TARGETS.map((target) => (
                  <OptionSelect
                    key={target}
                    label={t(`builder.formatting.elementNames.${target}`)}
                    value={settings.advanced.textTransforms[target]}
                    options={TEXT_TRANSFORM_OPTIONS}
                    optionLabel={(tr) => t(`builder.formatting.transformOptions.${tr}`)}
                    onChange={(v) => handleTextTransformChange(target, v as TextTransformOption)}
                  />
                ))}
              </div>
            </CollapsibleGroup>

            {/* Vertical Spacing */}
            <CollapsibleGroup title={t('builder.designGroups.verticalSpacing')}>
              <div className="space-y-3">
                {VERTICAL_SPACING_KEYS.map((key) => (
                  <PtStepper
                    key={key}
                    label={t(`builder.formatting.spacingRows.${key}`)}
                    value={settings.advanced.verticalSpacing[key]}
                    min={0}
                    max={40}
                    step={0.5}
                    onChange={(v) => handleVspaceChange(key, v)}
                  />
                ))}
              </div>
            </CollapsibleGroup>

            {/* Borders */}
            <CollapsibleGroup title={t('builder.designGroups.borders')}>
              <div className="space-y-3">
                {BORDER_KEYS.map((key) => {
                  const border = settings.advanced.borders[key];
                  return (
                    <div
                      key={key}
                      className="flex items-center justify-between gap-2 rounded-xl border border-[#e6e3dc] bg-white p-2"
                    >
                      <span className="text-xs text-ink-soft">
                        {t(`builder.formatting.borderRows.${key}`)}
                      </span>
                      <div className="flex items-center gap-3">
                        <PtStepper
                          value={border.thickness}
                          min={0}
                          max={10}
                          step={0.5}
                          disabled={!border.enabled}
                          onChange={(v) => handleBorderThicknessChange(key, v)}
                        />
                        <SwitchRow
                          checked={border.enabled}
                          onChange={() => handleBorderToggle(key)}
                          label={t('builder.formatting.borderEnabled')}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </CollapsibleGroup>
          </>
        )}
      </div>
    </div>
  );
};

/**
 * Glyph picker: segmented buttons that preview the actual marker/separator
 * character (rendered in a mono font so `>>`, `->` and `•` read clearly).
 */
interface GlyphPickerProps {
  options: string[];
  value: string;
  onChange: (value: string) => void;
  glyphLabel?: (option: string) => string;
}

const GlyphPicker: React.FC<GlyphPickerProps> = ({ options, value, onChange, glyphLabel }) => (
  <div className="flex gap-1.5">
    {options.map((option) => (
      <button
        key={option}
        type="button"
        onClick={() => onChange(option)}
        aria-pressed={value === option}
        title={glyphLabel?.(option)}
        className={`flex h-9 flex-1 items-center justify-center rounded-xl border font-mono text-xs transition-all ${
          value === option
            ? 'border-primary bg-primary/5 shadow-sw-xs ring-1 ring-primary text-primary'
            : 'border-[#e6e3dc] bg-white text-ink-soft hover:border-primary hover:bg-paper-tint'
        }`}
      >
        {option}
      </button>
    ))}
  </div>
);

/**
 * Option select: label + segmented option buttons (used for text weights and
 * text transformations).
 */
interface OptionSelectProps {
  label: string;
  value: string;
  options: string[];
  optionLabel: (option: string) => string;
  onChange: (value: string) => void;
}

const OptionSelect: React.FC<OptionSelectProps> = ({
  label,
  value,
  options,
  optionLabel,
  onChange,
}) => (
  <div>
    <div className="mb-1.5 text-xs font-semibold text-ink-soft">{label}</div>
    <div className="flex flex-wrap gap-1.5">
      {options.map((option) => (
        <button
          key={option}
          type="button"
          onClick={() => onChange(option)}
          aria-pressed={value === option}
          className={`flex-1 rounded-lg border px-2 py-1.5 text-[11px] transition-all ${
            value === option
              ? 'border-primary bg-primary/5 shadow-sw-xs ring-1 ring-primary text-primary'
              : 'border-[#e6e3dc] bg-white text-ink-soft hover:border-primary hover:bg-paper-tint'
          }`}
        >
          {optionLabel(option)}
        </button>
      ))}
    </div>
  </div>
);

/**
 * Point (pt) stepper: minus/plus buttons + number input, supports fractional
 * steps (0.5) and an optional label. The disabled state is used by border
 * thickness rows when the border is toggled off.
 */
interface PtStepperProps {
  label?: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  unit?: string;
}

const PtStepper: React.FC<PtStepperProps> = ({
  label,
  value,
  onChange,
  min = 0,
  max = 40,
  step = 0.5,
  disabled = false,
  unit = 'pt',
}) => {
  const clamp = (n: number) => Math.min(max, Math.max(min, n));
  const roundStep = (n: number) => Math.round(n / step) * step;
  const changeButton =
    'flex h-8 w-8 items-center justify-center rounded-lg border border-[#e6e3dc] bg-white text-ink-soft transition-all hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-40';
  const inputClass =
    'h-8 w-14 rounded-lg border border-[#e6e3dc] bg-white text-center text-sm font-semibold text-ink outline-none transition-colors focus:border-primary disabled:bg-paper-tint disabled:opacity-60 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none';

  return (
    <div className="flex items-center gap-2">
      {label && <span className="flex-1 text-xs text-ink-soft">{label}</span>}
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onChange(roundStep(clamp(value - step)))}
          disabled={disabled || value <= min}
          className={changeButton}
          aria-label={label ? `${label} -` : '-'}
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={value}
          disabled={disabled}
          onChange={(e) => {
            const parsed = parseFloat(e.target.value);
            if (!Number.isNaN(parsed)) {
              onChange(roundStep(clamp(parsed)));
            }
          }}
          className={inputClass}
          aria-label={label}
        />
        <button
          type="button"
          onClick={() => onChange(roundStep(clamp(value + step)))}
          disabled={disabled || value >= max}
          className={changeButton}
          aria-label={label ? `${label} +` : '+'}
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
        <span className="w-5 text-left text-[10px] text-steel-grey">{unit}</span>
      </div>
    </div>
  );
};

/**
 * Collapsible group: clicking the title hides/shows its content.
 * The whole heading row is a button — full name + chevron — so it is
 * obvious that clicking anywhere on it toggles the section.
 * - variant "group": primary section heading (accent square + title + chevron)
 * - variant "subheading": secondary heading inside a group
 */
interface CollapsibleGroupProps {
  title: React.ReactNode;
  variant?: 'group' | 'subheading';
  icon?: React.ComponentType<{ className?: string }>;
  defaultOpen?: boolean;
  children: React.ReactNode;
}

const CollapsibleGroup: React.FC<CollapsibleGroupProps> = ({
  title,
  variant = 'group',
  icon: Icon,
  defaultOpen = true,
  children,
}) => {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const buttonClass =
    variant === 'group'
      ? 'mb-3 flex w-full items-center gap-2 rounded-xl border border-[#e6e3dc] bg-paper-tint/60 px-3 py-2 text-xs font-bold uppercase tracking-wider text-ink transition-all hover:border-[#c9c5bc] hover:bg-paper-tint'
      : 'mb-2 mt-5 flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-bold uppercase tracking-wider text-ink-soft transition-colors hover:bg-paper-tint';
  return (
    <div>
      <button
        type="button"
        onClick={() => setIsOpen((open) => !open)}
        aria-expanded={isOpen}
        className={buttonClass}
      >
        {Icon && (
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Icon className="h-3 w-3" />
          </span>
        )}
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-steel-grey transition-transform ${
            isOpen ? '' : '-rotate-90'
          }`}
        />
        <span className="flex-1 text-left">{title}</span>
      </button>
      {isOpen && <div>{children}</div>}
    </div>
  );
};

/**
 * Section order list with drag & drop, rename, visibility and delete.
 */
interface SectionOrderListProps {
  sections: SectionMeta[];
  onReorder: (orderedIds: string[]) => void;
  onRename: (sectionId: string, newName: string) => void;
  onToggleVisibility: (sectionId: string) => void;
  onDelete: (sectionId: string) => void;
  onAdd: (displayName: string, sectionType: SectionType) => void;
}

const SectionOrderList: React.FC<SectionOrderListProps> = ({
  sections,
  onReorder,
  onRename,
  onToggleVisibility,
  onDelete,
  onAdd,
}) => {
  const { t } = useTranslations();
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const ids = sections.map((s) => s.id);
    const oldIndex = ids.indexOf(String(active.id));
    const newIndex = ids.indexOf(String(over.id));
    if (oldIndex === -1 || newIndex === -1) return;

    const reordered = [...ids];
    reordered.splice(oldIndex, 1);
    reordered.splice(newIndex, 0, String(active.id));
    onReorder(reordered);
  };

  return (
    <div>
      <p className="mb-3 text-xs leading-relaxed text-steel-grey">
        {t('builder.sectionOrder.hint')}
      </p>
      <DndContext
        id="design-sections"
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={sections.map((s) => s.id)} strategy={verticalListSortingStrategy}>
          <div className="space-y-2">
            {sections.map((section) => (
              <SortableSectionRow
                key={section.id}
                section={section}
                onRename={(name) => onRename(section.id, name)}
                onToggleVisibility={() => onToggleVisibility(section.id)}
                onDelete={() => onDelete(section.id)}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      <div className="mt-4">
        <AddSectionButton onAdd={onAdd} />
      </div>
    </div>
  );
};

interface SortableSectionRowProps {
  section: SectionMeta;
  onRename: (newName: string) => void;
  onToggleVisibility: () => void;
  onDelete: () => void;
}

const SortableSectionRow: React.FC<SortableSectionRowProps> = ({
  section,
  onRename,
  onToggleVisibility,
  onDelete,
}) => {
  const { t } = useTranslations();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: section.id,
    disabled: section.id === 'personalInfo',
  });
  const [isEditing, setIsEditing] = useState(false);
  const [editedName, setEditedName] = useState(section.displayName);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);

  const isPersonalInfo = section.id === 'personalInfo';
  const isHidden = !section.isVisible;

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };

  const handleSaveEdit = () => {
    if (editedName.trim()) {
      onRename(editedName.trim());
    }
    setIsEditing(false);
  };

  const handleDeleteClick = () => {
    if (section.isDefault) {
      onToggleVisibility();
    } else {
      setShowDeleteConfirm(true);
    }
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-2 rounded-xl border bg-white px-2 py-2 transition-colors ${
        isHidden
          ? 'border-dashed border-[#c9c5bc] opacity-60'
          : 'border-[#e6e3dc] hover:border-[#c9c5bc]'
      } ${isDragging ? 'shadow-sw-md ring-2 ring-primary/30' : ''}`}
    >
      {/* Drag handle */}
      <div
        {...attributes}
        {...listeners}
        className={`flex h-8 w-6 items-center justify-center rounded-lg ${
          isPersonalInfo
            ? 'cursor-default text-[#c9c5bc]'
            : 'cursor-grab text-steel-grey active:cursor-grabbing hover:bg-paper-tint hover:text-primary'
        }`}
        aria-label={t('builder.sectionOrder.dragToReorder')}
        title={t('builder.sectionOrder.dragToReorder')}
      >
        <GripVertical className="h-4 w-4" />
      </div>

      {/* Icon */}
      <span
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${
          isHidden
            ? 'border-transparent bg-paper-tint text-steel-grey'
            : 'border-transparent bg-paper-tint text-primary'
        }`}
      >
        {getSectionIconElement(section)}
      </span>

      {/* Name / Inline rename */}
      {isEditing ? (
        <div className="flex min-w-0 flex-1 items-center gap-1">
          <Input
            value={editedName}
            onChange={(e) => setEditedName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSaveEdit();
              if (e.key === 'Escape') setIsEditing(false);
            }}
            className="h-8 flex-1 rounded-lg text-sm font-semibold"
            autoFocus
          />
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-green-700 hover:bg-green-50"
            onClick={handleSaveEdit}
            aria-label={t('common.save')}
          >
            <Check className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-steel-grey hover:bg-paper-tint"
            onClick={() => setIsEditing(false)}
            aria-label={t('common.cancel')}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      ) : (
        <>
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-ink">
            {section.displayName}
          </span>
          {isHidden && (
            <span className="rounded-full border border-orange-500 bg-orange-50 px-2 py-0.5 text-[9px] uppercase tracking-wider text-orange-600">
              {t('builder.sectionHeader.hiddenFromPdfTag')}
            </span>
          )}
          {!section.isDefault && (
            <span className="rounded-full border border-[#e6e3dc] bg-white px-2 py-0.5 text-[9px] uppercase tracking-wider text-steel-grey">
              {t('builder.sectionHeader.customTag')}
            </span>
          )}
        </>
      )}

      {/* Actions */}
      {!isEditing && (
        <div className="flex shrink-0 items-center gap-0.5">
          {!isPersonalInfo && (
            <>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-steel-grey"
                onClick={() => {
                  setEditedName(section.displayName);
                  setIsEditing(true);
                }}
                aria-label={t('builder.sectionHeader.renameSection')}
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-steel-grey"
                onClick={onToggleVisibility}
                aria-label={t('builder.sectionHeader.hideSection')}
              >
                {section.isVisible ? (
                  <Eye className="h-3.5 w-3.5" />
                ) : (
                  <EyeOff className="h-3.5 w-3.5" />
                )}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-destructive hover:bg-destructive/10"
                onClick={handleDeleteClick}
                aria-label={t('builder.sectionHeader.deleteSection')}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </>
          )}
        </div>
      )}

      <ConfirmDialog
        open={showDeleteConfirm}
        onOpenChange={setShowDeleteConfirm}
        title={t('builder.sectionHeader.deleteTitle')}
        description={t('builder.sectionHeader.deleteDescription', { name: section.displayName })}
        confirmLabel={t('common.delete')}
        cancelLabel={t('common.cancel')}
        variant="danger"
        onConfirm={onDelete}
      />
    </div>
  );
};

/**
 * Margin Slider Component
 *
 * Range input for margin values. In mm mode the range is 5-25mm; in percent
 * mode it is 0-10% of the page dimension.
 */
interface MarginSliderProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  unit?: MarginUnit;
}

const MarginSlider: React.FC<MarginSliderProps> = ({ label, value, onChange, unit = 'mm' }) => {
  const min = unit === 'percent' ? 0 : 5;
  const max = unit === 'percent' ? 10 : 25;
  return (
    <div className="flex items-center gap-2">
      <span className=" text-xs w-12 text-ink-soft">{label}:</span>
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value, 10))}
        className="flex-1 h-1.5 bg-paper-tint rounded-full appearance-none cursor-pointer
                   [&::-webkit-slider-thumb]:appearance-none
                   [&::-webkit-slider-thumb]:w-3.5
                   [&::-webkit-slider-thumb]:h-3.5
                   [&::-webkit-slider-thumb]:rounded-full
                   [&::-webkit-slider-thumb]:bg-primary
                   [&::-webkit-slider-thumb]:border-none
                   [&::-webkit-slider-thumb]:cursor-pointer
                   [&::-moz-range-thumb]:w-3.5
                   [&::-moz-range-thumb]:h-3.5
                   [&::-moz-range-thumb]:rounded-full
                   [&::-moz-range-thumb]:bg-primary
                   [&::-moz-range-thumb]:border-none
                   [&::-moz-range-thumb]:cursor-pointer"
      />
      <span className=" text-xs w-7 text-right text-ink-soft">
        {value}
        {unit === 'percent' ? '%' : ''}
      </span>
    </div>
  );
};

/**
 * Percent slider for line heights (100-200% of the base line height).
 */
interface PercentSliderProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
}

const PercentSlider: React.FC<PercentSliderProps> = ({ label, value, onChange }) => {
  return (
    <div className="flex items-center gap-2">
      <span className=" text-xs w-24 text-ink-soft">{label}:</span>
      <input
        type="range"
        min={100}
        max={200}
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value, 10))}
        className="flex-1 h-1.5 bg-paper-tint rounded-full appearance-none cursor-pointer
                   [&::-webkit-slider-thumb]:appearance-none
                   [&::-webkit-slider-thumb]:w-3.5
                   [&::-webkit-slider-thumb]:h-3.5
                   [&::-webkit-slider-thumb]:rounded-full
                   [&::-webkit-slider-thumb]:bg-primary
                   [&::-webkit-slider-thumb]:border-none
                   [&::-webkit-slider-thumb]:cursor-pointer
                   [&::-moz-range-thumb]:w-3.5
                   [&::-moz-range-thumb]:h-3.5
                   [&::-moz-range-thumb]:rounded-full
                   [&::-moz-range-thumb]:bg-primary
                   [&::-moz-range-thumb]:border-none
                   [&::-moz-range-thumb]:cursor-pointer"
      />
      <span className=" text-xs w-9 text-right text-ink-soft">{value}%</span>
    </div>
  );
};

/**
 * Segmented alignment selector (left / center / right).
 *
 * Each option renders a mini text-alignment preview (paragraph bars) plus its
 * name, so the meaning of every choice is visible at a glance.
 */
interface AlignmentSelectorProps {
  label: string;
  value: TextAlign;
  onChange: (value: TextAlign) => void;
}

const ALIGNMENT_OPTIONS: { id: TextAlign; barAlign: string }[] = [
  { id: 'left', barAlign: 'items-start' },
  { id: 'center', barAlign: 'items-center' },
  { id: 'right', barAlign: 'items-end' },
];

const AlignmentSelector: React.FC<AlignmentSelectorProps> = ({ label, value, onChange }) => {
  const { t } = useTranslations();
  return (
    <div>
      <div className="mb-1.5 text-xs font-semibold text-ink-soft">{label}</div>
      <div className="flex gap-2">
        {ALIGNMENT_OPTIONS.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => onChange(option.id)}
            aria-label={t(`builder.formatting.alignmentOptions.${option.id}`)}
            title={t(`builder.formatting.alignmentOptions.${option.id}`)}
            className={`flex flex-1 flex-col items-center gap-1.5 rounded-xl border p-2 transition-all ${
              value === option.id
                ? 'border-primary bg-primary/5 shadow-sw-xs ring-1 ring-primary'
                : 'border-[#e6e3dc] bg-white hover:border-primary hover:bg-paper-tint'
            }`}
          >
            <span
              className={`flex h-10 w-full flex-col justify-center gap-1 rounded-lg bg-paper-tint px-2 ${option.barAlign}`}
            >
              <span className="h-1 w-4/5 rounded-full bg-steel-grey/70" />
              <span className="h-1 w-3/5 rounded-full bg-steel-grey/70" />
              <span className="h-1 w-2/5 rounded-full bg-steel-grey/70" />
            </span>
            <span
              className={`text-[10px] font-medium uppercase tracking-wide ${
                value === option.id ? 'text-primary' : 'text-ink-soft'
              }`}
            >
              {t(`builder.formatting.alignmentOptions.${option.id}`)}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
};

/**
 * Preview selector: segmented buttons that each render a mini resume-entry
 * preview of the option, so the user sees the result before picking it.
 */
interface PreviewOption {
  id: string;
  label: string;
  preview: React.ReactNode;
}

const PreviewSelector: React.FC<{
  label: string;
  value: string;
  options: PreviewOption[];
  onChange: (value: string) => void;
}> = ({ label, value, options, onChange }) => (
  <div>
    <div className="mb-1.5 text-xs font-semibold text-ink-soft">{label}</div>
    <div className="flex gap-2">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          onClick={() => onChange(option.id)}
          aria-pressed={value === option.id}
          className={`flex flex-1 flex-col items-center gap-1.5 rounded-xl border p-2 transition-all ${
            value === option.id
              ? 'border-primary bg-primary/5 shadow-sw-xs ring-1 ring-primary'
              : 'border-[#e6e3dc] bg-white hover:border-primary hover:bg-paper-tint'
          }`}
        >
          {option.preview}
          <span
            className={`text-[10px] font-medium uppercase tracking-wide ${
              value === option.id ? 'text-primary' : 'text-ink-soft'
            }`}
          >
            {option.label}
          </span>
        </button>
      ))}
    </div>
  </div>
);

/**
 * Mini resume-entry preview building blocks.
 */
const MiniEntry: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="flex h-14 w-full flex-col justify-center gap-0.5 rounded-lg bg-paper-tint px-2">
    {children}
  </div>
);

const MiniRow: React.FC<{
  children: React.ReactNode;
  bold?: boolean;
  muted?: boolean;
  right?: React.ReactNode;
  stackedSuffix?: React.ReactNode;
}> = ({ children, bold = false, muted = false, right, stackedSuffix }) => (
  <div className="flex min-w-0 items-center justify-between gap-1">
    <span
      className={`truncate text-[8px] leading-tight ${
        bold ? 'font-bold text-ink' : muted ? 'text-steel-grey' : 'text-ink-soft'
      }`}
    >
      {children}
      {stackedSuffix && (
        <>
          <span className="text-steel-grey"> — </span>
          <span className="font-normal text-steel-grey">{stackedSuffix}</span>
        </>
      )}
    </span>
    {right && <span className="shrink-0 text-[7px] text-steel-grey">{right}</span>}
  </div>
);

/**
 * Spacing Selector Component
 *
 * Button group for selecting spacing levels (1-5)
 */
interface SpacingSelectorProps {
  label: string;
  value: SpacingLevel;
  onChange: (value: SpacingLevel) => void;
}

const SpacingSelector: React.FC<SpacingSelectorProps> = ({ label, value, onChange }) => {
  const levels: SpacingLevel[] = [1, 2, 3, 4, 5];

  return (
    <div className="flex items-center gap-2">
      <span className=" text-xs w-16 text-ink-soft">{label}:</span>
      <div className="flex gap-1">
        {levels.map((level) => (
          <button
            key={level}
            onClick={() => onChange(level)}
            className={`h-6 w-6 rounded-lg border text-xs transition-all ${
              value === level
                ? 'bg-primary text-white border-primary shadow-sw-xs'
                : 'bg-white text-ink-soft border-[#e6e3dc] hover:border-primary hover:text-primary'
            }`}
          >
            {level}
          </button>
        ))}
      </div>
    </div>
  );
};

/**
 * Spacing stepper: number input with minus/plus buttons (1-5).
 */
interface SpacingStepperProps {
  label: string;
  value: SpacingLevel;
  onChange: (value: SpacingLevel) => void;
  min?: number;
  max?: number;
}

const SpacingStepper: React.FC<SpacingStepperProps> = ({
  label,
  value,
  onChange,
  min = 1,
  max = 5,
}) => {
  const clamp = (n: number) => Math.min(max, Math.max(min, n));
  const changeButton =
    'flex h-8 w-8 items-center justify-center rounded-lg border border-[#e6e3dc] bg-white text-ink-soft transition-all hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-[#e6e3dc] disabled:hover:text-ink-soft';

  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-ink-soft">{label}</span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onChange(Math.max(min, value - 1) as SpacingLevel)}
          disabled={value <= min}
          className={changeButton}
          aria-label={`${label} -`}
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
        <input
          type="number"
          min={min}
          max={max}
          value={value}
          onChange={(e) => {
            const parsed = parseInt(e.target.value, 10);
            if (!Number.isNaN(parsed)) {
              onChange(clamp(parsed) as SpacingLevel);
            }
          }}
          className="h-8 w-12 rounded-lg border border-[#e6e3dc] bg-white text-center text-sm font-semibold text-ink outline-none transition-colors focus:border-primary [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
          aria-label={label}
        />
        <button
          type="button"
          onClick={() => onChange(Math.min(max, value + 1) as SpacingLevel)}
          disabled={value >= max}
          className={changeButton}
          aria-label={`${label} +`}
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
};

/**
 * Switch toggle row (accent color / options)
 */
interface SwitchRowProps {
  checked: boolean;
  onChange: () => void;
  label: string;
}

const SwitchRow: React.FC<SwitchRowProps> = ({ checked, onChange, label }) => {
  return (
    <label className="flex cursor-pointer items-center gap-3">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={onChange}
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border-2 transition-colors ${
          checked ? 'border-primary bg-primary' : 'border-[#c9c5bc] bg-white hover:border-primary'
        }`}
      >
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sw-xs transition-all ${
            checked ? 'left-[22px]' : 'left-0.5'
          }`}
        />
      </button>
      <span className=" text-xs text-ink-soft">{label}</span>
    </label>
  );
};

export default FormattingControls;
