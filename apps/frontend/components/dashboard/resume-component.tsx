import React from 'react';
import {
  ResumeSingleColumn,
  ResumeTwoColumn,
  ResumeModern,
  ResumeModernTwoColumn,
  ResumeLatex,
  ResumeClean,
  ResumeVivid,
} from '@/components/resume';
import {
  type TemplateSettings,
  type TemplateType,
  type DateRangeFormat,
  normalizeTemplateSettings,
  settingsToCssVars,
} from '@/lib/types/template-settings';
import { formatDateRangeWithFormat } from '@/lib/utils/date-format';
import baseStyles from '@/components/resume/styles/_base.module.css';

export type ContactDisplayMode = 'full' | 'label';
export type ContactDisplayField = 'email' | 'phone' | 'website' | 'linkedin' | 'github';

export interface PersonalInfo {
  name?: string;
  title?: string;
  email?: string;
  phone?: string;
  location?: string;
  website?: string;
  linkedin?: string;
  github?: string;
  /** Per-field contact display mode: 'label' renders a short hypertext label
   *  (e.g. "Email", "LinkedIn"), 'full' renders the raw value. Absent = default. */
  contactDisplay?: Partial<Record<ContactDisplayField, ContactDisplayMode>>;
}

export interface Experience {
  id: number;
  title?: string;
  company?: string;
  location?: string;
  years?: string;
  description?: string[];
  descriptionStyles?: ('bullet' | 'plain')[];
}

export interface Education {
  id: number;
  institution?: string;
  degree?: string;
  years?: string;
  description?: string;
}

export interface Project {
  id: number;
  name?: string;
  role?: string;
  years?: string;
  github?: string;
  website?: string;
  description?: string[];
  descriptionStyles?: ('bullet' | 'plain')[];
}

export interface SkillGroup {
  name: string;
  skills: string[];
}

export interface AdditionalInfo {
  technicalSkills?: string[];
  languages?: string[];
  certificationsTraining?: string[];
  awards?: string[];
  skillGroups?: SkillGroup[];
}

export interface AdditionalSectionLabels {
  technicalSkills: string;
  languages: string;
  certifications: string;
  awards: string;
}

export interface ResumeSectionHeadings {
  summary: string;
  experience: string;
  education: string;
  projects: string;
  certifications: string;
  skills: string;
  languages: string;
  awards: string;
  links: string;
}

export interface ResumeFallbackLabels {
  name: string;
}

// Section Type for dynamic sections
export type SectionType = 'personalInfo' | 'text' | 'itemList' | 'stringList';

// Section Metadata for dynamic section management
export interface SectionMeta {
  id: string; // Unique identifier (e.g., "summary", "custom_1")
  key: string; // Data key (matches ResumeData field or customSections key)
  displayName: string; // User-visible name
  sectionType: SectionType; // Type of section
  isDefault: boolean; // True for built-in sections
  isVisible: boolean; // Whether to show in resume
  order: number; // Display order (0 = first after personalInfo)
}

// Generic item for custom item-based sections
export interface CustomSectionItem {
  id: number;
  title?: string; // Primary title
  subtitle?: string; // Secondary info (company, institution, etc.)
  location?: string;
  years?: string;
  description?: string[];
  descriptionStyles?: ('bullet' | 'plain')[];
}

// Custom section data container
export interface CustomSection {
  sectionType: SectionType;
  items?: CustomSectionItem[]; // For itemList type
  strings?: string[]; // For stringList type
  text?: string; // For text type
}

export interface ResumeData {
  personalInfo?: PersonalInfo;
  summary?: string;
  workExperience?: Experience[];
  education?: Education[];
  personalProjects?: Project[];
  additional?: AdditionalInfo;
  // NEW: Section metadata and custom sections
  sectionMeta?: SectionMeta[];
  customSections?: Record<string, CustomSection>;
}

interface ResumeProps {
  resumeData: ResumeData;
  template?: TemplateType;
  settings?: TemplateSettings;
  additionalSectionLabels?: Partial<AdditionalSectionLabels>;
  sectionHeadings?: Partial<ResumeSectionHeadings>;
  fallbackLabels?: Partial<ResumeFallbackLabels>;
}

/**
 * Apply the configured date format to every date range in the resume data.
 *
 * Done at the data layer (instead of inside each template) so templates keep
 * rendering dates through formatDateRange, which is a no-op on already
 * formatted strings. The 'short' format is a passthrough: templates already
 * normalize it.
 */
