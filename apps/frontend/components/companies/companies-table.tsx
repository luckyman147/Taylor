'use client';

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';
import Plus from 'lucide-react/dist/esm/icons/plus';
import Pencil from 'lucide-react/dist/esm/icons/pencil';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2';
import Globe from 'lucide-react/dist/esm/icons/globe';
import Linkedin from 'lucide-react/dist/esm/icons/linkedin';
import Mail from 'lucide-react/dist/esm/icons/mail';
import Building2 from 'lucide-react/dist/esm/icons/building-2';
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
  bulkDeleteCompanies,
  deleteCompany,
  getImportHeaders,
  importCompanies,
  listCompanies,
  updateCompany,
  type Company,
  type CompanyField,
  type CompanyImportHeaders,
  type CompanyImportResponse,
  type CompanySize,
  type CompanyStatus,
  type CompanyType,
  type CompanyUpdate,
} from '@/lib/api/companies';
import { downloadCsv } from '@/lib/utils/csv';
import { ColumnsDropdown } from './columns-dropdown';
import { CompanyDetailsDialog } from './company-details-dialog';
import { CompanyEmailDialog } from './company-email-dialog';
import { CompanyFormDialog } from './company-form-dialog';
import { InlineSelectEditor, InlineTextEditor } from './inline-edit';

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

