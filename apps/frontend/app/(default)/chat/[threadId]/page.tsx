'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Send, Loader2, Sparkles, Upload, FileText } from 'lucide-react';
import SidebarNav from '@/components/common/SidebarNav';
import { ThreadSidebar } from '@/components/chat/thread-sidebar';
import { MessageList, type ChatMessage } from '@/components/chat/message-list';
import { ModeSwitcher } from '@/components/chat/mode-switcher';
import { ModelBadge } from '@/components/chat/model-badge';
import { FileViewerDialog } from '@/components/chat/file-viewer-dialog';
import { useTranslations } from '@/lib/i18n';
import {
  createThread,
  sendTurn,
  confirmAction,
  cancelAction,
  dismissMemory,
  updateThread,
  getThreadMessages,
  type ThreadSummary,
  type TurnResponse,
} from '@/lib/api/chat';

const SUGGESTED_QUESTIONS = [
  'chat.suggestions.q1',
  'chat.suggestions.q2',
  'chat.suggestions.q3',
  'chat.suggestions.q4',
];

export default function ChatThreadRoute() {
  const router = useRouter();
  const params = useParams();
  const { t } = useTranslations();
  const threadId = params.threadId as string;

  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [activeThread, setActiveThread] = useState<ThreadSummary | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [fileViewer, setFileViewer] = useState<{ filename: string; content: string } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const inFlight = useRef(false);

  // Load threads and find active one
  useEffect(() => {
    import('@/lib/api/chat').then(({ listThreads }) =>
      listThreads().then((data) => {
        setThreads(data);
        const found = data.find((t) => t.thread_id === threadId);
        if (found) setActiveThread(found);
      }).catch(() => {}),
    );
  }, [refreshKey, threadId]);

  // Load messages when thread changes
  useEffect(() => {
    if (!threadId) return;
    setMessages([]);
    getThreadMessages(threadId)
      .then((msgs) => {
        const mapped: ChatMessage[] = msgs.map((m) => ({
          role: m.role,
          content: m.content,
          cards: m.envelope?.cards,
          actions: m.envelope?.actions,
          pendingAction: m.envelope?.pending_action ?? null,
          memoryCandidates: [],
          followups: m.envelope?.followups,
          sources: m.envelope?.sources,
        }));
        setMessages(mapped);
      })
      .catch(() => {});
  }, [threadId]);

  const handleNewThread = useCallback(
    (newId: string) => {
      setRefreshKey((k) => k + 1);
      router.push(`/chat/${newId}`);
    },
    [router],
  );

  const handleSelectThread = useCallback(
    (id: string) => {
      router.push(`/chat/${id}`);
    },
    [router],
  );

  const handleDeleteThread = useCallback(
    (deletedId: string) => {
      setThreads((prev) => prev.filter((t) => t.thread_id !== deletedId));
      if (threadId === deletedId) {
        router.push('/chat');
      }
      setRefreshKey((k) => k + 1);
    },
    [threadId, router],
  );

  const handleModeChange = useCallback(
    async (mode: string) => {
      if (!activeThread) return;
      try {
        await updateThread(activeThread.thread_id, { mode });
        setActiveThread((prev) => (prev ? { ...prev, mode } : null));
      } catch {}
    },
    [activeThread],
  );

  const processResponse = useCallback((resp: TurnResponse): ChatMessage => {
    return {
      role: 'assistant',
      content: resp.assistant_content,
      cards: resp.cards,
      actions: resp.actions,
      pendingAction: resp.pending_action,
      memoryCandidates: resp.memory_candidates,
      followups: resp.followups,
      sources: resp.sources,
      modelInfo: resp.model_info,
    };
  }, []);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if ((!trimmed && !selectedFile) || inFlight.current) return;
      inFlight.current = true;

      let currentThreadId = threadId;
      if (!currentThreadId) {
        try {
          const thread = await createThread('ask');
          currentThreadId = thread.thread_id;
          setActiveThread(thread);
          setThreads((prev) => [thread, ...prev]);
          router.push(`/chat/${currentThreadId}`);
        } catch {
          setError('Failed to create thread');
          inFlight.current = false;
          return;
        }
      }

      // Upload file first if attached
      let message = trimmed;
      let attachment: { filename: string; resumeId: string } | null = null;
      if (selectedFile) {
        try {
          const { getUploadUrl } = await import('@/lib/api/client');
          const formData = new FormData();
          formData.append('file', selectedFile);
          const res = await fetch(getUploadUrl(), { method: 'POST', body: formData });
          if (!res.ok) throw new Error(`Upload failed (${res.status})`);
          const data = await res.json();
          setRefreshKey((k) => k + 1);
          const fileName = selectedFile.name;
          const resumeId = data.resume_id;
          attachment = { filename: fileName, resumeId };
          setSelectedFile(null);
          message = trimmed
            ? `I uploaded "${fileName}". ${trimmed}`
            : `I uploaded "${fileName}". Analyze it.`;
        } catch (e) {
          setError(e instanceof Error ? e.message : 'Upload failed');
          inFlight.current = false;
          return;
        }
      }

      const userMessage: ChatMessage = { role: 'user', content: message, attachment };
      setMessages((prev) => [...prev, userMessage]);
      setInput('');
      setSending(true);
      setError(null);

      try {
        const resp = await sendTurn(currentThreadId, message);
        const assistantMsg = processResponse(resp);
        setMessages((prev) => [...prev, assistantMsg]);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setMessages((prev) => prev.filter((m) => m !== userMessage));
      } finally {
        setSending(false);
        inFlight.current = false;
        setRefreshKey((k) => k + 1);
      }
    },
    [threadId, processResponse, router, selectedFile],
  );

  const handleConfirm = useCallback(
    async (token: string) => {
      try {
        const result = await confirmAction(token);
        setMessages((prev) => {
          const updated = [...prev];
          const lastIdx = updated.length - 1;
          if (lastIdx >= 0 && updated[lastIdx].pendingAction) {
            updated[lastIdx] = {
              ...updated[lastIdx],
              pendingAction: null,
              content: `${updated[lastIdx].content}\n\n✅ ${result.message}`,
            };
          }
          return updated;
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [],
  );

  const handleCancel = useCallback(
    async (token: string) => {
      try {
        await cancelAction(token);
        setMessages((prev) => {
          const updated = [...prev];
          const lastIdx = updated.length - 1;
          if (lastIdx >= 0 && updated[lastIdx].pendingAction) {
            updated[lastIdx] = {
              ...updated[lastIdx],
              pendingAction: null,
            };
          }
          return updated;
        });
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [],
  );

  const handleDismissMemory = useCallback(async (statement: string) => {
    try {
      await dismissMemory(statement);
    } catch {}
  }, []);

  const handleFollowup = useCallback(
    (question: string) => {
      void send(question);
    },
    [send],
  );

  const handleSelectResume = useCallback(
    (resumeId: string) => {
      void send(`audit resume ${resumeId}`);
    },
    [send],
  );

  const handleViewFile = useCallback(
    async (filename: string, resumeId: string) => {
      try {
        const { getResumeContent } = await import('@/lib/api/chat');
        const data = await getResumeContent(resumeId);
        setFileViewer({ filename: data.filename, content: data.content });
      } catch {
        setFileViewer({ filename, content: '(Failed to load file content)' });
      }
    },
    [],
  );

  const isEmpty = messages.length === 0;

  return (
    <div className="flex h-[100dvh] w-full flex-col overflow-hidden bg-white pl-16">
      <SidebarNav currentPage="chat" onNavigate={(page) => router.push(page)} />
      <main className="flex min-h-0 flex-1 w-full max-w-[104rem] flex-col">
        <div className="flex min-h-0 flex-1">
          {/* Thread sidebar */}
          <ThreadSidebar
            activeThreadId={threadId ?? null}
            onSelectThread={handleSelectThread}
            onNewThread={handleNewThread}
            onDeleteThread={handleDeleteThread}
            refreshKey={refreshKey}
          />

          {/* Main chat area */}
          <div className="flex min-h-0 flex-1 flex-col">
            {/* Messages or empty state */}
            {isEmpty ? (
              <div className="flex min-h-0 flex-1 flex-col items-center justify-center p-8">
                <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
                  <Sparkles className="h-8 w-8 text-primary" />
                </div>
                <h2 className="mb-2 text-[26px] font-bold leading-tight text-ink">
                  {t('chat.empty.title')}
                </h2>
                <p className="mb-8 max-w-md text-center text-sm leading-relaxed text-ink-soft">
                  {t('chat.empty.description')}
                </p>
                <div className="flex flex-wrap justify-center gap-2.5">
                  {SUGGESTED_QUESTIONS.map((key) => (
                    <button
                      key={key}
                      onClick={() => void send(t(key))}
                      className="rounded-full border border-[#e6e3dc] bg-[#faf9f7] px-4 py-2 text-sm font-medium text-ink-soft transition-colors hover:border-primary/25 hover:bg-primary/5 hover:text-primary"
                    >
                      {t(key)}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <MessageList
                messages={messages}
                mode={activeThread?.mode || 'ask'}
                loading={sending}
                onConfirm={handleConfirm}
                onCancel={handleCancel}
                onDismissMemory={handleDismissMemory}
                onFollowup={handleFollowup}
                onSelectResume={handleSelectResume}
                onViewFile={handleViewFile}
              />
            )}

            {/* Error */}
            {error && (
              <div className="px-5 py-1 text-center text-xs text-destructive">{error}</div>
            )}

            {/* Composer */}
            <div className="mx-auto w-full max-w-3xl px-5 pb-5">
              {/* Mode toggles above input */}
              <div className="mb-2.5 flex items-center justify-center gap-3">
                <ModeSwitcher
                  currentMode={activeThread?.mode || 'ask'}
                  onModeChange={handleModeChange}
                  disabled={!activeThread}
                />
                <ModelBadge />
              </div>

              {/* Input pill */}
              <div className="rounded-[25px] border border-[#e2e0d8] bg-[#f8f7f5] shadow-sw-xs transition-shadow focus-within:shadow-sw-sm focus-within:border-primary/30">
                {/* File attachment chip */}
                {selectedFile && (
                  <div className="flex items-center gap-2 border-b border-[#e6e3dc] px-4 py-2">
                    <div className="flex items-center gap-2 rounded-lg border border-[#e6e3dc] bg-white px-2.5 py-1.5">
                      <FileText className="h-4 w-4 text-blue-500" />
                      <span className="max-w-[150px] truncate text-xs font-medium text-ink">{selectedFile.name}</span>
                      <button
                        onClick={() => setSelectedFile(null)}
                        className="ml-1 text-ink-muted hover:text-ink"
                      >
                        ×
                      </button>
                    </div>
                  </div>
                )}

                <div className="flex items-end">
                  <label className="flex h-9 w-9 shrink-0 items-center justify-center m-2 cursor-pointer rounded-full text-ink-muted transition-colors hover:bg-[#e6e3dc] hover:text-ink-soft">
                    <Upload className="h-4 w-4" />
                    <input
                      type="file"
                      accept=".pdf,.doc,.docx,.md,.txt"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) setSelectedFile(file);
                        e.target.value = '';
                      }}
                    />
                  </label>
                  <textarea
                    ref={textareaRef}
                    rows={1}
                    value={input}
                    onChange={(e) => {
                      setInput(e.target.value);
                      e.target.style.height = 'auto';
                      e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        void send(input);
                      }
                    }}
                    placeholder={t('chat.placeholder')}
                    className="min-h-[48px] max-h-[160px] flex-1 resize-none bg-transparent px-5 py-3.5 text-[15px] leading-relaxed text-ink outline-none placeholder:text-ink-muted"
                  />
                  <button
                    onClick={() => void send(input)}
                    disabled={sending || (!input.trim() && !selectedFile)}
                    className="m-2 flex h-9 w-9 items-center justify-center rounded-full bg-primary text-white transition-colors hover:bg-[#17304f] disabled:opacity-40"
                  >
                    {sending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* File viewer dialog */}
      <FileViewerDialog
        isOpen={!!fileViewer}
        onClose={() => setFileViewer(null)}
        filename={fileViewer?.filename || ''}
        content={fileViewer?.content || ''}
      />
    </div>
  );
}