function applyDateFormat(data: ResumeData, format: DateRangeFormat): ResumeData {
  if (!data || format === 'short') return data;

  const formatYears = (years?: string) =>
    years ? formatDateRangeWithFormat(years, format) : years;

  const mapItems = <T extends { years?: string }>(items?: T[]): T[] | undefined =>
    items?.map((item) => ({ ...item, years: formatYears(item.years) }));

  const customSections = data.customSections
    ? Object.fromEntries(
        Object.entries(data.customSections).map(([key, section]) => [
          key,
          section && section.items ? { ...section, items: mapItems(section.items) } : section,
        ])
      )
    : undefined;

  return {
    ...data,
    workExperience: mapItems(data.workExperience),
    education: mapItems(data.education),
    personalProjects: mapItems(data.personalProjects),
    customSections,
  };
}

/**
 * Resume Component
 *
 * Main wrapper component that delegates rendering to template-specific components.
 * Applies CSS custom properties from settings for consistent styling.
 *
 * Templates:
 * - swiss-single: Traditional single-column layout (default)
 * - swiss-two-column: Two-column layout with experience sidebar
 * - modern: Single-column with user-selectable accent colors
 * - modern-two-column: Two-column layout with modern colorful accents
 */
const Resume: React.FC<ResumeProps> = ({
  resumeData,
  template = 'swiss-single',
  settings,
  additionalSectionLabels,
  sectionHeadings,
  fallbackLabels,
}) => {
  // Merge provided settings with defaults (nested objects included)
  const mergedSettings: TemplateSettings = normalizeTemplateSettings(settings);

  // If template is provided as prop but not in settings, use the prop
  if (template && !settings?.template) {
    mergedSettings.template = template;
  }

  // Convert settings to CSS variables
  const cssVars = settingsToCssVars(mergedSettings);

  // Reformat date ranges per the chosen date format (no-op for 'short')
  const formattedData = applyDateFormat(resumeData, mergedSettings.dateFormat);

  return (
    <div
      className={`${baseStyles['resume-body']} bg-white text-black w-full mx-auto resume-template-${mergedSettings.template}`}
      style={cssVars}
    >
      {mergedSettings.template === 'swiss-single' && (
        <ResumeSingleColumn
          data={formattedData}
          showContactIcons={mergedSettings.showContactIcons}
          additionalSectionLabels={additionalSectionLabels}
          skillsLayout={mergedSettings.skillsLayout}
          listSeparator={mergedSettings.advanced.listSeparator}
          workExperienceSettings={mergedSettings.workExperience}
          educationSettings={mergedSettings.education}
        />
      )}
      {mergedSettings.template === 'swiss-two-column' && (
        <ResumeTwoColumn
          data={formattedData}
          showContactIcons={mergedSettings.showContactIcons}
          sectionHeadings={sectionHeadings}
          skillsLayout={mergedSettings.skillsLayout}
          workExperienceSettings={mergedSettings.workExperience}
          educationSettings={mergedSettings.education}
        />
      )}
      {mergedSettings.template === 'modern' && (
        <ResumeModern
          data={formattedData}
          showContactIcons={mergedSettings.showContactIcons}
          additionalSectionLabels={additionalSectionLabels}
          skillsLayout={mergedSettings.skillsLayout}
          listSeparator={mergedSettings.advanced.listSeparator}
          workExperienceSettings={mergedSettings.workExperience}
          educationSettings={mergedSettings.education}
        />
      )}
      {mergedSettings.template === 'modern-two-column' && (
        <ResumeModernTwoColumn
          data={formattedData}
          showContactIcons={mergedSettings.showContactIcons}
          sectionHeadings={sectionHeadings}
          fallbackLabels={fallbackLabels}
          skillsLayout={mergedSettings.skillsLayout}
          workExperienceSettings={mergedSettings.workExperience}
          educationSettings={mergedSettings.education}
        />
      )}
      {mergedSettings.template === 'latex' && (
        <ResumeLatex
          data={formattedData}
          showContactIcons={mergedSettings.showContactIcons}
          additionalSectionLabels={additionalSectionLabels}
          skillsLayout={mergedSettings.skillsLayout}
          listSeparator={mergedSettings.advanced.listSeparator}
          workExperienceSettings={mergedSettings.workExperience}
          educationSettings={mergedSettings.education}
        />
      )}
      {mergedSettings.template === 'clean' && (
        <ResumeClean
          data={formattedData}
          showContactIcons={mergedSettings.showContactIcons}
          additionalSectionLabels={additionalSectionLabels}
          skillsLayout={mergedSettings.skillsLayout}
          listSeparator={mergedSettings.advanced.listSeparator}
          workExperienceSettings={mergedSettings.workExperience}
          educationSettings={mergedSettings.education}
        />
      )}
      {mergedSettings.template === 'vivid' && (
        <ResumeVivid
          data={formattedData}
          showContactIcons={mergedSettings.showContactIcons}
          sectionHeadings={sectionHeadings}
          fallbackLabels={fallbackLabels}
          skillsLayout={mergedSettings.skillsLayout}
          workExperienceSettings={mergedSettings.workExperience}
          educationSettings={mergedSettings.education}
        />
      )}
    </div>
  );
};

export default Resume;