function toHref(raw: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

type GroupBy = 'none' | 'size' | 'type' | 'industry' | 'status';

/** Fields editable inline (click a cell). */
type EditableField =
  'phone' | 'industry' | 'address' | 'company_size' | 'company_type' | 'status' | 'year_founded';

interface EditingCell {
  companyId: string;
  field: EditableField;
}

/** Table columns that can be hidden via the columns toggle. */
type ColumnKey =
  'phone' | 'industry' | 'address' | 'size' | 'type' | 'status' | 'year_founded' | 'links' | 'actions';

const ALL_COLUMNS: ColumnKey[] = [
  'phone',
  'industry',
  'address',
  'size',
  'type',
  'status',
  'year_founded',
  'links',
  'actions',
];

const DEFAULT_COLUMNS: Record<ColumnKey, boolean> = Object.fromEntries(
  ALL_COLUMNS.map((key) => [key, true])
) as Record<ColumnKey, boolean>;

const COLUMNS_STORAGE_KEY = 'companies.table.columns';

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

/** Badge styles per company status (static classes so Tailwind keeps them). */
import { STATUS_STYLES } from './status-styles';

const EXPORT_HEADERS = [
  'name',
  'email',
  'phone',
  'address',
  'website',
  'company_size',
  'company_type',
  'status',
  'linkedin_url',
  'industry',
  'year_founded',
];

/** Import fields in display order (labels come from `companies.form.*`). */
const IMPORT_FIELDS: CompanyField[] = [
  'name',
  'email',
  'phone',
  'address',
  'website',
  'company_size',
  'company_type',
  'status',
  'linkedin_url',
  'industry',
  'year_founded',
];

const STATUS_VALUES: CompanyStatus[] = [
  'watching',
  'contacted',
  'applied',
  'interviewing',
  'negotiating',
  'won',
  'lost',
];

const PAGE_SIZE_OPTIONS = ['10', '25', '50'];

export function CompaniesTable() {
  const { t } = useTranslations();
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Company | null>(null);
  const [details, setDetails] = useState<Company | null>(null);
  const [emailing, setEmailing] = useState<Company | null>(null);
  const [deleting, setDeleting] = useState<Company | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [editingCell, setEditingCell] = useState<EditingCell | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleteOpen, setBulkDeleteOpen] = useState(false);
  const [bulkDeleteError, setBulkDeleteError] = useState<string | null>(null);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const [search, setSearch] = useState('');
  const [sizeFilter, setSizeFilter] = useState<CompanySize | ''>('');
  const [typeFilter, setTypeFilter] = useState<CompanyType | ''>('');
  const [statusFilter, setStatusFilter] = useState<CompanyStatus | ''>('');
  const [groupBy, setGroupBy] = useState<GroupBy>('none');
  const [visibleColumns, setVisibleColumns] = useState<Record<ColumnKey, boolean>>(DEFAULT_COLUMNS);

  // Load saved column prefs after hydration (a lazy useState initializer would
  // read localStorage during hydration and mismatch the SSR'd defaults).
  useEffect(() => {
    setVisibleColumns(loadColumnPrefs());
  }, []);

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
  const [importResult, setImportResult] = useState<CompanyImportResponse | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const importOpen = importResult !== null || importError !== null;
  const [mappingFile, setMappingFile] = useState<File | null>(null);
  const [mappingHeaders, setMappingHeaders] = useState<CompanyImportHeaders | null>(null);
  const [mapping, setMapping] = useState<Partial<Record<CompanyField, string>>>({});
  const [mappingError, setMappingError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await listCompanies();
      setCompanies(res.companies);
      setSelectedIds((prev) => {
        if (prev.size === 0) return prev;
        const alive = new Set(res.companies.map((c) => c.company_id));
        const pruned = new Set([...prev].filter((id) => alive.has(id)));
        return pruned.size === prev.size ? prev : pruned;
      });
    } catch {
      setError(t('companies.errors.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const sizeLabel = (size: CompanySize | null): string =>
    size ? t(`companies.size.${size}`) : '—';
  const typeLabel = (type: CompanyType | null): string =>
    type ? t(`companies.type.${type}`) : '—';
  const statusLabel = (status: CompanyStatus | null): string =>
    status ? t(`companies.status.${status}`) : '—';

  const fieldLabel = (field: CompanyField): string =>
    t(
      field === 'company_size'
        ? 'companies.form.size'
        : field === 'company_type'
          ? 'companies.form.type'
          : field === 'status'
            ? 'companies.form.status'
            : field === 'linkedin_url'
              ? 'companies.form.linkedin'
              : field === 'year_founded'
                ? 'companies.form.yearFounded'
                : `companies.form.${field}`
    );

  const cellValue = (company: Company, field: EditableField): string => {
    switch (field) {
      case 'phone':
        return company.phone ?? '';
      case 'industry':
        return company.industry ?? '';
      case 'address':
        return company.address ?? '';
      case 'company_size':
        return company.company_size ?? '';
      case 'company_type':
        return company.company_type ?? '';
      case 'status':
        return company.status ?? '';
      case 'year_founded':
        return company.year_founded?.toString() ?? '';
    }
  };

  const handleCellCommit = async (companyId: string, field: EditableField, raw: string) => {
    const original = companies.find((c) => c.company_id === companyId);
    setEditingCell(null);
    if (!original) return;

    let value: string | number | null;
    if (field === 'year_founded') {
      const trimmed = raw.trim();
      if (trimmed !== '' && !/^\d{4}$/.test(trimmed)) {
        setError(t('companies.form.invalidYear'));
        return;
      }
      value = trimmed === '' ? null : Number(trimmed);
    } else {
      const trimmed = raw.trim();
      value = trimmed === '' ? null : trimmed;
    }

    const current = cellValue(original, field);
    const unchanged = value === null ? current === '' : String(value) === current;
    if (unchanged) return;

    setError(null);
    try {
      const updated = await updateCompany(companyId, { [field]: value } as CompanyUpdate);
      setCompanies((prev) => prev.map((c) => (c.company_id === companyId ? updated : c)));
    } catch {
      setCompanies((prev) => prev.map((c) => (c.company_id === companyId ? original : c)));
      setError(t('companies.errors.updateFailed'));
    }
  };

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return companies.filter((company) => {
      if (sizeFilter && company.company_size !== sizeFilter) return false;
      if (typeFilter && company.company_type !== typeFilter) return false;
      if (statusFilter && company.status !== statusFilter) return false;
      if (!query) return true;
      return (
        company.name.toLowerCase().includes(query) ||
        (company.industry ?? '').toLowerCase().includes(query) ||
        (company.address ?? '').toLowerCase().includes(query) ||
        (company.email ?? '').toLowerCase().includes(query)
      );
    });
  }, [companies, search, sizeFilter, typeFilter, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageRows = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, page, pageSize]);

  useEffect(() => {
    setPage(1);
  }, [search, sizeFilter, typeFilter, statusFilter, groupBy]);

  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const groups = useMemo(() => {
    if (groupBy === 'none') return null;
    const grouped = new Map<string, Company[]>();
    for (const company of pageRows) {
      const key =
        groupBy === 'size'
          ? (company.company_size ?? '')
          : groupBy === 'type'
            ? (company.company_type ?? '')
            : groupBy === 'status'
              ? (company.status ?? '')
              : (company.industry ?? '');
      const list = grouped.get(key) ?? [];
      list.push(company);
      grouped.set(key, list);
    }
    const sorted = [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b));
    return sorted;
  }, [pageRows, groupBy]);

  const groupLabel = (key: string): string => {
    if (groupBy === 'size') return key ? sizeLabel(key as CompanySize) : '—';
    if (groupBy === 'type') return key ? typeLabel(key as CompanyType) : '—';
    if (groupBy === 'status') return key ? statusLabel(key as CompanyStatus) : '—';
    return key || '—';
  };

  const handleExport = () => {
    const rows = filtered.map((company) => [
      company.name,
      company.email,
      company.phone,
      company.address,
      company.website,
      company.company_size,
      company.company_type,
      company.status,
      company.linkedin_url,
      company.industry,
      company.year_founded,
    ]);
    downloadCsv('companies.csv', EXPORT_HEADERS, rows);
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
      setImportError(t('companies.import.failed'));
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleRunImport = async () => {
    if (!mappingFile || !mappingHeaders) return;
    if (!mapping.name?.trim()) {
      setMappingError(t('companies.import.mappingNameRequired'));
      return;
    }
    setImporting(true);
    setImportError(null);
    setMappingError(null);
    try {
      const result = await importCompanies(mappingFile, mapping);
      setMappingFile(null);
      setMappingHeaders(null);
      setMapping({});
      setImportResult(result);
      await load();
    } catch {
      setImportError(t('companies.import.failed'));
    } finally {
      setImporting(false);
    }
  };

  const handleDelete = async () => {
    if (!deleting) return;
    setDeleteError(null);
    try {
      await deleteCompany(deleting.company_id);
      setDeleting(null);
      await load();
    } catch {
      setDeleteError(t('companies.errors.deleteFailed'));
    }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    setBulkDeleting(true);
    setBulkDeleteError(null);
    try {
      await bulkDeleteCompanies([...selectedIds]);
      setSelectedIds(new Set());
      setBulkDeleteOpen(false);
      await load();
    } catch {
      setBulkDeleteError(t('companies.errors.deleteFailed'));
    } finally {
      setBulkDeleting(false);
    }
  };

  const toggleSelect = (companyId: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(companyId)) {
        next.delete(companyId);
      } else {
        next.add(companyId);
      }
      return next;
    });
  };

  const pageSelectedCount = pageRows.filter((c) => selectedIds.has(c.company_id)).length;
  const allPageSelected = pageRows.length > 0 && pageSelectedCount === pageRows.length;

  const sizeOptions = (['1-10', '11-50', '51-200', '201-1000', '1000+'] as CompanySize[]).map(
    (s) => ({ id: s, label: sizeLabel(s) })
  );
  const typeOptions = (
    [
      'startup',
      'agency',
      'enterprise',
      'nonprofit',
      'education',
      'government',
      'other',
    ] as CompanyType[]
  ).map((ty) => ({ id: ty, label: typeLabel(ty) }));
  const statusOptions = STATUS_VALUES.map((s) => ({ id: s, label: statusLabel(s) }));
  const allOption = { id: '', label: t('companies.toolbar.all') };
  const groupByOptions: { id: GroupBy; label: string }[] = [
    { id: 'none', label: t('companies.toolbar.groupNone') },
    { id: 'size', label: t('companies.toolbar.groupSize') },
    { id: 'type', label: t('companies.toolbar.groupType') },
    { id: 'industry', label: t('companies.toolbar.groupIndustry') },
    { id: 'status', label: t('companies.toolbar.groupStatus') },
  ];
  const pageSizeOptions = PAGE_SIZE_OPTIONS.map((size) => ({
    id: size,
    label: t('companies.pagination.perPage', { count: size }),
  }));
  const columnOptions: { id: ColumnKey; label: string }[] = [
    { id: 'phone', label: t('companies.table.phone') },
    { id: 'industry', label: t('companies.table.industry') },
    { id: 'address', label: t('companies.table.address') },
    { id: 'size', label: t('companies.table.size') },
    { id: 'type', label: t('companies.table.type') },
    { id: 'status', label: t('companies.table.status') },
    { id: 'year_founded', label: t('companies.table.yearFounded') },
    { id: 'links', label: t('companies.table.links') },
    { id: 'actions', label: t('companies.table.actions') },
  ];
  const toggleColumn = (key: ColumnKey) =>
    setVisibleColumns((prev) => ({ ...prev, [key]: !prev[key] }));
  const visibleColumnCount = ALL_COLUMNS.filter((key) => visibleColumns[key]).length;

  const showTable = !loading && companies.length > 0;
  const showNoResults = !loading && companies.length > 0 && filtered.length === 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Header — navy gradient band with title + actions */}
      <div className="relative shrink-0 overflow-hidden bg-gradient-to-br from-primary via-primary to-[#15304f] px-6 py-8 md:px-8">
        <div className="pointer-events-none absolute -right-16 -top-24 h-64 w-64 rounded-full bg-white/5" />
        <div className="pointer-events-none absolute -bottom-28 right-40 h-60 w-60 rounded-full bg-white/5" />
        <div className="relative flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-primary-foreground/60">
              {t('companies.subtitle')}
            </p>
            <h1 className="mt-1.5 font-sans text-3xl font-bold uppercase tracking-tight text-white md:text-4xl">
              {t('companies.title')}
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
              {t('companies.toolbar.import')}
            </Button>
            <Button
              variant="outline"
              onClick={handleExport}
              disabled={filtered.length === 0}
              className="border-white/40 bg-white/10 text-white backdrop-blur hover:border-white/70 hover:bg-white/20"
            >
              <Download className="h-4 w-4" />
              {t('companies.toolbar.export')}
            </Button>
            <Button
              onClick={() => {
                setEditing(null);
                setFormOpen(true);
              }}
              className="border-white bg-white text-primary hover:bg-blue-50 hover:border-white"
            >
              <Plus className="h-4 w-4" />
              {t('companies.addCompany')}
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
                placeholder={t('companies.toolbar.searchPlaceholder')}
                aria-label={t('companies.toolbar.search')}
                className="pl-9"
              />
            </div>
            <Dropdown
              options={[allOption, ...sizeOptions]}
              value={sizeFilter}
              onChange={(value) => setSizeFilter(value as CompanySize | '')}
              ariaLabel={t('companies.toolbar.size')}
              className="min-w-0 flex-1"
              triggerClassName="h-10 rounded-lg px-3 py-0"
            />
            <Dropdown
              options={[allOption, ...typeOptions]}
              value={typeFilter}
              onChange={(value) => setTypeFilter(value as CompanyType | '')}
              ariaLabel={t('companies.toolbar.type')}
              className="min-w-0 flex-1"
              triggerClassName="h-10 rounded-lg px-3 py-0"
            />
            <Dropdown
              options={[allOption, ...statusOptions]}
              value={statusFilter}
              onChange={(value) => setStatusFilter(value as CompanyStatus | '')}
              ariaLabel={t('companies.toolbar.status')}
              className="min-w-0 flex-1"
              triggerClassName="h-10 rounded-lg px-3 py-0"
            />
            <Dropdown
              options={groupByOptions}
              value={groupBy}
              onChange={(value) => setGroupBy(value as GroupBy)}
              ariaLabel={t('companies.toolbar.groupBy')}
              className="min-w-0 flex-1"
              triggerClassName="h-10 rounded-lg px-3 py-0"
            />
            <ColumnsDropdown
              options={columnOptions}
              visible={visibleColumns}
              onChange={(id) => toggleColumn(id as ColumnKey)}
              label={t('companies.toolbar.columns')}
              ariaLabel={t('companies.toolbar.columns')}
            />
            <span className="text-xs font-medium text-ink-soft">
              {t('companies.toolbar.count', { count: String(filtered.length) })}
            </span>
          </div>
        </div>
      )}

      {selectedIds.size > 0 && (
        <div className="shrink-0 border-b border-primary/20 bg-primary/5 px-6 py-2.5 md:px-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs font-semibold text-primary">
              {t('companies.selection.count', { count: String(selectedIds.size) })}
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSelectedIds(new Set())}
                disabled={bulkDeleting}
              >
                {t('companies.selection.clear')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setBulkDeleteOpen(true)}
                disabled={bulkDeleting}
                className="border-destructive/40 text-destructive hover:bg-destructive/5"
              >
                <Trash2 className="h-4 w-4" />
                {t('companies.selection.delete')}
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
        ) : companies.length === 0 ? (
          <div className="flex flex-col items-center justify-center p-10 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-[#e6e3dc] bg-white text-primary shadow-sw-sm">
              <Building2 className="h-7 w-7" />
            </div>
            <p className="mt-4 font-sans text-lg font-bold text-ink">
              {t('companies.empty.title')}
            </p>
            <p className="mt-1 max-w-sm text-xs text-ink-soft">
              {t('companies.empty.description')}
            </p>
          </div>
        ) : showNoResults ? (
          <div className="flex flex-col items-center justify-center p-10 text-center">
            <p className="font-sans text-lg font-bold text-ink">{t('companies.empty.noResults')}</p>
            <p className="mt-1 max-w-sm text-xs text-ink-soft">
              {t('companies.empty.noResultsHint')}
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
                      aria-label={t('companies.selection.selectAll')}
                      checked={allPageSelected}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedIds(
                            (prev) => new Set([...prev, ...pageRows.map((c) => c.company_id)])
                          );
                        } else {
                          setSelectedIds((prev) => {
                            const next = new Set(prev);
                            for (const c of pageRows) next.delete(c.company_id);
                            return next;
                          });
                        }
                      }}
                      className="h-4 w-4 accent-primary"
                    />
                  </th>
                  <th className="px-4 py-3">{t('companies.table.company')}</th>
                  {visibleColumns.phone && (
                    <th className="px-4 py-3">{t('companies.table.phone')}</th>
                  )}
                  {visibleColumns.industry && (
                    <th className="px-4 py-3">{t('companies.table.industry')}</th>
                  )}
                  {visibleColumns.address && (
                    <th className="px-4 py-3">{t('companies.table.address')}</th>
                  )}
                  {visibleColumns.size && (
                    <th className="px-4 py-3">{t('companies.table.size')}</th>
                  )}
                  {visibleColumns.type && (
                    <th className="px-4 py-3">{t('companies.table.type')}</th>
                  )}
                  {visibleColumns.status && (
                    <th className="px-4 py-3">{t('companies.table.status')}</th>
                  )}
                  {visibleColumns.year_founded && (
                    <th className="px-4 py-3">{t('companies.table.yearFounded')}</th>
                  )}
                  {visibleColumns.links && (
                    <th className="px-4 py-3">{t('companies.table.links')}</th>
                  )}
                  {visibleColumns.actions && (
                    <th className="px-4 py-3 text-right">{t('companies.table.actions')}</th>
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
                        {group.map((company) => (
                          <CompanyRow
                            key={company.company_id}
                            company={company}
                            sizeLabel={sizeLabel}
                            typeLabel={typeLabel}
                            statusLabel={statusLabel}
                            selected={selectedIds.has(company.company_id)}
                            onToggleSelect={() => toggleSelect(company.company_id)}
                            onEdit={(c) => {
                              setEditing(c);
                              setFormOpen(true);
                            }}
                            onDelete={(c) => {
                              setDeleteError(null);
                              setDeleting(c);
                            }}
                            onEmail={setEmailing}
                            editingCell={editingCell}
                            onStartEdit={(companyId, field) => setEditingCell({ companyId, field })}
                            onCommit={handleCellCommit}
                            onCancelEdit={() => setEditingCell(null)}
                            onShowDetails={setDetails}
                            sizeOptions={sizeOptions}
                            typeOptions={typeOptions}
                            statusOptions={statusOptions}
                            noneLabel={t('companies.form.none')}
                            editHint={t('companies.table.editHint')}
                            visibleColumns={visibleColumns}
                            t={t}
                          />
                        ))}
                      </Fragment>
                    ))
                  : pageRows.map((company) => (
                      <CompanyRow
                        key={company.company_id}
                        company={company}
                        sizeLabel={sizeLabel}
                        typeLabel={typeLabel}
                        statusLabel={statusLabel}
                        selected={selectedIds.has(company.company_id)}
                        onToggleSelect={() => toggleSelect(company.company_id)}
                        onEdit={(c) => {
                          setEditing(c);
                          setFormOpen(true);
                        }}
                        onDelete={(c) => {
                          setDeleteError(null);
                          setDeleting(c);
                        }}
                        onEmail={setEmailing}
                        editingCell={editingCell}
                        onStartEdit={(companyId, field) => setEditingCell({ companyId, field })}
                        onCommit={handleCellCommit}
                        onCancelEdit={() => setEditingCell(null)}
                        onShowDetails={setDetails}
                        sizeOptions={sizeOptions}
                        typeOptions={typeOptions}
                        statusOptions={statusOptions}
                        noneLabel={t('companies.form.none')}
                        editHint={t('companies.table.editHint')}
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
              {t('companies.pagination.showing', {
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
                aria-label={t('companies.pagination.previous')}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
                <Button
                  key={p}
                  variant={p === page ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setPage(p)}
                  aria-label={t('companies.pagination.page', { count: String(p) })}
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
                aria-label={t('companies.pagination.next')}
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
                ariaLabel={t('companies.pagination.perPage', { count: String(pageSize) })}
                triggerClassName="h-10 rounded-lg px-3 py-0"
              />
            </div>
          </div>
        )}
      </div>

      <CompanyFormDialog
        open={formOpen}
        onOpenChange={setFormOpen}
        company={editing}
        onSaved={load}
      />

      <CompanyDetailsDialog
        open={details !== null}
        onOpenChange={(open) => {
          if (!open) setDetails(null);
        }}
        company={details}
        onEdit={() => {
          setEditing(details);
          setDetails(null);
          setFormOpen(true);
        }}
        sizeLabel={sizeLabel}
        typeLabel={typeLabel}
        statusLabel={statusLabel}
      />

      <CompanyEmailDialog
        open={emailing !== null}
        onOpenChange={(open) => {
          if (!open) setEmailing(null);
        }}
        company={emailing}
        onSent={() => void load()}
      />

      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(open) => {
          if (!open) setDeleting(null);
        }}
        variant="danger"
        title={t('companies.delete.title')}
        description={t('companies.delete.description', { name: deleting?.name ?? '' })}
        errorMessage={deleteError ?? undefined}
        confirmLabel={t('companies.delete.confirm')}
        onConfirm={handleDelete}
      />

      <ConfirmDialog
        open={bulkDeleteOpen}
        onOpenChange={(open) => {
          if (!open) setBulkDeleteOpen(false);
        }}
        variant="danger"
        title={t('companies.selection.deleteTitle')}
        description={t('companies.selection.deleteDescription', {
          count: String(selectedIds.size),
        })}
        errorMessage={bulkDeleteError ?? undefined}
        confirmLabel={t('companies.selection.delete')}
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
            <DialogTitle>{t('companies.import.mappingTitle')}</DialogTitle>
            <DialogDescription>{t('companies.import.mappingDescription')}</DialogDescription>
          </DialogHeader>
          <div className="max-h-[55vh] space-y-3 overflow-y-auto p-6">
            {mappingHeaders && (
              <>
                <p className="text-xs font-medium text-ink-soft">
                  {t('companies.import.mappingHint')}
                </p>
                {IMPORT_FIELDS.map((field) => (
                  <div key={field} className="grid grid-cols-[130px_1fr] items-center gap-3">
                    <Label className="text-[11px] font-bold uppercase tracking-wider text-ink-soft">
                      {fieldLabel(field)}
                      {mapping[field] === mappingHeaders.detected[field] &&
                        mappingHeaders.detected[field] && (
                          <span className="ml-1.5 rounded bg-primary/10 px-1 py-0.5 text-[9px] font-semibold normal-case tracking-normal text-primary">
                            {t('companies.import.mappingAuto')}
                          </span>
                        )}
                    </Label>
                    <Dropdown
                      options={[
                        { id: '', label: t('companies.form.none') },
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
              {t('companies.import.mappingImport')}
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
            <DialogTitle>{t('companies.import.title')}</DialogTitle>
            <DialogDescription>{t('companies.import.description')}</DialogDescription>
          </DialogHeader>
          <div className="max-h-[50vh] space-y-3 overflow-y-auto p-6">
            {importError ? (
              <p className="text-xs text-destructive">{importError}</p>
            ) : (
              importResult && (
                <>
                  <p className="text-xs font-medium text-ink">
                    {t('companies.import.created', { count: String(importResult.created) })}
                  </p>
                  <p className="text-xs font-medium text-ink-soft">
                    {t('companies.import.skipped', { count: String(importResult.skipped) })}
                  </p>
                  {importResult.errors.length > 0 && (
                    <>
                      <p className="text-xs font-medium text-warning">
                        {t('companies.import.failedCount', {
                          count: String(importResult.errors.length),
                        })}
                      </p>
                      <ul className="space-y-1.5">
                        {importResult.errors.map((entry, index) => (
                          <li
                            key={`${entry.row}-${index}`}
                            className="rounded-lg border border-destructive/20 bg-[#fdf3f2] px-3 py-2 text-xs text-destructive"
                          >
                            {t('companies.import.errorRow', {
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
              {t('companies.import.done')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

interface CompanyRowProps {
  company: Company;
  sizeLabel: (size: CompanySize | null) => string;
  typeLabel: (type: CompanyType | null) => string;
  statusLabel: (status: CompanyStatus | null) => string;
  selected: boolean;
  onToggleSelect: () => void;
  onEdit: (company: Company) => void;
  onDelete: (company: Company) => void;
  onEmail: (company: Company) => void;
  editingCell: EditingCell | null;
  onStartEdit: (companyId: string, field: EditableField) => void;
  onCommit: (companyId: string, field: EditableField, value: string) => void;
  onCancelEdit: () => void;
  onShowDetails: (company: Company) => void;
  sizeOptions: { id: string; label: string }[];
  typeOptions: { id: string; label: string }[];
  statusOptions: { id: string; label: string }[];
  noneLabel: string;
  editHint: string;
  visibleColumns: Record<ColumnKey, boolean>;
  t: (key: string, params?: Record<string, string | number>) => string;
}

function CompanyRow({
  company,
  sizeLabel,
  typeLabel,
  statusLabel,
  selected,
  onToggleSelect,
  onEdit,
  onDelete,
  onEmail,
  editingCell,
  onStartEdit,
  onCommit,
  onCancelEdit,
  onShowDetails,
  sizeOptions,
  typeOptions,
  statusOptions,
  noneLabel,
  editHint,
  visibleColumns,
  t,
}: CompanyRowProps) {
  const website = toHref(company.website);
  const linkedin = toHref(company.linkedin_url);
  const isEditing = (field: EditableField): boolean =>
    editingCell !== null &&
    editingCell.companyId === company.company_id &&
    editingCell.field === field;
  const startEdit = (field: EditableField) => onStartEdit(company.company_id, field);
  const commit = (field: EditableField) => (value: string) =>
    onCommit(company.company_id, field, value);
  const withNone = (options: { id: string; label: string }[]) => [
    { id: '', label: noneLabel },
    ...options,
  ];
  const editableCellProps = (field: EditableField) => ({
    title: editHint,
    onClick: () => startEdit(field),
  });
  const fieldLabel = (field: EditableField): string => {
    switch (field) {
      case 'company_size':
        return t('companies.form.size');
      case 'company_type':
        return t('companies.form.type');
      case 'status':
        return t('companies.form.status');
      case 'year_founded':
        return t('companies.form.yearFounded');
      default:
        return t(`companies.form.${field}`);
    }
  };
  return (
    <tr
      className={`group border-b border-[#f0eee8] last:border-b-0 hover:bg-paper-tint/60 ${
        selected ? 'bg-primary/5' : ''
      }`}
    >
      <td className="px-4 py-3">
        <input
          type="checkbox"
          aria-label={t('companies.selection.selectRow', { name: company.name })}
          checked={selected}
          onChange={onToggleSelect}
          className="h-4 w-4 accent-primary"
        />
      </td>
      <td className="cursor-pointer px-4 py-3" onClick={() => onShowDetails(company)}>
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-xs font-bold text-primary">
            {initialsOf(company.name)}
          </div>
          <div className="min-w-0 flex-1">
            <p
              className="truncate font-semibold text-ink group-hover:text-primary"
              title={t('companies.table.viewDetails')}
            >
              {company.name}
            </p>
            {company.email && (
              <span className="flex items-center gap-1 truncate text-xs text-ink-soft">
                <Mail className="h-3 w-3 shrink-0" />
                <span className="truncate">{company.email}</span>
              </span>
            )}
          </div>
        </div>
      </td>
      {visibleColumns.phone && (
        <td className="px-4 py-3">
          {isEditing('phone') ? (
            <InlineTextEditor
              initialValue={company.phone ?? ''}
              ariaLabel={fieldLabel('phone')}
              onCommit={commit('phone')}
              onCancel={onCancelEdit}
            />
          ) : company.phone ? (
            <span
              {...editableCellProps('phone')}
              className="cursor-text text-ink-soft hover:text-primary"
              aria-label={t('companies.table.phone')}
            >
              {company.phone}
            </span>
          ) : (
            <span {...editableCellProps('phone')} className="cursor-text text-ink-soft">
              —
            </span>
          )}
        </td>
      )}
      {visibleColumns.industry && (
        <td className="px-4 py-3">
          {isEditing('industry') ? (
            <InlineTextEditor
              initialValue={company.industry ?? ''}
              ariaLabel={fieldLabel('industry')}
              onCommit={commit('industry')}
              onCancel={onCancelEdit}
            />
          ) : (
            <span {...editableCellProps('industry')} className="cursor-text text-ink-soft">
              {company.industry || '—'}
            </span>
          )}
        </td>
      )}
      {visibleColumns.address && (
        <td className="max-w-56 px-4 py-3">
          {isEditing('address') ? (
            <InlineTextEditor
              initialValue={company.address ?? ''}
              ariaLabel={fieldLabel('address')}
              onCommit={commit('address')}
              onCancel={onCancelEdit}
            />
          ) : (
            <span
              {...editableCellProps('address')}
              className="block cursor-text truncate text-ink-soft hover:text-primary"
              title={company.address ?? undefined}
            >
              {company.address || '—'}
            </span>
          )}
        </td>
      )}
      {visibleColumns.size && (
        <td className="px-4 py-3">
          {isEditing('company_size') ? (
            <InlineSelectEditor
              initialValue={company.company_size ?? ''}
              ariaLabel={fieldLabel('company_size')}
              options={withNone(sizeOptions)}
              onCommit={commit('company_size')}
              onCancel={onCancelEdit}
            />
          ) : (
            <span {...editableCellProps('company_size')} className="cursor-text text-ink-soft">
              {sizeLabel(company.company_size)}
            </span>
          )}
        </td>
      )}
      {visibleColumns.type && (
        <td className="px-4 py-3">
          {isEditing('company_type') ? (
            <InlineSelectEditor
              initialValue={company.company_type ?? ''}
              ariaLabel={fieldLabel('company_type')}
              options={withNone(typeOptions)}
              onCommit={commit('company_type')}
              onCancel={onCancelEdit}
            />
          ) : (
            <span {...editableCellProps('company_type')} className="cursor-text text-ink-soft">
              {typeLabel(company.company_type)}
            </span>
          )}
        </td>
      )}
      {visibleColumns.status && (
        <td className="px-4 py-3">
          {isEditing('status') ? (
            <InlineSelectEditor
              initialValue={company.status ?? ''}
              ariaLabel={fieldLabel('status')}
              options={withNone(statusOptions)}
              onCommit={commit('status')}
              onCancel={onCancelEdit}
            />
          ) : company.status ? (
            <span
              {...editableCellProps('status')}
              className={`inline-flex cursor-text rounded-md border px-2 py-0.5 text-[11px] font-semibold ${
                STATUS_STYLES[company.status]
              }`}
            >
              {statusLabel(company.status)}
            </span>
          ) : (
            <span {...editableCellProps('status')} className="cursor-text text-ink-soft">
              —
            </span>
          )}
        </td>
      )}
      {visibleColumns.year_founded && (
        <td className="px-4 py-3">
          {isEditing('year_founded') ? (
            <InlineTextEditor
              initialValue={company.year_founded?.toString() ?? ''}
              ariaLabel={fieldLabel('year_founded')}
              type="number"
              onCommit={commit('year_founded')}
              onCancel={onCancelEdit}
            />
          ) : (
            <span {...editableCellProps('year_founded')} className="cursor-text text-ink-soft">
              {company.year_founded ?? '—'}
            </span>
          )}
        </td>
      )}
      {visibleColumns.links && (
        <td className="px-4 py-3">
          <div className="flex items-center gap-2">
            {website && (
              <a
                href={website}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={t('companies.table.website')}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#e6e3dc] text-ink-soft transition-colors hover:border-primary hover:text-primary"
              >
                <Globe className="h-4 w-4" />
              </a>
            )}
            {linkedin && (
              <a
                href={linkedin}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={t('companies.table.linkedin')}
                className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#e6e3dc] text-ink-soft transition-colors hover:border-primary hover:text-primary"
              >
                <Linkedin className="h-4 w-4" />
              </a>
            )}
          </div>
        </td>
      )}
      {visibleColumns.actions && (
        <td className="px-4 py-3">
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              aria-label={t('companies.table.email')}
              onClick={() => onEmail(company)}
              disabled={!company.email}
              title={company.email ? t('companies.table.email') : t('companies.emailDialog.errors.noEmail')}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#e6e3dc] text-ink-soft transition-colors hover:border-primary hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Mail className="h-4 w-4" />
            </button>
            <button
              type="button"
              aria-label={t('companies.table.edit')}
              onClick={() => onEdit(company)}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#e6e3dc] text-ink-soft transition-colors hover:border-primary hover:text-primary"
            >
              <Pencil className="h-4 w-4" />
            </button>
            <button
              type="button"
              aria-label={t('companies.table.delete')}
              onClick={() => onDelete(company)}
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
