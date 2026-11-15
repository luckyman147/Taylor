'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Bold, Italic, Underline, Minus, Image, AlignLeft, AlignCenter, AlignRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useTranslations } from '@/lib/i18n';
import {
  EMPTY_SIGNATURE_FIELDS,
  generateSignatureHtml,
  isEmptySignatureFields,
  parseSignatureToFields,
  profileToSignatureFields,
  type SignatureFields,
  type SignatureLayout,
  type SignaturePhotoPosition,
  type SignatureProfileSource,
  type SignatureSpacing,
  type SignatureTextAlign,
} from '@/lib/utils/signature-html';

interface SignatureMakerProps {
  /** Current shared HTML value (single source of truth). */
  value: string;
  onChange: (html: string) => void;
  /** Optional id prefix for inputs. */
  idPrefix: string;
  /**
   * Bumped when the user opens the Visual tab — forces a re-parse of the
   * shared HTML (covers manual edits made in the HTML tab).
   */
  reparseToken?: number;
  /** Career profile used to pre-fill identity fields (layout/design left alone). */
  profile?: SignatureProfileSource | null;
}

const SECTION =
  'rounded-lg border border-[#e6e3dc] bg-white p-3 space-y-2';
const SECTION_TITLE =
  'text-[10px] font-bold uppercase tracking-wider text-steel-grey';
const CHIP =
  'rounded-full border px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide transition-colors';
const CHIP_ON = 'border-primary bg-primary text-white';
const CHIP_OFF = 'border-[#e6e3dc] bg-white text-ink-soft hover:text-primary';

/**
 * Structured signature form. Identity fields are seeded from the career
 * profile when empty; the user mainly picks layout, text styles, and color.
 * Regenerates allowlisted HTML into the shared value while this tab is active.
 */
