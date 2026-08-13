import { type DateRangeFormat } from '@/lib/types/template-settings';
import { formatDateRange } from '@/lib/utils';

/**
 * Date formatting for resume date ranges.
 *
 * Resume data stores date ranges as free-form strings ("Jun 2025 - Present",
 * "2023 2025", "September 2020", ...). This module parses the two endpoints of
 * a range and re-renders them in the format chosen in the builder:
 * - short:   "Sep 2020 - Feb 2024"
 * - long:    "September 2020 - February 2024"
 * - mmmyyyy: "09/2020 - 02/2024"
 * - years:   "2020 - 2024"
 *
 * Unparseable tokens (e.g. "Q1 2024") are kept verbatim, so nothing is ever
 * lost or mangled.
 */

const MONTHS_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

const MONTHS_LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

const OPEN_ENDED_TOKENS = ['present', 'current', 'now', 'ongoing'];

interface ParsedDateToken {
  month?: number; // 0-11
  year?: number;
  raw: string;
}

const monthIndex = (name: string): number | undefined => {
  const lower = name.toLowerCase();
  const short = MONTHS_SHORT.findIndex((m) => m.toLowerCase() === lower);
  if (short !== -1) return short;
  const full = MONTHS_LONG.findIndex((m) => m.toLowerCase() === lower);
  return full !== -1 ? full : undefined;
};

/**
 * Parse a single date token ("Sep 2020", "September 2020", "09/2020", "2020",
 * "Present"). Returns null when the token cannot be understood.
 */
function parseDateToken(token: string): ParsedDateToken | null {
  const trimmed = token.trim();
  if (!trimmed) return null;
  if (OPEN_ENDED_TOKENS.includes(trimmed.toLowerCase())) {
    return { raw: trimmed };
  }

  // Month name + year: "Sep 2020", "September 2020"
  let match = trimmed.match(/^([A-Za-z]+)\s+(\d{4})$/);
  if (match) {
    const month = monthIndex(match[1]);
    if (month !== undefined) {
      return { month, year: parseInt(match[2], 10), raw: trimmed };
    }
    return null;
  }

  // Numeric month + year: "09/2020", "09-2020"
  match = trimmed.match(/^(\d{1,2})[/-](\d{4})$/);
  if (match) {
    const month = parseInt(match[1], 10);
    if (month >= 1 && month <= 12) {
      return { month: month - 1, year: parseInt(match[2], 10), raw: trimmed };
    }
    return null;
  }

  // Year only: "2020"
  match = trimmed.match(/^(\d{4})$/);
  if (match) {
    return { year: parseInt(match[1], 10), raw: trimmed };
  }

  return null;
}

/**
 * Render a parsed token in the requested format. Open-ended tokens
 * ("Present") are always kept verbatim; years-only tokens stay year-only.
 */
function renderDateToken(token: ParsedDateToken, format: DateRangeFormat): string {
  if (token.raw && (token.month === undefined || token.year === undefined)) {
    return token.raw;
  }
  if (token.year === undefined) return token.raw;
  if (format === 'years') return String(token.year);
  if (token.month === undefined) return String(token.year);

  switch (format) {
    case 'long':
      return `${MONTHS_LONG[token.month]} ${token.year}`;
    case 'mmmyyyy':
      return `${String(token.month + 1).padStart(2, '0')}/${token.year}`;
    case 'short':
    default:
      return `${MONTHS_SHORT[token.month]} ${token.year}`;
  }
}

/**
 * Format a date range string in the requested format.
 *
 * Falls back to the normalized raw string whenever any part of the range
 * cannot be parsed.
 *
 * @param dateString - Raw date range ("Jun 2025 Aug 2025", "2023 2025", ...)
 * @param format - Target format (defaults to 'short')
 */
export function formatDateRangeWithFormat(
  dateString: string | undefined | null,
  format: DateRangeFormat = 'short'
): string {
  if (!dateString) return '';
  if (format === 'short') return formatDateRange(dateString);

  const normalized = formatDateRange(dateString);
  const tokens = normalized
    .split(' - ')
    .map((part) => part.trim())
    .map(parseDateToken);

  if (tokens.some((token) => token === null)) return normalized;

  return tokens.map((token) => renderDateToken(token as ParsedDateToken, format)).join(' - ');
}
