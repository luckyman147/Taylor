'use client';

import { useEffect, useState } from 'react';
import { Plus, Trash2, MessageSquare } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslations } from '@/lib/i18n';
import {
  listThreads,
  createThread,
  deleteThread,
  type ThreadSummary,
} from '@/lib/api/chat';
import { groupThreadsByDate, formatThreadTime } from '@/lib/chat-utils';

interface ThreadSidebarProps {
  activeThreadId: string | null;
  onSelectThread: (threadId: string) => void;
  onNewThread: (threadId: string) => void;
  onDeleteThread?: (threadId: string) => void;
  refreshKey?: number;
}

const MODE_ICONS: Record<string, string> = {
  ask: '💬',
  coach: '🎯',
  recruiter: '👔',
  resume_analyst: '📊',
};

export function ThreadSidebar({
  activeThreadId,
  onSelectThread,
  onNewThread,
  onDeleteThread,
  refreshKey,
}: ThreadSidebarProps) {
  const { t } = useTranslations();
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listThreads()
      .then((data) => {
        if (!cancelled) setThreads(data);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  const handleCreate = async () => {
    try {
      const thread = await createThread('ask');
      setThreads((prev) => [thread, ...prev]);
      onNewThread(thread.thread_id);
    } catch {}
  };

  const handleDelete = async (e: React.MouseEvent, threadId: string) => {
    e.stopPropagation();
    try {
      await deleteThread(threadId);
      setThreads((prev) => prev.filter((t) => t.thread_id !== threadId));
      onDeleteThread?.(threadId);
    } catch {}
  };

  const groups = groupThreadsByDate(threads);

  return (
    <div className="flex h-full w-64 flex-col border-r border-[#e6e3dc] bg-[#faf9f7]">
      {/* New Chat button */}
      <div className="p-3">
        <button
          onClick={() => void handleCreate()}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-[#e6e3dc] bg-white px-3 py-2.5 text-sm font-medium text-ink transition-colors hover:bg-[#f0ece4]"
        >
          <Plus className="h-4 w-4" />
          {t('chat.sidebar.newThread')}
        </button>
      </div>

      {/* Thread list */}
      <div className="min-h-0 flex-1 overflow-y-auto px-2">
        {loading && (
          <div className="p-4 text-center text-xs text-ink-soft">
            {t('chat.sidebar.loading')}
          </div>
        )}

        {!loading && threads.length === 0 && (
          <div className="p-4 text-center text-xs text-ink-soft">
            {t('chat.sidebar.empty')}
          </div>
        )}

        {groups.map((group) => (
          <div key={group.label} className="mb-2">
            <div className="px-2 pt-3 pb-1 text-[10px] font-bold uppercase tracking-wider text-ink-muted">
              {group.label}
            </div>
            {group.threads.map((thread) => (
              <button
                key={thread.thread_id}
                onClick={() => onSelectThread(thread.thread_id)}
                className={cn(
                  'group flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2.5 text-left transition-colors hover:bg-[#e6e3dc]/40',
                  activeThreadId === thread.thread_id
                    ? 'border-l-2 border-primary bg-primary/5 pl-2'
                    : 'border-l-2 border-transparent',
                )}
              >
                <MessageSquare className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-muted" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-medium text-ink">
                      {thread.title}
                    </span>
                  </div>
                  {thread.last_preview && (
                    <p className="mt-0.5 truncate text-xs text-ink-soft">
                      {thread.last_preview}
                    </p>
                  )}
                  <div className="mt-1 flex items-center gap-2">
                    <span className="text-[10px] text-ink-muted">
                      {MODE_ICONS[thread.mode] || '💬'}
                    </span>
                    <span className="text-[10px] text-ink-muted">
                      {formatThreadTime(thread.updated_at)}
                    </span>
                    <span className="text-[10px] text-ink-muted">
                      {thread.message_count} {t('chat.sidebar.messages')}
                    </span>
                  </div>
                </div>
                <button
                  onClick={(e) => void handleDelete(e, thread.thread_id)}
                  className="mt-0.5 shrink-0 rounded p-0.5 text-ink-muted opacity-0 group-hover:opacity-100 hover:text-destructive"
                  aria-label={t('chat.sidebar.deleteThread')}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
