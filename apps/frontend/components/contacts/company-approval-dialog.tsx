'use client';

import React, { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Building2, ExternalLink, Globe, Briefcase, CheckCircle2 } from 'lucide-react';
import { useTranslations } from '@/lib/i18n';
import { createCompany } from '@/lib/api/companies';

interface CompanyApprovalDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  company: string;
  website?: string;
  industry?: string;
  onAdded: () => void;
}

export function CompanyApprovalDialog({
  open,
  onOpenChange,
  company,
  website,
  industry,
  onAdded,
}: CompanyApprovalDialogProps) {
  const { t } = useTranslations();
  const [submitting, setSubmitting] = useState(false);

  const handleAdd = async () => {
    setSubmitting(true);
    try {
      await createCompany({
        name: company,
        ...(website && { website }),
        ...(industry && { industry }),
      });
      onAdded();
      onOpenChange(false);
    } catch {
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md p-0 gap-0 overflow-hidden">
        <DialogHeader className="p-6 pb-4">
          <DialogTitle className="flex items-center gap-2 text-lg">
            <div className="flex items-center justify-center w-9 h-9 rounded-full bg-primary/10">
              <Building2 className="w-5 h-5 text-primary" />
            </div>
            {t('companies.approval.title')}
          </DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground pt-2">
            {t('companies.approval.description', { company })}
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 pb-6">
          <div className="rounded-lg border bg-muted/30 divide-y">
            <div className="flex items-center gap-3 px-4 py-3">
              <Building2 className="w-4 h-4 text-muted-foreground shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-xs text-muted-foreground">{t('companies.approval.name')}</p>
                <p className="text-sm font-medium truncate">{company}</p>
              </div>
            </div>
            {website && (
              <div className="flex items-center gap-3 px-4 py-3">
                <Globe className="w-4 h-4 text-muted-foreground shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-muted-foreground">{t('companies.approval.website')}</p>
                  <a
                    href={website.startsWith('http') ? website : `https://${website}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm font-medium text-primary hover:underline inline-flex items-center gap-1 truncate"
                  >
                    {website.replace(/^https?:\/\//, '')}
                    <ExternalLink className="w-3 h-3 shrink-0" />
                  </a>
                </div>
              </div>
            )}
            {industry && (
              <div className="flex items-center gap-3 px-4 py-3">
                <Briefcase className="w-4 h-4 text-muted-foreground shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-muted-foreground">{t('companies.approval.industry')}</p>
                  <p className="text-sm font-medium">{industry}</p>
                </div>
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="px-6 py-4 border-t bg-muted/20">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            {t('companies.approval.dismissButton')}
          </Button>
          <Button onClick={handleAdd} disabled={submitting} className="gap-2">
            {submitting ? (
              t('common.generating')
            ) : (
              <>
                <CheckCircle2 className="w-4 h-4" />
                {t('companies.approval.addButton')}
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
