'use client';

import { useEffect, useMemo, useState } from 'react';
import FileText from 'lucide-react/dist/esm/icons/file-text';

import Resume, { type ResumeData } from '@/components/dashboard/resume-component';
import { fetchResume, type ResumeListItem } from '@/lib/api/resume';
import { useTranslations } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { getPageDimensionsPx } from '@/lib/constants/page-dimensions';
import { normalizeTemplateSettings, type TemplateSettings } from '@/lib/types/template-settings';

interface PreviewCacheEntry {
  updatedAt: string;
  data: ResumeData | null;
  settings: Partial<TemplateSettings> | null;
}

const previewCache = new Map<string, PreviewCacheEntry>();

interface ResumeThumbnailProps {
  resumeId: string;
  updatedAt?: string;
  processingStatus?: ResumeListItem['processing_status'];
  width?: number;
  className?: string;
}

/**
 * Miniature, non-interactive rendering of a resume's first page.
 *
 * Used on dashboard cards so users can recognize a resume at a glance without
 * opening the detail page. Resume data is fetched lazily and cached per
 * `updated_at`, so returning from the builder refreshes only changed cards.
 */
export function ResumeThumbnail({
  resumeId,
  updatedAt = '',
  processingStatus,
  width = 128,
  className,
}: ResumeThumbnailProps) {
  const { t } = useTranslations();
  const [preview, setPreview] = useState<PreviewCacheEntry | null>(() => {
    const cached = previewCache.get(resumeId);
    return cached && cached.updatedAt === updatedAt ? cached : null;
  });
  const [failed, setFailed] = useState(false);

  const canPreview = !processingStatus || processingStatus === 'ready';

  useEffect(() => {
    if (!canPreview) return;

    const cached = previewCache.get(resumeId);
    if (cached && cached.updatedAt === updatedAt) {
      setPreview(cached);
      return;
    }

    let cancelled = false;
    setFailed(false);

    fetchResume(resumeId)
      .then((data) => {
        if (cancelled) return;
        const entry: PreviewCacheEntry = {
          updatedAt,
          data: (data.processed_resume as ResumeData | null) ?? null,
          settings: (data.template_settings as Partial<TemplateSettings> | null) ?? null,
        };
        previewCache.set(resumeId, entry);
        setPreview(entry);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [resumeId, updatedAt, canPreview]);

  const settings = useMemo(
    () => normalizeTemplateSettings(preview?.settings ?? undefined),
    [preview?.settings]
  );
  const page = useMemo(() => getPageDimensionsPx(settings.pageSize), [settings.pageSize]);

  const additionalSectionLabels = useMemo(
    () => ({
      technicalSkills: t('resume.additionalLabels.technicalSkills'),
      languages: t('resume.additionalLabels.languages'),
      certifications: t('resume.additionalLabels.certifications'),
      awards: t('resume.additionalLabels.awards'),
    }),
    [t]
  );
  const sectionHeadings = useMemo(
    () => ({
      summary: t('resume.sections.summary'),
      experience: t('resume.sections.experience'),
      education: t('resume.sections.education'),
      projects: t('resume.sections.projects'),
      certifications: t('resume.sections.certifications'),
      skills: t('resume.sections.skillsOnly'),
      languages: t('resume.sections.languages'),
      awards: t('resume.sections.awards'),
      links: t('resume.sections.links'),
    }),
    [t]
  );
  const fallbackLabels = useMemo(() => ({ name: t('resume.defaults.name') }), [t]);

  const scale = width / page.width;
  const height = Math.round(page.height * scale);
  const showResume = canPreview && !failed && preview?.data;

  return (
    <div
      aria-hidden="true"
      className={cn(
        'relative shrink-0 overflow-hidden rounded-md border border-ink/15 bg-white',
        'shadow-[0_1px_2px_rgba(15,23,42,0.10)] transition-shadow group-hover:shadow-[0_4px_14px_rgba(15,23,42,0.14)]',
        className
      )}
      style={{ width, height }}
    >
      {showResume ? (
        <div
          style={{
            width: page.width,
            height: page.height,
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
            pointerEvents: 'none',
          }}
        >
          <Resume
            resumeData={preview.data as ResumeData}
            settings={settings}
            additionalSectionLabels={additionalSectionLabels}
            sectionHeadings={sectionHeadings}
            fallbackLabels={fallbackLabels}
          />
        </div>
      ) : (
        <div
          className={cn(
            'flex h-full w-full flex-col items-center justify-center gap-2 text-steel-grey',
            canPreview && !failed && 'animate-pulse bg-paper-tint'
          )}
        >
          <FileText className="h-5 w-5" />
        </div>
      )}
    </div>
  );
}
