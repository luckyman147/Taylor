'use client';

import React, { useEffect, useRef, useState } from 'react';
import SlidersHorizontal from 'lucide-react/dist/esm/icons/sliders-horizontal';
import X from 'lucide-react/dist/esm/icons/x';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dropdown } from '@/components/ui/dropdown';

export interface ContactDateRange {
  from?: string;
  to?: string;
}

interface ContactsFilterPanelProps {
  goalFilter: string;
  goalOptions: { id: string; label: string }[];
  allOption: { id: string; label: string };
  onGoalFilter: (value: string) => void;
  statusFilter: string;
  statusOptions: { id: string; label: string }[];
  onStatusFilter: (value: string) => void;
  relationshipFilter: string;
  relationshipOptions: { id: string; label: string }[];
  onRelationshipFilter: (value: string) => void;
  dateFilter: string;
  dateFilterOptions: { id: string; label: string }[];
  onDateFilter: (value: string) => void;
  dateRange: ContactDateRange;
  onDateRange: (range: ContactDateRange) => void;
  activeFilterCount: number;
  onClear: () => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}

/** Collapsible popover that holds the contact filtering controls. */
export function ContactsFilterPanel({
  goalFilter,
  goalOptions,
  allOption,
  onGoalFilter,
  statusFilter,
  statusOptions,
  onStatusFilter,
  relationshipFilter,
  relationshipOptions,
  onRelationshipFilter,
  dateFilter,
  dateFilterOptions,
  onDateFilter,
  dateRange,
  onDateRange,
  activeFilterCount,
  onClear,
  t,
}: ContactsFilterPanelProps) {
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
        aria-label={t('contacts.toolbar.filters')}
        className={`flex h-10 items-center gap-2 rounded-lg border bg-white px-3 text-sm font-semibold text-ink transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-primary/20 ${
          isOpen || activeFilterCount > 0
            ? 'border-primary'
            : 'border-[#c9c5bc] hover:border-primary'
        }`}
      >
        <SlidersHorizontal className="h-4 w-4 text-ink-soft" />
        {t('contacts.toolbar.filters')}
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
          aria-label={t('contacts.toolbar.filters')}
          className="absolute right-0 top-full z-50 mt-2 w-96 rounded-xl border border-[#e6e3dc] bg-white p-4 shadow-sw-lg"
        >
          <div className="max-h-[70vh] space-y-3 overflow-y-auto">
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-soft">
                {t('contacts.toolbar.goal')}
              </span>
              <Dropdown
                options={[allOption, ...goalOptions]}
                value={goalFilter}
                onChange={onGoalFilter}
                ariaLabel={t('contacts.toolbar.goal')}
                triggerClassName="h-9 rounded-lg px-3 py-0 text-sm"
              />
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-soft">
                {t('contacts.toolbar.status')}
              </span>
              <Dropdown
                options={[allOption, ...statusOptions]}
                value={statusFilter}
                onChange={onStatusFilter}
                ariaLabel={t('contacts.toolbar.status')}
                triggerClassName="h-9 rounded-lg px-3 py-0 text-sm"
              />
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-soft">
                {t('contacts.toolbar.relationship')}
              </span>
              <Dropdown
                options={[allOption, ...relationshipOptions]}
                value={relationshipFilter}
                onChange={onRelationshipFilter}
                ariaLabel={t('contacts.toolbar.relationship')}
                triggerClassName="h-9 rounded-lg px-3 py-0 text-sm"
              />
            </div>

            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-soft">
                {t('contacts.toolbar.date')}
              </span>
              <Dropdown
                options={dateFilterOptions}
                value={dateFilter}
                onChange={onDateFilter}
                ariaLabel={t('contacts.toolbar.date')}
                triggerClassName="h-9 rounded-lg px-3 py-0 text-sm"
              />
              <div className="flex items-center gap-2">
                <Input
                  type="date"
                  value={dateRange.from ?? ''}
                  aria-label={t('contacts.toolbar.dateFrom')}
                  onChange={(e) =>
                    onDateRange({
                      ...dateRange,
                      from: e.target.value || undefined,
                    })
                  }
                  className="h-9 flex-1 rounded-lg border-[#e6e3dc] text-sm"
                />
                <span className="text-xs text-ink-soft">–</span>
                <Input
                  type="date"
                  value={dateRange.to ?? ''}
                  aria-label={t('contacts.toolbar.dateTo')}
                  onChange={(e) =>
                    onDateRange({
                      ...dateRange,
                      to: e.target.value || undefined,
                    })
                  }
                  className="h-9 flex-1 rounded-lg border-[#e6e3dc] text-sm"
                />
              </div>
            </div>

            {activeFilterCount > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={onClear}
                aria-label={t('contacts.toolbar.clearFilters')}
                className="w-full border-[#e6e3dc] text-ink-soft hover:bg-paper-tint"
              >
                <X className="h-4 w-4" />
                {t('contacts.toolbar.clearFilters')}
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
