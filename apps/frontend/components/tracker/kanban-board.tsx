'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  DndContext,
  DragEndEvent,
  PointerSensor,
  KeyboardSensor,
  closestCorners,
  useSensor,
  useSensors,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import Plus from 'lucide-react/dist/esm/icons/plus';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';
import ChevronLeft from 'lucide-react/dist/esm/icons/chevron-left';
import ChevronRight from 'lucide-react/dist/esm/icons/chevron-right';
import FolderKanban from 'lucide-react/dist/esm/icons/folder-kanban';
import BarChart3 from 'lucide-react/dist/esm/icons/bar-chart-3';
import { Button } from '@/components/ui/button';
import { useTranslations } from '@/lib/i18n';
import {
  listApplications,
  updateApplication,
  bulkUpdateStatus,
  bulkDeleteApplications,
  APPLICATION_STATUS_ORDER,
  type Application,
  type ApplicationColumns,
  type ApplicationStatus,
} from '@/lib/api/tracker';
import { KanbanColumn } from './kanban-column';
import { BulkActionBar } from './bulk-action-bar';
import { CardDetailModal } from './card-detail-modal';
import { ManualAddApplicationDialog } from './manual-add-application-dialog';
import { OverviewSection } from './overview-section';
import { planMove } from './reorder';
import { STATUS_DOT } from './status-colors';

function emptyColumns(): ApplicationColumns {
  return APPLICATION_STATUS_ORDER.reduce((acc, status) => {
    acc[status] = [];
    return acc;
  }, {} as ApplicationColumns);
}

