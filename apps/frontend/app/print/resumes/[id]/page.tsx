import Resume, { ResumeData } from '@/components/dashboard/resume-component';
import {
  type TemplateType,
  type PageSize,
  type TemplateSettings,
  type SpacingLevel,
  type HeaderFontFamily,
  type BodyFontFamily,
  type AccentColor,
  type DateRangeFormat,
  type TextAlign,
  type SkillsLayoutMode,
  type MarginUnit,
  type EducationShowBy,
  type EducationLayout,
  type WorkShowBy,
  type WorkDatesBy,
  type WorkLocationBy,
  type BulletMarker,
  type ListSeparator,
  type TextWeightOption,
  type TextTransformOption,
  DEFAULT_TEMPLATE_SETTINGS,
} from '@/lib/types/template-settings';
import { API_BASE } from '@/lib/api/client';
import { translate } from '@/lib/i18n/server';
import { resolveLocale } from '@/lib/i18n/locale';
import { withLocalizedDefaultSections } from '@/lib/utils/section-helpers';

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{
    template?: string;
    pageSize?: string;
    marginTop?: string;
    marginBottom?: string;
    marginLeft?: string;
    marginRight?: string;
    marginUnit?: string;
    sectionSpacing?: string;
    itemSpacing?: string;
    lineHeight?: string;
    listLineHeight?: string;
    dateFormat?: string;
    headerAlign?: string;
    dateAlign?: string;
    locationAlign?: string;
    skillsLayout?: string;
    fontSize?: string;
    headerScale?: string;
    headerFont?: string;
    bodyFont?: string;
    compactMode?: string;
    showContactIcons?: string;
    accentColor?: string;
    customAccentColor?: string;
    workShowBy?: string;
    workDatesBy?: string;
    workLocationBy?: string;
    educationShowBy?: string;
    educationLayout?: string;
    bulletMarker?: string;
    listSeparator?: string;
    sizeFullName?: string;
    sizePrimaryHeading?: string;
    sizeSecondaryHeading?: string;
    sizeSectionTitle?: string;
    sizeBodyCopy?: string;
    sizeMinorCopy?: string;
    weightFullName?: string;
    weightPrimaryHeading?: string;
    weightSecondaryHeading?: string;
    weightSectionTitle?: string;
    weightBodyCopy?: string;
    weightMinorCopy?: string;
    transformFullName?: string;
    transformPrimaryHeading?: string;
    transformSecondaryHeading?: string;
    transformSectionTitle?: string;
    transformBodyCopy?: string;
    transformMinorCopy?: string;
    vspaceBetweenSections?: string;
    vspaceTitlesContent?: string;
    vspacePrimarySecondary?: string;
    vspaceContentBlocks?: string;
    vspaceListItems?: string;
    borderAboveHeader?: string;
    borderBelowHeader?: string;
    borderSectionTitles?: string;
    lang?: string;
  }>;
};

/**
 * Parse header font family
 */
function parseHeaderFont(value: string | undefined): HeaderFontFamily {
  if (value === 'serif' || value === 'sans-serif' || value === 'mono' || value === 'times-roman') {
    return value;
  }
  return DEFAULT_TEMPLATE_SETTINGS.fontSize.headerFont;
}

/**
 * Parse body font family
 */
function parseBodyFont(value: string | undefined): BodyFontFamily {
  if (value === 'serif' || value === 'sans-serif' || value === 'mono' || value === 'times-roman') {
    return value;
  }
  return DEFAULT_TEMPLATE_SETTINGS.fontSize.bodyFont;
}

/**
 * Parse accent color
 */
function parseAccentColor(value: string | undefined): AccentColor {
  if (value === 'blue' || value === 'green' || value === 'orange' || value === 'red') {
    return value;
  }
  return DEFAULT_TEMPLATE_SETTINGS.accentColor;
}

/**
 * Parse boolean from string
 */
function parseBoolean(value: string | undefined, defaultValue: boolean): boolean {
  if (value === 'true') return true;
  if (value === 'false') return false;
  return defaultValue;
}

async function fetchResumeData(id: string): Promise<ResumeData> {
  const res = await fetch(`${API_BASE}/resumes?resume_id=${encodeURIComponent(id)}`, {
    cache: 'no-store',
  });
  if (!res.ok) {
    throw new Error(`Failed to load resume (status ${res.status}).`);
  }
  const payload = (await res.json()) as {
    data: { processed_resume?: ResumeData; raw_resume?: { content?: string } };
  };
  if (payload.data.processed_resume) {
    return payload.data.processed_resume;
  }
  if (payload.data.raw_resume?.content) {
    try {
      return JSON.parse(payload.data.raw_resume.content) as ResumeData;
    } catch (error) {
      // Log error for debugging instead of silently failing
      // Note: Avoid logging content preview to prevent PII exposure
      console.error('Failed to parse resume JSON:', {
        resumeId: id,
        error: error instanceof Error ? error.message : 'Unknown error',
        contentLength: payload.data.raw_resume.content.length,
      });
      throw new Error('Failed to parse resume data. The resume content may be corrupted.');
    }
  }
  return {} as ResumeData;
}

