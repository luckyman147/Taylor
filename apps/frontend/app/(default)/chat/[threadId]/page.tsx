'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Send, Loader2, Sparkles, Plus, FileText, Paperclip, Plug, MessageCircle, Target, Briefcase, CheckCircle2, Pause } from 'lucide-react';
import SidebarNav from '@/components/common/SidebarNav';
import { ThreadSidebar } from '@/components/chat/thread-sidebar';
import { MessageList, type ChatMessage } from '@/components/chat/message-list';
import { ModeSkillSelector } from '@/components/chat/mode-switcher';
import { ModelBadge } from '@/components/chat/model-badge';
import { EvalPanel } from '@/components/chat/eval-panel';
import { AddMCPDialog } from '@/components/chat/add-mcp-dialog';
import { FileViewerDialog } from '@/components/chat/file-viewer-dialog';
import { EmailBodyDialog } from '@/components/chat/email-body-dialog';
import { ContactDialog } from '@/components/chat/contact-dialog';
import { CompanyDialog } from '@/components/chat/company-dialog';
import { SaveJobDialog } from '@/components/chat/save-job-dialog';
import { TailorDialog } from '@/components/chat/tailor-dialog';
import { StatusTimeline } from '@/components/chat/status-timeline';
import { useTranslations } from '@/lib/i18n';
import {
  createThread,
  sendTurn,
  sendTurnStream,
  confirmAction,
  cancelAction,
  dismissMemory,
  updateThread,
  getThreadMessages,
  type ThreadSummary,
  type TurnResponse,
  type AgentEvent,
} from '@/lib/api/chat';

const SUGGESTED_QUESTIONS = [
  'chat.suggestions.q1',
  'chat.suggestions.q2',
  'chat.suggestions.q3',
  'chat.suggestions.q4',
];

const MODES = [
  { id: 'ask', icon: MessageCircle, label: 'Ask' },
  { id: 'agent', icon: Target, label: 'Agent' },
  { id: 'search', icon: Briefcase, label: 'Search' },
];

