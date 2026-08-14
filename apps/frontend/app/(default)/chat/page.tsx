'use client';

import { useRouter } from 'next/navigation';
import Sparkles from 'lucide-react/dist/esm/icons/sparkles';
import SidebarNav from '@/components/common/SidebarNav';
import { CareerChatTab } from '@/components/profile/career-chat-tab';
import { useTranslations } from '@/lib/i18n';

export default function ChatRoute() {
  const router = useRouter();
  const { t } = useTranslations();

  return (
    <div className="flex h-[100dvh] w-full flex-col overflow-hidden bg-white pl-16">
      <SidebarNav currentPage="chat" onNavigate={(page) => router.push(page)} />
      <main className="flex min-h-0 w-full max-w-[104rem] flex-col">
        <div className="flex min-h-0 flex-1 flex-col p-6">
          <header className="mb-5 flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary text-white">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-ink">{t('profile.chat.title')}</h1>
              <p className="text-xs text-ink-soft">{t('profile.subtitle')}</p>
            </div>
          </header>
          <div className="min-h-0 flex-1">
            <CareerChatTab />
          </div>
        </div>
      </main>
    </div>
  );
}
