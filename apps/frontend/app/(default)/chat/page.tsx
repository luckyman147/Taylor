'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Sparkles } from 'lucide-react';
import SidebarNav from '@/components/common/SidebarNav';
import { ThreadSidebar } from '@/components/chat/thread-sidebar';
import { useTranslations } from '@/lib/i18n';

const SUGGESTED_QUESTIONS = [
  'chat.suggestions.q1',
  'chat.suggestions.q2',
  'chat.suggestions.q3',
  'chat.suggestions.q4',
];

export default function ChatRoute() {
  const router = useRouter();
  const { t } = useTranslations();

  const handleSelectThread = (threadId: string) => {
    router.push(`/chat/${threadId}`);
  };

  const handleNewThread = (threadId: string) => {
    router.push(`/chat/${threadId}`);
  };

  return (
    <div className="flex h-[100dvh] w-full flex-col overflow-hidden bg-white pl-16">
      <SidebarNav currentPage="chat" onNavigate={(page) => router.push(page)} />
      <main className="flex min-h-0 flex-1 w-full max-w-[104rem] flex-col">
        <div className="flex min-h-0 flex-1">
          {/* Thread sidebar */}
          <ThreadSidebar
            activeThreadId={null}
            onSelectThread={handleSelectThread}
            onNewThread={handleNewThread}
          />

          {/* Empty state */}
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center p-8">
            <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-full bg-primary/10">
              <Sparkles className="h-8 w-8 text-primary" />
            </div>
            <h2 className="mb-2 text-[26px] font-bold leading-tight text-ink">
              {t('chat.empty.title')}
            </h2>
            <p className="mb-8 max-w-md text-center text-sm leading-relaxed text-ink-soft">
              {t('chat.empty.description')}
            </p>
            <div className="flex flex-wrap justify-center gap-2.5">
              {SUGGESTED_QUESTIONS.map((key) => (
                <button
                  key={key}
                  onClick={() => router.push('/chat')}
                  className="rounded-full border border-[#e6e3dc] bg-[#faf9f7] px-4 py-2 text-sm font-medium text-ink-soft transition-colors hover:border-primary/25 hover:bg-primary/5 hover:text-primary"
                >
                  {t(key)}
                </button>
              ))}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
