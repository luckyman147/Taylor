/**
 * Resume Template Settings
 *
 * Defines the structure for template selection and formatting controls.
 * These settings affect both the live preview and PDF generation.
 */

import { PAGE_DIMENSIONS, mmToPx } from '@/lib/constants/page-dimensions';

export type TemplateType =
  | 'swiss-single'
  | 'swiss-two-column'
  | 'modern'
  | 'modern-two-column'
  | 'latex'
  | 'clean'
  | 'vivid';

export type PageSize = 'A4' | 'LETTER';

export type AccentColor = 'blue' | 'green' | 'orange' | 'red';

export type SpacingLevel = 1 | 2 | 3 | 4 | 5;

export type HeaderFontFamily = 'serif' | 'sans-serif' | 'mono' | 'times-roman';
export type BodyFontFamily = 'serif' | 'sans-serif' | 'mono' | 'times-roman';

export type TextAlign = 'left' | 'center' | 'right';

export type DateRangeFormat = 'short' | 'long' | 'mmmyyyy' | 'years';

export type SkillsLayoutMode = 'comma' | 'list' | 'columns';

export type MarginUnit = 'mm' | 'percent';

export type WorkShowBy = 'company' | 'position';
export type WorkDatesBy = 'company' | 'position' | 'both';
export type WorkLocationBy = 'company' | 'position' | 'none';
export type EducationShowBy = 'degree' | 'institution';
export type EducationLayout = 'stacked' | 'inline';

export interface MarginSettings {
  top: number; // 5-25mm (or 0-10% of page height when marginUnit is 'percent')
  bottom: number;
  left: number; // 5-25mm (or 0-10% of page width when marginUnit is 'percent')
  right: number;
}

export interface SpacingSettings {
  section: SpacingLevel; // Gap between major sections
  item: SpacingLevel; // Gap between items within sections
  padding: SpacingLevel; // Inner content padding
}

export interface AlignmentSettings {
  header: TextAlign; // Name & title (resume header) alignment
  date: TextAlign; // Date range alignment
  location: TextAlign; // Location alignment
}

export interface FontSizeSettings {
  base: SpacingLevel; // Overall text scale
  headerScale: SpacingLevel; // Header size multiplier
  headerFont: HeaderFontFamily; // Header font family
  bodyFont: BodyFontFamily; // Body text font family
}

export interface WorkExperienceSettings {
  showBy: WorkShowBy; // Which field is the entry's primary line
  datesBy: WorkDatesBy; // Which line carries the date range
  locationBy: WorkLocationBy; // Which line carries the location (or hide it)
}

export interface EducationSettings {
  showBy: EducationShowBy; // Which field is the entry's primary line
  layout: EducationLayout; // Stacked lines vs single inline line
}

export type BulletMarker = '•' | '*' | '-' | '>>' | '->';
export type ListSeparator = '*' | '-' | ',' | '|';

export type TextStyleTarget =
  | 'bodyCopy'
  | 'primaryHeading'
  | 'secondaryHeading'
  | 'sectionTitle'
  | 'fullName'
  | 'minorCopy';

export type TextWeightOption = 'light' | 'regular' | 'bold' | 'extralight';
export type TextTransformOption = 'uppercase' | 'as-written' | 'capitalize';

export interface BorderSetting {
  enabled: boolean;
  thickness: number; // pt
}

export interface AdvancedSettings {
  bulletMarker: BulletMarker; // List item bullet character
  listSeparator: ListSeparator; // Inline join separator for education & skills
  textSizes: Record<TextStyleTarget, number>; // pt
  textWeights: Record<TextStyleTarget, TextWeightOption>;
  textTransforms: Record<TextStyleTarget, TextTransformOption>;
  verticalSpacing: {
    betweenSections: number; // pt - gap between major sections
    titlesContent: number; // pt - gap below section titles
    primarySecondaryHeadings: number; // pt - gap between primary & secondary heading lines
    contentBlocks: number; // pt - gap between items within a section
    listItems: number; // pt - gap between list/bullet items
  };
  borders: {
    aboveHeader: BorderSetting;
    belowHeader: BorderSetting;
    sectionTitles: BorderSetting;
  };
}

export const TEXT_WEIGHT_MAP: Record<TextWeightOption, number> = {
  light: 300,
  regular: 400,
  bold: 700,
  extralight: 200,
};

export const TEXT_TRANSFORM_MAP: Record<TextTransformOption, string> = {
  uppercase: 'uppercase',
  'as-written': 'none',
  capitalize: 'capitalize',
};