export function SignatureMaker({
  value,
  onChange,
  idPrefix,
  reparseToken = 0,
  profile = null,
}: SignatureMakerProps) {
  const { t } = useTranslations();
  const [fields, setFields] = useState<SignatureFields>(() => ({
    ...EMPTY_SIGNATURE_FIELDS,
    ...(parseSignatureToFields(value) ?? {}),
    ...profileToSignatureFields(profile),
  }));
  const [dirty, setDirty] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const seededFromProfileRef = useRef(false);

  // Re-parse when external HTML changes (e.g. user edited HTML tab then returned).
  useEffect(() => {
    const parsed = parseSignatureToFields(value);
    if (parsed) {
      setFields((f) => ({
        ...parsed,
        accentColor: parsed.accentColor || f.accentColor,
        photoSrc: parsed.photoSrc || f.photoSrc,
        usePhoto: parsed.usePhoto || f.usePhoto,
        // Preserve design choices that are hard to detect from HTML alone
        // when the incoming markup is a minimal hand-edit.
        padding: parsed.padding || f.padding,
        photoSize: parsed.photoSize || f.photoSize,
        nameSize: parsed.nameSize || f.nameSize,
      }));
      setDirty(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reparseToken]);

  // Soft re-sync while not dirty (initial load / parent resets).
  useEffect(() => {
    if (dirty) return;
    const parsed = parseSignatureToFields(value);
    if (parsed) {
      setFields((f) => ({
        ...parsed,
        accentColor: parsed.accentColor || f.accentColor,
        photoSrc: parsed.photoSrc || f.photoSrc,
        usePhoto: parsed.usePhoto || f.usePhoto,
        padding: parsed.padding || f.padding,
        photoSize: parsed.photoSize || f.photoSize,
        nameSize: parsed.nameSize || f.nameSize,
      }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  // Auto-seed identity from profile once when fields are empty and no signature yet.
  useEffect(() => {
    if (seededFromProfileRef.current || dirty) return;
    if (!profile) return;
    if (value.trim()) return; // existing signature wins
    const seed = profileToSignatureFields(profile);
    if (Object.keys(seed).length === 0) return;
    seededFromProfileRef.current = true;
    setFields((f) => {
      if (!isEmptySignatureFields(f)) return f;
      const next = { ...f, ...seed };
      const html = generateSignatureHtml(next);
      if (html) {
        // Defer onChange to avoid setState-during-render in React 18 StrictMode.
        queueMicrotask(() => onChange(html));
      }
      return next;
    });
    setDirty(true);
    setShowDetails(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile, value, dirty]);

  const applyFromProfile = () => {
    const seed = profileToSignatureFields(profile);
    if (Object.keys(seed).length === 0) return;
    setFields((f) => {
      const next = { ...f, ...seed };
      queueMicrotask(() => onChange(generateSignatureHtml(next)));
      return next;
    });
    setDirty(true);
    setShowDetails(true);
  };

  const set = <K extends keyof SignatureFields>(key: K, v: SignatureFields[K]) => {
    setFields((f) => ({ ...f, [key]: v }));
    setDirty(true);
  };

  const toggleStyle = (
    key: 'nameBold' | 'nameItalic' | 'nameUnderline' | 'showDivider' | 'usePhoto'
  ) => {
    set(key, !fields[key] as SignatureFields[typeof key]);
  };

  const regenerate = useMemo(() => generateSignatureHtml(fields), [fields]);

  useEffect(() => {
    if (!dirty) return;
    if (regenerate !== value) onChange(regenerate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [regenerate, dirty]);

  const field = (
    key: keyof Omit<
      SignatureFields,
      | 'layout'
      | 'accentColor'
      | 'nameBold'
      | 'nameItalic'
      | 'nameUnderline'
      | 'showDivider'
      | 'usePhoto'
      | 'photoSrc'
      | 'photoPosition'
      | 'textAlign'
      | 'nameSize'
      | 'photoSize'
      | 'spacing'
      | 'padding'
    >,
    labelKey: string,
    type: string = 'text',
    placeholder?: string
  ) => (
    <div className="space-y-1">
      <Label htmlFor={`${idPrefix}-${key}`} className="text-[11px]">
        {t(labelKey)}
      </Label>
      <Input
        id={`${idPrefix}-${key}`}
        type={type}
        value={fields[key]}
        onChange={(e) => set(key, e.target.value)}
        placeholder={placeholder}
        className="h-9 text-sm"
      />
    </div>
  );

  const chipGroup = <T extends string | number>(
    labelKey: string,
    options: readonly T[],
    current: T,
    onSelect: (v: T) => void,
    render: (v: T) => string
  ) => (
    <div className="space-y-1">
      <span className={`${SECTION_TITLE} block`}>{t(labelKey)}</span>
      <div
        className="flex flex-wrap gap-1"
        role="radiogroup"
        aria-label={t(labelKey)}
      >
        {options.map((opt) => (
          <button
            key={String(opt)}
            type="button"
            role="radio"
            aria-checked={current === opt}
            aria-label={`${t(labelKey)} ${render(opt)}`}
            onClick={() => onSelect(opt)}
            className={`${CHIP} ${current === opt ? CHIP_ON : CHIP_OFF}`}
          >
            {render(opt)}
          </button>
        ))}
      </div>
    </div>
  );

  const styleToggle = (
    key: 'nameBold' | 'nameItalic' | 'nameUnderline' | 'showDivider' | 'usePhoto',
    Icon: React.ComponentType<{ className?: string }>,
    labelKey: string
  ) => (
    <button
      type="button"
      aria-label={t(labelKey)}
      aria-pressed={fields[key]}
      onClick={() => toggleStyle(key)}
      className={
        'flex h-8 w-8 items-center justify-center rounded border transition-colors disabled:opacity-40 ' +
        (fields[key]
          ? 'border-primary bg-primary text-white'
          : 'border-[#e6e3dc] bg-white text-ink-soft hover:text-primary')
      }
      disabled={key === 'usePhoto' && !fields.photoSrc && !profile?.avatar}
      title={
        key === 'usePhoto' && !fields.photoSrc && !profile?.avatar
          ? t('emailSignature.form.noPhoto')
          : undefined
      }
    >
      <Icon className="h-4 w-4" />
    </button>
  );
  const layouts: SignatureLayout[] = ['stacked', 'inline', 'table'];
  const photoPositions: SignaturePhotoPosition[] = ['top', 'left', 'right'];
  const aligns: SignatureTextAlign[] = ['left', 'center', 'right'];
  const spacings: SignatureSpacing[] = ['compact', 'normal', 'relaxed'];
  const nameSizes = [14, 16, 18, 20, 22];
  const photoSizes = [40, 48, 56, 64];
  const paddings = [0, 4, 8, 12, 16];
  const hasPhoto = Boolean(fields.photoSrc || profile?.avatar);

  const alignIcon = (a: SignatureTextAlign) =>
    a === 'center' ? AlignCenter : a === 'right' ? AlignRight : AlignLeft;

  return (
    <div className="space-y-3 rounded-lg border border-[#e6e3dc] bg-paper-tint/40 p-4">
      <p className="text-xs text-steel-grey">{t('emailSignature.form.seedHint')}</p>

      {/* Control grid: layout / style / position — consistent padding + grouping. */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {/* ——— Layout ——— */}
        <section className={SECTION} aria-label={t('emailSignature.form.sections.layout')}>
          <h4 className={SECTION_TITLE}>{t('emailSignature.form.sections.layout')}</h4>
          <div className="space-y-1">
            <span className={`${SECTION_TITLE} block`}>
              {t('emailSignature.form.layout.label')}
            </span>
            <div
              className="flex flex-wrap gap-1"
              role="radiogroup"
              aria-label={t('emailSignature.form.layout.label')}
            >
              {layouts.map((layout) => (
                <button
                  key={layout}
                  type="button"
                  role="radio"
                  aria-checked={fields.layout === layout}
                  aria-label={t(`emailSignature.form.layout.${layout}`)}
                  onClick={() => set('layout', layout)}
                  className={`${CHIP} ${fields.layout === layout ? CHIP_ON : CHIP_OFF}`}
                >
                  {t(`emailSignature.form.layout.${layout}`)}
                </button>
              ))}
            </div>
          </div>
          {hasPhoto &&
            chipGroup(
              'emailSignature.form.photoPosition.label',
              photoPositions,
              fields.photoPosition,
              (v) => set('photoPosition', v),
              (v) => t(`emailSignature.form.photoPosition.${v}`)
            )}
          <div className="space-y-1">
            <span className={`${SECTION_TITLE} block`}>
              {t('emailSignature.form.align.label')}
            </span>
            <div
              className="flex flex-wrap gap-1"
              role="radiogroup"
              aria-label={t('emailSignature.form.align.label')}
            >
            {aligns.map((a) => {
              const Icon = alignIcon(a);
              return (
                <button
                  key={a}
                  type="button"
                  role="radio"
                  aria-checked={fields.textAlign === a}
                  aria-label={t(`emailSignature.form.align.${a}`)}
                  onClick={() => set('textAlign', a)}
                  className={`${CHIP} flex items-center gap-1 ${
                    fields.textAlign === a ? CHIP_ON : CHIP_OFF
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  <span>{t(`emailSignature.form.align.${a}`)}</span>
                </button>
              );
            })}
            </div>
          </div>
        </section>

        {/* ——— Style ——— */}
        <section className={SECTION} aria-label={t('emailSignature.form.sections.style')}>
          <h4 className={SECTION_TITLE}>{t('emailSignature.form.sections.style')}</h4>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <Label htmlFor={`${idPrefix}-accent`} className="text-[11px]">
                {t('emailSignature.form.color')}
              </Label>
              <input
                id={`${idPrefix}-accent`}
                type="color"
                value={fields.accentColor}
                onChange={(e) => set('accentColor', e.target.value)}
                className="h-9 w-14 cursor-pointer rounded border border-[#c9c5bc] bg-white p-1"
                aria-label={t('emailSignature.form.color')}
              />
            </div>
            <div className="space-y-1">
              <span className={`${SECTION_TITLE} block`}>
                {t('emailSignature.form.styles')}
              </span>
              <div className="flex flex-wrap gap-1">
                {styleToggle('nameBold', Bold, 'emailSignature.form.bold')}
                {styleToggle('nameItalic', Italic, 'emailSignature.form.italic')}
                {styleToggle('nameUnderline', Underline, 'emailSignature.form.underline')}
                {styleToggle('showDivider', Minus, 'emailSignature.form.divider')}
                {styleToggle('usePhoto', Image, 'emailSignature.form.usePhoto')}
              </div>
            </div>
          </div>
          {chipGroup(
            'emailSignature.form.nameSize',
            nameSizes,
            fields.nameSize,
            (v) => set('nameSize', v),
            (v) => `${v}px`
          )}
          {hasPhoto &&
            chipGroup(
              'emailSignature.form.photoSize',
              photoSizes,
              fields.photoSize,
              (v) => set('photoSize', v),
              (v) => `${v}px`
            )}
        </section>

        {/* ——— Position & spacing ——— */}
        <section
          className={`${SECTION} md:col-span-2 xl:col-span-1`}
          aria-label={t('emailSignature.form.sections.position')}
        >
          <h4 className={SECTION_TITLE}>{t('emailSignature.form.sections.position')}</h4>
          {chipGroup(
            'emailSignature.form.spacing.label',
            spacings,
            fields.spacing,
            (v) => set('spacing', v),
            (v) => t(`emailSignature.form.spacing.${v}`)
          )}
          {chipGroup(
            'emailSignature.form.padding',
            paddings,
            fields.padding,
            (v) => set('padding', v),
            (v) => `${v}px`
          )}
        </section>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[#e6e3dc] pt-3">
        <Button type="button" size="sm" variant="ghost" onClick={applyFromProfile}>
          {t('emailSignature.form.fromProfile')}
        </Button>
        <div className="flex gap-2">
          <Button type="button" size="sm" variant="ghost" onClick={() => setShowDetails((v) => !v)} aria-expanded={showDetails}>
            {showDetails ? '−' : '+'} {t('emailSignature.form.details')}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              setDirty(true);
              onChange(generateSignatureHtml(fields));
            }}
          >
            {t('emailSignature.form.generate')}
          </Button>
        </div>
      </div>

      {showDetails && (
        <div className="grid grid-cols-1 gap-3 rounded-lg border border-[#e6e3dc] bg-white p-3 sm:grid-cols-2">
          {field('name', 'emailSignature.form.name')}
          {field('title', 'emailSignature.form.title')}
          {field('company', 'emailSignature.form.company')}
          {field('phone', 'emailSignature.form.phone', 'tel')}
          {field('email', 'emailSignature.form.email', 'email')}
          {field('website', 'emailSignature.form.website', 'url', 'https://…')}
          {field('linkedin', 'emailSignature.form.linkedin', 'url', 'https://linkedin.com/in/…')}
          {field('tagline', 'emailSignature.form.tagline')}
        </div>
      )}
    </div>
  );
}
