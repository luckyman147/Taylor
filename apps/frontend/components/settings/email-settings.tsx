'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Mail, Loader2, CheckCircle2, XCircle, Eye, EyeOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ToggleSwitch } from '@/components/ui/toggle-switch';
import { useTranslations } from '@/lib/i18n';
import { fetchEmailConfig, updateEmailConfig, type EmailConfig } from '@/lib/api/email';

type Status = 'idle' | 'loading' | 'saving' | 'saved' | 'error';

const DEFAULT_PORT = 587;

export function EmailSettings() {
  const { t } = useTranslations();

  const [status, setStatus] = useState<Status>('loading');
  const [error, setError] = useState<string | null>(null);

  const [smtpHost, setSmtpHost] = useState('');
  const [smtpPort, setSmtpPort] = useState(DEFAULT_PORT);
  const [useTls, setUseTls] = useState(true);
  const [senderEmail, setSenderEmail] = useState('');
  const [senderName, setSenderName] = useState('');
  const [password, setPassword] = useState('');
  const [hasPassword, setHasPassword] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const load = useCallback(async () => {
    setStatus('loading');
    setError(null);
    try {
      const cfg: EmailConfig = await fetchEmailConfig();
      setSmtpHost(cfg.smtp_host ?? '');
      setSmtpPort(cfg.smtp_port ?? DEFAULT_PORT);
      setUseTls(cfg.use_tls ?? true);
      setSenderEmail(cfg.sender_email ?? '');
      setSenderName(cfg.sender_name ?? '');
      setHasPassword(Boolean(cfg.has_password));
      setPassword('');
    } catch {
      setError(t('settings.email.loadFailed'));
    } finally {
      setStatus('idle');
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSave = async () => {
    setStatus('saving');
    setError(null);
    try {
      await updateEmailConfig({
        smtp_host: smtpHost.trim(),
        smtp_port: Number(smtpPort),
        use_tls: useTls,
        sender_email: senderEmail.trim(),
        sender_name: senderName.trim(),
        password: password || undefined,
      });
      setHasPassword(password !== '' || hasPassword);
      setPassword('');
      setStatus('saved');
      setTimeout(() => setStatus('idle'), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('settings.email.saveFailed'));
      setStatus('error');
    }
  };

  const portInput = Number.isNaN(smtpPort) ? 0 : smtpPort;

  return (
    <section className="space-y-6">
      <div className="flex items-center gap-3 border-b border-[#e6e3dc] pb-3">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10">
          <Mail className="h-4 w-4 text-primary" />
        </span>
        <h2 className="text-sm font-bold uppercase tracking-wide text-ink">
          {t('settings.email.title')}
        </h2>
      </div>

      {status === 'loading' ? (
        <div className="flex items-center justify-center rounded-2xl border border-dashed border-[#e6e3dc] p-8">
          <Loader2 className="h-6 w-6 animate-spin text-steel-grey" />
        </div>
      ) : (
        <div className="space-y-6">
          <p className="text-sm text-ink-soft">{t('settings.email.description')}</p>

          <div className="grid gap-6 lg:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="smtp-host" className="text-xs uppercase tracking-wider text-ink-soft">
                {t('settings.email.smtpHost')}
              </Label>
              <Input
                id="smtp-host"
                value={smtpHost}
                onChange={(e) => setSmtpHost(e.target.value)}
                placeholder="smtp.gmail.com"
                className="rounded-lg border-ink bg-white focus-visible:border-primary"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="smtp-port" className="text-xs uppercase tracking-wider text-ink-soft">
                {t('settings.email.smtpPort')}
              </Label>
              <Input
                id="smtp-port"
                type="number"
                value={smtpPort}
                onChange={(e) => setSmtpPort(Number(e.target.value))}
                placeholder={String(DEFAULT_PORT)}
                className="rounded-lg border-ink bg-white focus-visible:border-primary"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="sender-email" className="text-xs uppercase tracking-wider text-ink-soft">
                {t('settings.email.senderEmail')}
              </Label>
              <Input
                id="sender-email"
                type="email"
                value={senderEmail}
                onChange={(e) => setSenderEmail(e.target.value)}
                placeholder="you@gmail.com"
                className="rounded-lg border-ink bg-white focus-visible:border-primary"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="sender-name" className="text-xs uppercase tracking-wider text-ink-soft">
                {t('settings.email.senderName')}
              </Label>
              <Input
                id="sender-name"
                value={senderName}
                onChange={(e) => setSenderName(e.target.value)}
                placeholder={t('settings.email.senderNamePlaceholder')}
                className="rounded-lg border-ink bg-white focus-visible:border-primary"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="smtp-password" className="text-xs uppercase tracking-wider text-ink-soft">
                {t('settings.email.password')}
              </Label>
              <div className="relative">
                <Input
                  id="smtp-password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={
                    hasPassword ? t('settings.email.passwordSet') : t('settings.email.passwordPlaceholder')
                  }
                  className="rounded-lg border-ink bg-white pr-10 focus-visible:border-primary"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((prev) => !prev)}
                  aria-label={t('settings.email.togglePasswordVisibility')}
                  className="absolute inset-y-0 right-3 flex items-center text-steel-grey transition-colors hover:text-ink"
                >
                  {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              <p className="text-xs text-steel-grey">{t('settings.email.passwordHint')}</p>
            </div>

            <div className="space-y-2">
              <ToggleSwitch
                checked={useTls}
                onCheckedChange={setUseTls}
                label={t('settings.email.useTls')}
                description={t('settings.email.useTlsHint')}
              />
            </div>
          </div>

          {error && (
            <p className="flex items-center gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
              <XCircle className="h-4 w-4 shrink-0" />
              {error}
            </p>
          )}

          <div className="flex items-center gap-3">
            <Button
              onClick={handleSave}
              disabled={status === 'saving'}
              className="rounded-full bg-primary text-white hover:bg-primary/90"
            >
              {status === 'saving' ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Mail className="h-4 w-4 mr-2" />
              )}
              {t('settings.email.save')}
            </Button>
            {status === 'saved' && (
              <span className="flex items-center gap-1 text-xs font-semibold text-emerald-700">
                <CheckCircle2 className="h-4 w-4" />
                {t('settings.email.saved')}
              </span>
            )}
            {portInput <= 0 && <span className="text-xs text-destructive">{t('settings.email.invalidPort')}</span>}
          </div>
        </div>
      )}
    </section>
  );
}