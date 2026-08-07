'use client';

import { useMemo } from 'react';
import { type ResumeData } from '@/components/dashboard/resume-component';
import { extractKeywords, calculateMatchStats } from '@/lib/utils/keyword-matcher';
import { JDDisplay } from './jd-display';
import { HighlightedResumeView } from './highlighted-resume-view';
import { CheckCircle, Target } from 'lucide-react';
import { useTranslations } from '@/lib/i18n';

interface JDComparisonViewProps {
  jobDescription: string;
  resumeData: ResumeData;
}

/**
 * Split view comparing job description with resume.
 * Left: JD (read-only)
 * Right: Resume with matching keywords highlighted
 */
export function JDComparisonView({ jobDescription, resumeData }: JDComparisonViewProps) {
  const { t } = useTranslations();

  // Extract keywords from JD
  const keywords = useMemo(() => extractKeywords(jobDescription), [jobDescription]);

  // Build full resume text for stats calculation
  const resumeText = useMemo(() => {
    const parts: string[] = [];

    if (resumeData.summary) parts.push(resumeData.summary);

    resumeData.workExperience?.forEach((exp) => {
      if (exp.title) parts.push(exp.title);
      if (exp.company) parts.push(exp.company);
      exp.description?.forEach((d) => parts.push(d));
    });

    resumeData.education?.forEach((edu) => {
      if (edu.degree) parts.push(edu.degree);
      if (edu.institution) parts.push(edu.institution);
    });

    resumeData.personalProjects?.forEach((proj) => {
      if (proj.name) parts.push(proj.name);
      if (proj.role) parts.push(proj.role);
      proj.description?.forEach((d) => parts.push(d));
    });

    if (resumeData.additional) {
      resumeData.additional.technicalSkills?.forEach((s) => parts.push(s));
      resumeData.additional.languages?.forEach((l) => parts.push(l));
      resumeData.additional.certificationsTraining?.forEach((c) => parts.push(c));
    }

    return parts.join(' ');
  }, [resumeData]);

  // Calculate match statistics
  const stats = useMemo(() => calculateMatchStats(resumeText, keywords), [resumeText, keywords]);

  return (
    <div className="flex h-full flex-col">
      {/* Stats Bar */}
      <div className="flex items-center justify-between border-b border-[#e6e3dc] bg-secondary/40 px-4 py-3">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/10">
              <Target className="h-4 w-4 text-primary" />
            </span>
            <span className="text-sm text-ink">
              {t('builder.jdMatch.stats.keywordsExtracted', { count: keywords.size })}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-success/10">
              <CheckCircle className="h-4 w-4 text-success" />
            </span>
            <span className="text-sm text-ink">
              {t('builder.jdMatch.stats.matchesFound', { count: stats.matchCount })}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-ink-soft">{t('builder.jdMatch.stats.matchRateLabel')}</span>
          <span
            className={`rounded-full px-3 py-1 text-sm font-bold ${
              stats.matchPercentage >= 50
                ? 'bg-success/10 text-success'
                : stats.matchPercentage >= 30
                  ? 'bg-amber-50 text-amber-700'
                  : 'bg-red-50 text-red-700'
            }`}
          >
            {stats.matchPercentage}%
          </span>
        </div>
      </div>

      {/* Split View */}
      <div className="grid min-h-0 flex-1 grid-cols-2">
        {/* Left: JD */}
        <div className="overflow-hidden border-r border-[#e6e3dc]">
          <JDDisplay content={jobDescription} />
        </div>

        {/* Right: Resume with highlights */}
        <div className="overflow-hidden">
          <HighlightedResumeView resumeData={resumeData} keywords={keywords} />
        </div>
      </div>
    </div>
  );
}
