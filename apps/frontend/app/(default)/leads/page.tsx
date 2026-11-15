'use client';

import { useRouter } from 'next/navigation';
import SidebarNav from '@/components/common/SidebarNav';
import LeadsPage from '@/components/leads/leads-page';

export default function Leads() {
  const router = useRouter();

  return (
    <div className="flex h-[100dvh] w-full flex-col overflow-hidden bg-white pl-16">
      <SidebarNav currentPage="leads" onNavigate={(page) => router.push(page)} />
      <main className="flex min-h-0 w-full flex-col overflow-y-auto">
        <LeadsPage />
      </main>
    </div>
  );
}
