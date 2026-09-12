'use client';

import { useState } from 'react';
import { FileText, FileCode, File, Eye, Check, TrendingUp, Target, Award, Bookmark, ExternalLink, Loader2, X, Mail, Building2, Briefcase, MapPin, User, UserPlus } from 'lucide-react';
import { saveJobFromChat } from '@/lib/api/chat';
import { JobSearchForm } from './job-search-form';
import type { ToolCard } from '@/lib/api/chat';

interface ToolCardsProps {
  cards: ToolCard[];
  threadId?: string;
  onSelectResume?: (id: string) => void;
  onViewFile?: (filename: string, resumeId: string) => void;
  onJobSearch?: (query: string) => void;
  onViewEmail?: (email: EmailItem) => void;
  onAddContact?: (data: { name: string; email?: string; company?: string }) => void;
  onAddCompany?: (data: { name: string; website?: string }) => void;
  onSaveJob?: (data: { title: string; company: string; location?: string; url?: string }) => void;
  onTailorResume?: (data: { job_description: string; company: string; role: string }) => void;
}

function formatCardTitle(kind: string): string {
  const titles: Record<string, string> = {
    audit: 'Resume Audit',
    resume_selection: 'Select Resume',
    file: 'Resume',
    stats: 'Career Stats',
    evidence: 'Skill Evidence',
    job: 'Job Match',
    job_list: 'Job Listings',
    job_search_form: 'Find Jobs',
    info: 'Career Summary',
    sources: 'Sources',
    email_list: 'Emails',
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

function readinessColor(readiness: string): string {
  switch (readiness) {
    case 'strong': return 'text-emerald-600';
    case 'adequate': return 'text-amber-600';
    case 'weak': return 'text-red-500';
    default: return 'text-ink-muted';
  }
}

function levelColor(level: string): string {
  switch (level) {
    case 'expert': return 'bg-emerald-100 text-emerald-700';
    case 'advanced': return 'bg-blue-100 text-blue-700';
    case 'intermediate': return 'bg-amber-100 text-amber-700';
    case 'beginner': return 'bg-gray-100 text-gray-600';
    default: return 'bg-gray-100 text-gray-600';
  }
}

function percentileColor(percentile: number): string {
  if (percentile >= 80) return 'bg-emerald-500';
  if (percentile >= 60) return 'bg-blue-500';
  if (percentile >= 40) return 'bg-amber-500';
  return 'bg-gray-400';
}

function MarketPositionCard({ data }: { data: Record<string, unknown> }) {
  const skills = (data.skills || []) as { skill: string; percentile: number; level: string }[];
  const domains = (data.domains || []) as { domain: string; percentile: number; seniority: string; readiness: string }[];
  const currentRole = data.current_role as string | undefined;
  const specialization = (data.specialization || []) as string[];
  const recommendedRoles = (data.recommended_roles || []) as { role: string; domain: string; seniority: string; match_score: number; reason?: string }[];
  const verdict = data.verdict as string | undefined;

  return (
    <div className="space-y-3 text-[13px] leading-relaxed">
      {currentRole && (
        <div className="flex items-center gap-2">
          <Award className="h-4 w-4 text-ink-muted" />
          <span className="font-medium text-ink">{currentRole}</span>
        </div>
      )}

      {specialization.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {specialization.map((s) => (
            <span key={s} className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">{s}</span>
          ))}
        </div>
      )}

      {skills.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-ink-muted">
            <TrendingUp className="h-3 w-3" /> Skills
          </div>
          <div className="space-y-1">
            {skills.slice(0, 7).map((s) => (
              <div key={s.skill} className="flex items-center gap-2">
                <span className="w-28 truncate text-ink-soft">{s.skill}</span>
                <div className="flex-1">
                  <div className="h-1.5 rounded-full bg-surface-secondary">
                    <div
                      className={`h-full rounded-full ${percentileColor(s.percentile)} transition-all`}
                      style={{ width: `${s.percentile}%` }}
                    />
                  </div>
                </div>
                <span className="w-10 text-right text-[11px] text-ink-soft">{s.percentile}</span>
                <span className={`w-20 rounded-full px-1.5 py-0.5 text-center text-[10px] font-medium ${levelColor(s.level)}`}>
                  {s.level}
                </span>
              </div>
            ))}
          </div>
          {skills.length > 7 && (
            <div className="text-[11px] text-ink-muted">+{skills.length - 7} more</div>
          )}
        </div>
      )}

      {domains.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-ink-muted">
            <Target className="h-3 w-3" /> Domains
          </div>
          <div className="space-y-1">
            {domains.slice(0, 5).map((d) => (
              <div key={d.domain} className="flex items-center justify-between rounded-lg bg-white/60 px-2.5 py-1.5">
                <span className="font-medium text-ink">{d.domain}</span>
                <div className="flex items-center gap-3">
                  <span className="text-[11px] text-ink-muted">{d.seniority}</span>
                  <span className="w-10 text-right text-[11px] text-ink-soft">{d.percentile}%</span>
                  <span className={`text-[11px] font-medium ${readinessColor(d.readiness)}`}>{d.readiness}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {recommendedRoles.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[11px] font-bold uppercase tracking-wider text-ink-muted">Recommended Roles</div>
          <div className="space-y-1">
            {recommendedRoles.slice(0, 5).map((r) => (
              <div key={r.role} className="flex items-center justify-between rounded-lg bg-white/60 px-2.5 py-1.5">
                <div>
                  <span className="font-medium text-ink">{r.role}</span>
                  <span className="ml-1.5 text-[11px] text-ink-muted">{r.domain}/{r.seniority}</span>
                </div>
                {r.match_score != null && (
                  <span className="text-[11px] font-medium text-primary">{r.match_score}% match</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {verdict && (
        <div className="rounded-lg bg-primary/5 border border-primary/10 px-3 py-2 text-[13px] text-ink-soft">
          {verdict}
        </div>
      )}
    </div>
  );
}

interface JobItem {
  title: string;
  company: string;
  location: string;
  url: string;
  source: string;
  description_snippet: string;
}

function SaveJobDialog({
  job,
  onClose,
  onSaved,
}: {
  job: JobItem;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [title, setTitle] = useState(job.title);
  const [company, setCompany] = useState(job.company);
  const [location, setLocation] = useState(job.location === 'Not specified' ? '' : job.location);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveJobFromChat({ title, company, location, url: job.url });
      setSaved(true);
      setTimeout(onSaved, 800);
    } catch {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-md rounded-xl border border-[#e6e3dc] bg-white p-5 shadow-lg">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-ink">Save Job to Tracker</h3>
          <button onClick={onClose} className="text-ink-muted hover:text-ink">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="mb-1 block text-[11px] font-medium text-ink-muted">Title</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="w-full rounded-md border border-[#e6e3dc] px-3 py-1.5 text-[13px] text-ink outline-none focus:border-primary/40"
            />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-medium text-ink-muted">Company</label>
            <input
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              className="w-full rounded-md border border-[#e6e3dc] px-3 py-1.5 text-[13px] text-ink outline-none focus:border-primary/40"
            />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-medium text-ink-muted">Location</label>
            <input
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              className="w-full rounded-md border border-[#e6e3dc] px-3 py-1.5 text-[13px] text-ink outline-none focus:border-primary/40"
            />
          </div>
          {job.url && (
            <div className="text-[12px] text-ink-muted truncate">
              <a href={job.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                {job.url}
              </a>
            </div>
          )}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded-md border border-[#e6e3dc] px-3 py-1.5 text-[12px] font-medium text-ink-soft hover:bg-ink-soft/5"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || saved || !title || !company}
            className="inline-flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-[12px] font-medium text-white hover:bg-primary/90 disabled:opacity-50"
          >
            {saving ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : saved ? (
              <Check className="h-3 w-3" />
            ) : (
              <Bookmark className="h-3 w-3" />
            )}
            {saved ? 'Saved' : 'Save to Tracker'}
          </button>
        </div>
      </div>
    </div>
  );
}

function JobListCard({ data }: { data: Record<string, unknown> }) {
  const jobs = (data.jobs as JobItem[]) || [];
  const sources = data.sources as Record<string, { status: string; count: number }> | undefined;
  const [savingJob, setSavingJob] = useState<JobItem | null>(null);
  const [dismissed, setDismissed] = useState(false);

  if (jobs.length === 0) {
    return <div className="text-[13px] text-ink-muted">No jobs found.</div>;
  }

  return (
    <div className="space-y-3">
      {sources && (
        <div className="flex flex-wrap gap-2 text-[11px] text-ink-muted">
          {Object.entries(sources).map(([name, s]) => (
            <span key={name} className="rounded-full bg-ink-soft/5 px-2 py-0.5">
              {name}: {s.status === 'ok' ? `${s.count} results` : s.status}
            </span>
          ))}
        </div>
      )}
      <div className="space-y-2">
        {jobs.map((job, idx) => (
          <div
            key={idx}
            className="rounded-lg border border-[#e6e3dc] bg-white p-3 text-[13px] leading-relaxed"
          >
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-ink">
                  {job.title}
                </div>
                <div className="text-ink-soft">
                  {job.company}
                  {job.location && job.location !== 'Not specified' && (
                    <> &middot; {job.location}</>
                  )}
                </div>
                {job.description_snippet && (
                  <div className="mt-1 text-[12px] text-ink-muted line-clamp-2">
                    {job.description_snippet}
                  </div>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                {job.url && (
                  <a
                    href={job.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 rounded-md border border-[#e6e3dc] bg-white px-2 py-1 text-[11px] font-medium text-ink-soft transition-colors hover:bg-ink-soft/5"
                  >
                    <ExternalLink className="h-3 w-3" />
                    Apply
                  </a>
                )}
                <button
                  onClick={() => setSavingJob(job)}
                  className="inline-flex items-center gap-1 rounded-md border border-[#e6e3dc] bg-white px-2 py-1 text-[11px] font-medium text-ink-soft transition-colors hover:bg-ink-soft/5"
                >
                  <Bookmark className="h-3 w-3" />
                  Save
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
      {savingJob && (
        <SaveJobDialog
          job={savingJob}
          onClose={() => setSavingJob(null)}
          onSaved={() => {
            setSavingJob(null);
            setDismissed(true);
          }}
        />
      )}
    </div>
  );
}

function SourcesCard({ data }: { data: Record<string, unknown> }) {
  const sources = (data.sources || []) as {
    url: string;
    title: string;
    hostname?: string;
    favicon_url?: string;
  }[];
  if (sources.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {sources.map((s, i) => {
        let hostname = s.hostname || '';
        if (!hostname && s.url) {
          try {
            hostname = new URL(s.url).hostname.replace('www.', '');
          } catch { /* ignore */ }
        }
        const favicon = s.favicon_url || (hostname
          ? `https://www.google.com/s2/favicons?domain=${hostname}&sz=32`
          : '');
        return (
          <a
            key={i}
            href={s.url}
            target="_blank"
            rel="noopener noreferrer"
            className="group flex items-center gap-2 rounded-lg border border-[#e6e3dc] bg-white px-3 py-2 text-[13px] transition-colors hover:border-primary/40 hover:bg-primary/5"
          >
            {favicon ? (
              <img
                src={favicon}
                alt=""
                className="h-4 w-4 shrink-0 rounded-sm"
                onError={(e) => {
                  (e.target as HTMLImageElement).style.display = 'none';
                }}
              />
            ) : (
              <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[9px] font-bold text-primary">
                {(hostname || s.title)[0]?.toUpperCase() || '?'}
              </span>
            )}
            <span className="min-w-0 truncate text-ink-soft group-hover:text-primary">
              {s.title || hostname}
            </span>
            <ExternalLink className="h-3 w-3 shrink-0 text-ink-muted opacity-0 transition-opacity group-hover:opacity-100" />
          </a>
        );
      })}
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

interface EmailEntities {
  company?: string;
  contacts?: Array<{ name: string; email?: string }>;
  job_title?: string;
  job_description?: string;
  match_percentage?: string;
  is_job_alert?: boolean;
  location?: string;
  summary?: string;
}

interface EmailItem {
  uid: string;
  subject: string;
  sender: string;
  date: string;
  snippet: string;
  body: string;
  entities?: EmailEntities;
}

interface EmailListCardProps {
  data: Record<string, unknown>;
  onViewEmail?: (email: EmailItem) => void;
  onAddContact?: (data: { name: string; email?: string; company?: string }) => void;
  onAddCompany?: (data: { name: string; website?: string }) => void;
  onSaveJob?: (data: { title: string; company: string; location?: string; url?: string }) => void;
  onTailorResume?: (data: { job_description: string; company: string; role: string }) => void;
}

function EmailListCard({ data, onViewEmail, onAddContact, onAddCompany, onSaveJob, onTailorResume }: EmailListCardProps) {
  const emails = (data.emails as EmailItem[]) || [];
  const total = (data.total as number) || 0;
  const hint = data.hint as string | undefined;

  if (emails.length === 0) {
    return (
      <div className="flex items-center gap-2 text-sm text-ink-soft">
        <Mail className="h-4 w-4" />
        <span>{hint || 'No emails found.'}</span>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="text-xs text-ink-muted">{total} email{total !== 1 ? 's' : ''}</div>
      {emails.map((email) => {
        const entities = email.entities;
        const hasEntities = entities && (entities.company || entities.contacts?.length || entities.job_title);
        return (
          <div
            key={email.uid}
            className="rounded-lg border border-[#e6e3dc] bg-white p-3 hover:bg-[#f5f3f0] transition-colors cursor-pointer"
            onClick={() => onViewEmail?.(email)}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <Mail className="h-3.5 w-3.5 shrink-0 text-ink-muted" />
                <span className="text-sm font-medium truncate">{email.subject || '(no subject)'}</span>
                {entities?.match_percentage && (
                  <span className="text-[10px] font-bold text-green-600 bg-green-50 px-1.5 py-0.5 rounded-full shrink-0">
                    {entities.match_percentage} match
                  </span>
                )}
              </div>
              <span className="text-[10px] text-ink-muted shrink-0">{email.date}</span>
            </div>
            <div className="mt-1 text-xs text-ink-soft">From: {email.sender}</div>

            {hasEntities && (
              <div className="mt-2 space-y-1">
                {entities.company && (
                  <div className="flex items-center gap-1.5 text-xs">
                    <Building2 className="h-3 w-3 text-ink-muted" />
                    <span className="font-medium">{entities.company}</span>
                  </div>
                )}
                {entities.job_title && (
                  <div className="flex items-center gap-1.5 text-xs">
                    <Briefcase className="h-3 w-3 text-ink-muted" />
                    <span>{entities.job_title}</span>
                  </div>
                )}
                {entities.location && (
                  <div className="flex items-center gap-1.5 text-xs">
                    <MapPin className="h-3 w-3 text-ink-muted" />
                    <span>{entities.location}</span>
                  </div>
                )}
                {entities.contacts && entities.contacts.length > 0 && (
                  <div className="flex items-center gap-1.5 text-xs">
                    <User className="h-3 w-3 text-ink-muted" />
                    <span>{entities.contacts.map(c => c.name).join(', ')}</span>
                  </div>
                )}
              </div>
            )}

            <div className="mt-2 flex flex-wrap gap-1.5" onClick={(e) => e.stopPropagation()}>
              {entities?.contacts && entities.contacts.length > 0 && onAddContact && (
                <button
                  onClick={() => onAddContact({ name: entities.contacts![0].name, email: entities.contacts![0].email, company: entities.company })}
                  className="inline-flex items-center gap-1 rounded-md bg-blue-50 px-2 py-1 text-[10px] font-medium text-blue-700 hover:bg-blue-100 transition-colors"
                >
                  <UserPlus className="h-3 w-3" />
                  Add Contact
                </button>
              )}
              {entities?.company && onAddCompany && (
                <button
                  onClick={() => onAddCompany({ name: entities.company! })}
                  className="inline-flex items-center gap-1 rounded-md bg-purple-50 px-2 py-1 text-[10px] font-medium text-purple-700 hover:bg-purple-100 transition-colors"
                >
                  <Building2 className="h-3 w-3" />
                  Add Company
                </button>
              )}
              {entities?.job_title && entities?.company && onSaveJob && (
                <button
                  onClick={() => onSaveJob({ title: entities.job_title!, company: entities.company!, location: entities.location })}
                  className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-1 text-[10px] font-medium text-amber-700 hover:bg-amber-100 transition-colors"
                >
                  <Bookmark className="h-3 w-3" />
                  Save Job
                </button>
              )}
              {entities?.job_description && entities?.company && onTailorResume && (
                <button
                  onClick={() => onTailorResume({ job_description: entities.job_description!, company: entities.company!, role: entities.job_title || '' })}
                  className="inline-flex items-center gap-1 rounded-md bg-green-50 px-2 py-1 text-[10px] font-medium text-green-700 hover:bg-green-100 transition-colors"
                >
                  <FileText className="h-3 w-3" />
                  Tailor Resume
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function isMarketPositionData(data: Record<string, unknown>): boolean {
  const skills = data.skills;
  const domains = data.domains;
  if (!Array.isArray(skills) || !Array.isArray(domains)) return false;
  if (skills.length === 0 || domains.length === 0) return false;
  const first = skills[0] as Record<string, unknown>;
  return first && 'skill' in first && 'percentile' in first;
}

function CardBody({ kind, data, onSelectResume, onViewFile, onJobSearch, onViewEmail, onAddContact, onAddCompany, onSaveJob, onTailorResume }: { kind: string; data: Record<string, unknown>; onSelectResume?: (id: string) => void; onViewFile?: (filename: string, resumeId: string) => void; onJobSearch?: (query: string) => void; onViewEmail?: (email: EmailItem) => void; onAddContact?: (data: { name: string; email?: string; company?: string }) => void; onAddCompany?: (data: { name: string; website?: string }) => void; onSaveJob?: (data: { title: string; company: string; location?: string; url?: string }) => void; onTailorResume?: (data: { job_description: string; company: string; role: string }) => void }) {
  if (data.needs_selection) return <ResumeSelectionCard data={data} onSelect={onSelectResume} />;
  if (kind === 'file') return <FileCard data={data} onView={onViewFile} />;
  if (kind === 'info') return <CareerSummaryCard data={data} />;
  if (kind === 'job_list') return <JobListCard data={data} />;
  if (kind === 'email_list') return <EmailListCard data={data} onViewEmail={onViewEmail} onAddContact={onAddContact} onAddCompany={onAddCompany} onSaveJob={onSaveJob} onTailorResume={onTailorResume} />;
  if (kind === 'job_search_form') return <JobSearchForm onSubmit={(q) => onJobSearch?.(q)} />;
  if (kind === 'sources') return <SourcesCard data={data} />;
  if (kind === 'stats' && isMarketPositionData(data)) return <MarketPositionCard data={data} />;
  return <GenericCard data={data} />;
}

export function ToolCards({ cards, onSelectResume, onViewFile, onJobSearch, onViewEmail, onAddContact, onAddCompany, onSaveJob, onTailorResume }: ToolCardsProps) {
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
          <CardBody kind={card.kind} data={card.data} onSelectResume={onSelectResume} onViewFile={onViewFile} onJobSearch={onJobSearch} onViewEmail={onViewEmail} onAddContact={onAddContact} onAddCompany={onAddCompany} onSaveJob={onSaveJob} onTailorResume={onTailorResume} />
        </div>
      ))}
    </div>
  );
}
