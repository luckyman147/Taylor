'use client';

import React, { useEffect, useState } from 'react';
import { Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { RetroTabs } from '@/components/ui/retro-tabs';
import { Textarea } from '@/components/ui/textarea';
import { useTranslations } from '@/lib/i18n';
import { getProfile, type CareerProfile } from '@/lib/api/profile';
import { sanitizeSignatureHtml } from '@/lib/utils/html-sanitizer';
import { MAX_SIG_CHARS, type SignatureProfileSource } from '@/lib/utils/signature-html';
import { SignatureMaker } from './signature-maker';

interface EmailSignatureFieldProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  /** Optional — hide the label when the parent already provides one. */
  showLabel?: boolean;
  /**
   * Career profile for auto-seeding identity fields. When omitted, the
   * field fetches the profile once (covers Settings → Email).
   */
  profile?: SignatureProfileSource | null;
}

/**
 * HTML email signature editor — opens as a modal with Visual | HTML tabs.
 * Visual tab = structured maker (seeded from career profile); HTML tab = raw source.
 * Shared by Profile and Settings → Email (both edit the same profile field).
 */
export function EmailSignatureField({
  id,
  value,
  onChange,
  showLabel = true,
  profile,
}: EmailSignatureFieldProps) {
  const { t } = useTranslations();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<'visual' | 'html'>('visual');
  const [reparseToken, setReparseToken] = useState(0);
  const [fetchedProfile, setFetchedProfile] = useState<CareerProfile | null>(null);
  const preview = value.trim() ? sanitizeSignatureHtml(value) : '';
  const tooLong = value.length > MAX_SIG_CHARS;
  const profileSource = profile !== undefined ? profile : fetchedProfile;

  useEffect(() => {
    if (profile !== undefined) return;
    let cancelled = false;
    getProfile()
      .then((bundle) => {
        if (!cancelled) setFetchedProfile(bundle.profile);
      })
      .catch(() => {
        /* profile optional for seeding */
      });
    return () => {
      cancelled = true;
    };
  }, [profile]);

  return (
    <div className="space-y-2">
      {showLabel && (
        <Label htmlFor={id} className="text-xs uppercase tracking-wider text-ink-soft">
          {t('emailSignature.label')}
        </Label>
      )}

      {/* Trigger: compact summary + edit button. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-between gap-3 rounded-lg border border-[#e6e3dc] bg-white px-3 py-2 text-left transition-colors hover:border-primary/50"
        aria-label={t('emailSignature.edit')}
      >
        <span className="min-w-0 flex-1 truncate text-sm text-ink-soft">
          {preview ? (
            <span dangerouslySetInnerHTML={{ __html: preview }} />
          ) : (
            t('emailSignature.placeholder')
          )}
        </span>
        <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-primary">
          <Pencil className="h-3 w-3" />
          {t('emailSignature.edit')}
        </span>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto p-6 sm:p-8">
          <DialogHeader>
            <DialogTitle>{t('emailSignature.title')}</DialogTitle>
            <DialogDescription>{t('emailSignature.hint')}</DialogDescription>
          </DialogHeader>

          <RetroTabs
            tabs={[
              { id: 'visual', label: t('emailSignature.modes.visual') },
              { id: 'html', label: t('emailSignature.modes.html') },
            ]}
            activeTab={mode}
            onTabChange={(tabId) => {
              const next = tabId as 'visual' | 'html';
              if (next === 'visual' && mode === 'html') {
                setReparseToken((n) => n + 1);
              }
              setMode(next);
            }}
            className="w-fit"
          />

          {/* Both panes stay mounted so draft state survives tab switches. */}
          <div className={mode === 'visual' ? undefined : 'hidden'}>
            <SignatureMaker
              value={value}
              onChange={onChange}
              idPrefix={id}
              reparseToken={reparseToken}
              profile={profileSource}
            />
          </div>

          <div className={mode === 'html' ? 'space-y-1' : 'hidden'}>
            <Textarea
              id={id}
              rows={6}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              placeholder={t('emailSignature.placeholder')}
              className="font-mono text-xs rounded-lg border-ink bg-white focus-visible:border-primary"
              aria-label={t('emailSignature.modes.html')}
            />
            <p className={`text-xs ${tooLong ? 'text-red-600' : 'text-steel-grey'}`}>
              {tooLong
                ? t('emailSignature.tooLong', { count: String(MAX_SIG_CHARS) })
                : t('emailSignature.hint')}
            </p>
          </div>

          {mode === 'visual' && (
            <p className="text-xs text-steel-grey">{t('emailSignature.hint')}</p>
          )}

          {preview ? (
            <div className="space-y-1">
              <span className="text-xs font-semibold uppercase tracking-wider text-ink-soft">
                {t('emailSignature.preview')}
              </span>
              <div
                className="rounded-lg border border-[#e6e3dc] bg-paper-tint px-3 py-2 text-sm text-ink"
                dangerouslySetInnerHTML={{ __html: preview }}
              />
            </div>
          ) : null}

          <DialogFooter className="mt-4">
            <Button type="button" onClick={() => setOpen(false)}>
              {t('common.done')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
