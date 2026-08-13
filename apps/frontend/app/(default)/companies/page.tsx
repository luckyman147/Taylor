'use client';

import { useRouter } from 'next/navigation';
import SidebarNav from '@/components/common/SidebarNav';
import { CompaniesTable } from '@/components/companies/companies-table';

export default function CompaniesPage() {
  const router = useRouter();

  return (
    <div className="flex h-[100dvh] w-full flex-col overflow-hidden bg-white pl-16">
      <SidebarNav currentPage="companies" onNavigate={(page) => router.push(page)} />
      <main className="flex min-h-0 w-full max-w-[104rem] flex-col">
        <CompaniesTable />
      </main>
    </div>
  );
}
