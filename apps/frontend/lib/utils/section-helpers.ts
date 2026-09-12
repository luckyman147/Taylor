/**
 * Section helpers for dynamic resume section management.
 *
 * These utilities handle section metadata operations including
 * getting default sections, sorting, and managing custom sections.
 */

import type {
  ResumeData,
  SectionMeta,
  SectionType,
  CustomSection,
} from '@/components/dashboard/resume-component';

export type TranslationFunction = (key: string, params?: Record<string, string | number>) => string;

/**
 * Default section metadata for backward compatibility.
 * Used when a resume doesn't have sectionMeta defined.
 * Certifications and Awards are hidden by default: users opt in when they have entries.
 */
export const DEFAULT_SECTION_META: SectionMeta[] = [
  {
    id: 'personalInfo',
    key: 'personalInfo',
    displayName: 'Personal Info',
    sectionType: 'personalInfo',
    isDefault: true,
    isVisible: true,
    order: 0,
  },
  {
    id: 'summary',
    key: 'summary',
    displayName: 'Summary',
    sectionType: 'text',
    isDefault: true,
    isVisible: true,
    order: 1,
  },
  {
    id: 'workExperience',
    key: 'workExperience',
    displayName: 'Experience',
    sectionType: 'itemList',
    isDefault: true,
    isVisible: true,
    order: 2,
  },
  {
    id: 'education',
    key: 'education',
    displayName: 'Education',
    sectionType: 'itemList',
    isDefault: true,
    isVisible: true,
    order: 3,
  },
  {
    id: 'certifications',
    key: 'certifications',
    displayName: 'Certifications',
    sectionType: 'itemList',
    isDefault: true,
    isVisible: false,
    order: 4,
  },
  {
    id: 'awards',
    key: 'awards',
    displayName: 'Awards',
    sectionType: 'itemList',
    isDefault: true,
    isVisible: false,
    order: 5,
  },
  {
    id: 'personalProjects',
    key: 'personalProjects',
    displayName: 'Projects',
    sectionType: 'itemList',
    isDefault: true,
    isVisible: true,
    order: 6,
  },
  {
    id: 'skills',
    key: 'skills',
    displayName: 'Skills',
    sectionType: 'stringList',
    isDefault: true,
    isVisible: true,
    order: 7,
  },
  {
    id: 'languages',
    key: 'languages',
    displayName: 'Languages',
    sectionType: 'stringList',
    isDefault: true,
    isVisible: true,
    order: 8,
  },
];

const DEFAULT_SECTION_DISPLAY_NAME_BY_ID: Readonly<Record<string, string>> = Object.freeze(
  Object.fromEntries(DEFAULT_SECTION_META.map((section) => [section.id, section.displayName]))
);

const DEFAULT_SECTION_I18N_KEY_BY_ID: Readonly<Record<string, string>> = Object.freeze({
  personalInfo: 'resume.sections.personalInfo',
  summary: 'resume.sections.summary',
  workExperience: 'resume.sections.experience',
  education: 'resume.sections.education',
  certifications: 'resume.sections.certifications',
  awards: 'resume.sections.awards',
  personalProjects: 'resume.sections.projects',
  skills: 'resume.sections.skills',
  languages: 'resume.sections.languages',
});

/**
 * Localize default section display names without overwriting user customizations.
 *
 * Rules:
 * - Only affects built-in sections (isDefault === true)
 * - Only overwrites when the displayName still equals the original English default
 */
export function localizeDefaultSectionMeta(
  sections: SectionMeta[],
  t: TranslationFunction
): SectionMeta[] {
  return sections.map((section) => {
    if (!section.isDefault) return section;

    const i18nKey = DEFAULT_SECTION_I18N_KEY_BY_ID[section.id];
    if (!i18nKey) return section;

    const defaultDisplayName = DEFAULT_SECTION_DISPLAY_NAME_BY_ID[section.id];
    if (!defaultDisplayName) return section;

    if (section.displayName !== defaultDisplayName) return section;

    return { ...section, displayName: t(i18nKey) };
  });
}

/**
 * Return a ResumeData object with localized default sectionMeta.
 *
 * - If resumeData.sectionMeta is missing, it generates it from DEFAULT_SECTION_META.
 * - If sectionMeta exists, it only localizes untouched default English section names.
 */