/**
 * Default advanced settings. Values are computed from the classic rendering
 * (14px body base, 2x header scale, 1rem section gap, 0.25rem item gap) so
 * new resumes render identically to today.
 */
export const DEFAULT_ADVANCED_SETTINGS: AdvancedSettings = {
  bulletMarker: '•',
  listSeparator: ',',
  textSizes: {
    fullName: 21,
    primaryHeading: 12,
    secondaryHeading: 10.5,
    sectionTitle: 12.5,
    bodyCopy: 10.5,
    minorCopy: 8,
  },
  textWeights: {
    fullName: 'bold',
    primaryHeading: 'regular',
    secondaryHeading: 'bold',
    sectionTitle: 'bold',
    bodyCopy: 'regular',
    minorCopy: 'regular',
  },
  textTransforms: {
    fullName: 'as-written',
    primaryHeading: 'as-written',
    secondaryHeading: 'as-written',
    sectionTitle: 'uppercase',
    bodyCopy: 'as-written',
    minorCopy: 'as-written',
  },
  verticalSpacing: {
    betweenSections: 12,
    titlesContent: 3,
    primarySecondaryHeadings: 3,
    contentBlocks: 3,
    listItems: 2,
  },
  borders: {
    aboveHeader: { enabled: false, thickness: 1 },
    belowHeader: { enabled: false, thickness: 1 },
    sectionTitles: { enabled: true, thickness: 1 },
  },
};

export interface TemplateSettings {
  template: TemplateType;
  pageSize: PageSize;
  margins: MarginSettings;
  spacing: SpacingSettings;
  fontSize: FontSizeSettings;
  lineHeight: number; // Text line height, percent (100-200)
  listLineHeight: number; // List/bullet line height, percent (100-200)
  dateFormat: DateRangeFormat; // How date ranges render in the resume
  alignment: AlignmentSettings; // Text alignment for section titles, dates, locations
  skillsLayout: SkillsLayoutMode; // How the technical skills list renders
  workExperience: WorkExperienceSettings; // Work entry field arrangement
  education: EducationSettings; // Education entry field arrangement
  marginUnit: MarginUnit; // Unit of the margin values ('mm' or percent of page)
  compactMode: boolean; // Apply tighter spacing across the board
  showContactIcons: boolean; // Show icons next to contact info
  accentColor: AccentColor; // Accent color for Modern template
  advanced: AdvancedSettings; // Advanced styles, sizes, weights, transforms, spacing & borders
}

/**
 * Default template settings
 */
export const DEFAULT_TEMPLATE_SETTINGS: TemplateSettings = {
  template: 'swiss-single',
  pageSize: 'A4',
  margins: { top: 10, bottom: 10, left: 10, right: 10 },
  spacing: { section: 3, item: 2, padding: 3 },
  fontSize: { base: 3, headerScale: 3, headerFont: 'serif', bodyFont: 'sans-serif' },
  lineHeight: 135,
  listLineHeight: 125,
  dateFormat: 'short',
  alignment: { header: 'center', date: 'right', location: 'left' },
  skillsLayout: 'comma',
  workExperience: { showBy: 'position', datesBy: 'position', locationBy: 'company' },
  education: { showBy: 'institution', layout: 'stacked' },
  marginUnit: 'mm',
  compactMode: false,
  showContactIcons: false,
  accentColor: 'blue',
  advanced: DEFAULT_ADVANCED_SETTINGS,
};

/**
 * Merge partial settings with defaults (deep for nested objects).
 *
 * Use when loading persisted settings (localStorage, query params) so new
 * fields added after the settings were saved fall back to their defaults.
 */
