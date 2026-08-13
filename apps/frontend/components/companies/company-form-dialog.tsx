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
  createCompany,
  updateCompany,
  type Company,
  type CompanySize,
  type CompanyStatus,
  type CompanyType,
} from '@/lib/api/companies';

interface CompanyFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When set, the dialog edits this company; otherwise it creates a new one. */
  company?: Company | null;
  onSaved: () => void;
}

export function CompanyFormDialog({
  open,
  onOpenChange,
  company,
  onSaved,
}: CompanyFormDialogProps) {
  const { t } = useTranslations();
  const editing = Boolean(company);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [website, setWebsite] = useState('');
  const [size, setSize] = useState<CompanySize | ''>('');
  const [type, setType] = useState<CompanyType | ''>('');
  const [status, setStatus] = useState<CompanyStatus | ''>('');
  const [linkedin, setLinkedin] = useState('');
  const [industry, setIndustry] = useState('');
  const [yearFounded, setYearFounded] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Seed the form from the company being edited whenever the dialog opens.
  React.useEffect(() => {
    if (!open) return;
    setName(company?.name ?? '');
    setEmail(company?.email ?? '');
    setPhone(company?.phone ?? '');
    setAddress(company?.address ?? '');
    setWebsite(company?.website ?? '');
    setSize(company?.company_size ?? '');
    setType(company?.company_type ?? '');
    setStatus(company?.status ?? '');
    setLinkedin(company?.linkedin_url ?? '');
    setIndustry(company?.industry ?? '');
    setYearFounded(company?.year_founded != null ? String(company.year_founded) : '');
    setError(null);
  }, [open, company]);

  const sizeOptions = (['1-10', '11-50', '51-200', '201-1000', '1000+'] as CompanySize[]).map(
    (s) => ({ id: s, label: t(`companies.size.${s}`) })
  );
  const typeOptions = (
    [
      'startup',
      'agency',
      'enterprise',
      'nonprofit',
      'education',
      'government',
      'other',
    ] as CompanyType[]
  ).map((ty) => ({ id: ty, label: t(`companies.type.${ty}`) }));
  const statusOptions = (
    [
      'watching',
      'contacted',
      'applied',
      'interviewing',
      'negotiating',
      'won',
      'lost',
    ] as CompanyStatus[]
  ).map((s) => ({ id: s, label: t(`companies.status.${s}`) }));
  const noneOption = { id: '', label: t('companies.form.none') };

  const yearValue = yearFounded.trim() === '' ? null : Number(yearFounded);

  const handleSubmit = async () => {
    if (!name.trim()) {
      setError(t('companies.form.validation'));
      return;
    }
    if (
      yearFounded.trim() !== '' &&
      (Number.isNaN(yearValue) || yearValue! < 1600 || yearValue! > 2100)
    ) {
      setError(t('companies.form.invalidYear'));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const payload = {
        name: name.trim(),
        email: email.trim() || undefined,
        phone: phone.trim() || undefined,
        address: address.trim() || undefined,
        website: website.trim() || undefined,
        company_size: (size as CompanySize | '') || undefined,
        company_type: (type as CompanyType | '') || undefined,
        status: (status as CompanyStatus | '') || undefined,
        linkedin_url: linkedin.trim() || undefined,
        industry: industry.trim() || undefined,
        year_founded: yearValue ?? undefined,
      };
      if (editing && company) {
        await updateCompany(company.company_id, payload);
      } else {
        await createCompany(payload);
      }
      onSaved();
      onOpenChange(false);
    } catch {
      setError(t('companies.form.failed'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl p-0 gap-0 overflow-hidden">
        <DialogHeader className="border-b border-[#e6e3dc] bg-white p-6">
          <DialogTitle>
            {editing ? t('companies.form.editTitle') : t('companies.form.addTitle')}
          </DialogTitle>
          <DialogDescription>{t('companies.form.description')}</DialogDescription>
        </DialogHeader>

        <div className="max-h-[60vh] space-y-4 overflow-y-auto p-6">
          <div className="space-y-1">
            <Label htmlFor="company-name">{t('companies.form.name')}</Label>
            <Input
              id="company-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('companies.form.namePlaceholder')}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="company-email">{t('companies.form.email')}</Label>
              <Input
                id="company-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t('companies.form.optional')}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="company-phone">{t('companies.form.phone')}</Label>
              <Input
                id="company-phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder={t('companies.form.optional')}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="company-address">{t('companies.form.address')}</Label>
              <Input
                id="company-address"
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder={t('companies.form.optional')}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="company-website">{t('companies.form.website')}</Label>
              <Input
                id="company-website"
                type="url"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
                placeholder="https://…"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="company-linkedin">{t('companies.form.linkedin')}</Label>
              <Input
                id="company-linkedin"
                type="url"
                value={linkedin}
                onChange={(e) => setLinkedin(e.target.value)}
                placeholder="https://linkedin.com/company/…"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="company-industry">{t('companies.form.industry')}</Label>
              <Input
                id="company-industry"
                value={industry}
                onChange={(e) => setIndustry(e.target.value)}
                placeholder={t('companies.form.optional')}
              />
            </div>
            <div className="space-y-1">
              <Label>{t('companies.form.size')}</Label>
              <Dropdown
                options={[noneOption, ...sizeOptions]}
                value={size}
                onChange={(value) => setSize(value as CompanySize | '')}
              />
            </div>
            <div className="space-y-1">
              <Label>{t('companies.form.type')}</Label>
              <Dropdown
                options={[noneOption, ...typeOptions]}
                value={type}
                onChange={(value) => setType(value as CompanyType | '')}
              />
            </div>
            <div className="space-y-1">
              <Label>{t('companies.form.status')}</Label>
              <Dropdown
                options={[noneOption, ...statusOptions]}
                value={status}
                onChange={(value) => setStatus(value as CompanyStatus | '')}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="company-year">{t('companies.form.yearFounded')}</Label>
              <Input
                id="company-year"
                type="number"
                min={1600}
                max={2100}
                value={yearFounded}
                onChange={(e) => setYearFounded(e.target.value)}
                placeholder={t('companies.form.optional')}
              />
            </div>
          </div>

          {error && <p className=" text-xs text-destructive">{error}</p>}
        </div>

        <DialogFooter className="flex-row justify-end gap-3 border-t border-[#e6e3dc] bg-secondary p-4">
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : editing ? (
              t('companies.form.save')
            ) : (
              t('companies.form.submit')
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
