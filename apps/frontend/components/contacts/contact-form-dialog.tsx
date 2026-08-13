'use client';

import React, { useState } from 'react';
import Loader2 from 'lucide-react/dist/esm/icons/loader-2';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dropdown } from '@/components/ui/dropdown';
import { useTranslations } from '@/lib/i18n';
import {
  createContact,
  updateContact,
  type Contact,
  type ContactGoal,
  type ContactRelationship,
  type ContactStatus,
} from '@/lib/api/contacts';

interface ContactFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When set, the dialog edits this contact; otherwise it creates a new one. */
  contact?: Contact | null;
  onSaved: () => void;
}

export function ContactFormDialog({
  open,
  onOpenChange,
  contact,
  onSaved,
}: ContactFormDialogProps) {
  const { t } = useTranslations();
  const editing = Boolean(contact);

  const [name, setName] = useState('');
  const [company, setCompany] = useState('');
  const [location, setLocation] = useState('');
  const [goal, setGoal] = useState<ContactGoal | ''>('');
  const [status, setStatus] = useState<ContactStatus | ''>('');
  const [relationship, setRelationship] = useState<ContactRelationship | ''>('');
  const [followUpDate, setFollowUpDate] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Seed the form from the contact being edited whenever the dialog opens.
  React.useEffect(() => {
    if (!open) return;
    setName(contact?.name ?? '');
    setCompany(contact?.company ?? '');
    setLocation(contact?.location ?? '');
    setGoal(contact?.goal ?? '');
    setStatus(contact?.status ?? '');
    setRelationship(contact?.relationship ?? '');
    setFollowUpDate(contact?.follow_up_date ?? '');
    setError(null);
  }, [open, contact]);

  const goalOptions = (
    [
      'networking',
      'informational_interview',
      'request_referral',
      'research_interviewer',
      'research_career',
    ] as ContactGoal[]
  ).map((g) => ({ id: g, label: t(`contacts.goal.${g}`) }));
  const statusOptions = (
    ['to_contact', 'follow_up', 'meeting_scheduled', 'thank_you_sent'] as ContactStatus[]
  ).map((s) => ({ id: s, label: t(`contacts.status.${s}`) }));
  const relationshipOptions = (
    [
      'self',
      'coworker',
      'friend',
      'family',
      'other',
      'recruiter',
      'mentor',
      'hiring_manager',
      'alumni',
    ] as ContactRelationship[]
  ).map((r) => ({ id: r, label: t(`contacts.relationship.${r}`) }));
  const noneOption = { id: '', label: t('contacts.form.none') };

  const handleSubmit = async () => {
    if (!name.trim()) {
      setError(t('contacts.form.validation'));
      return;
    }
    if (
      followUpDate.trim() !== '' &&
      !/^\d{4}-\d{2}-\d{2}$/.test(followUpDate.trim())
    ) {
      setError(t('contacts.form.invalidDate'));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const payload = {
        name: name.trim(),
        company: company.trim() || undefined,
        location: location.trim() || undefined,
        goal: (goal as ContactGoal | '') || undefined,
        status: (status as ContactStatus | '') || undefined,
        relationship: (relationship as ContactRelationship | '') || undefined,
        follow_up_date: followUpDate.trim() || undefined,
      };
      if (editing && contact) {
        await updateContact(contact.contact_id, payload);
      } else {
        await createContact(payload);
      }
      onSaved();
      onOpenChange(false);
    } catch {
      setError(t('contacts.form.failed'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl p-0 gap-0 overflow-hidden">
        <DialogHeader className="border-b border-[#e6e3dc] bg-white p-6">
          <DialogTitle>
            {editing ? t('contacts.form.editTitle') : t('contacts.form.addTitle')}
          </DialogTitle>
          <DialogDescription>{t('contacts.form.description')}</DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] space-y-4 overflow-y-auto p-6">
          <div className="space-y-1">
            <Label htmlFor="contact-name">{t('contacts.form.name')}</Label>
            <Input
              id="contact-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('contacts.form.namePlaceholder')}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="contact-company">{t('contacts.form.company')}</Label>
              <Input
                id="contact-company"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                placeholder={t('contacts.form.optional')}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="contact-location">{t('contacts.form.location')}</Label>
              <Input
                id="contact-location"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder={t('contacts.form.optional')}
              />
            </div>
            <div className="space-y-1">
              <Label>{t('contacts.form.goal')}</Label>
              <Dropdown
                options={[noneOption, ...goalOptions]}
                value={goal}
                onChange={(value) => setGoal(value as ContactGoal | '')}
              />
            </div>
            <div className="space-y-1">
              <Label>{t('contacts.form.status')}</Label>
              <Dropdown
                options={[noneOption, ...statusOptions]}
                value={status}
                onChange={(value) => setStatus(value as ContactStatus | '')}
              />
            </div>
            <div className="space-y-1">
              <Label>{t('contacts.form.relationship')}</Label>
              <Dropdown
                options={[noneOption, ...relationshipOptions]}
                value={relationship}
                onChange={(value) => setRelationship(value as ContactRelationship | '')}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="contact-follow-up-date">{t('contacts.form.followUpDate')}</Label>
              <Input
                id="contact-follow-up-date"
                type="date"
                value={followUpDate}
                onChange={(e) => setFollowUpDate(e.target.value)}
                placeholder={t('contacts.form.optional')}
              />
            </div>
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <DialogFooter className="flex-row justify-end gap-3 border-t border-[#e6e3dc] bg-secondary p-4">
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : editing ? (
              t('contacts.form.save')
            ) : (
              t('contacts.form.submit')
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}