'use client';

import React, { useEffect, useRef, useState } from 'react';
import SlidersHorizontal from 'lucide-react/dist/esm/icons/sliders-horizontal';
import X from 'lucide-react/dist/esm/icons/x';
import { Button } from '@/components/ui/button';
import { Dropdown, type DropdownOption } from '@/components/ui/dropdown';
import { useTranslations } from '@/lib/i18n';

interface FilterPopoverProps {
  sizeFilter: string;
  sizeOptions: DropdownOption[];
  allOption: DropdownOption;
  onSizeFilter: (value: string) => void;
  typeFilter: string;
  typeOptions: DropdownOption[];
  onTypeFilter: (value: string) => void;
  statusFilter: string;
  statusOptions: DropdownOption[];
  onStatusFilter: (value: string) => void;
  groupBy: string;
  groupByOptions: DropdownOption[];
  onGroupBy: (value: string) => void;
  sortBy: string;
  sortOptions: DropdownOption[];
  onSortBy: (value: string) => void;
  activeFilterCount: number;
  onClear: () => void;
}

/** Collapsible popover that holds the company filtering controls. */
export function FilterPopover({
  sizeFilter,
  sizeOptions,
  allOption,
  onSizeFilter,
  typeFilter,
  typeOptions,
  onTypeFilter,
  statusFilter,
  statusOptions,
  onStatusFilter,
  groupBy,
  groupByOptions,
  onGroupBy,
  sortBy,
  sortOptions,
  onSortBy,
  activeFilterCount,
  onClear,
}: FilterPopoverProps) {
  const { t } = useTranslations();
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const menuId = React.useId();

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-controls={isOpen ? menuId : undefined}
        aria-label={t('companies.toolbar.filters')}
        className={`flex h-10 items-center gap-2 rounded-lg border bg-white px-3 text-sm font-semibold text-ink transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-primary/20 ${
          isOpen || activeFilterCount > 0
            ? 'border-primary'
            : 'border-[#c9c5bc] hover:border-primary'
        }`}
      >
        <SlidersHorizontal className="h-4 w-4 text-ink-soft" />
        {t('companies.toolbar.filters')}
        {activeFilterCount > 0 && (
          <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-bold text-white">
            {activeFilterCount}
          </span>
        )}
      </button>

      {isOpen && (
        <div
          id={menuId}
          role="menu"
          aria-label={t('companies.toolbar.filters')}
          className="absolute right-0 top-full z-50 mt-2 w-96 rounded-xl border border-[#e6e3dc] bg-white p-4 shadow-sw-lg"
        >
          <div className="max-h-[70vh] space-y-3 overflow-y-auto">
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-soft">
                {t('companies.toolbar.size')}
              </span>
              <Dropdown
                options={[allOption, ...sizeOptions]}
                value={sizeFilter}
                onChange={onSizeFilter}
                ariaLabel={t('companies.toolbar.size')}
                triggerClassName="h-9 rounded-lg px-3 py-0 text-sm"
              />
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-soft">
                {t('companies.toolbar.type')}
              </span>
              <Dropdown
                options={[allOption, ...typeOptions]}
                value={typeFilter}
                onChange={onTypeFilter}
                ariaLabel={t('companies.toolbar.type')}
                triggerClassName="h-9 rounded-lg px-3 py-0 text-sm"
              />
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-soft">
                {t('companies.toolbar.status')}
              </span>
              <Dropdown
                options={[allOption, ...statusOptions]}
                value={statusFilter}
                onChange={onStatusFilter}
                ariaLabel={t('companies.toolbar.status')}
                triggerClassName="h-9 rounded-lg px-3 py-0 text-sm"
              />
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-soft">
                {t('companies.toolbar.groupBy')}
              </span>
              <Dropdown
                options={groupByOptions}
                value={groupBy}
                onChange={onGroupBy}
                ariaLabel={t('companies.toolbar.groupBy')}
                triggerClassName="h-9 rounded-lg px-3 py-0 text-sm"
              />
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-soft">
                {t('companies.toolbar.sortBy')}
              </span>
              <Dropdown
                options={sortOptions}
                value={sortBy}
                onChange={onSortBy}
                ariaLabel={t('companies.toolbar.sortBy')}
                triggerClassName="h-9 rounded-lg px-3 py-0 text-sm"
              />
            </div>

            {activeFilterCount > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={onClear}
                aria-label={t('companies.toolbar.clearFilters')}
                className="w-full border-[#e6e3dc] text-ink-soft hover:bg-paper-tint"
              >
                <X className="h-4 w-4" />
                {t('companies.toolbar.clearFilters')}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