export function normalizeTemplateSettings(settings?: Partial<TemplateSettings>): TemplateSettings {
  return {
    ...DEFAULT_TEMPLATE_SETTINGS,
    ...settings,
    margins: { ...DEFAULT_TEMPLATE_SETTINGS.margins, ...settings?.margins },
    spacing: { ...DEFAULT_TEMPLATE_SETTINGS.spacing, ...settings?.spacing },
    fontSize: { ...DEFAULT_TEMPLATE_SETTINGS.fontSize, ...settings?.fontSize },
    alignment: { ...DEFAULT_TEMPLATE_SETTINGS.alignment, ...settings?.alignment },
    workExperience: {
      ...DEFAULT_TEMPLATE_SETTINGS.workExperience,
      ...settings?.workExperience,
    },
    education: { ...DEFAULT_TEMPLATE_SETTINGS.education, ...settings?.education },
    advanced: {
      ...DEFAULT_TEMPLATE_SETTINGS.advanced,
      ...settings?.advanced,
      textSizes: {
        ...DEFAULT_TEMPLATE_SETTINGS.advanced.textSizes,
        ...settings?.advanced?.textSizes,
      },
      textWeights: {
        ...DEFAULT_TEMPLATE_SETTINGS.advanced.textWeights,
        ...settings?.advanced?.textWeights,
      },
      textTransforms: {
        ...DEFAULT_TEMPLATE_SETTINGS.advanced.textTransforms,
        ...settings?.advanced?.textTransforms,
      },
      verticalSpacing: {
        ...DEFAULT_TEMPLATE_SETTINGS.advanced.verticalSpacing,
        ...settings?.advanced?.verticalSpacing,
      },
      borders: {
        aboveHeader: {
          ...DEFAULT_TEMPLATE_SETTINGS.advanced.borders.aboveHeader,
          ...settings?.advanced?.borders?.aboveHeader,
        },
        belowHeader: {
          ...DEFAULT_TEMPLATE_SETTINGS.advanced.borders.belowHeader,
          ...settings?.advanced?.borders?.belowHeader,
        },
        sectionTitles: {
          ...DEFAULT_TEMPLATE_SETTINGS.advanced.borders.sectionTitles,
          ...settings?.advanced?.borders?.sectionTitles,
        },
      },
    },
  };
}

/**
 * Page size dimensions for display
 */
export const PAGE_SIZE_INFO: Record<PageSize, { name: string; dimensions: string }> = {
  A4: { name: 'A4', dimensions: '210 × 297 mm' },
  LETTER: { name: 'US Letter', dimensions: '8.5 × 11 in' },
};

/**
 * CSS Variable mappings for spacing levels
 */
export const SECTION_SPACING_MAP: Record<SpacingLevel, string> = {
  1: '0.375rem', // 6px
  2: '0.625rem', // 10px
  3: '1rem', // 16px - default
  4: '1.25rem', // 20px
  5: '1.5rem', // 24px
};

export const ITEM_SPACING_MAP: Record<SpacingLevel, string> = {
  1: '0.125rem', // 2px
  2: '0.25rem', // 4px - default
  3: '0.5rem', // 8px
  4: '0.75rem', // 12px
  5: '1rem', // 16px
};

export const PADDING_MAP: Record<SpacingLevel, string> = {
  1: '0mm',
  2: '2mm',
  3: '4mm', // default
  4: '6mm',
  5: '8mm',
};

export const FONT_SIZE_MAP: Record<SpacingLevel, string> = {
  1: '11px',
  2: '12px',
  3: '14px', // default
  4: '15px',
  5: '16px',
};

export const HEADER_SCALE_MAP: Record<SpacingLevel, number> = {
  1: 1.5,
  2: 1.75,
  3: 2, // default
  4: 2.25,
  5: 2.5,
};

// Section header scale (SUMMARY, EXPERIENCE, etc.) - slightly smaller than name
export const SECTION_HEADER_SCALE_MAP: Record<SpacingLevel, number> = {
  1: 1.0,
  2: 1.1,
  3: 1.2, // default
  4: 1.3,
  5: 1.4,
};

// Header font family mapping
export const HEADER_FONT_MAP: Record<HeaderFontFamily, string> = {
  serif: 'ui-serif, Georgia, Cambria, "Times New Roman", Times, serif',
  'sans-serif': 'ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji", "Segoe UI Emoji"',
  mono: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
  'times-roman':
    '"CMU Serif", "Latin Modern Roman", "Computer Modern", "Times New Roman", Times, serif',
};

export const BODY_FONT_MAP: Record<BodyFontFamily, string> = {
  serif: 'ui-serif, Georgia, Cambria, "Times New Roman", Times, serif',
  'sans-serif': 'ui-sans-serif, system-ui, sans-serif, "Apple Color Emoji", "Segoe UI Emoji"',
  mono: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
  'times-roman':
    '"CMU Serif", "Latin Modern Roman", "Computer Modern", "Times New Roman", Times, serif',
};

/**
 * Accent color mapping for Modern template
 */
export const ACCENT_COLOR_MAP: Record<
  AccentColor,
  { primary: string; light: string; name: string }
