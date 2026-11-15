'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';
import Search from 'lucide-react/dist/esm/icons/search';
import Sparkles from 'lucide-react/dist/esm/icons/sparkles';
import MapPin from 'lucide-react/dist/esm/icons/map-pin';
import Users from 'lucide-react/dist/esm/icons/users';
import Building2 from 'lucide-react/dist/esm/icons/building-2';
import Briefcase from 'lucide-react/dist/esm/icons/briefcase';
import ExternalLink from 'lucide-react/dist/esm/icons/external-link';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2';
import Download from 'lucide-react/dist/esm/icons/download';
import UserPlus from 'lucide-react/dist/esm/icons/user-plus';
import Building from 'lucide-react/dist/esm/icons/building';
import EyeOff from 'lucide-react/dist/esm/icons/eye-off';
import X from 'lucide-react/dist/esm/icons/x';
import Check from 'lucide-react/dist/esm/icons/check';
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down';
import Save from 'lucide-react/dist/esm/icons/save';
import FolderOpen from 'lucide-react/dist/esm/icons/folder-open';
import { Button } from '@/components/ui/button';
import { useTranslations } from '@/lib/i18n';
import { downloadCsv } from '@/lib/utils/csv';
import {
  recommendLeadCriteria,
  searchLeadsStream,
  listLeads,
  updateLead,
  saveLead,
  bulkSaveLeads,
  deleteLead,
  bulkDeleteLeads,
  listLeadDrafts,
  saveLeadDraft,
  deleteLeadDraft,
  type DedupStats,
  type Lead,
  type LeadCriteria,
  type LeadProgressEvent,
  type LeadSearchDraft,
  type LeadStatus,
  type LeadType,
  type SuggestedType,
} from '@/lib/api/leads';

const SOURCE_META: Record<string, { label: string; color: string; bg: string }> = {
  linkedin: { label: 'LinkedIn', color: 'border-blue-600 text-blue-600', bg: 'bg-primary/5' },
  exa: { label: 'Exa', color: 'border-cyan-600 text-cyan-600', bg: 'bg-cyan-50' },
  web: { label: 'Web', color: 'border-teal-600 text-teal-600', bg: 'bg-teal-50' },
};

const TYPE_COLORS: Record<LeadType, string> = {
  person: 'border-blue-200 bg-blue-50 text-blue-700',
  company: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  agency: 'border-purple-200 bg-purple-50 text-purple-700',
};

const CATEGORY_OPTIONS: SuggestedType[] = ['contact', 'company', 'agency', 'unsure'];

const STATUS_COLORS: Record<LeadStatus, string> = {
  new: 'border-amber-200 bg-amber-50 text-amber-700',
  saved: 'border-green-200 bg-green-50 text-green-700',
  contacted: 'border-blue-200 bg-blue-50 text-blue-700',
  dismissed: 'border-[#e7e6df] bg-paper-tint text-steel-grey',
};

const PHASE_KEYS: Record<string, string> = {
  searching: 'search',
  profiles: 'profiles',
  companies: 'companies',
  filtering: 'filtering',
  categorize: 'categorize',
  dedupe: 'dedupe',
  persisted: 'persisted',
  enrich: 'enrich',
  done: 'finalize',
};