/**
 * Parse spacing level from string, clamped to valid range 1-5
 */
function parseSpacingLevel(value: string | undefined, defaultValue: SpacingLevel): SpacingLevel {
  if (!value) return defaultValue;
  const num = parseInt(value, 10);
  if (isNaN(num) || num < 1 || num > 5) return defaultValue;
  return num as SpacingLevel;
}

/**
 * Parse a percentage value, clamped to valid range 100-200
 */
function parsePercent(value: string | undefined, defaultValue: number): number {
  if (!value) return defaultValue;
  const num = parseInt(value, 10);
  if (isNaN(num)) return defaultValue;
  return Math.max(100, Math.min(200, num));
}

/**
 * Parse margin value from string, clamped to a safe range.
 * The range is wide (0-40) because percent-based margins are converted to
 * millimeters by the backend before reaching this page.
 */
function parseMargin(value: string | undefined, defaultValue: number): number {
  if (!value) return defaultValue;
  const num = parseInt(value, 10);
  if (isNaN(num)) return defaultValue;
  return Math.max(0, Math.min(40, num));
}

/**
 * Parse the date range format
 */
function parseDateFormat(value: string | undefined): DateRangeFormat {
  if (value === 'short' || value === 'long' || value === 'mmmyyyy' || value === 'years') {
    return value;
  }
  return DEFAULT_TEMPLATE_SETTINGS.dateFormat;
}

/**
 * Parse a text alignment value
 */
function parseTextAlign(value: string | undefined, defaultValue: TextAlign): TextAlign {
  if (value === 'left' || value === 'center' || value === 'right') {
    return value;
  }
  return defaultValue;
}

/**
 * Parse the skills layout mode
 */
function parseSkillsLayout(value: string | undefined): SkillsLayoutMode {
  if (value === 'comma' || value === 'list' || value === 'columns') {
    return value;
  }
  return DEFAULT_TEMPLATE_SETTINGS.skillsLayout;
}

/**
 * Parse the margin unit
 */
function parseMarginUnit(value: string | undefined): MarginUnit {
  if (value === 'mm' || value === 'percent') {
    return value;
  }
  return DEFAULT_TEMPLATE_SETTINGS.marginUnit;
}

/**
 * Parse a value from an allow-list of strings, falling back to the default.
 */
function parseEnum<T extends string>(
  value: string | undefined,
  allowed: readonly T[],
  defaultValue: T
): T {
  if (value && (allowed as readonly string[]).includes(value)) {
    return value as T;
  }
  return defaultValue;
}

/**
 * Parse work/education entry arrangement settings
 */
function parseWorkShowBy(value: string | undefined): WorkShowBy {
  return parseEnum(
    value,
    ['company', 'position'] as const,
    DEFAULT_TEMPLATE_SETTINGS.workExperience.showBy
  );
}

function parseWorkDatesBy(value: string | undefined): WorkDatesBy {
  return parseEnum(
    value,
    ['company', 'position', 'both'] as const,
    DEFAULT_TEMPLATE_SETTINGS.workExperience.datesBy
  );
}

function parseWorkLocationBy(value: string | undefined): WorkLocationBy {
  return parseEnum(
    value,
    ['company', 'position', 'none'] as const,
    DEFAULT_TEMPLATE_SETTINGS.workExperience.locationBy
  );
}

function parseEducationShowBy(value: string | undefined): EducationShowBy {
  return parseEnum(
    value,
    ['degree', 'institution'] as const,
    DEFAULT_TEMPLATE_SETTINGS.education.showBy
  );
}

function parseEducationLayout(value: string | undefined): EducationLayout {
  return parseEnum(
    value,
    ['stacked', 'inline'] as const,
    DEFAULT_TEMPLATE_SETTINGS.education.layout
  );
}

/**
 * Parse a point (pt) value, clamped to a safe range. 0 means "hidden" for
 * border widths.
 */
function parsePt(value: string | undefined, defaultValue: number): number {
  if (!value) return defaultValue;
  const num = parseFloat(value);
  if (isNaN(num)) return defaultValue;
  return Math.max(0, Math.min(40, num));
}