export function withLocalizedDefaultSections(
  resumeData: ResumeData,
  t: TranslationFunction
): ResumeData {
  const baseMeta = resumeData.sectionMeta?.length ? resumeData.sectionMeta : DEFAULT_SECTION_META;
  const localizedMeta = localizeDefaultSectionMeta(baseMeta, t);
  return { ...resumeData, sectionMeta: localizedMeta };
}

/**
 * Get section metadata from resume data, falling back to defaults.
 * Default sections missing from stored metadata are appended hidden, so
 * new optional sections (e.g. Certifications) become available on older
 * resumes without changing existing visibility or order.
 */
export function getSectionMeta(resumeData: ResumeData): SectionMeta[] {
  let stored = resumeData.sectionMeta?.length ? resumeData.sectionMeta : DEFAULT_SECTION_META;

  // Safety net: migrate legacy 'additional' sections to 'skills'
  // This handles old resumes where the backend stored id/key as "additional"
  let needsMigration = false;
  for (const s of stored) {
    if (s.id === 'additional' || s.key === 'additional') {
      needsMigration = true;
      break;
    }
  }
  if (needsMigration) {
    const migrated = stored.map((s) => {
      const next = { ...s };
      if (next.id === 'additional') next.id = 'skills';
      if (next.key === 'additional') next.key = 'skills';
      return next;
    });
    // Deduplicate if both 'additional' (now 'skills') and original 'skills' exist
    const seen = new Set<string>();
    stored = migrated.filter((s) => {
      if (seen.has(s.id)) return false;
      seen.add(s.id);
      return true;
    });
  }

  const byId = new Map(stored.map((s) => [s.id, s]));
  let maxOrder = stored.reduce((max, s) => Math.max(max, s.order), 0);
  const merged = [...stored];
  for (const def of DEFAULT_SECTION_META) {
    if (!byId.has(def.id)) {
      merged.push({ ...def, order: maxOrder + 1, isVisible: false });
      maxOrder += 1;
    }
  }
  return merged;
}

/**
 * Get sorted sections (visible only) for rendering.
 */
export function getSortedSections(resumeData: ResumeData): SectionMeta[] {
  return [...getSectionMeta(resumeData)]
    .filter((s) => s.isVisible)
    .sort((a, b) => a.order - b.order);
}

/**
 * Get all sections (including hidden) for management UI.
 */
export function getAllSections(resumeData: ResumeData): SectionMeta[] {
  return [...getSectionMeta(resumeData)].sort((a, b) => a.order - b.order);
}

/**
 * Generate a unique ID for a new custom section.
 */
export function generateCustomSectionId(existingSections: SectionMeta[]): string {
  const customSections = existingSections.filter((s) => s.id.startsWith('custom_'));
  const maxId = customSections.reduce((max, s) => {
    const num = parseInt(s.id.replace('custom_', ''), 10);
    return isNaN(num) ? max : Math.max(max, num);
  }, 0);
  return `custom_${maxId + 1}`;
}

/**
 * Create a new custom section with metadata.
 */
export function createCustomSection(
  existingSections: SectionMeta[],
  displayName: string,
  sectionType: SectionType
): SectionMeta {
  const id = generateCustomSectionId(existingSections);
  const maxOrder = Math.max(...existingSections.map((s) => s.order), 0);

  return {
    id,
    key: id,
    displayName,
    sectionType,
    isDefault: false,
    isVisible: true,
    order: maxOrder + 1,
  };
}

/**
 * Move a section up one position in the ordering (personalInfo is pinned first).
 * Returns a new SectionMeta array.
 */
export function moveSectionUp(sections: SectionMeta[], sectionId: string): SectionMeta[] {
  const sorted = [...sections].sort((a, b) => a.order - b.order);
  const index = sorted.findIndex((s) => s.id === sectionId);
  if (index <= 0 || sorted[index - 1].id === 'personalInfo') return sections;

  const current = sorted[index];
  const above = sorted[index - 1];
  return sections.map((s) => {
    if (s.id === current.id) return { ...s, order: above.order };
    if (s.id === above.id) return { ...s, order: current.order };
    return s;
  });
}

/**
 * Move a section down one position in the ordering.
 * Returns a new SectionMeta array.
 */
