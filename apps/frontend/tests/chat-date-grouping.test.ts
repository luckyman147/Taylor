import { describe, expect, it } from 'vitest';
import { groupThreadsByDate, formatThreadTime } from '@/lib/chat-utils';

describe('groupThreadsByDate', () => {
  const now = new Date();
  const today = now.toISOString();
  const yesterday = new Date(now.getTime() - 86400000).toISOString();
  const lastWeek = new Date(now.getTime() - 7 * 86400000).toISOString();

  it('groups threads into Today/Yesterday/Older', () => {
    const threads = [
      { updated_at: today },
      { updated_at: yesterday },
      { updated_at: lastWeek },
    ];
    const groups = groupThreadsByDate(threads);
    expect(groups).toHaveLength(3);
    expect(groups[0].label).toBe('Today');
    expect(groups[0].threads).toHaveLength(1);
    expect(groups[1].label).toBe('Yesterday');
    expect(groups[1].threads).toHaveLength(1);
    expect(groups[2].label).toBe('Older');
    expect(groups[2].threads).toHaveLength(1);
  });

  it('skips empty groups', () => {
    const threads = [{ updated_at: today }];
    const groups = groupThreadsByDate(threads);
    expect(groups).toHaveLength(1);
    expect(groups[0].label).toBe('Today');
  });

  it('handles empty list', () => {
    const groups = groupThreadsByDate([]);
    expect(groups).toHaveLength(0);
  });

  it('multiple threads in same group', () => {
    const t1 = new Date(now.getTime() - 1000).toISOString();
    const t2 = new Date(now.getTime() - 2000).toISOString();
    const threads = [{ updated_at: t1 }, { updated_at: t2 }];
    const groups = groupThreadsByDate(threads);
    expect(groups).toHaveLength(1);
    expect(groups[0].threads).toHaveLength(2);
  });
});

describe('formatThreadTime', () => {
  it('formats ISO string to time', () => {
    const iso = '2026-08-21T14:30:00Z';
    const result = formatThreadTime(iso);
    expect(result).toMatch(/\d{1,2}:\d{2}/);
  });
});