const SKILLS = [
  { id: 'coach', label: 'Career Coach', icon: '🎯' },
  { id: 'recruiter', label: 'Recruiter', icon: '👔' },
  { id: 'resume_analyst', label: 'Resume Analyst', icon: '📊' },
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
  const [uploading, setUploading] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<{ filename: string; resumeId: string } | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [fileViewer, setFileViewer] = useState<{ filename: string; content: string } | null>(null);
  const [showPlusMenu, setShowPlusMenu] = useState(false);
  const [showMCPDialog, setShowMCPDialog] = useState(false);
  const [streamEvents, setStreamEvents] = useState<AgentEvent[]>([]);
  const [streamStatus, setStreamStatus] = useState<'running' | 'paused' | 'completed'>('completed');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const inFlight = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const plusMenuRef = useRef<HTMLDivElement>(null);

  // Abort stream on unmount
  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

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

  const handleSkillsChange = useCallback(
    async (skills: string[]) => {
      if (!activeThread) return;
      try {
        await updateThread(activeThread.thread_id, { skills });
        setActiveThread((prev) => (prev ? { ...prev, skills } : null));
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

  const handleFileSelect = useCallback(async (file: File) => {
    setSelectedFile(file);
    setUploadedFile(null);
    setUploading(true);
    setError(null);
    try {
      const { getUploadUrl } = await import('@/lib/api/client');
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch(getUploadUrl(), { method: 'POST', body: formData });
      if (!res.ok) throw new Error(`Upload failed (${res.status})`);
      const data = await res.json();
      setRefreshKey((k) => k + 1);
      setUploadedFile({ filename: file.name, resumeId: data.resume_id });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
      setSelectedFile(null);
    } finally {
      setUploading(false);
    }
  }, []);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if ((!trimmed && !uploadedFile) || inFlight.current || uploading) return;
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

      const message = trimmed || 'Analyze this file.';
      const attachment = uploadedFile;

      const finalMessage = attachment?.resumeId
        ? `${message}\n\n[Attached resume: ${attachment.filename} (id: ${attachment.resumeId})]`
        : message;

      const userMessage: ChatMessage = { role: 'user', content: message, attachment };
      setMessages((prev) => [...prev, userMessage]);
      setInput('');
      setSending(true);
      setStreamEvents([]);
      setStreamStatus('running');
      setError(null);
      setSelectedFile(null);
      setUploadedFile(null);

      try {
        const controller = await sendTurnStream(
          currentThreadId,
          finalMessage,
          attachment?.resumeId,
          {
            onEvent: (event) => {
              setStreamEvents((prev) => [...prev, event]);
            },
            onComplete: (resp) => {
              const assistantMsg = processResponse(resp);
              setMessages((prev) => [...prev, assistantMsg]);
              setStreamStatus('completed');
            },
            onError: (err) => {
              setError(err.message);
              setMessages((prev) => prev.filter((m) => m !== userMessage));
              setStreamStatus('completed');
            },
          },
        );
        abortControllerRef.current = controller;
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setMessages((prev) => prev.filter((m) => m !== userMessage));
        setStreamStatus('completed');
      } finally {
        setSending(false);
        inFlight.current = false;
        setRefreshKey((k) => k + 1);
      }
    },
    [threadId, processResponse, router, uploadedFile, uploading],
  );

  const handlePause = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setSending(false);
    setStreamStatus('paused');
    inFlight.current = false;
  }, []);

  const handleConfirm = useCallback(
    async (token: string) => {
      if (!threadId) return;
      try {
        const result = await confirmAction(token, threadId);

        // Update message: remove pending action, add result card
        setMessages((prev) => {
          const updated = [...prev];
          const idx = updated.findLastIndex((m) => m.pendingAction);
          if (idx >= 0) {
            const existingCards = updated[idx].cards || [];
            const resultCards = result.result_card ? [result.result_card] : [];
            updated[idx] = {
              ...updated[idx],
              pendingAction: null,
              content: `${updated[idx].content}\n\n✅ ${result.message}`,
              cards: [...existingCards, ...resultCards],
            };
          }
          return updated;
        });

        // Trigger a follow-up AI turn to analyze the results
        if (result.ok && result.result_card) {
          setSending(true);
          setStreamEvents([]);
          setStreamStatus('running');
          try {
            await sendTurnStream(
              threadId,
              'Analyze these search results and provide insights.',
              undefined,
              {
                onEvent: (event) => setStreamEvents((prev) => [...prev, event]),
                onComplete: (resp) => {
                  const assistantMsg = processResponse(resp);
                  setMessages((prev) => [...prev, assistantMsg]);
                  setStreamStatus('completed');
                },
                onError: (err) => {
                  setError(err.message);
                  setStreamStatus('completed');
                },
              },
            );
          } catch {
            setStreamStatus('completed');
          } finally {
            setSending(false);
            inFlight.current = false;
          }
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        // Clear pendingAction so ConfirmCard doesn't stay spinner-locked
        setMessages((prev) =>
          prev.map((m) =>
            m.pendingAction ? { ...m, pendingAction: null } : m,
          ),
        );
      }
    },
    [threadId, processResponse],
  );

  const handleCancel = useCallback(
    async (token: string) => {
      try {
        await cancelAction(token);
        setMessages((prev) => {
          const updated = [...prev];
          const idx = updated.findLastIndex((m) => m.pendingAction);
          if (idx >= 0) {
            updated[idx] = {
              ...updated[idx],
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

  // Email dialog state
  const [emailDialog, setEmailDialog] = useState<{ open: boolean; email: any }>({ open: false, email: null });
  const [contactDialog, setContactDialog] = useState<{ open: boolean; data: { name: string; email?: string; company?: string } }>({ open: false, data: { name: '' } });
  const [companyDialog, setCompanyDialog] = useState<{ open: boolean; data: { name: string; website?: string } }>({ open: false, data: { name: '' } });
  const [saveJobDialog, setSaveJobDialog] = useState<{ open: boolean; data: { title: string; company: string; location?: string; url?: string } }>({ open: false, data: { title: '', company: '' } });
  const [tailorDialog, setTailorDialog] = useState<{ open: boolean; data: { job_description: string; company: string; role: string } }>({ open: false, data: { job_description: '', company: '', role: '' } });

  const handleViewEmail = useCallback((email: any) => {
    setEmailDialog({ open: true, email });
  }, []);

  const handleAddContact = useCallback((data: { name: string; email?: string; company?: string }) => {
    setContactDialog({ open: true, data });
  }, []);

  const handleAddCompany = useCallback((data: { name: string; website?: string }) => {
    setCompanyDialog({ open: true, data });
  }, []);

  const handleSaveJob = useCallback((data: { title: string; company: string; location?: string; url?: string }) => {
    setSaveJobDialog({ open: true, data });
  }, []);

  const handleTailorResume = useCallback((data: { job_description: string; company: string; role: string }) => {
    setTailorDialog({ open: true, data });
  }, []);

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
                onJobSearch={handleFollowup}
                onViewEmail={handleViewEmail}
                onAddContact={handleAddContact}
                onAddCompany={handleAddCompany}
                onSaveJob={handleSaveJob}
                onTailorResume={handleTailorResume}
                streamEvents={streamEvents}
                streamStatus={streamStatus}
              />
            )}

            {/* Error */}
            {error && (
              <div className="px-5 py-1 text-center text-xs text-destructive">{error}</div>
            )}

            {/* Eval Panel (temporary testing) */}
            <EvalPanel
              lastUserMessage={
                messages.length > 0
                  ? [...messages].reverse().find((m) => m.role === 'user')?.content || ''
                  : ''
              }
            />

            {/* Composer */}
            <div className="mx-auto w-full max-w-3xl px-5 pb-5">
              {/* Input pill */}
              <div className="rounded-[25px] border border-[#e2e0d8] bg-[#f8f7f5] shadow-sw-xs transition-shadow focus-within:shadow-sw-sm focus-within:border-primary/30">
                {/* File attachment chip */}
                {(selectedFile || uploadedFile) && (
                  <div className="flex items-center gap-2 border-b border-[#e6e3dc] px-4 py-2">
                    <div className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 ${
                      uploadedFile ? 'border-emerald-200 bg-emerald-50' : 'border-[#e6e3dc] bg-white'
                    }`}>
                      {uploading ? (
                        <Loader2 className="h-4 w-4 text-primary animate-spin" />
                      ) : uploadedFile ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                      ) : (
                        <FileText className="h-4 w-4 text-blue-500" />
                      )}
                      <span className="max-w-[150px] truncate text-xs font-medium text-ink">
                        {selectedFile?.name || uploadedFile?.filename}
                      </span>
                      {uploading && (
                        <span className="text-[10px] text-ink-muted">Uploading...</span>
                      )}
                      {!uploading && (
                        <button
                          onClick={() => { setSelectedFile(null); setUploadedFile(null); }}
                          className="ml-1 text-ink-muted hover:text-ink"
                        >
                          ×
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {/* Top row: mode/skill selector + model badge */}
                <div className="flex items-center justify-between px-4 pt-2.5 pb-1">
                  {/* Mode + Skill selector */}
                  <ModeSkillSelector
                    currentMode={activeThread?.mode || 'ask'}
                    currentSkills={activeThread?.skills || []}
                    onModeChange={handleModeChange}
                    onSkillsChange={handleSkillsChange}
                    disabled={!activeThread}
                  />

                  {/* Model badge */}
                  <ModelBadge />
                </div>

                <div className="flex items-end">
                  {/* + Button with menu */}
                  <div className="relative m-2" ref={plusMenuRef}>
                    <button
                      onClick={() => setShowPlusMenu(!showPlusMenu)}
                      className="flex h-9 w-9 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-[#e6e3dc] hover:text-ink-soft"
                    >
                      <Plus className="h-4 w-4" />
                    </button>

                    {showPlusMenu && (
                      <>
                        <div className="fixed inset-0 z-40" onClick={() => setShowPlusMenu(false)} />
                        <div className="absolute bottom-full left-0 z-50 mb-2 w-48 rounded-xl border border-[#e6e3dc] bg-white py-1.5 shadow-lg">
                          <button
                            onClick={() => {
                              setShowPlusMenu(false);
                              document.getElementById('chat-file-input')?.click();
                            }}
                            className="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-ink hover:bg-[#faf9f7] transition-colors"
                          >
                            <Paperclip className="h-4 w-4 text-ink-muted" />
                            Upload File
                          </button>
                          <button
                            onClick={() => {
                              setShowPlusMenu(false);
                              setShowMCPDialog(true);
                            }}
                            className="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-ink hover:bg-[#faf9f7] transition-colors"
                          >
                            <Plug className="h-4 w-4 text-ink-muted" />
                            MCP Servers
                          </button>
                        </div>
                      </>
                    )}
                  </div>

                  {/* Hidden file input */}
                  <input
                    id="chat-file-input"
                    type="file"
                    accept=".pdf,.doc,.docx,.md,.txt"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void handleFileSelect(file);
                      e.target.value = '';
                    }}
                  />
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
                    onClick={() => {
                      if (sending) {
                        handlePause();
                      } else {
                        void send(input);
                      }
                    }}
                    disabled={!sending && (uploading || (!input.trim() && !uploadedFile))}
                    className="m-2 flex h-9 w-9 items-center justify-center rounded-full bg-primary text-white transition-colors hover:bg-[#17304f] disabled:opacity-40"
                  >
                    {sending ? (
                      <Pause className="h-4 w-4" />
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

      {/* Email body dialog */}
      <EmailBodyDialog
        isOpen={emailDialog.open}
        onClose={() => setEmailDialog({ open: false, email: null })}
        email={emailDialog.email}
        onAddContact={handleAddContact}
        onAddCompany={handleAddCompany}
        onSaveJob={handleSaveJob}
        onTailorResume={handleTailorResume}
      />

      {/* Contact dialog */}
      <ContactDialog
        isOpen={contactDialog.open}
        onClose={() => setContactDialog({ open: false, data: { name: '' } })}
        initialData={contactDialog.data}
        onCreated={() => {}}
      />

      {/* Company dialog */}
      <CompanyDialog
        isOpen={companyDialog.open}
        onClose={() => setCompanyDialog({ open: false, data: { name: '' } })}
        initialData={companyDialog.data}
        onCreated={() => {}}
      />

      {/* Save job dialog */}
      <SaveJobDialog
        isOpen={saveJobDialog.open}
        onClose={() => setSaveJobDialog({ open: false, data: { title: '', company: '' } })}
        initialData={saveJobDialog.data}
        threadId={threadId}
        onSaved={() => {}}
      />

      {/* Tailor resume dialog */}
      <TailorDialog
        isOpen={tailorDialog.open}
        onClose={() => setTailorDialog({ open: false, data: { job_description: '', company: '', role: '' } })}
        initialData={tailorDialog.data}
        onTailor={(resumeId, jd, company, role) => {
          void send(`Tailor resume ${resumeId} for ${role} at ${company}`);
        }}
      />

      {/* MCP add dialog */}
      <AddMCPDialog
        open={showMCPDialog}
        onClose={() => setShowMCPDialog(false)}
      />
    </div>
  );
}
