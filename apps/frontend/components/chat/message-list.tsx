'use client';

import { useEffect, useRef } from 'react';
import { MessageCard } from './message-card';
import { StatusTimeline } from './status-timeline';
import type { ToolCard, Action, PendingAction, MemoryCandidate, AgentEvent } from '@/lib/api/chat';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  cards?: ToolCard[];
  actions?: Action[];
  pendingAction?: PendingAction | null;
  memoryCandidates?: MemoryCandidate[];
  followups?: string[];
  sources?: string[];
  modelInfo?: { provider: string; model: string } | null;
  attachment?: { filename: string; resumeId: string } | null;
  messageId?: string;
  version?: number;
  streamEvents?: AgentEvent[];
}

interface MessageListProps {
  messages: ChatMessage[];
  mode?: string;
  loading?: boolean;
  onConfirm?: (token: string) => void;
  onCancel?: (token: string) => void;
  onDismissMemory?: (statement: string) => void;
  onFollowup?: (question: string) => void;
  onSelectResume?: (resumeId: string) => void;
  onCompareResumes?: (names: string[]) => void;
  onViewFile?: (filename: string, resumeId: string) => void;
  onJobSearch?: (query: string, sources?: string[]) => void;
  onViewEmail?: (email: any) => void;
  onAddContact?: (data: { name: string; email?: string; company?: string }) => void;
  onAddCompany?: (data: { name: string; website?: string }) => void;
  onSaveJob?: (data: { title: string; company: string; location?: string; url?: string }) => void;
  onTailorResume?: (data: { job_description: string; company: string; role: string }) => void;
  onClarify?: (intent: string) => void;
  onEdit?: (messageIndex: number, newContent: string) => void;
  onRetry?: (messageIndex: number) => void;
  onRevert?: (messageIndex: number) => void;
  streamEvents?: AgentEvent[];
  streamStatus?: 'running' | 'paused' | 'completed';
}

export function MessageList({
  messages,
  mode = 'ask',
  loading,
  onConfirm,
  onCancel,
  onDismissMemory,
  onFollowup,
  onSelectResume,
  onCompareResumes,
  onViewFile,
  onJobSearch,
  onViewEmail,
  onAddContact,
  onAddCompany,
  onSaveJob,
  onTailorResume,
  onClarify,
  onEdit,
  onRetry,
  onRevert,
  streamEvents = [],
  streamStatus = 'completed',
}: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    });
  }, [messages, loading, streamEvents]);

  return (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto scroll-smooth">
      <div className="mx-auto max-w-3xl space-y-6 px-5 py-6">
        {messages.map((msg, i) => (
          <div key={i}>
            <MessageCard
              role={msg.role}
              content={msg.content}
              mode={mode}
              cards={msg.cards}
              actions={msg.actions}
              pendingAction={msg.pendingAction}
              memoryCandidates={msg.memoryCandidates}
              followups={msg.followups}
              modelInfo={msg.modelInfo}
              attachment={msg.attachment}
              isLast={i === messages.length - 1 && msg.role === 'assistant'}
              messageId={msg.messageId}
              version={msg.version}
              onConfirm={onConfirm}
              onCancel={onCancel}
              onDismissMemory={onDismissMemory}
              onFollowup={onFollowup}
              onSelectResume={onSelectResume}
              onCompareResumes={onCompareResumes}
              onViewFile={onViewFile}
              onJobSearch={onJobSearch}
              onViewEmail={onViewEmail}
              onAddContact={onAddContact}
              onAddCompany={onAddCompany}
              onSaveJob={onSaveJob}
              onTailorResume={onTailorResume}
              onClarify={onClarify}
              onEdit={msg.role === 'user' ? (newContent) => onEdit?.(i, newContent) : undefined}
              onRetry={msg.role === 'user' ? () => onRetry?.(i) : undefined}
              onRevert={
                msg.role === 'assistant' && i === messages.length - 1
                  ? () => onRevert?.(i)
                  : undefined
              }
            />
            {/* Persistent reasoning timeline for assistant messages */}
            {msg.role === 'assistant' && msg.streamEvents && msg.streamEvents.length > 0 && (
              <div className="mt-2 pl-6">
                <StatusTimeline events={msg.streamEvents} status="completed" />
              </div>
            )}
          </div>
        ))}

        {/* Active streaming timeline (while loading) */}
        {loading && streamEvents.length > 0 && (
          <div className="pl-6">
            <StatusTimeline events={streamEvents} status={streamStatus} />
          </div>
        )}

        {/* Fallback: simple loading indicator when no events yet */}
        {loading && streamEvents.length === 0 && (
          <div className="flex items-center gap-2 pl-6 text-sm text-ink-muted">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            <span>Thinking...</span>
          </div>
        )}
      </div>
    </div>
  );
}
