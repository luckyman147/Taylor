/**
 * Entry arrangement helpers
 *
 * Turn the generic Work Experience / Education settings into a concrete
 * field arrangement that every template can render:
 *
 * Work experience, per entry:
 * - primary: the field shown on the entry's first/bold line
 * - secondary: the field shown on the entry's second line
 * - location / dates are placed on the primary or secondary line depending
 *   on `locationBy` / `datesBy` (dates may appear on both lines with 'both')
 *
 * Education, per entry:
 * - primary/secondary are degree vs institution, ordered by `showBy`
 */

import { formatDateRange } from '@/lib/utils';
import type { EducationSettings, WorkExperienceSettings } from '@/lib/types/template-settings';

export interface WorkEntryInput {
  title?: string;
  company?: string;
  location?: string;
  years?: string;
}

export interface ArrangedWorkEntry {
  primary?: string;
  secondary?: string;
  location?: string; // undefined when locationBy is 'none'
  datesOnPrimary: boolean;
  datesOnSecondary: boolean;
  locationOnPrimary: boolean;
}

const joinParts = (parts: (string | undefined)[]): string | undefined => {
  const joined = parts.filter(Boolean).join(' • ');
  return joined || undefined;
};

/**
 * Arrange the two text fields of a work experience entry.
 */
export function arrangeWorkEntry(
  exp: WorkEntryInput,
  settings: WorkExperienceSettings
): ArrangedWorkEntry {
  const { showBy, datesBy, locationBy } = settings;
  return {
    primary: showBy === 'company' ? exp.company : exp.title,
    secondary: showBy === 'company' ? exp.title : exp.company,
    location: locationBy === 'none' ? undefined : exp.location,
    datesOnPrimary: datesBy !== 'company',
    datesOnSecondary: datesBy !== 'position',
    locationOnPrimary: locationBy === 'position',
  };
}

/**
 * Build the right-side metadata strings (dates + location) for both lines.
 */
export function workEntryMeta(
  entry: ArrangedWorkEntry,
  years?: string
): { primaryMeta?: string; secondaryMeta?: string } {
  const fmtYears = years ? formatDateRange(years) : undefined;
  return {
    primaryMeta: joinParts([
      entry.datesOnPrimary ? fmtYears : undefined,
      entry.locationOnPrimary ? entry.location : undefined,
    ]),
    secondaryMeta: joinParts([
      entry.datesOnSecondary ? fmtYears : undefined,
      !entry.locationOnPrimary ? entry.location : undefined,
    ]),
  };
}

/**
 * Single-line metadata (dates + location) for templates that render each work
 * entry on one line (Clean, Vivid, ...). Dates always appear (every datesBy
 * option places them on some line); location appears unless it is hidden.
 */
export function workEntryInlineMeta(entry: ArrangedWorkEntry, years?: string): string | undefined {
  const fmtYears = years ? formatDateRange(years) : undefined;
  return joinParts([fmtYears, entry.location]);
}

/**
 * Arrange the two text fields of an education entry.
 */
export function arrangeEducationEntry(
  edu: { degree?: string; institution?: string },
  settings: EducationSettings
): { primary: string; secondary: string } {
  const primary = settings.showBy === 'degree' ? edu.degree : edu.institution;
  const secondary = settings.showBy === 'degree' ? edu.institution : edu.degree;
  return { primary: primary ?? '', secondary: secondary ?? '' };
}
