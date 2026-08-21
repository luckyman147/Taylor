/**
 * Date grouping utilities for chat thread sidebar.
 */

export function groupThreadsByDate<T extends { updated_at: string }>(
  threads: T[],
): { label: string; threads: T[] }[] {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const groups: Record<string, typeof threads> = {
    Today: [],
    Yesterday: [],
    Older: [],
  };

  for (const thread of threads) {
    const d = new Date(thread.updated_at);
    const threadDay = new Date(d.getFullYear(), d.getMonth(), d.getDate());

    if (threadDay.getTime() >= today.getTime()) {
      groups.Today.push(thread);
    } else if (threadDay.getTime() >= yesterday.getTime()) {
      groups.Yesterday.push(thread);
    } else {
      groups.Older.push(thread);
    }
  }

  return [
    { label: 'Today', threads: groups.Today },
    { label: 'Yesterday', threads: groups.Yesterday },
    { label: 'Older', threads: groups.Older },
  ].filter((g) => g.threads.length > 0);
}

export function formatThreadTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}
