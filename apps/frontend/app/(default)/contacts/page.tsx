'use client';

import { useRouter } from 'next/navigation';
import SidebarNav from '@/components/common/SidebarNav';
import { ContactsTable } from '@/components/contacts/contacts-table';

export default function ContactsPage() {
  const router = useRouter();

  return (
    <div className="flex h-[100dvh] w-full flex-col overflow-hidden bg-white pl-16">
      <SidebarNav currentPage="contacts" onNavigate={(page) => router.push(page)} />
      <main className="flex min-h-0 w-full max-w-[104rem] flex-col">
        <ContactsTable />
      </main>
    </div>
  );
}