export function moveSectionDown(sections: SectionMeta[], sectionId: string): SectionMeta[] {
  const sorted = [...sections].sort((a, b) => a.order - b.order);
  const index = sorted.findIndex((s) => s.id === sectionId);
  if (index < 0 || index >= sorted.length - 1) return sections;

  const current = sorted[index];
  const below = sorted[index + 1];
  return sections.map((s) => {
    if (s.id === current.id) return { ...s, order: below.order };
    if (s.id === below.id) return { ...s, order: current.order };
    return s;
  });
}

/**
 * Apply a new ordering to sections based on an array of ids in their new order.
 * Existing order values are rewritten sequentially; personalInfo always ends up first.
 * Sections not mentioned in orderedIds are appended after the referenced ones.
 * Returns the updated SectionMeta array.
 */
export function reorderSections(sections: SectionMeta[], orderedIds: string[]): SectionMeta[] {
  const byId = new Map(sections.map((s) => [s.id, s]));
  const finalOrder: SectionMeta[] = [];

  const personal = byId.get('personalInfo');
  if (personal) finalOrder.push({ ...personal, order: 0 });

  const seen = new Set<string>();
  for (const id of orderedIds) {
    if (id === 'personalInfo') continue;
    const section = byId.get(id);
    if (section && !seen.has(id)) {
      seen.add(id);
      finalOrder.push(section);
    }
  }

  for (const section of sections) {
    if (section.id === 'personalInfo' || seen.has(section.id)) continue;
    finalOrder.push(section);
  }

  return finalOrder.map((s, index) => ({ ...s, order: index }));
}

/**
 * Rename a section. Returns a new SectionMeta array (or the same array if name is empty).
 */
export function renameSection(
  sections: SectionMeta[],
  sectionId: string,
  newName: string
): SectionMeta[] {
  if (!newName.trim()) return sections;
  return sections.map((s) => (s.id === sectionId ? { ...s, displayName: newName.trim() } : s));
}

/**
 * Toggle a section's visibility. Returns a new SectionMeta array.
 */
export function toggleSectionVisibility(sections: SectionMeta[], sectionId: string): SectionMeta[] {
  return sections.map((s) => (s.id === sectionId ? { ...s, isVisible: !s.isVisible } : s));
}

/**
 * Delete a section. Default sections are hidden instead of removed.
 * Returns a new SectionMeta array and the updated customSections (unchanged for defaults).
 */
export function deleteSection(
  resumeData: ResumeData,
  sectionId: string
): { sectionMeta: SectionMeta[]; customSections: Record<string, CustomSection> } {
  const meta = resumeData.sectionMeta?.length ? resumeData.sectionMeta : DEFAULT_SECTION_META;
  const section = meta.find((s) => s.id === sectionId);
  if (!section) return { sectionMeta: meta, customSections: resumeData.customSections ?? {} };

  if (section.isDefault) {
    return {
      sectionMeta: toggleSectionVisibility(meta, sectionId),
      customSections: resumeData.customSections ?? {},
    };
  }

  const customSections = { ...(resumeData.customSections ?? {}) };
  delete customSections[section.key];
  return {
    sectionMeta: meta.filter((s) => s.id !== sectionId),
    customSections,
  };
}

/**
 * Renumber list entry ids by position (1-based).
 *
 * The builder targets entries by `item.id` (e.g. `data.map(... item.id === id)`),
 * so entries without ids (old drafts, pre-fix payloads) would all share `id=0`
 * and one edit would apply to every entry. Deterministic by position.
 */
export function ensureUniqueEntryIds<T extends { id?: number }>(items: T[] | undefined): T[] {
  return (items ?? []).map((item, index) => ({ ...item, id: index + 1 }));
}

/**
 * Add a new custom section to resume data (metadata + empty custom section container).
 * Returns updated ResumeData.
 */
export function addCustomSectionToData(
  resumeData: ResumeData,
  displayName: string,
  sectionType: SectionType
): ResumeData {
  const meta = resumeData.sectionMeta?.length ? resumeData.sectionMeta : DEFAULT_SECTION_META;
  const newSection = createCustomSection(meta, displayName, sectionType);

  const newCustomSection: CustomSection = {
    sectionType,
    text: sectionType === 'text' ? '' : undefined,
    items: sectionType === 'itemList' ? [] : undefined,
    strings: sectionType === 'stringList' ? [] : undefined,
  };

  return {
    ...resumeData,
    sectionMeta: [...meta, newSection],
    customSections: {
      ...(resumeData.customSections ?? {}),
      [newSection.key]: newCustomSection,
    },
  };
}
