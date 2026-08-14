'use client';

import { useRouter } from 'next/navigation';
import SidebarNav from '@/components/common/SidebarNav';
import { ProfilePage } from '@/components/profile/profile-page';

export default function ProfileRoute() {
  const router = useRouter();

  return (
    <div className="flex h-[100dvh] w-full flex-col overflow-hidden bg-white pl-16">
      <SidebarNav currentPage="profile" onNavigate={(page) => router.push(page)} />
      <main className="flex min-h-0 w-full max-w-[104rem] flex-col">
        <ProfilePage />
      </main>
    </div>
  );
}