> = {
  blue: { primary: '#1D4ED8', light: '#DBEAFE', name: 'Blue' },
  green: { primary: '#15803D', light: '#DCFCE7', name: 'Green' },
  orange: { primary: '#EA580C', light: '#FED7AA', name: 'Orange' },
  red: { primary: '#DC2626', light: '#FEE2E2', name: 'Red' },
};

// Compact mode multiplier (applied to spacing values only, NOT line-height)
export const COMPACT_MULTIPLIER = 0.6;

// Line height gets a gentler reduction in compact mode
export const COMPACT_LINE_HEIGHT_MULTIPLIER = 0.92;

/**
 * Convert TemplateSettings to CSS custom properties
 */
export function settingsToCssVars(settings?: TemplateSettings): React.CSSProperties {
  const s = normalizeTemplateSettings(settings);
  const compact = s.compactMode ? COMPACT_MULTIPLIER : 1;
  // Line height gets a gentler reduction in compact mode to avoid text overlap
  const lineHeightFactor = s.compactMode ? COMPACT_LINE_HEIGHT_MULTIPLIER : 1;

  // Margins: 'percent' mode converts the percentage to pixels using the page
  // dimensions (top/bottom relative to page height, left/right to page width).
  const page = PAGE_DIMENSIONS[s.pageSize];
  const marginTop =
    s.marginUnit === 'percent'
      ? `${mmToPx((page.height * s.margins.top) / 100)}px`
      : `${s.margins.top}mm`;
  const marginBottom =
    s.marginUnit === 'percent'
      ? `${mmToPx((page.height * s.margins.bottom) / 100)}px`
      : `${s.margins.bottom}mm`;
  const marginLeft =
    s.marginUnit === 'percent'
      ? `${mmToPx((page.width * s.margins.left) / 100)}px`
      : `${s.margins.left}mm`;
  const marginRight =
    s.marginUnit === 'percent'
      ? `${mmToPx((page.width * s.margins.right) / 100)}px`
      : `${s.margins.right}mm`;

  // Get accent colors for Modern template
  const accentColors = ACCENT_COLOR_MAP[s.accentColor];

  // Advanced settings (named text sizes, weights, transforms, spacing, borders)
  const advanced = s.advanced;
  const borderWidth = (b: { enabled: boolean; thickness: number }) =>
    b.enabled ? `${b.thickness}pt` : '0';
  const sizeVar = (target: TextStyleTarget) => `${advanced.textSizes[target]}pt`;
  const weightVar = (target: TextStyleTarget) => TEXT_WEIGHT_MAP[advanced.textWeights[target]];
  const transformVar = (target: TextStyleTarget) =>
    TEXT_TRANSFORM_MAP[advanced.textTransforms[target]];

  return {
    // Advanced: bullet marker & list separator (raw strings)
    '--bullet-marker': JSON.stringify(advanced.bulletMarker),
    '--list-separator': advanced.listSeparator,
    '--section-gap': s.compactMode
      ? `calc(${SECTION_SPACING_MAP[s.spacing.section]} * ${compact})`
      : SECTION_SPACING_MAP[s.spacing.section],
    '--item-gap': s.compactMode
      ? `calc(${ITEM_SPACING_MAP[s.spacing.item]} * ${compact})`
      : ITEM_SPACING_MAP[s.spacing.item],
    '--line-height': (s.lineHeight / 100) * lineHeightFactor,
    '--list-line-height': (s.listLineHeight / 100) * lineHeightFactor,
    '--section-header-align': s.alignment.header,
    '--date-align': s.alignment.date,
    '--location-align': s.alignment.location,
    '--font-size-base': FONT_SIZE_MAP[s.fontSize.base],
    '--header-scale': HEADER_SCALE_MAP[s.fontSize.headerScale],
    '--section-header-scale': SECTION_HEADER_SCALE_MAP[s.fontSize.headerScale],
    '--header-font': HEADER_FONT_MAP[s.fontSize.headerFont],
    '--body-font': BODY_FONT_MAP[s.fontSize.bodyFont],
    '--margin-top': marginTop,
    '--margin-bottom': marginBottom,
    '--margin-left': marginLeft,
    '--margin-right': marginRight,
    // Accent colors for Modern template
    '--resume-accent-primary': accentColors.primary,
    '--resume-accent-light': accentColors.light,
    '--content-padding': s.compactMode
      ? `calc(${PADDING_MAP[s.spacing.padding]} * ${compact})`
      : PADDING_MAP[s.spacing.padding],
    // Advanced: text sizes (pt)
    '--size-full-name': sizeVar('fullName'),
    '--size-primary-heading': sizeVar('primaryHeading'),
    '--size-secondary-heading': sizeVar('secondaryHeading'),
    '--size-section-title': sizeVar('sectionTitle'),
    '--size-body-copy': sizeVar('bodyCopy'),
    '--size-minor-copy': sizeVar('minorCopy'),
    // Advanced: text weights (numeric)
    '--weight-full-name': weightVar('fullName'),
    '--weight-primary-heading': weightVar('primaryHeading'),
    '--weight-secondary-heading': weightVar('secondaryHeading'),
    '--weight-section-title': weightVar('sectionTitle'),
    '--weight-body-copy': weightVar('bodyCopy'),
    '--weight-minor-copy': weightVar('minorCopy'),
    // Advanced: text transforms
    '--transform-full-name': transformVar('fullName'),
    '--transform-primary-heading': transformVar('primaryHeading'),
    '--transform-secondary-heading': transformVar('secondaryHeading'),
    '--transform-section-title': transformVar('sectionTitle'),
    '--transform-body-copy': transformVar('bodyCopy'),
    '--transform-minor-copy': transformVar('minorCopy'),
    // Advanced: vertical spacing (pt)
    '--vspace-between-sections': `${advanced.verticalSpacing.betweenSections}pt`,
    '--vspace-titles-content': `${advanced.verticalSpacing.titlesContent}pt`,
    '--vspace-primary-secondary': `${advanced.verticalSpacing.primarySecondaryHeadings}pt`,
    '--vspace-content-blocks': `${advanced.verticalSpacing.contentBlocks}pt`,
    '--vspace-list-items': `${advanced.verticalSpacing.listItems}pt`,
    // Advanced: borders (pt width, 0 = hidden)
    '--border-above-header-w': borderWidth(advanced.borders.aboveHeader),
    '--border-below-header-w': borderWidth(advanced.borders.belowHeader),
    '--border-section-titles-w': borderWidth(advanced.borders.sectionTitles),
  } as React.CSSProperties;
}

