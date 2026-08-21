'use client';

import { FileText, Check } from 'lucide-react';
import type { ToolCard } from '@/lib/api/chat';

interface ToolCardsProps {
  cards: ToolCard[];
  onSelectResume?: (resumeId: string) => void;
}

function formatCardTitle(kind: string): string {
  const titles: Record<string, string> = {
    audit: 'Resume Audit',
    stats: 'Career Stats',
    evidence: 'Skill Evidence',
    job: 'Job Match',
    info: 'Career Summary',
  };
  return titles[kind] || 'Data';
}

function ResumeSelectionCard({ data, onSelect }: { data: Record<string, unknown>; onSelect?: (id: string) => void }) {
  const resumes = (data.resumes || []) as { resume_id: string; title: string; is_master: boolean; has_data: boolean }[];
  const prompt = (data.prompt as string) || 'Choose a resume:';

  return (
    <div className="space-y-2 text-[13px]">
      <p className="text-ink-soft">{prompt}</p>
      <div className="flex flex-wrap gap-2">
        {resumes.map((r) => (
          <button
            key={r.resume_id}
            onClick={() => onSelect?.(r.resume_id)}
            disabled={!r.has_data}
            className="flex items-center gap-2 rounded-lg border border-[#e6e3dc] bg-white px-3 py-2 text-left text-[13px] transition-colors hover:border-primary/40 hover:bg-primary/5 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <FileText className="h-4 w-4 text-ink-muted" />
            <div>
              <div className="font-medium text-ink">{r.title}</div>
              <div className="flex items-center gap-1.5 text-[11px] text-ink-muted">
                {r.is_master && <span className="flex items-center gap-0.5"><Check className="h-3 w-3" /> Master</span>}
                {!r.has_data && <span>Processing…</span>}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function CareerSummaryCard({ data }: { data: Record<string, unknown> }) {
  const name = data.name as string | undefined;
  const title = data.title as string | undefined;
  const skills = (data.skills || []) as (string | { name: string; category: string })[];
  const targetRoles = (data.target_roles || []) as string[];

  return (
    <div className="space-y-2 text-[13px] leading-relaxed">
      {name && (
        <div><span className="font-semibold">{name}</span>{title && <> · {title}</>}</div>
      )}
      {skills.length > 0 && (
        <div>
          <span className="font-medium">Skills:</span>{' '}
          <span className="text-ink-soft">{skills.slice(0, 8).map((s) => typeof s === 'string' ? s : s.name).join(', ')}</span>
          {skills.length > 8 && <span className="text-ink-muted"> +{skills.length - 8} more</span>}
        </div>
      )}
      {targetRoles.length > 0 && (
        <div>
          <span className="font-medium">Target:</span>{' '}
          <span className="text-ink-soft">{targetRoles.join(', ')}</span>
        </div>
      )}
    </div>
  );
}

function GenericCard({ data }: { data: Record<string, unknown> }) {
  const entries = Object.entries(data).filter(([k, v]) => v != null && k !== 'needs_selection' && k !== 'resumes' && k !== 'prompt');
  if (entries.length === 0) return <div className="text-[13px] text-ink-muted">(no data)</div>;

  return (
    <div className="space-y-1 text-[13px] leading-relaxed">
      {entries.map(([key, value]) => {
        const label = key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
        if (typeof value === 'object' && value !== null) {
          if (Array.isArray(value)) {
            const items = value.slice(0, 5).map((v) =>
              typeof v === 'object' && v !== null
                ? (v as Record<string, unknown>).name || (v as Record<string, unknown>).title || JSON.stringify(v).slice(0, 60)
                : String(v)
            );
            return (
              <div key={key}>
                <span className="font-medium">{label}:</span>{' '}
                <span className="text-ink-soft">{items.join(', ')}</span>
                {value.length > 5 && <span className="text-ink-muted"> +{value.length - 5} more</span>}
              </div>
            );
          }
          const flat = JSON.stringify(value, null, 0).slice(0, 120);
          return (
            <div key={key}>
              <span className="font-medium">{label}:</span>{' '}
              <span className="text-ink-soft">{flat}</span>
            </div>
          );
        }
        return (
          <div key={key}>
            <span className="font-medium">{label}:</span>{' '}
            <span className="text-ink-soft">{String(value)}</span>
          </div>
        );
      })}
    </div>
  );
}

function CardBody({ kind, data, onSelectResume }: { kind: string; data: Record<string, unknown>; onSelectResume?: (id: string) => void }) {
  // Resume selection card (needs_selection from get_ats_audit)
  if (data.needs_selection) return <ResumeSelectionCard data={data} onSelect={onSelectResume} />;
  if (kind === 'info') return <CareerSummaryCard data={data} />;
  return <GenericCard data={data} />;
}

export function ToolCards({ cards, onSelectResume }: ToolCardsProps) {
  if (cards.length === 0) return null;

  return (
    <div className="space-y-2">
      {cards.map((card, i) => (
        <div
          key={i}
          className="rounded-xl border border-[#e6e3dc] bg-[#faf9f7] p-3.5"
        >
          <div className="mb-2 text-[10px] font-bold uppercase tracking-wider text-ink-muted">
            {formatCardTitle(card.kind)}
          </div>
          <CardBody kind={card.kind} data={card.data} onSelectResume={onSelectResume} />
        </div>
      ))}
    </div>
  );
}