function parseLocations(raw: string): string[] {
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export default function LeadsPage() {
  const router = useRouter();
  const { t } = useTranslations();

  const [keywords, setKeywords] = useState('');
  const [target, setTarget] = useState('');
  const [purpose, setPurpose] = useState('');
  const [locations, setLocations] = useState('');
  const [leadTypes, setLeadTypes] = useState<LeadType[]>(['person', 'company', 'agency']);
  const [sources, setSources] = useState<string[]>(['linkedin', 'exa', 'web']);
  const [enrich, setEnrich] = useState(true);

  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<LeadProgressEvent | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [recommending, setRecommending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [criteria, setCriteria] = useState<LeadCriteria | null>(null);
  const [criteriaOpen, setCriteriaOpen] = useState(false);
  const [trackedNames, setTrackedNames] = useState<string[]>([]);

  const [drafts, setDrafts] = useState<LeadSearchDraft[]>([]);
  const [draftName, setDraftName] = useState('');
  const [draftsOpen, setDraftsOpen] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);

  const [leads, setLeads] = useState<Lead[]>([]);
  const [dedupStats, setDedupStats] = useState<DedupStats | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [busyId, setBusyId] = useState<string | null>(null);

  const applyCriteria = useCallback((c: LeadCriteria) => {
    const kw = [...new Set([...c.keywords, ...c.titles])].join(', ');
    if (kw) setKeywords(kw);
    if (c.locations.length > 0) setLocations(c.locations.join(', '));
    if (c.lead_types.length > 0) setLeadTypes(c.lead_types);
    if (c.target) setTarget(c.target);
    if (c.purpose) setPurpose(c.purpose);
    setCriteriaOpen(false);
  }, []);

  const handleRecommend = useCallback(async () => {
    setRecommending(true);
    setError(null);
    setNotice(null);
    try {
      const resumeId = localStorage.getItem('master_resume_id');
      const res = await recommendLeadCriteria({
        resume_id: resumeId,
        goal: purpose.trim() || null,
        niche: target.trim() || null,
        current: {
          keywords: keywords.trim() || null,
          target: target.trim() || null,
          purpose: purpose.trim() || null,
          locations: parseLocations(locations),
          lead_types: leadTypes,
          sources,
        },
      });
      setCriteria(res.criteria);
      setTrackedNames(res.tracked_names);
      // Do NOT auto-apply — the diff card lets the user review before/after.
      setCriteriaOpen(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('leads.toasts.criteriaFailed'));
    } finally {
      setRecommending(false);
    }
  }, [keywords, leadTypes, locations, purpose, sources, target, t]);

  const loadDrafts = useCallback(async () => {
    try {
      const res = await listLeadDrafts();
      setDrafts(res.drafts);
    } catch {
      // Non-fatal: the drafts dropdown simply stays empty.
    }
  }, []);

  useEffect(() => {
    void loadDrafts();
  }, [loadDrafts]);

  const handleSaveDraft = useCallback(async () => {
    const name = draftName.trim() || target.trim() || keywords.trim().slice(0, 60);
    if (!name) {
      setError(t('leads.drafts.nameRequired'));
      return;
    }
    setSavingDraft(true);
    setError(null);
    setNotice(null);
    try {
      await saveLeadDraft({
        name,
        keywords: keywords.trim() || null,
        target: target.trim() || null,
        purpose: purpose.trim() || null,
        locations: parseLocations(locations),
        lead_types: leadTypes,
        sources,
        enrich_contacts: enrich,
      });
      setDraftName('');
      setNotice(t('leads.drafts.saved'));
      await loadDrafts();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('leads.drafts.saveFailed'));
    } finally {
      setSavingDraft(false);
    }
  }, [draftName, enrich, keywords, leadTypes, locations, loadDrafts, purpose, sources, target, t]);

  const handleLoadDraft = useCallback(
    (d: LeadSearchDraft) => {
      setKeywords(d.keywords ?? '');
      setTarget(d.target ?? '');
      setPurpose(d.purpose ?? '');
      setLocations(d.locations.join(', '));
      if (d.lead_types.length > 0) setLeadTypes(d.lead_types as LeadType[]);
      if (d.sources.length > 0) setSources(d.sources);
      setEnrich(d.enrich_contacts);
      setDraftName(d.name);
      setDraftsOpen(false);
      setNotice(t('leads.drafts.loaded'));
    },
    [t]
  );

  const handleDeleteDraft = useCallback(
    async (draftId: string) => {
      try {
        await deleteLeadDraft(draftId);
        await loadDrafts();
      } catch (err) {
        setError(err instanceof Error ? err.message : t('leads.drafts.deleteFailed'));
      }
    },
    [loadDrafts, t]
  );

  useEffect(() => {
    if (!loading) return;
    setElapsed(0);
    const id = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [loading]);

  // Show previously saved leads immediately — every search persists server-side,
  // so reload them on mount instead of starting from an empty table.
  const loadSavedLeads = useCallback(async () => {
    try {
      const res = await listLeads();
      setLeads(res.leads);
    } catch {
      // Non-fatal: the table simply stays empty until a search runs.
    }
  }, []);

  useEffect(() => {
    void loadSavedLeads();
  }, [loadSavedLeads]);

  // Real pipeline phase from the SSE stream; 'search' is the pre-event fallback.
  const phaseKey = PHASE_KEYS[progress?.phase ?? ''] ?? 'search';
  const progressPct =
    progress?.total && progress.total > 0
      ? Math.min(100, Math.round(((progress.done ?? 0) / progress.total) * 100))
      : null;
  const elapsedLabel = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(
    elapsed % 60
  ).padStart(2, '0')}`;

  const handleSearch = useCallback(async () => {
    if (!keywords.trim()) return;
    setLoading(true);
    setError(null);
    setNotice(null);
    setProgress(null);
    try {
      const res = await searchLeadsStream(
        {
          keywords: keywords.trim(),
          target: target.trim() || undefined,
          purpose: purpose.trim() || undefined,
          locations: parseLocations(locations),
          lead_types: leadTypes,
          sources,
          max_results: 30,
          enrich_contacts: enrich,
        },
        (event) => {
          if (event.phase !== 'done') setProgress(event);
        }
      );
      setDedupStats(res.dedup_stats);
      setSelectedIds(new Set());
      setCriteriaOpen(false);
      // Reload the full saved set so leads from earlier searches stay visible.
      await loadSavedLeads();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('leads.toasts.searchFailed'));
    } finally {
      setLoading(false);
    }
  }, [keywords, target, purpose, locations, leadTypes, sources, enrich, loadSavedLeads, t]);

  const handleCategoryChange = useCallback(
    async (lead: Lead, next: SuggestedType) => {
      if (next === lead.suggested_type) return;
      setBusyId(lead.lead_id);
      try {
        const updated = await updateLead(lead.lead_id, {
          suggested_type: next,
          ...(next !== 'unsure' ? { status: 'new' as LeadStatus } : {}),
        });
        setLeads((prev) => prev.map((l) => (l.lead_id === updated.lead_id ? updated : l)));
      } catch (err) {
        setError(err instanceof Error ? err.message : t('leads.errors.updateFailed'));
      } finally {
        setBusyId(null);
      }
    },
    [t]
  );

  const handleSaveOne = useCallback(
    async (lead: Lead) => {
      const target =
        lead.suggested_type === 'company' || lead.suggested_type === 'agency'
          ? 'company'
          : 'contact';
      if (lead.suggested_type === 'unsure') {
        setError(t('leads.category.pickOne'));
        return;
      }
      setBusyId(lead.lead_id);
      try {
        const updated = await saveLead(lead.lead_id, { target, create_linked_company: true });
        setLeads((prev) => prev.map((l) => (l.lead_id === updated.lead_id ? updated : l)));
        setNotice(t('leads.actions.savedOne', { name: lead.name }));
      } catch (err) {
        setError(err instanceof Error ? err.message : t('leads.errors.saveFailed'));
      } finally {
        setBusyId(null);
      }
    },
    [t]
  );

  const handleBulkSave = useCallback(
    async (target: 'contact' | 'company') => {
      const ids = Array.from(selectedIds);
      if (ids.length === 0) return;
      setBusyId('__bulk__');
      try {
        const res = await bulkSaveLeads(ids, { target, create_linked_company: true });
        setLeads((prev) =>
          prev.map((l) =>
            ids.includes(l.lead_id) && l.status === 'new' ? { ...l, status: 'saved' as const } : l
          )
        );
        setSelectedIds(new Set());
        setNotice(res.message);
      } catch (err) {
        setError(err instanceof Error ? err.message : t('leads.errors.saveFailed'));
      } finally {
        setBusyId(null);
      }
    },
    [selectedIds, t]
  );

  const handleDismissSelected = useCallback(async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setBusyId('__bulk__');
    try {
      await Promise.all(ids.map((id) => updateLead(id, { status: 'dismissed' as LeadStatus })));
      setLeads((prev) =>
        prev.map((l) => (ids.includes(l.lead_id) ? { ...l, status: 'dismissed' as const } : l))
      );
      setSelectedIds(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : t('leads.errors.updateFailed'));
    } finally {
      setBusyId(null);
    }
  }, [selectedIds, t]);

  const handleDeleteSelected = useCallback(async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setBusyId('__bulk__');
    try {
      await bulkDeleteLeads(ids);
      setLeads((prev) => prev.filter((l) => !ids.includes(l.lead_id)));
      setSelectedIds(new Set());
    } catch (err) {
      setError(err instanceof Error ? err.message : t('leads.errors.deleteFailed'));
    } finally {
      setBusyId(null);
    }
  }, [selectedIds, t]);

  const handleDismissOne = useCallback(
    async (lead: Lead) => {
      setBusyId(lead.lead_id);
      try {
        const updated = await updateLead(lead.lead_id, { status: 'dismissed' as LeadStatus });
        setLeads((prev) => prev.map((l) => (l.lead_id === updated.lead_id ? updated : l)));
      } catch (err) {
        setError(err instanceof Error ? err.message : t('leads.errors.updateFailed'));
      } finally {
        setBusyId(null);
      }
    },
    [t]
  );

  const handleDeleteOne = useCallback(
    async (lead: Lead) => {
      setBusyId(lead.lead_id);
      try {
        await deleteLead(lead.lead_id);
        setLeads((prev) => prev.filter((l) => l.lead_id !== lead.lead_id));
      } catch (err) {
        setError(err instanceof Error ? err.message : t('leads.errors.deleteFailed'));
      } finally {
        setBusyId(null);
      }
    },
    [t]
  );

  const handleExportCsv = useCallback(() => {
    const headers = [
      'Name',
      'Type',
      'Title',
      'Company',
      'Email',
      'Phone',
      'Location',
      'LinkedIn',
      'Website',
      'Sources',
      'Category',
      'Status',
    ];
    const rows = leads.map((l) => [
      l.name,
      l.lead_type,
      l.title,
      l.company,
      l.email,
      l.phone,
      l.location,
      l.linkedin_url,
      l.website,
      l.sources.join('; '),
      l.suggested_type,
      l.status,
    ]);
    downloadCsv('leads.csv', headers, rows);
  }, [leads]);

  const visibleLeads = useMemo(
    () => leads.filter((l) => l.status !== 'dismissed' || selectedIds.has(l.lead_id)),
    [leads, selectedIds]
  );

  const [collapsedGroups, setCollapsedGroups] = useState<Set<LeadType>>(new Set());

  const groupedLeads = useMemo(() => {
    const groups: Record<LeadType, Lead[]> = { person: [], company: [], agency: [] };
    for (const lead of visibleLeads) {
      groups[lead.lead_type]?.push(lead);
    }
    return groups;
  }, [visibleLeads]);

  const toggleGroup = (type: LeadType) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  };

  const allSelected =
    visibleLeads.length > 0 && visibleLeads.every((l) => selectedIds.has(l.lead_id));
  const someSelected = visibleLeads.some((l) => selectedIds.has(l.lead_id));

  const toggleAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(visibleLeads.map((l) => l.lead_id)));
    }
  };

  const toggleOne = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleType = (type: LeadType) => {
    setLeadTypes((prev) =>
      prev.includes(type) ? prev.filter((x) => x !== type) : [...prev, type]
    );
  };

  const toggleSource = (source: string) => {
    setSources((prev) =>
      prev.includes(source) ? prev.filter((x) => x !== source) : [...prev, source]
    );
  };

  return (
    <div className="min-h-screen bg-white pl-16">
      <div className="max-w-[1600px] mx-auto p-8 space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">{t('leads.title')}</h1>
            <p className="mt-1 text-xs uppercase tracking-wide text-ink-soft">
              {t('leads.subtitle')}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {leads.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleExportCsv}
                className="rounded-full px-4"
              >
                <Download className="w-4 h-4" />
                {t('leads.actions.exportCsv')}
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => router.back()}
              aria-label={t('common.close')}
              className="rounded-full border border-[#e6e3dc] bg-white text-ink shadow-sw-xs hover:border-primary hover:text-primary"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        </div>

        {error && (
          <div className="rounded-xl border border-red-500 bg-[#fdf3f2] p-4 text-sm text-red-700 flex items-start justify-between gap-4">
            <span>{error}</span>
            <button onClick={() => setError(null)} className="text-red-500 hover:text-red-700">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
        {notice && (
          <div className="rounded-xl border border-green-500 bg-green-50 p-4 text-sm text-green-700 flex items-start justify-between gap-4">
            <span className="flex items-center gap-2">
              <Check className="w-4 h-4" />
              {notice}
            </span>
            <button onClick={() => setNotice(null)} className="text-green-500 hover:text-green-700">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        <div className="flex flex-col gap-6">
          {/* Results */}
          <div className="min-w-0 space-y-4">
            {dedupStats && (
              <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 text-xs text-ink-soft flex flex-wrap gap-x-6 gap-y-1">
                <span>
                  <strong className="text-ink">{t('leads.stats.raw')}:</strong> {dedupStats.raw}
                </span>
                <span>
                  <strong className="text-ink">{t('leads.stats.merged')}:</strong>{' '}
                  {dedupStats.merged}
                </span>
                <span>
                  <strong className="text-ink">{t('leads.stats.alreadyInDb')}:</strong>{' '}
                  {dedupStats.already_in_db}
                </span>
                <span>
                  <strong className="text-ink">{t('leads.stats.inserted')}:</strong>{' '}
                  {dedupStats.new_inserted}
                </span>
              </div>
            )}

            {leads.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-[#c9c5bc] bg-paper-tint p-12 text-center">
                <h2 className="text-sm font-bold uppercase tracking-wide text-ink">
                  {t('leads.empty.title')}
                </h2>
                <p className="mt-2 text-xs text-ink-soft max-w-md mx-auto">
                  {t('leads.empty.description')}
                </p>
              </div>
            ) : (
              <div className="rounded-2xl border border-[#e6e3dc] bg-white shadow-sw-xs overflow-hidden">
                {/* Bulk bar */}
                {selectedIds.size > 0 && (
                  <div className="flex flex-wrap items-center gap-2 border-b border-[#e6e3dc] bg-paper-tint px-3 py-1.5">
                    <span className="text-[11px] font-bold uppercase tracking-wide text-ink">
                      {t('leads.actions.selected', { count: selectedIds.size })}
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleBulkSave('contact')}
                      disabled={busyId !== null}
                      className="rounded-full px-3"
                    >
                      <UserPlus className="w-3.5 h-3.5" />
                      {t('leads.actions.bulkSaveContact')}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleBulkSave('company')}
                      disabled={busyId !== null}
                      className="rounded-full px-3"
                    >
                      <Building className="w-3.5 h-3.5" />
                      {t('leads.actions.bulkSaveCompany')}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={handleDismissSelected}
                      disabled={busyId !== null}
                      className="rounded-full px-3 text-ink-soft"
                    >
                      <EyeOff className="w-3.5 h-3.5" />
                      {t('leads.actions.dismiss')}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={handleDeleteSelected}
                      disabled={busyId !== null}
                      className="rounded-full px-3 text-red-600 hover:bg-red-50"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      {t('leads.actions.delete')}
                    </Button>
                  </div>
                )}

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-[11px]">
                    <thead>
                      <tr className="border-b border-[#e6e3dc] bg-paper-tint">
                        <th className="px-2 py-1.5 w-8">
                          <input
                            type="checkbox"
                            checked={allSelected}
                            ref={(el) => {
                              if (el) el.indeterminate = !allSelected && someSelected;
                            }}
                            onChange={toggleAll}
                            className="h-3 w-3 accent-primary"
                            aria-label={t('leads.actions.selectAll')}
                          />
                        </th>
                        <th className="px-2 py-1.5 font-bold uppercase tracking-wide text-ink-soft">
                          {t('leads.table.name')}
                        </th>
                        <th className="px-2 py-1.5 font-bold uppercase tracking-wide text-ink-soft">
                          {t('leads.table.company')}
                        </th>
                        <th className="px-2 py-1.5 font-bold uppercase tracking-wide text-ink-soft">
                          {t('leads.table.email')}
                        </th>
                        <th className="px-2 py-1.5 font-bold uppercase tracking-wide text-ink-soft">
                          {t('leads.table.location')}
                        </th>
                        <th className="px-2 py-1.5 font-bold uppercase tracking-wide text-ink-soft">
                          {t('leads.table.sources')}
                        </th>
                        <th className="px-2 py-1.5 font-bold uppercase tracking-wide text-ink-soft">
                          {t('leads.table.category')}
                        </th>
                        <th className="px-2 py-1.5 font-bold uppercase tracking-wide text-ink-soft">
                          {t('leads.table.status')}
                        </th>
                        <th className="px-2 py-1.5 font-bold uppercase tracking-wide text-ink-soft text-right">
                          {t('leads.table.actions')}
                        </th>
                      </tr>
                    </thead>
                    {(['person', 'company', 'agency'] as const).map((groupType) => {
                      const groupLeads = groupedLeads[groupType];
                      if (groupLeads.length === 0) return null;
                      const collapsed = collapsedGroups.has(groupType);
                      return (
                        <tbody key={groupType}>
                          <tr className="bg-paper-tint/80">
                            <td colSpan={9} className="px-2 py-1.5">
                              <button
                                onClick={() => toggleGroup(groupType)}
                                aria-expanded={!collapsed}
                                className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-ink transition-colors hover:text-primary"
                              >
                                <ChevronDown
                                  className={`w-3.5 h-3.5 transition-transform ${collapsed ? '-rotate-90' : ''}`}
                                />
                                {t(`leads.type.${groupType}`)}
                                <span className="rounded-full border border-[#c9c5bc] bg-white px-1.5 py-0.5 text-[10px] text-ink-soft">
                                  {groupLeads.length}
                                </span>
                              </button>
                            </td>
                          </tr>
                          {!collapsed &&
                            groupLeads.map((lead) => (
                              <tr
                                key={lead.lead_id}
                                className={`border-b border-[#f0eee8] transition-colors hover:bg-paper-tint/60 ${
                                  selectedIds.has(lead.lead_id) ? 'bg-primary/5' : ''
                                }`}
                              >
                                <td className="px-2 py-1.5 align-top">
                                  <input
                                    type="checkbox"
                                    checked={selectedIds.has(lead.lead_id)}
                                    onChange={() => toggleOne(lead.lead_id)}
                                    className="h-3 w-3 accent-primary"
                                    aria-label={lead.name}
                                  />
                                </td>
                                <td className="px-2 py-1.5 align-top">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="font-bold text-ink">{lead.name}</span>
                                    <span
                                      className={`rounded-full border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${TYPE_COLORS[lead.lead_type]}`}
                                    >
                                      {t(`leads.type.${lead.lead_type}`)}
                                    </span>
                                  </div>
                                  {lead.title && (
                                    <p className="mt-0.5 text-ink-soft max-w-[320px] truncate">
                                      {lead.title}
                                    </p>
                                  )}
                                  {lead.linkedin_url && (
                                    <a
                                      href={lead.linkedin_url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="mt-0.5 inline-flex items-center gap-1 text-primary hover:underline"
                                    >
                                      LinkedIn
                                      <ExternalLink className="w-3 h-3" />
                                    </a>
                                  )}
                                </td>
                                <td className="px-2 py-1.5 align-top text-ink-soft max-w-[220px] truncate">
                                  {lead.company || '—'}
                                </td>
                                <td className="px-2 py-1.5 align-top text-ink-soft max-w-[240px]">
                                  {lead.email ? (
                                    <a
                                      href={`mailto:${lead.email}`}
                                      className="text-primary hover:underline break-all"
                                    >
                                      {lead.email}
                                    </a>
                                  ) : (
                                    <span className="text-steel-grey">—</span>
                                  )}
                                  {lead.phone && (
                                    <p className="text-steel-grey mt-0.5">{lead.phone}</p>
                                  )}
                                </td>
                                <td className="px-2 py-1.5 align-top text-ink-soft max-w-[200px] truncate">
                                  {lead.location || '—'}
                                </td>
                                <td className="px-2 py-1.5 align-top">
                                  <div className="flex flex-wrap gap-1">
                                    {lead.sources.map((source) => {
                                      const meta = SOURCE_META[source] ?? {
                                        label: source,
                                        color: 'border-gray-400 text-gray-500',
                                        bg: 'bg-gray-50',
                                      };
                                      return (
                                        <span
                                          key={source}
                                          className={`rounded-full border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${meta.bg} ${meta.color}`}
                                        >
                                          {meta.label}
                                        </span>
                                      );
                                    })}
                                  </div>
                                </td>
                                <td className="px-2 py-1.5 align-top">
                                  <div className="flex flex-col gap-1">
                                    <select
                                      value={lead.suggested_type}
                                      onChange={(e) =>
                                        handleCategoryChange(lead, e.target.value as SuggestedType)
                                      }
                                      disabled={busyId === lead.lead_id || lead.status === 'saved'}
                                      className="rounded-lg border border-[#c9c5bc] bg-white px-1 py-0.5 text-[10px] text-ink focus:border-primary focus:outline-none disabled:opacity-60"
                                      aria-label={t('leads.table.category')}
                                    >
                                      {CATEGORY_OPTIONS.map((opt) => (
                                        <option key={opt} value={opt}>
                                          {t(`leads.category.${opt}`)}
                                        </option>
                                      ))}
                                    </select>
                                    <span className="text-[9px] uppercase tracking-wide text-steel-grey">
                                      {t(`leads.category.source.${lead.category_source}`)}
                                    </span>
                                  </div>
                                </td>
                                <td className="px-2 py-1.5 align-top">
                                  <span
                                    className={`rounded-full border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${STATUS_COLORS[lead.status]}`}
                                  >
                                    {t(`leads.status.${lead.status}`)}
                                  </span>
                                </td>
                                <td className="px-2 py-1.5 align-top text-right">
                                  <div className="flex items-center justify-end gap-1">
                                    {lead.status !== 'saved' && (
                                      <Button
                                        size="sm"
                                        onClick={() => handleSaveOne(lead)}
                                        disabled={
                                          busyId === lead.lead_id ||
                                          lead.suggested_type === 'unsure'
                                        }
                                        className="rounded-full px-2.5 h-6 text-[9px]"
                                      >
                                        {lead.suggested_type === 'company' ||
                                        lead.suggested_type === 'agency' ? (
                                          <Building2 className="w-3 h-3" />
                                        ) : (
                                          <Users className="w-3 h-3" />
                                        )}
                                        {lead.suggested_type === 'company' ||
                                        lead.suggested_type === 'agency'
                                          ? t('leads.actions.saveAsCompany')
                                          : t('leads.actions.saveAsContact')}
                                      </Button>
                                    )}
                                    <button
                                      onClick={() => handleDismissOne(lead)}
                                      disabled={busyId === lead.lead_id}
                                      className="rounded-full border border-[#e7e6df] bg-white p-1 text-ink-soft transition-colors hover:border-primary hover:text-primary disabled:opacity-50"
                                      aria-label={t('leads.actions.dismiss')}
                                      title={t('leads.actions.dismiss')}
                                    >
                                      <EyeOff className="w-3 h-3" />
                                    </button>
                                    <button
                                      onClick={() => handleDeleteOne(lead)}
                                      disabled={busyId === lead.lead_id}
                                      className="rounded-full border border-red-400/50 bg-red-50 p-1 text-red-600 transition-colors hover:border-red-500 hover:bg-red-500 hover:text-white disabled:opacity-50"
                                      aria-label={t('leads.actions.delete')}
                                      title={t('leads.actions.delete')}
                                    >
                                      <Trash2 className="w-3 h-3" />
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            ))}
                        </tbody>
                      );
                    })}
                  </table>
                </div>
              </div>
            )}
          </div>

          {/* Search form (top bar) */}
          <div className="order-first space-y-4 rounded-2xl border border-[#e6e3dc] bg-white p-5 shadow-sw-xs">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-2">
                  <Search className="h-4 w-4 text-primary" />
                  <h2 className="text-xs font-bold uppercase tracking-wider text-ink">
                    {t('leads.form.title')}
                  </h2>
                </div>
                <div className="ml-2 flex items-center gap-1.5">
                  <input
                    type="text"
                    value={draftName}
                    onChange={(e) => setDraftName(e.target.value)}
                    placeholder={t('leads.drafts.namePlaceholder')}
                    className="w-36 rounded-full border border-[#c9c5bc] bg-white px-3 py-1.5 text-[11px] text-ink placeholder:text-steel-grey focus:border-primary focus:outline-none"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleSaveDraft}
                    disabled={savingDraft}
                    className="rounded-full"
                    title={t('leads.drafts.save')}
                  >
                    {savingDraft ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Save className="w-3.5 h-3.5" />
                    )}
                    {t('leads.drafts.save')}
                  </Button>
                  <div className="relative">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setDraftsOpen((o) => !o)}
                      className="rounded-full"
                    >
                      <FolderOpen className="w-3.5 h-3.5" />
                      {t('leads.drafts.load')} ({drafts.length})
                      <ChevronDown className="w-3 h-3" />
                    </Button>
                    {draftsOpen && (
                      <div className="absolute left-0 top-full z-20 mt-1 w-72 rounded-xl border border-[#e6e3dc] bg-white p-1.5 shadow-sw-xs">
                        {drafts.length === 0 ? (
                          <p className="px-3 py-2 text-[11px] text-steel-grey">
                            {t('leads.drafts.empty')}
                          </p>
                        ) : (
                          drafts.map((d) => (
                            <div
                              key={d.draft_id}
                              className="group flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 hover:bg-paper-tint"
                            >
                              <button
                                onClick={() => handleLoadDraft(d)}
                                className="min-w-0 flex-1 text-left"
                              >
                                <p className="truncate text-xs font-semibold text-ink">{d.name}</p>
                                <p className="truncate text-[10px] text-steel-grey">
                                  {d.keywords || d.target || '—'}
                                </p>
                              </button>
                              <button
                                onClick={() => handleDeleteDraft(d.draft_id)}
                                aria-label={t('leads.drafts.delete')}
                                title={t('leads.drafts.delete')}
                                className="rounded-full p-1 text-steel-grey opacity-0 transition-opacity group-hover:opacity-100 hover:text-red-600"
                              >
                                <Trash2 className="w-3 h-3" />
                              </button>
                            </div>
                          ))
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleRecommend}
                  disabled={recommending}
                  className="rounded-full"
                >
                  {recommending ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      {t('leads.criteria.recommending')}
                    </>
                  ) : (
                    <>
                      <Sparkles className="w-4 h-4" />
                      {t('leads.criteria.recommend')}
                    </>
                  )}
                </Button>
                <span className="text-[11px] text-ink-soft">
                  {t('leads.criteria.recommendHint')}
                </span>
              </div>
            </div>

            {criteriaOpen && criteria && (
              <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-2.5">
                <p className="text-[11px] font-bold uppercase tracking-wide text-primary">
                  {t('leads.criteria.suggestTitle')}
                </p>
                {criteria.rationale && (
                  <p className="text-[11px] text-ink-soft leading-relaxed">{criteria.rationale}</p>
                )}
                <div className="space-y-1.5">
                  {[
                    {
                      label: t('leads.form.keywords'),
                      before: keywords,
                      after: [...new Set([...criteria.keywords, ...criteria.titles])].join(', '),
                    },
                    {
                      label: t('leads.form.target'),
                      before: target,
                      after: criteria.target ?? target,
                    },
                    {
                      label: t('leads.form.purpose'),
                      before: purpose,
                      after: criteria.purpose ?? purpose,
                    },
                    {
                      label: t('leads.form.locations'),
                      before: locations,
                      after: criteria.locations.join(', '),
                    },
                    {
                      label: t('leads.form.leadTypes'),
                      before: leadTypes.map((l) => t(`leads.type.${l}`)).join(', '),
                      after: criteria.lead_types.map((l) => t(`leads.type.${l}`)).join(', '),
                    },
                  ].map((row) => {
                    const changed = row.before.trim() !== row.after.trim();
                    return (
                      <div
                        key={row.label}
                        className="rounded-lg border border-[#e7e6df] bg-white/70 px-2.5 py-1.5"
                      >
                        <p className="text-[9px] font-bold uppercase tracking-wide text-steel-grey">
                          {row.label}
                          {changed && <span className="ml-1.5 text-primary">•</span>}
                        </p>
                        {changed ? (
                          <p className="text-[11px] text-ink">
                            <span className="text-steel-grey line-through">
                              {row.before || '—'}
                            </span>
                            <span className="mx-1.5 text-primary">→</span>
                            <span className="font-semibold">{row.after || '—'}</span>
                          </p>
                        ) : (
                          <p className="text-[11px] text-ink-soft">{row.before || '—'}</p>
                        )}
                      </div>
                    );
                  })}
                </div>
                {criteria.recency_hint && (
                  <p className="text-[11px] text-ink-soft italic">{criteria.recency_hint}</p>
                )}
                {trackedNames.length > 0 && (
                  <p className="text-[11px] text-ink-soft">
                    {t('leads.criteria.trackedNote')}: {trackedNames.join(', ')}
                  </p>
                )}
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={() => applyCriteria(criteria)}
                    className="rounded-full flex-1"
                  >
                    <Check className="w-3.5 h-3.5" />
                    {t('leads.criteria.apply')}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => setCriteriaOpen(false)}
                    className="rounded-full flex-1"
                  >
                    <X className="w-3.5 h-3.5" />
                    {t('leads.criteria.dismiss')}
                  </Button>
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
              <div className="min-w-[220px] flex-1">
                <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-ink-soft">
                  {t('leads.form.keywords')}
                </label>
                <input
                  type="text"
                  value={keywords}
                  onChange={(e) => setKeywords(e.target.value)}
                  placeholder={t('leads.form.keywordsPlaceholder')}
                  className="w-full rounded-xl border border-[#c9c5bc] bg-white px-3 py-2 text-sm text-ink placeholder:text-steel-grey focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>

              <div className="min-w-[180px] flex-1">
                <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-ink-soft">
                  <MapPin className="h-3 w-3 inline mr-1" />
                  {t('leads.form.locations')}
                </label>
                <input
                  type="text"
                  value={locations}
                  onChange={(e) => setLocations(e.target.value)}
                  placeholder={t('leads.form.locationsPlaceholder')}
                  className="w-full rounded-xl border border-[#c9c5bc] bg-white px-3 py-2 text-sm text-ink placeholder:text-steel-grey focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>

              <div className="min-w-[200px] flex-1">
                <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-ink-soft">
                  {t('leads.form.target')}
                </label>
                <input
                  type="text"
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                  placeholder={t('leads.form.targetPlaceholder')}
                  className="w-full rounded-xl border border-[#c9c5bc] bg-white px-3 py-2 text-sm text-ink placeholder:text-steel-grey focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>

              <div className="min-w-[200px] flex-1">
                <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-ink-soft">
                  {t('leads.form.purpose')}
                </label>
                <input
                  type="text"
                  value={purpose}
                  onChange={(e) => setPurpose(e.target.value)}
                  placeholder={t('leads.form.purposePlaceholder')}
                  className="w-full rounded-xl border border-[#c9c5bc] bg-white px-3 py-2 text-sm text-ink placeholder:text-steel-grey focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-ink-soft">
                  {t('leads.form.leadTypes')}
                </label>
                <div className="flex flex-wrap gap-2">
                  {(['person', 'company', 'agency'] as LeadType[]).map((type) => (
                    <button
                      key={type}
                      onClick={() => toggleType(type)}
                      className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-all ${
                        leadTypes.includes(type)
                          ? 'border-primary bg-primary text-white shadow-sw-xs'
                          : 'border-[#e7e6df] bg-white text-ink hover:border-primary hover:text-primary'
                      }`}
                    >
                      {t(`leads.type.${type}`)}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-wider text-ink-soft">
                  <Briefcase className="h-3 w-3 inline mr-1" />
                  {t('leads.form.sources')}
                </label>
                <div className="flex flex-wrap gap-2">
                  {['linkedin', 'exa', 'web'].map((source) => (
                    <button
                      key={source}
                      onClick={() => toggleSource(source)}
                      className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-all ${
                        sources.includes(source)
                          ? 'border-primary bg-primary text-white shadow-sw-xs'
                          : 'border-[#e7e6df] bg-white text-ink hover:border-primary hover:text-primary'
                      }`}
                    >
                      {SOURCE_META[source]?.label ?? source}
                    </button>
                  ))}
                </div>
              </div>

              <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-[#e7e6df] bg-white px-3 py-2">
                <input
                  type="checkbox"
                  checked={enrich}
                  onChange={(e) => setEnrich(e.target.checked)}
                  className="h-4 w-4 rounded-md border-ink accent-primary"
                />
                <span className="text-xs font-semibold uppercase tracking-wide text-ink">
                  {t('leads.form.enrich')}
                </span>
              </label>

              <Button
                onClick={handleSearch}
                disabled={loading || !keywords.trim() || leadTypes.length === 0}
                className="rounded-xl px-6"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    {t('leads.form.searching')}
                  </>
                ) : (
                  <>
                    <Search className="w-4 h-4" />
                    {t('leads.form.search')}
                  </>
                )}
              </Button>
            </div>

            {loading && (
              <div className="space-y-2.5 rounded-xl border border-primary/20 bg-primary/5 p-3.5">
                <div className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-2 text-xs font-semibold text-ink">
                    <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
                    {t(`leads.form.phase.${phaseKey}`)}
                    {progress?.total ? (
                      <span className="font-mono text-[11px] font-normal tabular-nums text-ink-soft">
                        {progress.done ?? 0}/{progress.total}
                      </span>
                    ) : null}
                  </span>
                  <span className="font-mono text-xs tabular-nums text-ink-soft">
                    {elapsedLabel}
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-primary/10">
                  {progressPct !== null ? (
                    <div
                      className="h-full rounded-full bg-primary/60 transition-all duration-300"
                      style={{ width: `${progressPct}%` }}
                    />
                  ) : (
                    <div className="h-full w-2/5 animate-pulse rounded-full bg-primary/60" />
                  )}
                </div>
                {progress?.detail ? (
                  <p className="truncate text-[11px] text-ink-soft">{progress.detail}</p>
                ) : null}
                <p className="text-[10px] uppercase tracking-wide text-steel-grey">
                  {t('leads.form.phase.hint')}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