/**
 * Template metadata for UI display
 */
export interface TemplateInfo {
  id: TemplateType;
  name: string;
  description: string;
}

export const TEMPLATE_OPTIONS: TemplateInfo[] = [
  {
    id: 'swiss-single',
    name: 'Single Column',
    description: 'Traditional full-width layout with maximum content density',
  },
  {
    id: 'swiss-two-column',
    name: 'Two Column',
    description: 'Experience-focused main column with sidebar for skills',
  },
  {
    id: 'modern',
    name: 'Modern',
    description: 'Colorful accents with customizable theme colors',
  },
  {
    id: 'modern-two-column',
    name: 'Modern Two Column',
    description: 'Two-column layout with modern colorful accents and themes',
  },
  {
    id: 'latex',
    name: 'LaTeX',
    description: 'Classic serif academic layout with ruled section headers',
  },
  {
    id: 'clean',
    name: 'Clean',
    description: 'Minimal sans layout with large understated section headers',
  },
  {
    id: 'vivid',
    name: 'Vivid',
    description: 'Colorful two-column layout with accent headers and arrow bullets',
  },
];

/**
 * Signature font presets for single-typeface templates.
 *
 * LaTeX and Clean bind their headers to `--header-font` and body to `--body-font`, so
 * both font controls are live. Selecting one of these templates applies its signature
 * fonts (so it matches its reference look by default); the user can then override either
 * control. Templates not listed here keep the current font settings on selection.
 */
export const TEMPLATE_FONT_PRESETS: Partial<
  Record<TemplateType, { headerFont: HeaderFontFamily; bodyFont: BodyFontFamily }>
> = {
  latex: { headerFont: 'serif', bodyFont: 'serif' },
  clean: { headerFont: 'sans-serif', bodyFont: 'sans-serif' },
};

/**
 * Return settings with the given template applied, seeding the template's signature
 * fonts when it has a preset. Use this at every template-change entry point so the
 * single-typeface templates render their reference look by default.
 */
export function applyTemplatePreset(
  settings: TemplateSettings,
  template: TemplateType
): TemplateSettings {
  const preset = TEMPLATE_FONT_PRESETS[template];
  if (!preset) return { ...settings, template };
  return {
    ...settings,
    template,
    fontSize: { ...settings.fontSize, headerFont: preset.headerFont, bodyFont: preset.bodyFont },
  };
}
