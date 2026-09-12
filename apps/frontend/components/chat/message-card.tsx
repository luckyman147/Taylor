'use client';

import { MessageCircle, Target, Briefcase, BarChart3, FileText, Eye } from 'lucide-react';
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
  modelInfo?: { provider: string; model: string } | null;
  attachment?: { filename: string; resumeId: string } | null;
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
  modelInfo,
  attachment,
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
}: MessageCardProps) {
  const isUser = role === 'user';

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[78%] space-y-1.5">
          {attachment && (
            <div className="flex items-center gap-2 rounded-2xl rounded-br-sm bg-primary/90 px-3 py-2">
              <FileText className="h-4 w-4 shrink-0 text-white/80" />
              <span className="truncate text-sm font-medium text-white">{attachment.filename}</span>
              <button
                onClick={() => onViewFile?.(attachment.filename, attachment.resumeId)}
                className="ml-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/20 text-white transition-colors hover:bg-white/30"
              >
                <Eye className="h-3 w-3" />
              </button>
            </div>
          )}
          <div className="rounded-2xl rounded-br-sm bg-primary px-4 py-3 text-[15px] leading-relaxed text-white">
            <span className="whitespace-pre-wrap">{content}</span>
          </div>
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
          <ToolCards cards={cards} onSelectResume={onSelectResume} onViewFile={onViewFile} onJobSearch={onJobSearch} onViewEmail={onViewEmail} onAddContact={onAddContact} onAddCompany={onAddCompany} onSaveJob={onSaveJob} onTailorResume={onTailorResume} />
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

        {/* Model provider badge */}
        {modelInfo && (
          <div className="flex items-center gap-1.5 text-[10px] text-ink-muted">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />
            {modelInfo.provider} · {modelInfo.model}
          </div>
        )}
      </div>
    </div>
  );
}
