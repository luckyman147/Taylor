import { describe, expect, it } from 'vitest';
import { formatDateRangeWithFormat } from '@/lib/utils/date-format';

describe('formatDateRangeWithFormat', () => {
  it('returns an empty string for falsy input', () => {
    expect(formatDateRangeWithFormat(undefined)).toBe('');
    expect(formatDateRangeWithFormat(null)).toBe('');
    expect(formatDateRangeWithFormat('')).toBe('');
  });

  it('keeps the short format (default) as the normalized passthrough', () => {
    expect(formatDateRangeWithFormat('Jun 2025 Aug 2025')).toBe('Jun 2025 - Aug 2025');
    expect(formatDateRangeWithFormat('Jun 2025 - Aug 2025', 'short')).toBe('Jun 2025 - Aug 2025');
    expect(formatDateRangeWithFormat('2023 2025', 'short')).toBe('2023 - 2025');
  });

  it('formats month-year ranges in the long format', () => {
    expect(formatDateRangeWithFormat('Jun 2025 Aug 2025', 'long')).toBe('June 2025 - August 2025');
    expect(formatDateRangeWithFormat('September 2020 - February 2024', 'long')).toBe(
      'September 2020 - February 2024'
    );
  });

  it('formats month-year ranges in the numeric format', () => {
    expect(formatDateRangeWithFormat('Jun 2025 Aug 2025', 'mmmyyyy')).toBe('06/2025 - 08/2025');
    expect(formatDateRangeWithFormat('2020-2024', 'mmmyyyy')).toBe('2020 - 2024');
  });

  it('formats month-year ranges as years only', () => {
    expect(formatDateRangeWithFormat('Jun 2025 - Aug 2025', 'years')).toBe('2025 - 2025');
    expect(formatDateRangeWithFormat('2020 2024', 'years')).toBe('2020 - 2024');
    expect(formatDateRangeWithFormat('2020', 'years')).toBe('2020');
  });

  it('keeps open-ended tokens verbatim', () => {
    expect(formatDateRangeWithFormat('Jun 2025 Present', 'long')).toBe('June 2025 - Present');
    expect(formatDateRangeWithFormat('Jun 2025 - Present', 'mmmyyyy')).toBe('06/2025 - Present');
    expect(formatDateRangeWithFormat('Jun 2025 - Ongoing', 'years')).toBe('2025 - Ongoing');
  });

  it('normalizes en/em dashes regardless of format', () => {
    expect(formatDateRangeWithFormat('Sep 2020 – Feb 2024', 'years')).toBe('2020 - 2024');
  });

  it('falls back to the normalized raw string for unparseable tokens', () => {
    expect(formatDateRangeWithFormat('Q1 2024 - Present', 'long')).toBe('Q1 2024 - Present');
    expect(formatDateRangeWithFormat('Circa 2020', 'years')).toBe('Circa 2020');
  });
});
