'use client';

import Mail from 'lucide-react/dist/esm/icons/mail';
import Phone from 'lucide-react/dist/esm/icons/phone';
import Globe from 'lucide-react/dist/esm/icons/globe';
import Linkedin from 'lucide-react/dist/esm/icons/linkedin';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { useTranslations } from '@/lib/i18n';
import type { Company, CompanySize, CompanyStatus, CompanyType } from '@/lib/api/companies';
import { STATUS_STYLES } from './status-styles';

interface CompanyDetailsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  company: Company | null;
  onEdit: () => void;
  sizeLabel: (size: CompanySize | null) => string;
  typeLabel: (type: CompanyType | null) => string;
  statusLabel: (status: CompanyStatus | null) => string;
}

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
}

function toHref(raw: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function CompanyDetailsDialog({
  open,
  onOpenChange,
  company,
  onEdit,
  sizeLabel,
  typeLabel,
  statusLabel,
}: CompanyDetailsDialogProps) {
  const { t } = useTranslations();
  if (!company) return null;

  const website = toHref(company.website);
  const linkedin = toHref(company.linkedin_url);
  const name = company.name || t('common.unknown');

  const rows: {
    label: string;
    value: string;
    href?: string;
    external?: boolean;
    icon?: 'mail' | 'phone' | 'globe' | 'linkedin';
  }[] = [
    {
      label: t('companies.form.email'),
      value: company.email ?? '—',
      href: company.email ? `mailto:${company.email}` : undefined,
      icon: company.email ? 'mail' : undefined,
    },
    {
      label: t('companies.form.phone'),
      value: company.phone ?? '—',
      href: company.phone ? `tel:${company.phone}` : undefined,
      icon: company.phone ? 'phone' : undefined,
    },
    {
      label: t('companies.form.address'),
      value: company.address ?? '—',
    },
    {
      label: t('companies.form.website'),
      value: website ?? '—',
      href: website ?? undefined,
      external: true,
      icon: website ? 'globe' : undefined,
    },
    {
      label: t('companies.form.linkedin'),
      value: linkedin ?? '—',
      href: linkedin ?? undefined,
      external: true,
      icon: linkedin ? 'linkedin' : undefined,
    },
    {
      label: t('companies.form.industry'),
      value: company.industry ?? '—',
    },
    {
      label: t('companies.form.size'),
      value: sizeLabel(company.company_size),
    },
    {
      label: t('companies.form.type'),
      value: typeLabel(company.company_type),
    },
    {
      label: t('companies.form.yearFounded'),
      value: company.year_founded != null ? String(company.year_founded) : '—',
    },
    {
      label: t('companies.details.created'),
      value: formatDate(company.created_at),
    },
    {
      label: t('companies.details.updated'),
      value: formatDate(company.updated_at),
    },
  ];

  const rowIcon = (icon: string) => {
    switch (icon) {
      case 'mail':
        return <Mail className="h-3.5 w-3.5 shrink-0" />;
      case 'phone':
        return <Phone className="h-3.5 w-3.5 shrink-0" />;
      case 'globe':
        return <Globe className="h-3.5 w-3.5 shrink-0" />;
      case 'linkedin':
        return <Linkedin className="h-3.5 w-3.5 shrink-0" />;
      default:
        return null;
    }
  };

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
                {typeLabel(company.company_type)}
                {company.industry ? ` · ${company.industry}` : ''}
              </p>
            </div>
            {company.status && (
              <span
                className={`inline-flex shrink-0 rounded-md border px-2 py-0.5 text-[11px] font-semibold ${
                  STATUS_STYLES[company.status]
                }`}
              >
                {statusLabel(company.status)}
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
                      {...(row.external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                      className="inline-flex max-w-full items-center gap-1.5 truncate font-medium text-primary hover:underline"
                    >
                      {row.icon && rowIcon(row.icon)}
                      <span className="truncate">{row.value}</span>
                    </a>
                  ) : (
                    row.value
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </div>

        <DialogFooter className="flex-row justify-end gap-3 border-t border-[#e6e3dc] bg-secondary p-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.close')}
          </Button>
          <Button onClick={onEdit}>{t('common.edit')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
