'use client';

import Mail from 'lucide-react/dist/esm/icons/mail';
import Send from 'lucide-react/dist/esm/icons/send';
import Trash2 from 'lucide-react/dist/esm/icons/trash-2';
import ExternalLink from 'lucide-react/dist/esm/icons/external-link';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { useTranslations } from '@/lib/i18n';
import type { Contact, ContactGoal, ContactRelationship, ContactStatus } from '@/lib/api/contacts';
import { STATUS_STYLES } from './status-styles';

interface ContactDetailsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contact: Contact | null;
  onEdit: () => void;
  onDelete: () => void;
  onSendEmail: (contact: Contact) => void;
  goalLabel: (goal: ContactGoal | null) => string;
  statusLabel: (status: ContactStatus | null) => string;
  relationshipLabel: (relationship: ContactRelationship | null) => string;
}

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function ContactDetailsDialog({
  open,
  onOpenChange,
  contact,
  onEdit,
  onDelete,
  onSendEmail,
  goalLabel,
  statusLabel,
  relationshipLabel,
}: ContactDetailsDialogProps) {
  const { t } = useTranslations();
  if (!contact) return null;

  const name = contact.name || t('common.unknown');

  const rows: { label: string; value: string; href?: string }[] = [
    {
      label: t('contacts.form.email'),
      value: contact.email ?? '—',
      href: contact.email ? `mailto:${contact.email}` : undefined,
    },
    {
      label: t('contacts.form.company'),
      value: contact.company ?? '—',
    },
    {
      label: t('contacts.form.location'),
      value: contact.location ?? '—',
    },
    {
      label: t('contacts.form.goal'),
      value: goalLabel(contact.goal),
    },
    {
      label: t('contacts.form.relationship'),
      value: relationshipLabel(contact.relationship),
    },
    {
      label: t('contacts.form.followUpDate'),
      value: contact.follow_up_date ?? '—',
    },
    {
      label: t('contacts.form.linkedinUrl'),
      value: contact.linkedin_url ?? '—',
      href: contact.linkedin_url || undefined,
      external: true,
    },
    {
      label: t('contacts.form.websiteUrl'),
      value: contact.website_url ?? '—',
      href: contact.website_url || undefined,
      external: true,
    },
    {
      label: t('contacts.details.created'),
      value: formatDate(contact.created_at),
    },
    {
      label: t('contacts.details.updated'),
      value: formatDate(contact.updated_at),
    },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg p-0 gap-0 overflow-hidden">
        <DialogHeader className="border-b border-[#e6e3dc] bg-white p-6">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-sm font-bold text-primary">
              {initialsOf(name)}
            </div>
            <div className="min-w-0 flex-1">
              <DialogTitle className="truncate font-sans text-xl">{name}</DialogTitle>
              <p className="mt-0.5 truncate text-xs text-ink-soft">
                {contact.company ?? t('contacts.details.noCompany')}
                {contact.location ? ` · ${contact.location}` : ''}
              </p>
            </div>
            {contact.status && (
              <span
                className={`inline-flex shrink-0 rounded-md border px-2 py-0.5 text-[11px] font-semibold ${
                  STATUS_STYLES[contact.status]
                }`}
              >
                {statusLabel(contact.status)}
              </span>
            )}
          </div>
        </DialogHeader>

        <div className="max-h-[55vh] overflow-y-auto p-6">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4">
            {rows.map((row) => (
              <div key={row.label} className="min-w-0">
                <dt className="text-[11px] font-bold uppercase tracking-wider text-ink-soft">
                  {row.label}
                </dt>
                <dd className="mt-1 truncate text-sm text-ink">
                  {row.href ? (
                    <a
                      href={row.href}
                      target={row.external ? '_blank' : undefined}
                      rel={row.external ? 'noopener noreferrer' : undefined}
                      className="inline-flex items-center gap-1 text-primary hover:underline"
                    >
                      {row.external ? (
                        <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                      ) : (
                        <Mail className="h-3.5 w-3.5 shrink-0" />
                      )}
                      {row.value}
                    </a>
                  ) : (
                    row.value
                  )}
                </dd>
              </div>
            ))}
          </dl>
          {contact.description && (
            <div className="mt-4 min-w-0">
              <dt className="text-[11px] font-bold uppercase tracking-wider text-ink-soft">
                {t('contacts.form.description')}
              </dt>
              <dd className="mt-1 whitespace-pre-wrap text-sm text-ink">
                {contact.description}
              </dd>
            </div>
          )}
        </div>

        <DialogFooter className="flex-row justify-end gap-3 border-t border-[#e6e3dc] bg-secondary p-4">
          <Button
            variant="outline"
            onClick={onDelete}
            className="border-destructive/40 text-destructive hover:bg-destructive/5"
          >
            <Trash2 className="h-4 w-4" />
            {t('common.delete')}
          </Button>
          <Button
            variant="outline"
            onClick={() => onSendEmail(contact)}
            disabled={!contact.email}
            title={contact.email ? undefined : t('contacts.emailDialog.noEmail')}
          >
            <Send className="h-4 w-4" />
            {t('contacts.emailDialog.send')}
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.close')}
          </Button>
          <Button onClick={onEdit}>{t('common.edit')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}