'use client';

import React from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { useTranslations } from '@/lib/i18n';
import type { Application, ApplicationStatus } from '@/lib/api/tracker';
import { ApplicationCard } from './application-card';
import { STATUS_DOT } from './status-colors';

interface KanbanColumnProps {
  status: ApplicationStatus;
  applications: Application[];
  selectedIds: Set<string>;
  sharedResumeIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onOpen: (id: string) => void;
}

export function KanbanColumn({
  status,
  applications,
  selectedIds,
  sharedResumeIds,
  onToggleSelect,
  onOpen,
}: KanbanColumnProps) {
  const { t } = useTranslations();
  // Droppable wrapper so EMPTY columns still accept a dropped card. The id is
  // namespaced ("column:<status>") to disambiguate from card ids.
  const { setNodeRef, isOver } = useDroppable({ id: `column:${status}` });

  return (
    <div className="flex h-full w-80 shrink-0 flex-col rounded-2xl border border-[#e6e3dc] bg-white p-3">
      <div className="mb-2 flex items-center justify-between gap-2 px-1">
        <h2 className="flex min-w-0 items-center gap-1.5 truncate text-xs font-bold uppercase tracking-wide text-ink">
          <span className={`h-2 w-2 shrink-0 rounded-full ${STATUS_DOT[status]}`} />
          <span className="truncate">{t(`tracker.columns.${status}`)}</span>
        </h2>
        <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full border border-[#e6e3dc] bg-paper-tint px-1.5 text-[10px] font-bold text-steel-grey shadow-sw-xs">
          {applications.length}
        </span>
      </div>

      <SortableContext
        items={applications.map((a) => a.application_id)}
        strategy={verticalListSortingStrategy}
      >
        <div
          ref={setNodeRef}
          className={`flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto rounded-xl p-1 transition-colors ${isOver ? 'bg-primary/5' : ''}`}
        >
          {applications.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-steel-grey/50 bg-white/50 px-2 py-8 text-center text-xs text-steel-grey">
              {t('tracker.columns.empty')}
            </div>
          ) : (
            applications.map((application) => (
              <ApplicationCard
                key={application.application_id}
                application={application}
                selected={selectedIds.has(application.application_id)}
                sharedResume={
                  application.master_resume_id !== null &&
                  sharedResumeIds.has(application.master_resume_id)
                }
                onToggleSelect={onToggleSelect}
                onOpen={onOpen}
              />
            ))
          )}
        </div>
      </SortableContext>
    </div>
  );
}
