'use client';

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';
import Plus from 'lucide-react/dist/esm/icons/plus';
import Pencil from 'lucide-react/dist/esm/icons/pencil';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2';
import Users from 'lucide-react/dist/esm/icons/users';
import Search from 'lucide-react/dist/esm/icons/search';
import Download from 'lucide-react/dist/esm/icons/download';
import Upload from 'lucide-react/dist/esm/icons/upload';
import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Dropdown } from '@/components/ui/dropdown';
import { useTranslations } from '@/lib/i18n';
import {
  bulkDeleteContacts,
  deleteContact,
  getImportHeaders,
  importContacts,
  listContacts,
  type Contact,
  type ContactField,
  type ContactGoal,
  type ContactImportHeaders,
  type ContactImportResponse,
  type ContactRelationship,
  type ContactStatus,
} from '@/lib/api/contacts';
import { downloadCsv } from '@/lib/utils/csv';
import { ColumnsDropdown } from '../companies/columns-dropdown';
import { ContactDetailsDialog } from './contact-details-dialog';
import { ContactFormDialog } from './contact-form-dialog';

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

type GroupBy = 'none' | 'goal' | 'status' | 'relationship';

/** Table columns that can be hidden via the columns toggle. */
type ColumnKey =
  | 'company'
  | 'location'
  | 'goal'
  | 'status'
  | 'relationship'
  | 'follow_up_date'
  | 'actions';

const ALL_COLUMNS: ColumnKey[] = [
  'company',
  'location',
  'goal',
  'status',
  'relationship',
  'follow_up_date',
  'actions',
];

const DEFAULT_COLUMNS: Record<ColumnKey, boolean> = Object.fromEntries(
  ALL_COLUMNS.map((key) => [key, true])
) as Record<ColumnKey, boolean>;

const COLUMNS_STORAGE_KEY = 'contacts.table.columns';

function loadColumnPrefs(): Record<ColumnKey, boolean> {
  if (typeof window === 'undefined') return DEFAULT_COLUMNS;
  try {
    const raw = window.localStorage.getItem(COLUMNS_STORAGE_KEY);
    if (!raw) return DEFAULT_COLUMNS;
    const parsed = JSON.parse(raw) as Record<string, boolean>;
    return { ...DEFAULT_COLUMNS, ...parsed };
  } catch {
    return DEFAULT_COLUMNS;
  }
}

/** Badge styles per contact status (static classes so Tailwind keeps them). */
import { STATUS_STYLES } from './status-styles';

const EXPORT_HEADERS = [
  'name',
  'company',
  'location',
  'goal',
  'status',
  'relationship',
  'follow_up_date',
];

/** Import fields in display order (labels come from `contacts.form.*`). */
const IMPORT_FIELDS: ContactField[] = [
  'name',
  'company',
  'location',
  'goal',
  'status',
  'relationship',
  'follow_up_date',
];

const GOAL_VALUES: ContactGoal[] = [
  'networking',
  'informational_interview',
  'request_referral',
  'research_interviewer',
  'research_career',
];

const STATUS_VALUES: ContactStatus[] = [
  'to_contact',
  'follow_up',
  'meeting_scheduled',
  'thank_you_sent',
];

const RELATIONSHIP_VALUES: ContactRelationship[] = [
  'self',
  'coworker',
  'friend',
  'family',
  'other',
  'recruiter',
  'mentor',
  'hiring_manager',
  'alumni',
];

const PAGE_SIZE_OPTIONS = ['10', '25', '50'];

