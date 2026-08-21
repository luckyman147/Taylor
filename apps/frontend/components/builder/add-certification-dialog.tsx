'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Award, Loader2, Plus, Search } from 'lucide-react';
import { CareerCertification, getProfile } from '@/lib/api/profile';
import { useTranslations } from '@/lib/i18n';

interface AddCertificationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAdd: (certification: CareerCertification) => void;
  existingNames: string[];
}

/**
 * AddCertificationDialog Component
 *
 * Dialog for adding a certificate from the user's career profile.
 * Purely a picker — no AI involved.
 */
export const AddCertificationDialog: React.FC<AddCertificationDialogProps> = ({
  open,
  onOpenChange,
  onAdd,
  existingNames,
}) => {
  const { t } = useTranslations();

  const [certifications, setCertifications] = useState<CareerCertification[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState('');

  const reset = useCallback(() => {
    setCertifications([]);
    setLoading(false);
    setLoadError(null);
    setQuery('');
  }, []);

  const loadCertifications = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const profile = await getProfile();
      setCertifications(profile.certifications ?? []);
    } catch {
      setLoadError(t('builder.certificationsDialog.loadError'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (open) {
      reset();
      loadCertifications();
    }
  }, [open, reset, loadCertifications]);

  const existing = new Set(existingNames.map((n) => n.trim().toLowerCase()).filter(Boolean));
  const available = certifications.filter(
    (c) => !existing.has(c.name.trim().toLowerCase())
  );

  const filtered = query.trim()
    ? available.filter(
        (c) =>
          c.name.toLowerCase().includes(query.trim().toLowerCase()) ||
          (c.issuer ?? '').toLowerCase().includes(query.trim().toLowerCase())
      )
    : available;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[560px] rounded-2xl p-0 gap-0 overflow-hidden max-h-[85vh] flex flex-col">
        <DialogHeader className="p-6 pb-4 border-b border-[#e6e3dc]">
          <DialogTitle className="font-sans text-xl font-bold uppercase tracking-tight">
            {t('builder.certificationsDialog.title')}
          </DialogTitle>
          <DialogDescription className="mt-2 text-xs text-ink-soft">
            {t('builder.certificationsDialog.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {loading && (
            <div className="flex items-center justify-center gap-3 py-12 text-sm text-steel-grey">
              <Loader2 className="w-4 h-4 animate-spin" />
              {t('builder.certificationsDialog.loading')}
            </div>
          )}

          {!loading && loadError && (
            <div className="py-8 text-center space-y-4">
              <p className="text-sm text-steel-grey">{loadError}</p>
              <Button
                variant="outline"
                size="sm"
                onClick={loadCertifications}
                className="rounded-full"
              >
                {t('builder.certificationsDialog.retry')}
              </Button>
            </div>
          )}

          {!loading && !loadError && (
            <>
              <div className="space-y-2">
                <Label className="text-xs uppercase tracking-wider text-ink-soft">
                  {t('builder.certificationsDialog.profileCertifications')}
                </Label>
                {available.length > 0 && (
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-steel-grey" />
                    <Input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder={t('builder.certificationsDialog.searchPlaceholder')}
                      className="pl-9 border-[#c9c5bc] focus:border-primary rounded-lg"
                    />
                  </div>
                )}
              </div>

              {available.length === 0 ? (
                <div className="text-center rounded-2xl border border-dashed border-[#e6e3dc] bg-paper-tint py-10 px-6 space-y-3">
                  <p className="text-sm text-steel-grey">
                    {t('builder.certificationsDialog.allAdded')}
                  </p>
                  <p className="text-xs text-steel-grey">
                    {t('builder.certificationsDialog.noCertificationsHint')}
                  </p>
                  <Link
                    href="/profile"
                    className="inline-flex items-center justify-center rounded-full border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-accent hover:text-accent-foreground"
                  >
                    {t('builder.certificationsDialog.goToProfile')}
                  </Link>
                </div>
              ) : (
                <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
                  {filtered.map((cert) => (
                    <button
                      key={cert.certification_id}
                      type="button"
                      onClick={() => {
                        onAdd(cert);
                        onOpenChange(false);
                      }}
                      className="w-full rounded-2xl border border-[#e6e3dc] bg-white p-4 text-left transition-all hover:border-primary hover:bg-paper-tint"
                    >
                      <div className="flex items-center gap-3">
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[#e6e3dc] bg-paper-tint text-ink-soft">
                          <Award className="w-4 h-4" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold text-ink truncate">{cert.name}</div>
                          {(cert.issuer || cert.date_obtained) && (
                            <div className="text-xs text-steel-grey truncate">
                              {[cert.issuer, cert.date_obtained].filter(Boolean).join(' · ')}
                            </div>
                          )}
                        </div>
                        <Plus className="w-4 h-4 shrink-0 text-primary" />
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <DialogFooter className="flex-row justify-end gap-3 border-t border-[#e6e3dc] bg-secondary p-4">
          <DialogClose asChild>
            <Button variant="outline" className="rounded-full">
              {t('common.cancel')}
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};