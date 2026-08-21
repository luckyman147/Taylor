'use client';

import { MessageCircle, Target, Briefcase, BarChart3 } from 'lucide-react';
import { MarkdownContent } from '@/components/common/markdown-content';
import { ToolCards } from './tool-cards';
import { ConfirmCard } from './confirm-card';
import { MemoryCard } from './memory-card';
import type { ToolCard, Action, PendingAction, MemoryCandidate } from '@/lib/api/chat';

const MODE_CONFIG: Record<string, { icon: React.ComponentType<{ className?: string }>; label: string }> = {
  ask: { icon: MessageCircle, label: 'Ask' },
  coach: { icon: Target, label: 'Coach' },
  recruiter: { icon: Briefcase, label: 'Recruiter' },
  resume_analyst: { icon: BarChart3, label: 'Resume' },
};

interface MessageCardProps {
  role: 'user' | 'assistant';
  content: string;
  mode?: string;
  cards?: ToolCard[];
  actions?: Action[];
  pendingAction?: PendingAction | null;
  memoryCandidates?: MemoryCandidate[];
  followups?: string[];
  onConfirm?: (token: string) => void;
  onCancel?: (token: string) => void;
  onDismissMemory?: (statement: string) => void;
  onFollowup?: (question: string) => void;
}

export function MessageCard({
  role,
  content,
  mode = 'ask',
  cards = [],
  actions = [],
  pendingAction,
  memoryCandidates = [],
  followups = [],
  onConfirm,
  onCancel,
  onDismissMemory,
  onFollowup,
}: MessageCardProps) {
  const isUser = role === 'user';

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[78%] rounded-2xl rounded-br-sm bg-primary px-4 py-3 text-[15px] leading-relaxed text-white">
          <span className="whitespace-pre-wrap">{content}</span>
        </div>
      </div>
    );
  }

  // Assistant message — no bubble, full-width, left accent bar
  return (
    <div className="flex justify-start">
      <div className="w-full max-w-3xl space-y-3">
        {/* Header: mode icon + label */}
        <div className="flex items-center gap-2">
          {(() => {
            const config = MODE_CONFIG[mode];
            if (!config) return null;
            const Icon = config.icon;
            return <Icon className="h-4 w-4 text-primary" />;
          })()}
          <span className="text-xs font-semibold text-ink-soft">
            Taylor · {MODE_CONFIG[mode]?.label || mode}
          </span>
        </div>

        {/* Message content — full-width, no bubble, left accent bar */}
        <div className="border-l-2 border-primary pl-4">
          <div className="text-[15px] leading-relaxed text-ink">
            <MarkdownContent content={content} />
          </div>
        </div>

        {/* Tool result cards */}
        {cards.length > 0 && (
          <ToolCards cards={cards} />
        )}

        {/* Pending action confirmation */}
        {pendingAction && onConfirm && onCancel && (
          <ConfirmCard
            pendingAction={pendingAction}
            onConfirm={onConfirm}
            onCancel={onCancel}
          />
        )}

        {/* Memory candidates */}
        {memoryCandidates.length > 0 && onDismissMemory && (
          <MemoryCard
            candidates={memoryCandidates}
            onDismiss={onDismissMemory}
          />
        )}

        {/* Follow-up suggestions */}
        {followups.length > 0 && onFollowup && (
          <div className="flex flex-wrap gap-2">
            {followups.map((q, i) => (
              <button
                key={i}
                onClick={() => onFollowup(q)}
                className="rounded-full border border-[#e6e3dc] bg-[#faf9f7] px-3 py-1.5 text-xs font-medium text-ink-soft transition-colors hover:bg-[#e6e3dc]"
              >
                {q}
              </button>
            ))}
          </div>
        )}

        {/* Action links */}
        {actions.length > 0 && (
          <div className="flex gap-2">
            {actions.map((action, i) => (
              <a
                key={i}
                href={action.href || '#'}
                className="rounded-lg bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/20"
              >
                {action.label}
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
