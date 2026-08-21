'use client';

import type { ToolCard } from '@/lib/api/chat';

interface ToolCardsProps {
  cards: ToolCard[];
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

function CareerSummaryCard({ data }: { data: Record<string, unknown> }) {
  const profile = (data.profile || {}) as Record<string, string>;
  const skills = (data.skills || []) as { name: string; category: string }[];
  const education = (data.education || []) as { institution: string; degree: string }[];
  const projects = (data.projects || []) as { name: string; description: string[] }[];

  return (
    <div className="space-y-2 text-[13px] leading-relaxed">
      {profile.name && (
        <div><span className="font-semibold">{profile.name}</span>{profile.title && <> · {profile.title}</>}</div>
      )}
      {profile.summary && (
        <p className="text-ink-soft line-clamp-3">{String(profile.summary).slice(0, 200)}…</p>
      )}
      {skills.length > 0 && (
        <div>
          <span className="font-medium">Skills:</span>{' '}
          <span className="text-ink-soft">{skills.slice(0, 6).map((s) => s.name).join(', ')}</span>
          {skills.length > 6 && <span className="text-ink-muted"> +{skills.length - 6} more</span>}
        </div>
      )}
      {education.length > 0 && (
        <div>
          <span className="font-medium">Education:</span>{' '}
          <span className="text-ink-soft">{education.map((e) => e.degree).filter(Boolean).join(', ')}</span>
        </div>
      )}
      {projects.length > 0 && (
        <div>
          <span className="font-medium">Projects:</span>{' '}
          <span className="text-ink-soft">{projects.slice(0, 3).map((p) => p.name).join(', ')}</span>
        </div>
      )}
    </div>
  );
}

function GenericCard({ data }: { data: Record<string, unknown> }) {
  const entries = Object.entries(data).filter(([, v]) => v != null);
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

function CardBody({ kind, data }: { kind: string; data: Record<string, unknown> }) {
  if (kind === 'info') return <CareerSummaryCard data={data} />;
  return <GenericCard data={data} />;
}

export function ToolCards({ cards }: ToolCardsProps) {
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
          <CardBody kind={card.kind} data={card.data} />
        </div>
      ))}
    </div>
  );
}
