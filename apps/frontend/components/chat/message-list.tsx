'use client';

import { useEffect, useRef } from 'react';
import { MessageCard } from './message-card';
import { StatusTimeline } from './status-timeline';
import type {
  ToolCard,
  Action,
  PendingAction,
  MemoryCandidate,
  AgentEvent,
} from '@/lib/api/chat';

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
  onViewFile?: (filename: string, resumeId: string) => void;
  onJobSearch?: (query: string) => void;
  onViewEmail?: (email: any) => void;
  onAddContact?: (data: { name: string; email?: string; company?: string }) => void;
  onAddCompany?: (data: { name: string; website?: string }) => void;
  onSaveJob?: (data: { title: string; company: string; location?: string; url?: string }) => void;
  onTailorResume?: (data: { job_description: string; company: string; role: string }) => void;
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
  onViewFile,
  onJobSearch,
  onViewEmail,
  onAddContact,
  onAddCompany,
  onSaveJob,
  onTailorResume,
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
          <MessageCard
            key={i}
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
            onConfirm={onConfirm}
            onCancel={onCancel}
            onDismissMemory={onDismissMemory}
            onFollowup={onFollowup}
            onSelectResume={onSelectResume}
            onViewFile={onViewFile}
            onJobSearch={onJobSearch}
            onViewEmail={onViewEmail}
            onAddContact={onAddContact}
            onAddCompany={onAddCompany}
            onSaveJob={onSaveJob}
            onTailorResume={onTailorResume}
          />
        ))}

        {/* Streaming status timeline (replaces the simple Thinking... indicator) */}
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