function parseBulletMarker(value: string | undefined): BulletMarker {
  return parseEnum(
    value,
    ['•', '*', '-', '>>', '->'] as const,
    DEFAULT_TEMPLATE_SETTINGS.advanced.bulletMarker
  );
}

function parseListSeparator(value: string | undefined): ListSeparator {
  return parseEnum(
    value,
    ['*', '-', ',', '|'] as const,
    DEFAULT_TEMPLATE_SETTINGS.advanced.listSeparator
  );
}

function parseTextWeight(
  value: string | undefined,
  defaultValue: TextWeightOption
): TextWeightOption {
  return parseEnum(value, ['light', 'regular', 'bold', 'extralight'] as const, defaultValue);
}

function parseTextTransform(
  value: string | undefined,
  defaultValue: TextTransformOption
): TextTransformOption {
  return parseEnum(value, ['uppercase', 'as-written', 'capitalize'] as const, defaultValue);
}

function parseBorderWidth(
  value: string | undefined,
  defaultValue: number
): { enabled: boolean; thickness: number } {
  const pt = parsePt(value, defaultValue);
  return { enabled: pt > 0, thickness: pt > 0 ? pt : 1 };
}

/**
 * Validate template type
 */
function parseTemplate(value: string | undefined): TemplateType {
  // Allow-list mirrors TEMPLATE_OPTIONS in lib/types/template-settings.ts — keep in sync.
  if (
    value === 'swiss-single' ||
    value === 'swiss-two-column' ||
    value === 'modern' ||
    value === 'modern-two-column' ||
    value === 'latex' ||
    value === 'clean' ||
    value === 'vivid'
  ) {
    return value;
  }
  return 'swiss-single';
}

/**
 * Validate page size
 */
function parsePageSize(value: string | undefined): PageSize {
  if (value === 'A4' || value === 'LETTER') {
    return value;
  }
  return 'A4';
}

