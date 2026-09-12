'use client';

import React from 'react';
import Link from 'next/link';
import ArrowLeft from 'lucide-react/dist/esm/icons/arrow-left';
import { KanbanBoard } from '@/components/tracker/kanban-board';
import SidebarNav from '@/components/common/SidebarNav';
import { useTranslations } from '@/lib/i18n';
import { useRouter } from 'next/navigation';

export default function TrackerPage() {
  const { t } = useTranslations();
  const router = useRouter();

  return (
    <div className="flex h-[100dvh] w-full flex-col overflow-hidden bg-white">
      <SidebarNav currentPage="tracker" onNavigate={(page) => router.push(page)} />
      <main className="flex min-h-0 w-full max-w-[104rem] flex-col pl-24">
        <Link
          href="/dashboard"
          className="mb-3 inline-flex shrink-0 items-center gap-1 self-start rounded-full border border-[#e6e3dc] bg-white px-3 py-1.5 text-xs uppercase text-ink-soft shadow-sw-xs transition-all hover:border-primary hover:text-primary"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          {t('nav.backToDashboard')}
        </Link>
        <div className="flex min-h-0 w-full max-w-[104rem] flex-col gap-4">
          <KanbanBoard />
        </div>
      </main>
    </div>
  );
}
