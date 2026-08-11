import type { Locale } from '@/i18n/config';

import en from '@/messages/en.json';
import fr from '@/messages/fr.json';

export type Messages = typeof en;

const allMessages: Record<Locale, Messages> = {
  en,
  fr,
};

export function getMessages(locale: Locale): Messages {
  return allMessages[locale] || allMessages.en;
}