export default async function PrintResumePage({ params, searchParams }: PageProps) {
  const resolvedParams = await params;
  const resolvedSearchParams = searchParams ? await searchParams : undefined;
  const resumeData = await fetchResumeData(resolvedParams.id);
  const locale = resolveLocale(resolvedSearchParams?.lang);
  const t = (key: string, params?: Record<string, string | number>) =>
    translate(locale, key, params);
  const localizedResumeData = withLocalizedDefaultSections(resumeData, t);
  const additionalSectionLabels = {
    technicalSkills: t('resume.additionalLabels.technicalSkills'),
    languages: t('resume.additionalLabels.languages'),
    certifications: t('resume.additionalLabels.certifications'),
    awards: t('resume.additionalLabels.awards'),
  };
  const sectionHeadings = {
    summary: t('resume.sections.summary'),
    experience: t('resume.sections.experience'),
    education: t('resume.sections.education'),
    projects: t('resume.sections.projects'),
    certifications: t('resume.sections.certifications'),
    skills: t('resume.sections.skillsOnly'),
    languages: t('resume.sections.languages'),
    awards: t('resume.sections.awards'),
    links: t('resume.sections.links'),
  };
  const fallbackLabels = {
    name: t('resume.defaults.name'),
  };

  // Parse template settings from query params
  const settings: TemplateSettings = {
    template: parseTemplate(resolvedSearchParams?.template),
    pageSize: parsePageSize(resolvedSearchParams?.pageSize),
    margins: {
      top: parseMargin(resolvedSearchParams?.marginTop, DEFAULT_TEMPLATE_SETTINGS.margins.top),
      bottom: parseMargin(
        resolvedSearchParams?.marginBottom,
        DEFAULT_TEMPLATE_SETTINGS.margins.bottom
      ),
      left: parseMargin(resolvedSearchParams?.marginLeft, DEFAULT_TEMPLATE_SETTINGS.margins.left),
      right: parseMargin(
        resolvedSearchParams?.marginRight,
        DEFAULT_TEMPLATE_SETTINGS.margins.right
      ),
    },
    spacing: {
      section: parseSpacingLevel(
        resolvedSearchParams?.sectionSpacing,
        DEFAULT_TEMPLATE_SETTINGS.spacing.section
      ),
      item: parseSpacingLevel(
        resolvedSearchParams?.itemSpacing,
        DEFAULT_TEMPLATE_SETTINGS.spacing.item
      ),
      padding: DEFAULT_TEMPLATE_SETTINGS.spacing.padding,
    },
    fontSize: {
      base: parseSpacingLevel(
        resolvedSearchParams?.fontSize,
        DEFAULT_TEMPLATE_SETTINGS.fontSize.base
      ),
      headerScale: parseSpacingLevel(
        resolvedSearchParams?.headerScale,
        DEFAULT_TEMPLATE_SETTINGS.fontSize.headerScale
      ),
      headerFont: parseHeaderFont(resolvedSearchParams?.headerFont),
      bodyFont: parseBodyFont(resolvedSearchParams?.bodyFont),
    },
    lineHeight: parsePercent(
      resolvedSearchParams?.lineHeight,
      DEFAULT_TEMPLATE_SETTINGS.lineHeight
    ),
    listLineHeight: parsePercent(
      resolvedSearchParams?.listLineHeight,
      DEFAULT_TEMPLATE_SETTINGS.listLineHeight
    ),
    dateFormat: parseDateFormat(resolvedSearchParams?.dateFormat),
    alignment: {
      header: parseTextAlign(
        resolvedSearchParams?.headerAlign,
        DEFAULT_TEMPLATE_SETTINGS.alignment.header
      ),
      date: parseTextAlign(
        resolvedSearchParams?.dateAlign,
        DEFAULT_TEMPLATE_SETTINGS.alignment.date
      ),
      location: parseTextAlign(
        resolvedSearchParams?.locationAlign,
        DEFAULT_TEMPLATE_SETTINGS.alignment.location
      ),
    },
    skillsLayout: parseSkillsLayout(resolvedSearchParams?.skillsLayout),
    marginUnit: parseMarginUnit(resolvedSearchParams?.marginUnit),
    compactMode: parseBoolean(
      resolvedSearchParams?.compactMode,
      DEFAULT_TEMPLATE_SETTINGS.compactMode
    ),
    showContactIcons: parseBoolean(
      resolvedSearchParams?.showContactIcons,
      DEFAULT_TEMPLATE_SETTINGS.showContactIcons
    ),
    accentColor: parseAccentColor(resolvedSearchParams?.accentColor),
    customAccentColor: resolvedSearchParams?.customAccentColor || null,
    workExperience: {
      showBy: parseWorkShowBy(resolvedSearchParams?.workShowBy),
      datesBy: parseWorkDatesBy(resolvedSearchParams?.workDatesBy),
      locationBy: parseWorkLocationBy(resolvedSearchParams?.workLocationBy),
    },
    education: {
      showBy: parseEducationShowBy(resolvedSearchParams?.educationShowBy),
      layout: parseEducationLayout(resolvedSearchParams?.educationLayout),
    },
    advanced: {
      bulletMarker: parseBulletMarker(resolvedSearchParams?.bulletMarker),
      listSeparator: parseListSeparator(resolvedSearchParams?.listSeparator),
      textSizes: {
        fullName: parsePt(
          resolvedSearchParams?.sizeFullName,
          DEFAULT_TEMPLATE_SETTINGS.advanced.textSizes.fullName
        ),
        primaryHeading: parsePt(
          resolvedSearchParams?.sizePrimaryHeading,
          DEFAULT_TEMPLATE_SETTINGS.advanced.textSizes.primaryHeading
        ),
        secondaryHeading: parsePt(
          resolvedSearchParams?.sizeSecondaryHeading,
          DEFAULT_TEMPLATE_SETTINGS.advanced.textSizes.secondaryHeading
        ),
        sectionTitle: parsePt(
          resolvedSearchParams?.sizeSectionTitle,
          DEFAULT_TEMPLATE_SETTINGS.advanced.textSizes.sectionTitle
        ),
        bodyCopy: parsePt(
          resolvedSearchParams?.sizeBodyCopy,
          DEFAULT_TEMPLATE_SETTINGS.advanced.textSizes.bodyCopy
        ),
        minorCopy: parsePt(
          resolvedSearchParams?.sizeMinorCopy,
          DEFAULT_TEMPLATE_SETTINGS.advanced.textSizes.minorCopy
        ),
      },
      textWeights: {
        fullName: parseTextWeight(
          resolvedSearchParams?.weightFullName,
          DEFAULT_TEMPLATE_SETTINGS.advanced.textWeights.fullName
        ),
        primaryHeading: parseTextWeight(
          resolvedSearchParams?.weightPrimaryHeading,
          DEFAULT_TEMPLATE_SETTINGS.advanced.textWeights.primaryHeading
        ),
        secondaryHeading: parseTextWeight(
          resolvedSearchParams?.weightSecondaryHeading,
          DEFAULT_TEMPLATE_SETTINGS.advanced.textWeights.secondaryHeading
        ),
        sectionTitle: parseTextWeight(
          resolvedSearchParams?.weightSectionTitle,
          DEFAULT_TEMPLATE_SETTINGS.advanced.textWeights.sectionTitle
        ),
        bodyCopy: parseTextWeight(
          resolvedSearchParams?.weightBodyCopy,
          DEFAULT_TEMPLATE_SETTINGS.advanced.textWeights.bodyCopy
        ),
        minorCopy: parseTextWeight(
          resolvedSearchParams?.weightMinorCopy,
          DEFAULT_TEMPLATE_SETTINGS.advanced.textWeights.minorCopy
        ),
      },
      textTransforms: {
        fullName: parseTextTransform(
          resolvedSearchParams?.transformFullName,
          DEFAULT_TEMPLATE_SETTINGS.advanced.textTransforms.fullName
        ),
        primaryHeading: parseTextTransform(
          resolvedSearchParams?.transformPrimaryHeading,
          DEFAULT_TEMPLATE_SETTINGS.advanced.textTransforms.primaryHeading
        ),
        secondaryHeading: parseTextTransform(
          resolvedSearchParams?.transformSecondaryHeading,
          DEFAULT_TEMPLATE_SETTINGS.advanced.textTransforms.secondaryHeading
        ),
        sectionTitle: parseTextTransform(
          resolvedSearchParams?.transformSectionTitle,
          DEFAULT_TEMPLATE_SETTINGS.advanced.textTransforms.sectionTitle
        ),
        bodyCopy: parseTextTransform(
          resolvedSearchParams?.transformBodyCopy,
          DEFAULT_TEMPLATE_SETTINGS.advanced.textTransforms.bodyCopy
        ),
        minorCopy: parseTextTransform(
          resolvedSearchParams?.transformMinorCopy,
          DEFAULT_TEMPLATE_SETTINGS.advanced.textTransforms.minorCopy
        ),
      },
      verticalSpacing: {
        betweenSections: parsePt(
          resolvedSearchParams?.vspaceBetweenSections,
          DEFAULT_TEMPLATE_SETTINGS.advanced.verticalSpacing.betweenSections
        ),
        titlesContent: parsePt(
          resolvedSearchParams?.vspaceTitlesContent,
          DEFAULT_TEMPLATE_SETTINGS.advanced.verticalSpacing.titlesContent
        ),
        primarySecondaryHeadings: parsePt(
          resolvedSearchParams?.vspacePrimarySecondary,
          DEFAULT_TEMPLATE_SETTINGS.advanced.verticalSpacing.primarySecondaryHeadings
        ),
        contentBlocks: parsePt(
          resolvedSearchParams?.vspaceContentBlocks,
          DEFAULT_TEMPLATE_SETTINGS.advanced.verticalSpacing.contentBlocks
        ),
        listItems: parsePt(
          resolvedSearchParams?.vspaceListItems,
          DEFAULT_TEMPLATE_SETTINGS.advanced.verticalSpacing.listItems
        ),
      },
      borders: {
        aboveHeader: parseBorderWidth(
          resolvedSearchParams?.borderAboveHeader,
          DEFAULT_TEMPLATE_SETTINGS.advanced.borders.aboveHeader.enabled
            ? DEFAULT_TEMPLATE_SETTINGS.advanced.borders.aboveHeader.thickness
            : 0
        ),
        belowHeader: parseBorderWidth(
          resolvedSearchParams?.borderBelowHeader,
          DEFAULT_TEMPLATE_SETTINGS.advanced.borders.belowHeader.enabled
            ? DEFAULT_TEMPLATE_SETTINGS.advanced.borders.belowHeader.thickness
            : 0
        ),
        sectionTitles: parseBorderWidth(
          resolvedSearchParams?.borderSectionTitles,
          DEFAULT_TEMPLATE_SETTINGS.advanced.borders.sectionTitles.enabled
            ? DEFAULT_TEMPLATE_SETTINGS.advanced.borders.sectionTitles.thickness
            : 0
        ),
      },
    },
  };

  // Note: Margins are applied by Playwright's PDF renderer (not here)
  // This ensures margins appear on EVERY page, not just the first
  // The settings are passed to override CSS variables for spacing/fonts only
  const printSettings: TemplateSettings = {
    ...settings,
    // Zero out margins in CSS since Playwright handles them
    margins: { top: 0, bottom: 0, left: 0, right: 0 },
  };

  return (
    <div className="resume-print bg-white">
      <Resume
        resumeData={localizedResumeData}
        template={settings.template}
        settings={printSettings}
        additionalSectionLabels={additionalSectionLabels}
        sectionHeadings={sectionHeadings}
        fallbackLabels={fallbackLabels}
      />
    </div>
  );
}
