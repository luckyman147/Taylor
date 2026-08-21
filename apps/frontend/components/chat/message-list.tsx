'use client';

import { useEffect, useRef } from 'react';
import { Loader2 } from 'lucide-react';
import { MessageCard } from './message-card';
import type {
  ToolCard,
  Action,
  PendingAction,
  MemoryCandidate,
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
  onViewFile?: (filename: string, content: string) => void;
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
}: MessageListProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
    });
  }, [messages, loading]);

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
            onConfirm={onConfirm}
            onCancel={onCancel}
            onDismissMemory={onDismissMemory}
            onFollowup={onFollowup}
            onSelectResume={onSelectResume}
            onViewFile={onViewFile}
          />
        ))}

        {/* Loading indicator — spinner below the last message */}
        {loading && (
          <div className="flex justify-start pl-6">
            <Loader2 className="h-5 w-5 animate-spin text-primary" />
          </div>
        )}
      </div>
    </div>
  );
}