export function KanbanBoard() {
  const { t } = useTranslations();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  const [columns, setColumns] = useState<ApplicationColumns>(emptyColumns);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [openCardId, setOpenCardId] = useState<string | null>(null);
  const [manualAddOpen, setManualAddOpen] = useState(false);
  const [showOverview, setShowOverview] = useState(false);

  // Horizontal-scroll affordance: the seven stages overflow the canvas, so we
  // track whether more columns sit off-screen and surface controls + a stage
  // rail so no section is ever silently lost beyond the edge.
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);

  const load = async () => {
    try {
      const data = await listApplications();
      // Ensure all seven keys exist even if the server omits an empty one.
      setColumns({ ...emptyColumns(), ...data.columns });
      setError(null);
    } catch {
      setError(t('tracker.errors.loadFailed'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const allCards: Application[] = useMemo(
    () => APPLICATION_STATUS_ORDER.flatMap((status) => columns[status]),
    [columns]
  );

  // Master resume ids that back more than one card → "shared resume" badge.
  const sharedResumeIds = useMemo(() => {
    const counts = new Map<string, number>();
    for (const card of allCards) {
      if (card.master_resume_id) {
        counts.set(card.master_resume_id, (counts.get(card.master_resume_id) ?? 0) + 1);
      }
    }
    return new Set([...counts.entries()].filter(([, n]) => n > 1).map(([id]) => id));
  }, [allCards]);

  const isEmpty = allCards.length === 0;

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    // Board width is driven by the seven fixed-width columns, so we only need to
    // (re)attach when the board appears — not on every card-list change.
    const sync = () => {
      setCanScrollLeft(el.scrollLeft > 4);
      setCanScrollRight(Math.ceil(el.scrollLeft + el.clientWidth) < el.scrollWidth - 4);
    };
    sync();
    el.addEventListener('scroll', sync, { passive: true });
    window.addEventListener('resize', sync);
    return () => {
      el.removeEventListener('scroll', sync);
      window.removeEventListener('resize', sync);
    };
  }, [loading, isEmpty]);

  const scrollByColumn = (direction: 1 | -1) => {
    scrollRef.current?.scrollBy({ left: direction * 320, behavior: 'smooth' });
  };

  const scrollToColumn = (status: ApplicationStatus) => {
    scrollRef.current
      ?.querySelector<HTMLElement>(`[data-column="${status}"]`)
      ?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
  };

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;
    const plan = planMove(columns, String(active.id), String(over.id));
    if (!plan) return;

    // Optimistic update. If the server rejects the move we re-load authoritative
    // state from the server rather than reverting to a captured snapshot, which
    // could be stale if another move/refresh landed in the meantime.
    setColumns(plan.next);
    updateApplication(String(active.id), { status: plan.status, position: plan.position }).catch(
      async () => {
        // Re-sync authoritative state, THEN show a generic failure message:
        // load() clears the error on success, so set it afterwards to keep it
        // visible. Never echo raw backend error text (it could leak secrets).
        await load();
        setError(t('tracker.errors.moveFailed'));
      }
    );
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const nextSet = new Set(prev);
      if (nextSet.has(id)) nextSet.delete(id);
      else nextSet.add(id);
      return nextSet;
    });
  };

  const clearSelection = () => setSelectedIds(new Set());

  const handleBulkMove = async (status: ApplicationStatus) => {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    try {
      await bulkUpdateStatus(ids, status);
      clearSelection();
      await load();
    } catch {
      setError(t('tracker.errors.moveFailed'));
    }
  };

  const handleBulkDelete = async () => {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    try {
      await bulkDeleteApplications(ids);
      clearSelection();
      await load();
    } catch {
      setError(t('tracker.errors.deleteFailed'));
    }
  };

  const showScrollControls = !isEmpty && (canScrollLeft || canScrollRight);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Header — navy gradient band with kicker + travel controls */}
      <div className="relative shrink-0 overflow-hidden bg-gradient-to-br from-primary via-primary to-[#15304f] px-6 py-8 md:px-8">
        <div className="pointer-events-none absolute -right-16 -top-24 h-64 w-64 rounded-full bg-white/5" />
        <div className="pointer-events-none absolute -bottom-28 right-40 h-60 w-60 rounded-full bg-white/5" />
        <div className="pointer-events-none absolute -left-20 -top-10 hidden h-72 w-72 rounded-full bg-white/5 md:block" />
        <div className="relative flex flex-col gap-5 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-primary-foreground/60">
              {t('tracker.subtitle')}
            </p>
            <h1 className="mt-1.5 font-sans text-3xl font-bold uppercase tracking-tight text-white md:text-4xl">
              {t('tracker.title')}
            </h1>
          </div>
          <div className="flex items-center gap-3">
            {showScrollControls && (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  aria-label={t('tracker.scroll.prev')}
                  onClick={() => scrollByColumn(-1)}
                  disabled={!canScrollLeft}
                  className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/20 bg-white/10 text-white backdrop-blur transition-all hover:border-white/40 hover:bg-white/20 disabled:pointer-events-none disabled:opacity-30"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  aria-label={t('tracker.scroll.next')}
                  onClick={() => scrollByColumn(1)}
                  disabled={!canScrollRight}
                  className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/20 bg-white/10 text-white backdrop-blur transition-all hover:border-white/40 hover:bg-white/20 disabled:pointer-events-none disabled:opacity-30"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            )}
            <Button
              onClick={() => setShowOverview((v) => !v)}
              className={
                showOverview
                  ? 'border-white bg-white text-primary hover:bg-blue-50 hover:border-white'
                  : 'border-white/30 bg-white/10 text-white backdrop-blur transition-all hover:border-white/40 hover:bg-white/20'
              }
            >
              <BarChart3 className="h-4 w-4" />
              {showOverview ? t('tracker.hideOverview') : t('tracker.showOverview')}
            </Button>
            <Button
              onClick={() => setManualAddOpen(true)}
              className="border-white bg-white text-primary hover:bg-blue-50 hover:border-white"
            >
              <Plus className="h-4 w-4" />
              {t('tracker.addApplication')}
            </Button>
          </div>
        </div>
      </div>

      {error && (
        <div className="mx-6 mb-2 shrink-0 rounded-xl border border-destructive/30 bg-[#fdf3f2] px-4 py-2.5 text-xs font-medium text-destructive md:mx-8">
          {error}
        </div>
      )}

      {showOverview && (
        <div className="shrink-0 border-b border-[#e6e3dc] bg-paper-tint/40 px-6 pt-5 md:px-8">
          <div className="max-h-[55vh] overflow-y-auto pr-2">
            <OverviewSection />
          </div>
        </div>
      )}

      {selectedIds.size > 0 && (
        <div className="shrink-0 px-6 pb-4 md:px-8">
          <BulkActionBar
            selectedCount={selectedIds.size}
            onMove={handleBulkMove}
            onDelete={handleBulkDelete}
            onClear={clearSelection}
          />
        </div>
      )}

      {/* Board — flexes to fill the remaining canvas height; columns scroll
          horizontally as a group and vertically within each stage. */}
      <div className="flex min-h-0 flex-1 flex-col">
        {loading ? (
          <div className="flex flex-1 items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-steel-grey" />
          </div>
        ) : isEmpty ? (
          <div className="flex flex-1 flex-col items-center justify-center p-10 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-[#e6e3dc] bg-white text-primary shadow-sw-sm">
              <FolderKanban className="h-7 w-7" />
            </div>
            <p className="mt-4 font-sans text-lg font-bold text-ink">{t('tracker.empty.title')}</p>
            <p className="mt-1 max-w-sm text-xs text-ink-soft">{t('tracker.empty.description')}</p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
              {APPLICATION_STATUS_ORDER.map((status) => (
                <span
                  key={status}
                  className="flex items-center gap-1.5 rounded-full border border-[#e6e3dc] bg-white px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-ink-soft"
                >
                  <span className={`h-2 w-2 rounded-full ${STATUS_DOT[status]}`} />
                  {t(`tracker.columns.${status}`)}
                </span>
              ))}
            </div>
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={closestCorners}
            onDragEnd={handleDragEnd}
          >
            <div ref={scrollRef} className="flex min-h-0 flex-1 gap-4 overflow-x-auto px-4 pb-4">
              {APPLICATION_STATUS_ORDER.map((status) => (
                <div key={status} data-column={status} className="flex">
                  <KanbanColumn
                    status={status}
                    applications={columns[status]}
                    selectedIds={selectedIds}
                    sharedResumeIds={sharedResumeIds}
                    onToggleSelect={toggleSelect}
                    onOpen={setOpenCardId}
                  />
                </div>
              ))}
            </div>
          </DndContext>
        )}
      </div>

      {/* Stage rail — an always-visible map of every stage (with counts) so
          off-screen sections are never lost; click a stage to jump to it. */}
      {!isEmpty && (
        <div className="flex shrink-0 items-center gap-3 overflow-x-auto px-6 py-4 md:px-8">
          {canScrollRight && (
            <span className="flex shrink-0 items-center gap-1  text-[11px] font-bold uppercase tracking-wide text-primary">
              {t('tracker.scroll.hint')}
              <ChevronRight className="h-3.5 w-3.5" />
            </span>
          )}
          <div className="flex items-center gap-2">
            {APPLICATION_STATUS_ORDER.map((status) => (
              <button
                key={status}
                type="button"
                onClick={() => scrollToColumn(status)}
                className="flex shrink-0 items-center gap-1.5 rounded-full border border-[#e6e3dc] bg-white px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-soft shadow-sw-xs transition-all hover:border-primary hover:text-primary"
              >
                <span className={`h-2 w-2 rounded-full ${STATUS_DOT[status]}`} />
                {t(`tracker.columns.${status}`)}
                <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-paper-tint px-1 text-[10px] font-bold text-steel-grey">
                  {columns[status].length}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      <CardDetailModal
        applicationId={openCardId}
        open={openCardId !== null}
        onOpenChange={(open) => {
          if (!open) setOpenCardId(null);
        }}
        onUpdated={load}
      />

      <ManualAddApplicationDialog
        open={manualAddOpen}
        onOpenChange={setManualAddOpen}
        onCreated={load}
      />
    </div>
  );
}
