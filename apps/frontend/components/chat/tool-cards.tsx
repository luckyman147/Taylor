'use client';

import { FileText, FileCode, File, Eye, Check } from 'lucide-react';
import type { ToolCard } from '@/lib/api/chat';

interface ToolCardsProps {
  cards: ToolCard[];
  onSelectResume?: (id: string) => void;
  onViewFile?: (filename: string, resumeId: string) => void;
}

function formatCardTitle(kind: string): string {
  const titles: Record<string, string> = {
    audit: 'Resume Audit',
    resume_selection: 'Select Resume',
    file: 'Resume',
    stats: 'Career Stats',
    evidence: 'Skill Evidence',
    job: 'Job Match',
    info: 'Career Summary',
  };
  return titles[kind] || 'Data';
}

const EXT_ICONS: Record<string, typeof FileText> = {
  pdf: FileText,
  doc: FileCode,
  docx: FileCode,
  md: FileText,
  txt: File,
};

const EXT_COLORS: Record<string, string> = {
  pdf: 'text-red-500 bg-red-50',
  doc: 'text-blue-500 bg-blue-50',
  docx: 'text-blue-500 bg-blue-50',
  md: 'text-gray-600 bg-gray-50',
  txt: 'text-gray-500 bg-gray-50',
};

function getExtension(filename: string): string {
  return filename.split('.').pop()?.toLowerCase() || '';
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

function FileCard({ data, onView }: { data: Record<string, unknown>; onView?: (filename: string, resumeId: string) => void }) {
  const filename = (data.filename as string) || (data.title as string) || 'Resume';
  const resumeId = data.resume_id as string;
  const ext = getExtension(filename);
  const Icon = EXT_ICONS[ext] || File;
  const colorClass = EXT_COLORS[ext] || 'text-gray-500 bg-gray-50';

  return (
    <div className="flex items-center gap-3">
      <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${colorClass}`}>
        <Icon className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-ink">{filename}</div>
        <div className="text-xs text-ink-muted">{ext.toUpperCase()} document</div>
      </div>
      {resumeId && onView && (
        <button
          onClick={() => onView(filename, resumeId)}
          className="flex items-center gap-1.5 rounded-lg border border-[#e6e3dc] bg-white px-3 py-1.5 text-xs font-medium text-ink-soft transition-colors hover:bg-[#f0ece4]"
        >
          <Eye className="h-3.5 w-3.5" />
          View
        </button>
      )}
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

function CardBody({ kind, data, onSelectResume, onViewFile }: { kind: string; data: Record<string, unknown>; onSelectResume?: (id: string) => void; onViewFile?: (filename: string, resumeId: string) => void }) {
  if (data.needs_selection) return <ResumeSelectionCard data={data} onSelect={onSelectResume} />;
  if (kind === 'file') return <FileCard data={data} onView={onViewFile} />;
  if (kind === 'info') return <CareerSummaryCard data={data} />;
  return <GenericCard data={data} />;
}

export function ToolCards({ cards, onSelectResume, onViewFile }: ToolCardsProps) {
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
          <CardBody kind={card.kind} data={card.data} onSelectResume={onSelectResume} onViewFile={onViewFile} />
        </div>
      ))}
    </div>
  );
}
