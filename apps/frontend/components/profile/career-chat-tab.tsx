'use client';

import { useRef, useState } from 'react';
import Send from 'lucide-react/dist/esm/icons/send';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';
import Sparkles from 'lucide-react/dist/esm/icons/sparkles';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { useTranslations } from '@/lib/i18n';
import { askCareerQuestion, type ChatMessage } from '@/lib/api/profile';
import { MarkdownContent } from '@/components/common/markdown-content';

const MAX_HISTORY = 8;

const SUGGESTED_QUESTIONS = [
  'profile.chat.suggestions.q1',
  'profile.chat.suggestions.q2',
  'profile.chat.suggestions.q3',
  'profile.chat.suggestions.q4',
];

export function CareerChatTab() {
  const { t } = useTranslations();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
    });
  };

  const send = async (question: string) => {
    const text = question.trim();
    if (!text || sending) return;

    const history = messages.slice(-MAX_HISTORY);
    const userMessage: ChatMessage = { role: 'user', content: text };
    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setSending(true);
    setError(null);
    scrollToBottom();

    try {
      const response = await askCareerQuestion({
        question: text,
        history: history.slice(0, MAX_HISTORY),
      });
      setMessages((prev) => [...prev, { role: 'assistant', content: response.answer }]);
      scrollToBottom();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setMessages((prev) => prev.filter((m) => m !== userMessage));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex h-full min-h-[28rem] flex-col rounded-2xl border border-[#e6e3dc] bg-white shadow-sw-xs">
      <div className="flex items-center gap-2 border-b border-[#e6e3dc] px-5 py-3 text-xs font-bold uppercase tracking-wide text-primary">
        <Sparkles className="h-4 w-4" />
        {t('profile.chat.title')}
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
        {messages.length === 0 && (
          <div className="space-y-3 py-4">
            <p className="text-sm text-ink-soft">{t('profile.chat.empty')}</p>
            <div className="flex flex-wrap gap-2">
              {SUGGESTED_QUESTIONS.map((key) => (
                <button
                  key={key}
                  onClick={() => void send(t(key))}
                  className="rounded-full border border-[#e6e3dc] bg-paper-tint px-3 py-1.5 text-xs font-bold text-ink hover:bg-[#f0ece4]"
                >
                  {t(key)}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((message, index) => (
          <div
            key={index}
            className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={
                message.role === 'user'
                  ? 'max-w-[80%] rounded-2xl rounded-br-sm bg-primary px-4 py-2.5 text-sm text-white'
                  : 'max-w-[85%] rounded-2xl rounded-bl-sm border border-[#e6e3dc] bg-white px-4 py-2.5'
              }
            >
              {message.role === 'assistant' ? (
                <MarkdownContent content={message.content} />
              ) : (
                <span className="whitespace-pre-wrap">{message.content}</span>
              )}
            </div>
          </div>
        ))}

        {sending && (
          <div className="flex justify-start">
            <div className="rounded-2xl rounded-bl-sm border border-[#e6e3dc] px-4 py-2.5">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
            </div>
          </div>
        )}

        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>

      <div className="border-t border-[#e6e3dc] p-3">
        <div className="flex items-end gap-2">
          <Textarea
            rows={2}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void send(input);
              }
            }}
            placeholder={t('profile.chat.placeholder')}
            className="min-h-[3rem] flex-1 resize-none"
          />
          <Button onClick={() => void send(input)} disabled={sending || !input.trim()}>
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
      </div>
    </div>
  );
}