export function ContactsTable() {
  const { t } = useTranslations();
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Contact | null>(null);
  const [details, setDetails] = useState<Contact | null>(null);
  const [deleting, setDeleting] = useState<Contact | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkDeleteError, setBulkDeleteError] = useState<string | null>(null);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const [search, setSearch] = useState('');
  const [goalFilter, setGoalFilter] = useState<ContactGoal | ''>('');
  const [statusFilter, setStatusFilter] = useState<ContactStatus | ''>('');
  const [relationshipFilter, setRelationshipFilter] = useState<ContactRelationship | ''>('');
  const [groupBy, setGroupBy] = useState<GroupBy>('none');
  const [visibleColumns, setVisibleColumns] = useState<Record<ColumnKey, boolean>>(loadColumnPrefs);

  useEffect(() => {
    try {
      window.localStorage.setItem(COLUMNS_STORAGE_KEY, JSON.stringify(visibleColumns));
    } catch {
      // Storage unavailable (e.g. private mode) — the preference just won't persist.
    }
  }, [visibleColumns]);

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ContactImportResponse | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const importOpen = importResult !== null || importError !== null;
  const [mappingFile, setMappingFile] = useState<File | null>(null);
  const [mappingHeaders, setMappingHeaders] = useState<ContactImportHeaders | null>(null);
  const [mapping, setMapping] = useState<Partial<Record<ContactField, string>>>({});
  const [mappingError, setMappingError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listContacts();
      setContacts(res.contacts);
      setSelectedIds((prev) => {
        if (prev.size === 0) return prev;
        const alive = new Set(res.contacts.map((c) => c.contact_id));
        const pruned = new Set([...prev].filter((id) => alive.has(id)));
        return pruned.size === prev.size ? prev : pruned;
      });
    } catch {
      setError(t('contacts.errors.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const goalLabel = (goal: ContactGoal | null): string =>
    goal ? t(`contacts.goal.${goal}`) : '—';
  const statusLabel = (status: ContactStatus | null): string =>
    status ? t(`contacts.status.${status}`) : '—';
  const relationshipLabel = (relationship: ContactRelationship | null): string =>
    relationship ? t(`contacts.relationship.${relationship}`) : '—';

  const fieldLabel = (field: ContactField): string =>
    t(
      field === 'goal'
        ? 'contacts.form.goal'
        : field === 'status'
          ? 'contacts.form.status'
          : field === 'relationship'
            ? 'contacts.form.relationship'
            : field === 'follow_up_date'
              ? 'contacts.form.followUpDate'
              : `contacts.form.${field}`
    );

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return contacts.filter((contact) => {
      if (goalFilter && contact.goal !== goalFilter) return false;
      if (statusFilter && contact.status !== statusFilter) return false;
      if (relationshipFilter && contact.relationship !== relationshipFilter) return false;
      if (!query) return true;
      return (
        contact.name.toLowerCase().includes(query) ||
        (contact.company ?? '').toLowerCase().includes(query) ||
        (contact.location ?? '').toLowerCase().includes(query)
      );
    });
  }, [contacts, search, goalFilter, statusFilter, relationshipFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageRows = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, page, pageSize]);

  useEffect(() => {
    setPage(1);
  }, [search, goalFilter, statusFilter, relationshipFilter, groupBy]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const groups = useMemo(() => {
    if (groupBy === 'none') return null;
    const grouped = new Map<string, Contact[]>();
    for (const contact of pageRows) {
      const key =
        groupBy === 'goal'
          ? (contact.goal ?? '')
          : groupBy === 'status'
            ? (contact.status ?? '')
            : (contact.relationship ?? '');
      const list = grouped.get(key) ?? [];
      list.push(contact);
      grouped.set(key, list);
    }
    const sorted = [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b));
    return sorted;
  }, [pageRows, groupBy]);

  const groupLabel = (key: string): string => {
    if (groupBy === 'goal') return key ? goalLabel(key as ContactGoal) : '—';
    if (groupBy === 'status') return key ? statusLabel(key as ContactStatus) : '—';
    if (groupBy === 'relationship') return key ? relationshipLabel(key as ContactRelationship) : '—';
    return key || '—';
  };

  const handleExport = () => {
    const rows = filtered.map((contact) => [
      contact.name,
      contact.company,
      contact.location,
      contact.goal,
      contact.status,
      contact.relationship,
      contact.follow_up_date,
    ]);
    downloadCsv('contacts.csv', EXPORT_HEADERS, rows);
  };

  const handleImportFile = async (file: File | null) => {
    if (!file) return;
    setImporting(true);
    setImportError(null);
    try {
      const headers = await getImportHeaders(file);
      setMappingFile(file);
      setMappingHeaders(headers);
      setMapping(headers.detected);
      setMappingError(null);
    } catch {
      setImportError(t('contacts.import.failed'));
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleRunImport = async () => {
    if (!mappingFile || !mappingHeaders) return;
    if (!mapping.name?.trim()) {
      setMappingError(t('contacts.import.mappingNameRequired'));
      return;
    }
    setImporting(true);
    setImportError(null);
    setMappingError(null);
    try {
      const result = await importContacts(mappingFile, mapping);
      setMappingFile(null);
      setMappingHeaders(null);
      setMapping({});
      setImportResult(result);
      await load();
    } catch {
      setImportError(t('contacts.import.failed'));
    } finally {
      setImporting(false);
    }
  };

  const handleDelete = async () => {
    if (!deleting) return;
    setDeleteError(null);
    try {
      await deleteContact(deleting.contact_id);
      setDeleting(null);
      setDetails(null);
      await load();
    } catch {
      setDeleteError(t('contacts.errors.deleteFailed'));
    }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    setBulkDeleting(true);
    setBulkDeleteError(null);
    try {
      await bulkDeleteContacts([...selectedIds]);
      setSelectedIds(new Set());
      setBulkDeleteOpen(false);
      await load();
    } catch {
      setBulkDeleteError(t('contacts.errors.deleteFailed'));
    } finally {
      setBulkDeleting(false);
    }
  };

  const toggleSelect = (contactId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(contactId)) {
        next.delete(contactId);
      } else {
        next.add(contactId);
      }
      return next;
    });
  };

  const pageSelectedCount = pageRows.filter((c) => selectedIds.has(c.contact_id)).length;
  const allPageSelected = pageRows.length > 0 && pageSelectedCount === pageRows.length;

  const goalOptions = GOAL_VALUES.map((g) => ({ id: g, label: goalLabel(g) }));
  const statusOptions = STATUS_VALUES.map((s) => ({ id: s, label: statusLabel(s) }));
  const relationshipOptions = RELATIONSHIP_VALUES.map((r) => ({
    id: r,
    label: relationshipLabel(r),
  }));
  const allOption = { id: '', label: t('contacts.toolbar.all') };
  const groupByOptions: { id: GroupBy; label: string }[] = [
    { id: 'none', label: t('contacts.toolbar.groupNone') },
    { id: 'goal', label: t('contacts.toolbar.groupGoal') },
    { id: 'status', label: t('contacts.toolbar.groupStatus') },
    { id: 'relationship', label: t('contacts.toolbar.groupRelationship') },
  ];
  const pageSizeOptions = PAGE_SIZE_OPTIONS.map((size) => ({
    id: size,
    label: t('contacts.pagination.perPage', { count: size }),
  }));
  const columnOptions: { id: ColumnKey; label: string }[] = [
    { id: 'company', label: t('contacts.table.company') },
    { id: 'location', label: t('contacts.table.location') },
    { id: 'goal', label: t('contacts.table.goal') },
    { id: 'status', label: t('contacts.table.status') },
    { id: 'relationship', label: t('contacts.table.relationship') },
    { id: 'follow_up_date', label: t('contacts.table.followUpDate') },
    { id: 'actions', label: t('contacts.table.actions') },
  ];
  const toggleColumn = (key: ColumnKey) =>
    setVisibleColumns((prev) => ({ ...prev, [key]: !prev[key] }));
  const visibleColumnCount = ALL_COLUMNS.filter((key) => visibleColumns[key]).length;

  const showTable = !loading && contacts.length > 0;
  const showNoResults = !loading && contacts.length > 0 && filtered.length === 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Header — navy gradient band with title + actions */}
      <div className="relative shrink-0 overflow-hidden bg-gradient-to-br from-primary via-primary to-[#15304f] px-6 py-8 md:px-8">
        <div className="pointer-events-none absolute -right-16 -top-24 h-64 w-64 rounded-full bg-white/5" />
        <div className="pointer-events-none absolute -bottom-28 right-40 h-60 w-60 rounded-full bg-white/5" />
        <div className="relative flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-primary-foreground/60">
              {t('contacts.subtitle')}
            </p>
            <h1 className="mt-1.5 font-sans text-3xl font-bold uppercase tracking-tight text-white md:text-4xl">
              {t('contacts.title')}
            </h1>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.xlsx,.xlsm"
              className="hidden"
              onChange={(e) => void handleImportFile(e.target.files?.[0] ?? null)}
            />
            <Button
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={importing}
              className="border-white/40 bg-white/10 text-white backdrop-blur hover:border-white/70 hover:bg-white/20"
            >
              {importing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
              {t('contacts.toolbar.import')}
            </Button>
            <Button
              variant="outline"
              onClick={handleExport}
              disabled={filtered.length === 0}
              className="border-white/40 bg-white/10 text-white backdrop-blur hover:border-white/70 hover:bg-white/20"
            >
              <Download className="h-4 w-4" />
              {t('contacts.toolbar.export')}
            </Button>
            <Button
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
              className="border-white bg-white text-primary hover:bg-blue-50 hover:border-white"
            >
              <Plus className="h-4 w-4" />
              {t('contacts.addContact')}
            </Button>
          </div>
        </div>
      </div>

      {error && (
        <div className="mx-6 mb-2 shrink-0 rounded-xl border border-destructive/30 bg-[#fdf3f2] px-4 py-2.5 text-xs font-medium text-destructive md:mx-8">
          {error}
        </div>
      )}

      {showTable && (
        <div className="shrink-0 border-b border-[#e6e3dc] bg-paper-tint/60 px-6 py-3 md:px-8">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative w-56">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-soft" />
              <Input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('contacts.toolbar.searchPlaceholder')}
                aria-label={t('contacts.toolbar.search')}
                className="pl-9"
              />
            </div>
            <Dropdown
              options={[allOption, ...goalOptions]}
              value={goalFilter}
              onChange={(value) => setGoalFilter(value as ContactGoal | '')}
              ariaLabel={t('contacts.toolbar.goal')}
              className="min-w-0 flex-1"
              triggerClassName="h-10 rounded-lg px-3 py-0"
            />
            <Dropdown
              options={[allOption, ...statusOptions]}
              value={statusFilter}
              onChange={(value) => setStatusFilter(value as ContactStatus | '')}
              ariaLabel={t('contacts.toolbar.status')}
              className="min-w-0 flex-1"
              triggerClassName="h-10 rounded-lg px-3 py-0"
            />
            <Dropdown
              options={[allOption, ...relationshipOptions]}
              value={relationshipFilter}
              onChange={(value) => setRelationshipFilter(value as ContactRelationship | '')}
              ariaLabel={t('contacts.toolbar.relationship')}
              className="min-w-0 flex-1"
              triggerClassName="h-10 rounded-lg px-3 py-0"
            />
            <Dropdown
              options={groupByOptions}
              value={groupBy}
              onChange={(value) => setGroupBy(value as GroupBy)}
              ariaLabel={t('contacts.toolbar.groupBy')}
              className="min-w-0 flex-1"
              triggerClassName="h-10 rounded-lg px-3 py-0"
            />
            <ColumnsDropdown
              options={columnOptions}
              visible={visibleColumns}
              onChange={(id) => toggleColumn(id as ColumnKey)}
              label={t('contacts.toolbar.columns')}
              ariaLabel={t('contacts.toolbar.columns')}
            />
            <span className="text-xs font-medium text-ink-soft">
              {t('contacts.toolbar.count', { count: String(filtered.length) })}
            </span>
          </div>
        </div>
      )}

      {selectedIds.size > 0 && (
        <div className="shrink-0 border-b border-primary/20 bg-primary/5 px-6 py-2.5 md:px-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs font-semibold text-primary">
              {t('contacts.selection.count', { count: String(selectedIds.size) })}
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSelectedIds(new Set())}
                disabled={bulkDeleting}
              >
                {t('contacts.selection.clear')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setBulkDeleteOpen(true)}
                disabled={bulkDeleting}
                className="border-destructive/40 text-destructive hover:bg-destructive/5"
              >
                <Trash2 className="h-4 w-4" />
                {t('contacts.selection.delete')}
              </Button>
            </div>
          </div>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-6 md:p-8">
        {loading ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-steel-grey" />
          </div>
        ) : contacts.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-10 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-[#e6e3dc] bg-white text-primary shadow-sw-sm">
              <Users className="h-7 w-7" />
            </div>
            <p className="mt-4 font-sans text-lg font-bold text-ink">
              {t('contacts.empty.title')}
            </p>
            <p className="mt-1 max-w-sm text-xs text-ink-soft">
              {t('contacts.empty.description')}
            </p>
          </div>
        ) : showNoResults ? (
          <div className="flex flex-col items-center justify-center p-10 text-center">
            <p className="font-sans text-lg font-bold text-ink">{t('contacts.empty.noResults')}</p>
            <p className="mt-1 max-w-sm text-xs text-ink-soft">
              {t('contacts.empty.noResultsHint')}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-[#e6e3dc] bg-white shadow-sw-sm">
            <table className="w-full min-w-[900px] border-collapse text-left text-sm">
              <thead>
                <tr className="border-b border-[#e6e3dc] bg-paper-tint text-[11px] font-bold uppercase tracking-wider text-ink-soft">
                  <th className="w-10 px-4 py-3">
                    <input
                      type="checkbox"
                      aria-label={t('contacts.selection.selectAll')}
                      checked={allPageSelected}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedIds(
                            (prev) => new Set([...prev, ...pageRows.map((c) => c.contact_id)])
                          );
                        } else {
                          setSelectedIds((prev) => {
                            const next = new Set(prev);
                            for (const c of pageRows) next.delete(c.contact_id);
                            return next;
                          });
                        }
                      }}
                      className="h-4 w-4 accent-primary"
                    />
                  </th>
                  <th className="px-4 py-3">{t('contacts.table.name')}</th>
                  {visibleColumns.company && (
                    <th className="px-4 py-3">{t('contacts.table.company')}</th>
                  )}
                  {visibleColumns.location && (
                    <th className="px-4 py-3">{t('contacts.table.location')}</th>
                  )}
                  {visibleColumns.goal && (
                    <th className="px-4 py-3">{t('contacts.table.goal')}</th>
                  )}
                  {visibleColumns.status && (
                    <th className="px-4 py-3">{t('contacts.table.status')}</th>
                  )}
                  {visibleColumns.relationship && (
                    <th className="px-4 py-3">{t('contacts.table.relationship')}</th>
                  )}
                  {visibleColumns.follow_up_date && (
                    <th className="px-4 py-3">{t('contacts.table.followUpDate')}</th>
                  )}
                  {visibleColumns.actions && (
                    <th className="px-4 py-3 text-right">{t('contacts.table.actions')}</th>
                  )}
                </tr>
              </thead>
              <tbody>
                {groups
                  ? groups.map(([key, group]) => (
                      <Fragment key={key}>
                        <tr className="border-b border-[#e6e3dc] bg-primary/5">
                          <td
                            colSpan={1 + visibleColumnCount}
                            className="px-4 py-2 text-[11px] font-bold uppercase tracking-wider text-primary"
                          >
                            {groupLabel(key)} ({group.length})
                          </td>
                        </tr>
                        {group.map((contact) => (
                          <ContactRow
                            key={contact.contact_id}
                            contact={contact}
                            goalLabel={goalLabel}
                            statusLabel={statusLabel}
                            relationshipLabel={relationshipLabel}
                            selected={selectedIds.has(contact.contact_id)}
                            onToggleSelect={() => toggleSelect(contact.contact_id)}
                            onEdit={(c) => {
                              setEditing(c);
                              setFormOpen(true);
                            }}
                            onDelete={(c) => {
                              setDeleteError(null);
                              setDeleting(c);
                            }}
                            onShowDetails={setDetails}
                            visibleColumns={visibleColumns}
                            t={t}
                          />
                        ))}
                      </Fragment>
                    ))
                  : pageRows.map((contact) => (
                      <ContactRow
                        key={contact.contact_id}
                        contact={contact}
                        goalLabel={goalLabel}
                        statusLabel={statusLabel}
                        relationshipLabel={relationshipLabel}
                        selected={selectedIds.has(contact.contact_id)}
                        onToggleSelect={() => toggleSelect(contact.contact_id)}
                        onEdit={(c) => {
                          setEditing(c);
                          setFormOpen(true);
                        }}
                        onDelete={(c) => {
                          setDeleteError(null);
                          setDeleting(c);
                        }}
                        onShowDetails={setDetails}
                        visibleColumns={visibleColumns}
                        t={t}
                      />
                    ))}
              </tbody>
            </table>
          </div>
        )}
        {filtered.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs font-medium text-ink-soft">
              {t('contacts.pagination.showing', {
                from: String((page - 1) * pageSize + 1),
                to: String(Math.min(page * pageSize, filtered.length)),
                total: String(filtered.length),
              })}
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                aria-label={t('contacts.pagination.previous')}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
                <Button
                  key={p}
                  variant={p === page ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setPage(p)}
                  aria-label={t('contacts.pagination.page', { count: String(p) })}
                  className={p === page ? '' : 'text-ink-soft'}
                >
                  {p}
                </Button>
              ))}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                aria-label={t('contacts.pagination.next')}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
              <Dropdown
                options={pageSizeOptions}
                value={String(pageSize)}
                onChange={(value) => {
                  setPageSize(Number(value));
                  setPage(1);
                }}
                ariaLabel={t('contacts.pagination.perPage', { count: String(pageSize) })}
                triggerClassName="h-10 rounded-lg px-3 py-0"
              />
            </div>
          </div>
        )}
      </div>

      <ContactFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        contact={editing}
        onSaved={load}
      />

      <ContactDetailsDialog
        open={details !== null}
        onOpenChange={(open) => {
          if (!open) setDetails(null);
        }}
        contact={details}
        onEdit={() => {
          setEditing(details);
          setDetails(null);
          setFormOpen(true);
        }}
        onDelete={() => {
          if (details) {
            setDeleteError(null);
            setDeleting(details);
          }
        }}
        goalLabel={goalLabel}
        statusLabel={statusLabel}
        relationshipLabel={relationshipLabel}
      />

      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        variant="danger"
        title={t('contacts.delete.title')}
        description={t('contacts.delete.description', { name: deleting?.name ?? '' })}
        errorMessage={deleteError ?? undefined}
        confirmLabel={t('contacts.delete.confirm')}
        onConfirm={handleDelete}
      />

      <ConfirmDialog
        open={bulkDeleteOpen}
        onOpenChange={(open) => {
          if (!open) setBulkDeleteOpen(false);
        }}
        variant="danger"
        title={t('contacts.selection.deleteTitle')}
        description={t('contacts.selection.deleteDescription', {
          count: String(selectedIds.size),
        })}
        errorMessage={bulkDeleteError ?? undefined}
        confirmLabel={t('contacts.selection.delete')}
        onConfirm={handleBulkDelete}
      />

      <Dialog
        open={mappingHeaders !== null}
        onOpenChange={(open) => {
          if (!open) {
            setMappingFile(null);
            setMappingHeaders(null);
            setMapping({});
            setMappingError(null);
          }
        }}
      >
        <DialogContent className="max-w-lg p-0 gap-0 overflow-hidden">
          <DialogHeader className="border-b border-[#e6e3dc] bg-white p-6">
            <DialogTitle>{t('contacts.import.mappingTitle')}</DialogTitle>
            <DialogDescription>{t('contacts.import.mappingDescription')}</DialogDescription>
          </DialogHeader>
          <div className="max-h-[55vh] space-y-3 overflow-y-auto p-6">
            {mappingHeaders && (
              <>
                <p className="text-xs font-medium text-ink-soft">
                  {t('contacts.import.mappingHint')}
                </p>
                {IMPORT_FIELDS.map((field) => (
                  <div key={field} className="grid grid-cols-[130px_1fr] items-center gap-3">
                    <Label className="text-[11px] font-bold uppercase tracking-wider text-ink-soft">
                      {fieldLabel(field)}
                      {mapping[field] === mappingHeaders.detected[field] &&
                        mappingHeaders.detected[field] && (
                          <span className="ml-1.5 rounded bg-primary/10 px-1 py-0.5 text-[9px] font-semibold normal-case tracking-normal text-primary">
                            {t('contacts.import.mappingAuto')}
                          </span>
                        )}
                    </Label>
                    <Dropdown
                      options={[
                        { id: '', label: t('contacts.form.none') },
                        ...mappingHeaders.headers.map((header) => ({
                          id: header,
                          label: header,
                        })),
                      ]}
                      value={mapping[field] ?? ''}
                      onChange={(value) =>
                        setMapping((prev) => ({ ...prev, [field]: value || undefined }))
                      }
                      ariaLabel={fieldLabel(field)}
                      triggerClassName="h-10 rounded-lg px-3 py-0"
                    />
                  </div>
                ))}
                {mappingError && <p className="text-xs text-destructive">{mappingError}</p>}
              </>
            )}
          </div>
          <DialogFooter className="flex-row justify-end gap-3 border-t border-[#e6e3dc] bg-secondary p-4">
            <Button onClick={handleRunImport} disabled={importing}>
              {importing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Upload className="h-4 w-4" />
              )}
              {t('contacts.import.mappingImport')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={importOpen}
        onOpenChange={(open) => {
          if (!open) {
            setImportResult(null);
            setImportError(null);
          }
        }}
      >
        <DialogContent className="max-w-lg p-0 gap-0 overflow-hidden">
          <DialogHeader className="border-b border-[#e6e3dc] bg-white p-6">
            <DialogTitle>{t('contacts.import.title')}</DialogTitle>
            <DialogDescription>{t('contacts.import.description')}</DialogDescription>
          </DialogHeader>
          <div className="max-h-[50vh] space-y-3 overflow-y-auto p-6">
            {importError ? (
              <p className="text-xs text-destructive">{importError}</p>
            ) : (
              importResult && (
                <>
                  <p className="text-xs font-medium text-ink">
                    {t('contacts.import.created', { count: String(importResult.created) })}
                  </p>
                  <p className="text-xs font-medium text-ink-soft">
                    {t('contacts.import.skipped', { count: String(importResult.skipped) })}
                  </p>
                  {importResult.errors.length > 0 && (
                    <>
                      <p className="text-xs font-medium text-warning">
                        {t('contacts.import.failedCount', {
                          count: String(importResult.errors.length),
                        })}
                      </p>
                      <ul className="space-y-1.5">
                        {importResult.errors.map((entry, index) => (
                          <li
                            key={`${entry.row}-${index}`}
                            className="rounded-lg border border-destructive/20 bg-[#fdf3f2] px-3 py-2 text-xs text-destructive"
                          >
                            {t('contacts.import.errorRow', {
                              row: String(entry.row),
                              name: entry.name ?? '—',
                              error: entry.error,
                            })}
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </>
              )
            )}
          </div>
          <DialogFooter className="flex-row justify-end gap-3 border-t border-[#e6e3dc] bg-secondary p-4">
            <Button
              onClick={() => {
                setImportResult(null);
                setImportError(null);
              }}
            >
              {t('contacts.import.done')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface ContactRowProps {
  contact: Contact;
  goalLabel: (goal: ContactGoal | null) => string;
  statusLabel: (status: ContactStatus | null) => string;
  relationshipLabel: (relationship: ContactRelationship | null) => string;
  selected: boolean;
  onToggleSelect: () => void;
  onEdit: (contact: Contact) => void;
  onDelete: (contact: Contact) => void;
  onShowDetails: (contact: Contact) => void;
  visibleColumns: Record<ColumnKey, boolean>;
  t: (key: string, params?: Record<string, string | number>) => string;
}

function ContactRow({
  contact,
  goalLabel,
  statusLabel,
  relationshipLabel,
  selected,
  onToggleSelect,
  onEdit,
  onDelete,
  onShowDetails,
  visibleColumns,
  t,
}: ContactRowProps) {
  return (
    <tr
      className={`group border-b border-[#f0eee8] last:border-b-0 hover:bg-paper-tint/60 ${
        selected ? 'bg-primary/5' : ''
      }`}
    >
      <td className="px-4 py-3">
        <input
          type="checkbox"
          aria-label={t('contacts.selection.selectRow', { name: contact.name })}
          checked={selected}
          onChange={onToggleSelect}
          className="h-4 w-4 accent-primary"
        />
      </td>
      <td className="cursor-pointer px-4 py-3" onClick={() => onShowDetails(contact)}>
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-xs font-bold text-primary">
            {initialsOf(contact.name)}
          </div>
          <div className="min-w-0 flex-1">
            <p
              className="truncate font-semibold text-ink group-hover:text-primary"
              title={t('contacts.table.viewDetails')}
            >
              {contact.name}
            </p>
            {contact.company && (
              <span className="truncate text-xs text-ink-soft">{contact.company}</span>
            )}
          </div>
        </div>
      </td>
      {visibleColumns.company && (
        <td className="px-4 py-3 text-ink-soft">{contact.company || '—'}</td>
      )}
      {visibleColumns.location && (
        <td className="px-4 py-3 text-ink-soft">{contact.location || '—'}</td>
      )}
      {visibleColumns.goal && (
        <td className="px-4 py-3 text-ink-soft">{goalLabel(contact.goal)}</td>
      )}
      {visibleColumns.status && (
        <td className="px-4 py-3">
          {contact.status ? (
            <span
              className={`inline-flex rounded-md border px-2 py-0.5 text-[11px] font-semibold ${
                STATUS_STYLES[contact.status]
              }`}
            >
              {statusLabel(contact.status)}
            </span>
          ) : (
            <span className="text-ink-soft">—</span>
          )}
        </td>
      )}
      {visibleColumns.relationship && (
        <td className="px-4 py-3 text-ink-soft">{relationshipLabel(contact.relationship)}</td>
      )}
      {visibleColumns.follow_up_date && (
        <td className="px-4 py-3 text-ink-soft">{contact.follow_up_date || '—'}</td>
      )}
      {visibleColumns.actions && (
        <td className="px-4 py-3">
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              aria-label={t('contacts.table.edit')}
              onClick={() => onEdit(contact)}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#e6e3dc] text-ink-soft transition-colors hover:border-primary hover:text-primary"
            >
              <Pencil className="h-4 w-4" />
            </button>
            <button
              type="button"
              aria-label={t('contacts.table.delete')}
              onClick={() => onDelete(contact)}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#e6e3dc] text-ink-soft transition-colors hover:border-destructive hover:text-destructive"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </td>
      )}
    </tr>
  );
}