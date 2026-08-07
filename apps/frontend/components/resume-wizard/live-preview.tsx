'use client';

import type { ResumeData } from '@/components/dashboard/resume-component';
import { useTranslations } from '@/lib/i18n';

interface LivePreviewProps {
  resumeData: ResumeData;
  inferredSkills: string[];
}

function dedupeSkills(skills: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const skill of skills) {
    const trimmed = skill.trim();
    // Locale-invariant casing (matches the backend's casefold) — toLocaleLowerCase
    // would diverge in some locales (e.g. Turkish dotted/dotless I).
    const key = trimmed.toLowerCase();
    if (!trimmed || seen.has(key)) continue;
    seen.add(key);
    unique.push(trimmed);
  }
  return unique;
}

export function LivePreview({ resumeData, inferredSkills }: LivePreviewProps) {
  const { t } = useTranslations();
  const personalInfo = resumeData.personalInfo ?? {};
  const experience = resumeData.workExperience ?? [];
  const projects = resumeData.personalProjects ?? [];
  const education = resumeData.education ?? [];
  const technicalSkills = resumeData.additional?.technicalSkills ?? [];
  const skills = dedupeSkills([...technicalSkills, ...inferredSkills]);
  const inferredKeys = new Set(inferredSkills.map((s) => s.trim().toLowerCase()));

  const hasAnyContent =
    Boolean(personalInfo.name?.trim()) ||
    experience.length > 0 ||
    projects.length > 0 ||
    education.length > 0 ||
    skills.length > 0;

  return (
    <aside
      aria-label={t('resumeWizard.preview.label')}
      className="rounded-2xl border border-[#e6e3dc] bg-white p-5 shadow-sw-xs md:p-6"
    >
      <p className=" text-xs font-bold uppercase tracking-wider text-primary">
        {t('resumeWizard.preview.label')}
      </p>

      {!hasAnyContent ? (
        <p className="mt-6 font-sans text-sm text-steel-grey">{t('resumeWizard.preview.empty')}</p>
      ) : (
        <div className="mt-3 space-y-5">
          <div>
            <h2 className="text-2xl font-bold tracking-tight text-ink">
              {personalInfo.name?.trim() || t('resumeWizard.preview.unnamed')}
            </h2>
            {personalInfo.title?.trim() && (
              <p className="font-sans text-sm text-steel-grey">{personalInfo.title}</p>
            )}
          </div>

          {experience.length > 0 && (
            <section>
              <p className="border-b border-[#e6e3dc] pb-1  text-xs font-bold uppercase tracking-wider text-ink">
                {t('resumeWizard.preview.experience')}
              </p>
              {experience.map((item) => (
                <div key={item.id} className="mt-2">
                  <p className="font-sans text-sm font-bold">
                    {[item.title, item.company].filter(Boolean).join(' · ')}
                  </p>
                  {item.years?.trim() && <p className=" text-xs text-steel-grey">{item.years}</p>}
                  <ul className="mt-1 list-none space-y-1">
                    {(item.description ?? []).map((line, index) => (
                      <li key={index} className="font-sans text-xs leading-snug text-ink-soft">
                        {line}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </section>
          )}

          {projects.length > 0 && (
            <section>
              <p className="border-b border-[#e6e3dc] pb-1  text-xs font-bold uppercase tracking-wider text-ink">
                {t('resumeWizard.preview.projects')}
              </p>
              {projects.map((item) => (
                <p key={item.id} className="mt-2 font-sans text-sm font-bold">
                  {item.name}
                </p>
              ))}
            </section>
          )}

          {education.length > 0 && (
            <section>
              <p className="border-b border-[#e6e3dc] pb-1  text-xs font-bold uppercase tracking-wider text-ink">
                {t('resumeWizard.preview.education')}
              </p>
              {education.map((item) => (
                <p key={item.id} className="mt-2 font-sans text-sm">
                  {[item.degree, item.institution].filter(Boolean).join(' · ')}
                </p>
              ))}
            </section>
          )}

          {skills.length > 0 && (
            <section>
              <p className="border-b border-[#e6e3dc] pb-1  text-xs font-bold uppercase tracking-wider text-ink">
                {t('resumeWizard.preview.skills')}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {skills.map((skill) => {
                  const isNew = inferredKeys.has(skill.toLowerCase());
                  return (
                    <span
                      key={skill}
                      className={
                        isNew
                          ? 'rounded-full border border-green-200 bg-green-50 px-2.5 py-1 text-xs text-green-700'
                          : 'rounded-full border border-[#e6e3dc] bg-secondary/40 px-2.5 py-1 text-xs text-ink'
                      }
                    >
                      {skill}
                      {isNew && <span aria-hidden="true"> ✓</span>}
                    </span>
                  );
                })}
              </div>
            </section>
          )}
        </div>
      )}
    </aside>
  );
}
