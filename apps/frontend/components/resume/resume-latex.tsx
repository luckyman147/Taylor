import React from 'react';
import { Mail, Phone, Globe, Linkedin, Github } from 'lucide-react';
import type {
  ResumeData,
  SectionMeta,
  AdditionalSectionLabels,
  ContactDisplayField,
} from '@/components/dashboard/resume-component';
import { getSortedSections } from '@/lib/utils/section-helpers';
import { formatDateRange } from '@/lib/utils';
import {
  type EducationSettings,
  type ListSeparator,
  type SkillsLayoutMode,
  type WorkExperienceSettings,
} from '@/lib/types/template-settings';
import { arrangeEducationEntry, arrangeWorkEntry, workEntryMeta } from './entry-arrange';
import { DescriptionList } from './description-list';
import { ResumeSkillsContent, type SkillGroup } from './resume-skills';
import baseStyles from './styles/_base.module.css';
import styles from './styles/latex.module.css';

interface ResumeLatexProps {
  data: ResumeData;
  showContactIcons?: boolean;
  additionalSectionLabels?: Partial<AdditionalSectionLabels>;
  skillsLayout?: SkillsLayoutMode;
  listSeparator?: ListSeparator;
  workExperienceSettings?: WorkExperienceSettings;
  educationSettings?: EducationSettings;
}

/**
 * LaTeX Resume Template
 *
 * ATS-optimized serif academic layout matching classic LaTeX résumé style:
 * centered bold name, blue-accented ruled section headers, role-first two-line
 * entries (bold role + dates, then italic company + location), blue bullet markers.
 *
 * Single-typeface design: all text inherits `--body-font` (serif by default), so the
 * Body Font control drives the whole template. ATS-safe (all text is real DOM nodes).
 *
 * Section order: Determined by sectionMeta ordering.
 */
export const ResumeLatex: React.FC<ResumeLatexProps> = ({
  data,
  showContactIcons = false,
  additionalSectionLabels,
  skillsLayout = 'comma',
  listSeparator = ',',
  workExperienceSettings = { showBy: 'position', datesBy: 'position', locationBy: 'company' },
  educationSettings = { showBy: 'institution', layout: 'stacked' },
}) => {
  const { personalInfo, summary, workExperience, education, personalProjects, additional } = data;

  const sortedSections = getSortedSections(data);

  // LaTeX renders location as its own centered line, so it is not a contact-row item.
  const contactIcons: Record<string, React.ReactNode> = {
    Email: <Mail size={12} />,
    Phone: <Phone size={12} />,
    Website: <Globe size={12} />,
    LinkedIn: <Linkedin size={12} />,
    GitHub: <Github size={12} />,
  };

  const renderContactDetail = (label: string, value?: string, hrefPrefix: string = '') => {
    if (!value) return null;

    let finalHrefPrefix = hrefPrefix;
    if (
      ['Website', 'LinkedIn', 'GitHub'].includes(label) &&
      !value.startsWith('http') &&
      !value.startsWith('//')
    ) {
      finalHrefPrefix = 'https://';
    }

    const href = finalHrefPrefix + value;
    const isLink = href.startsWith('http') || href.startsWith('mailto:') || href.startsWith('tel:');

    const displayText =
      personalInfo?.contactDisplay?.[label.toLowerCase() as ContactDisplayField] === 'label'
        ? label
        : value;

    return (
      <span className="inline-flex items-center gap-1">
        {showContactIcons && contactIcons[label]}
        {isLink ? (
          <a href={href} target="_blank" rel="noopener noreferrer">
            {displayText}
          </a>
        ) : (
          <span>{displayText}</span>
        )}
      </span>
    );
  };

  // Build the contact row (location, phone, email, linkedin, github, website) joined by pipes.
  const contactItems = [
    personalInfo?.location ? <span>{personalInfo.location}</span> : null,
    renderContactDetail('Phone', personalInfo?.phone, 'tel:'),
    renderContactDetail('Email', personalInfo?.email, 'mailto:'),
    renderContactDetail('LinkedIn', personalInfo?.linkedin),
    renderContactDetail('GitHub', personalInfo?.github),
    renderContactDetail('Website', personalInfo?.website),
  ].filter(Boolean);

  // Role-first entry header: bold role / italic dates, then italic company / italic location.
  const renderEntryHeader = (
    primary?: string,
    dates?: string,
    secondary?: string,
    location?: string
  ) => (
    <>
      <div className={`flex justify-between items-baseline ${baseStyles['resume-row-tight']}`}>
        <span className={styles.entryPrimary}>{primary}</span>
        {dates && <span className={`${styles.entryDates} ml-4`}>{formatDateRange(dates)}</span>}
      </div>
      {(secondary || location) && (
        <div className={`flex justify-between items-baseline ${baseStyles['resume-row']}`}>
          {secondary && <span className={styles.entrySecondary}>{secondary}</span>}
          {location && (
            <span className={`${styles.entrySecondary} ml-4 ${baseStyles['resume-location']}`}>
              {location}
            </span>
          )}
        </div>
      )}
    </>
  );

  const renderBullets = (items?: string[], bulletStyles?: ('bullet' | 'plain')[]) => (
    <DescriptionList
      items={items}
      styles={bulletStyles}
      markerClassName={`${styles.bulletMarker} mr-1.5 flex-shrink-0`}
    />
  );

  const renderSection = (section: SectionMeta) => {
    switch (section.key) {
      case 'personalInfo':
        return null;

      case 'summary':
        if (!summary) return null;
        return (
          <div key={section.id} className={baseStyles['resume-section']}>
            <h3 className={styles.sectionTitle}>{section.displayName}</h3>
            <p className={`text-justify ${baseStyles['resume-text']}`}>{summary}</p>
          </div>
        );

      case 'workExperience':
        if (!workExperience || workExperience.length === 0) return null;
        return (
          <div key={section.id} className={baseStyles['resume-section']}>
            <h3 className={styles.sectionTitle}>{section.displayName}</h3>
            <div className={baseStyles['resume-items']}>
              {workExperience.map((exp) => {
                const entry = arrangeWorkEntry(exp, workExperienceSettings);
                const { primaryMeta, secondaryMeta } = workEntryMeta(entry, exp.years);
                return (
                  <div key={exp.id} className={baseStyles['resume-item']}>
                    {renderEntryHeader(entry.primary, primaryMeta, entry.secondary, secondaryMeta)}
                    {renderBullets(exp.description, exp.descriptionStyles)}
                  </div>
                );
              })}
            </div>
          </div>
        );

      case 'personalProjects':
        if (!personalProjects || personalProjects.length === 0) return null;
        return (
          <div key={section.id} className={baseStyles['resume-section']}>
            <h3 className={styles.sectionTitle}>{section.displayName}</h3>
            <div className={baseStyles['resume-items']}>
              {personalProjects.map((project) => (
                <div key={project.id} className={baseStyles['resume-item']}>
                  <div
                    className={`flex justify-between items-baseline ${baseStyles['resume-row-tight']}`}
                  >
                    <div className="flex items-baseline">
                      <span className={styles.entryPrimary}>{project.name}</span>
                      {project.role && (
                        <>
                          <span className={styles.projectSep}>---</span>
                          <span className={styles.entrySecondary}>{project.role}</span>
                        </>
                      )}
                    </div>
                    {project.years && (
                      <span className={`${styles.entryDates} ml-4`}>
                        {formatDateRange(project.years)}
                      </span>
                    )}
                  </div>
                  {(project.github || project.website) && (
                    <div className={baseStyles['resume-row']}>
                      <span className={styles.entryTech}>
                        {[
                          project.github &&
                            project.github
                              .replace(/^https?:\/\//, '')
                              .replace(/^www\./, '')
                              .replace(/\/$/, ''),
                          project.website &&
                            project.website
                              .replace(/^https?:\/\//, '')
                              .replace(/^www\./, '')
                              .replace(/\/$/, ''),
                        ]
                          .filter(Boolean)
                          .join(' | ')}
                      </span>
                    </div>
                  )}
                  {renderBullets(project.description, project.descriptionStyles)}
                </div>
              ))}
            </div>
          </div>
        );

      case 'education':
        if (!education || education.length === 0) return null;
        return (
          <div key={section.id} className={baseStyles['resume-section']}>
            <h3 className={styles.sectionTitle}>{section.displayName}</h3>
            <div className={baseStyles['resume-items']}>
              {education.map((edu) => {
                const eduEntry = arrangeEducationEntry(edu, educationSettings);
                const inline = educationSettings.layout === 'inline';
                return (
                  <div key={edu.id} className={baseStyles['resume-item']}>
                    {renderEntryHeader(
                      inline && eduEntry.secondary
                        ? `${eduEntry.primary} — ${eduEntry.secondary}`
                        : eduEntry.primary,
                      edu.years,
                      inline ? undefined : eduEntry.secondary
                    )}
                    {edu.description && (
                      <p className={baseStyles['resume-text-sm']}>{edu.description}</p>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );

      case 'additional':
        if (!additional) return null;
        return (
          <AdditionalSection
            key={section.id}
            additional={additional}
            displayName={section.displayName}
            labels={additionalSectionLabels}
            skillsLayout={skillsLayout}
            listSeparator={listSeparator}
            hideCertifications={
              data.sectionMeta?.some((s) => s.id === 'certifications' && s.isVisible) ?? false
            }
          />
        );

      case 'certifications': {
        const certs = (additional?.certificationsTraining ?? []).filter(
          (item): item is string => typeof item === 'string' && item.trim() !== ''
        );
        if (certs.length === 0) return null;
        return (
          <div key={section.id} className={baseStyles['resume-section']}>
            <h3 className={styles.sectionTitle}>{section.displayName}</h3>
            <div className={`${baseStyles['resume-stack']} ${baseStyles['resume-text-sm']}`}>
              {certs.map((cert) => (
                <span key={cert}>{cert}</span>
              ))}
            </div>
          </div>
        );
      }

      case 'awards': {
        const awards = (additional?.awards ?? []).filter(
          (item): item is string => typeof item === 'string' && item.trim() !== ''
        );
        if (awards.length === 0) return null;
        return (
          <div key={section.id} className={baseStyles['resume-section']}>
            <h3 className={styles.sectionTitle}>{section.displayName}</h3>
            <div className={`${baseStyles['resume-stack']} ${baseStyles['resume-text-sm']}`}>
              {awards.map((award) => (
                <span key={award}>{award}</span>
              ))}
            </div>
          </div>
        );
      }

      default:
        if (!section.isDefault) {
          return (
            <DynamicResumeSectionLatex
              key={section.id}
              sectionMeta={section}
              resumeData={data}
              renderBullets={renderBullets}
            />
          );
        }
        return null;
    }
  };

  return (
    <div className={styles.container}>
      {personalInfo && (
        <header className={baseStyles['resume-header']}>
          {personalInfo.name && <h1 className={`${styles.name} mb-1`}>{personalInfo.name}</h1>}
          {personalInfo.title && (
            <div className={`${styles.tagline} mb-1`}>{personalInfo.title}</div>
          )}
          {contactItems.length > 0 && (
            <div
              className={`flex flex-wrap items-center gap-x-2 gap-y-1 ${baseStyles['resume-contact-line']} ${styles.contactRow}`}
            >
              {contactItems.map((item, index) => (
                <React.Fragment key={index}>
                  {index > 0 && <span className={styles.contactSep}>|</span>}
                  {item}
                </React.Fragment>
              ))}
            </div>
          )}
        </header>
      )}

      {sortedSections
        .filter((section) => section.key !== 'personalInfo')
        .map((section) => renderSection(section))}
    </div>
  );
};

/**
 * Additional info section (skills, languages, certifications, awards).
 * Bold inline category label followed by comma-joined items, one line per category.
 */
const AdditionalSection: React.FC<{
  additional: ResumeData['additional'];
  displayName?: string;
  labels?: Partial<AdditionalSectionLabels>;
  skillsLayout?: SkillsLayoutMode;
  listSeparator?: ListSeparator;
  hideCertifications?: boolean;
}> = ({
  additional,
  displayName = 'Skills & Awards',
  labels,
  skillsLayout = 'comma',
  listSeparator = ',',
  hideCertifications = false,
}) => {
  if (!additional) return null;

  const clean = (items?: string[]) =>
    (items ?? []).filter((item): item is string => typeof item === 'string' && item.trim() !== '');

  const technicalSkills = clean(additional.technicalSkills);
  const skillGroups: SkillGroup[] = (additional.skillGroups ?? [])
    .filter(
      (group) =>
        typeof group?.name === 'string' &&
        Array.isArray(group.skills) &&
        group.skills.some((s) => typeof s === 'string' && s.trim() !== '')
    )
    .map((group) => ({ name: group.name, skills: clean(group.skills) }));
  const languages = clean(additional.languages);
  const certificationsTraining = hideCertifications ? [] : clean(additional.certificationsTraining);

  const mergedLabels: AdditionalSectionLabels = {
    technicalSkills: labels?.technicalSkills ?? 'Technical Skills:',
    languages: labels?.languages ?? 'Languages:',
    certifications: labels?.certifications ?? 'Certifications:',
    awards: labels?.awards ?? 'Awards:',
  };

  const hasContent =
    technicalSkills.length > 0 ||
    languages.length > 0 ||
    certificationsTraining.length > 0;

  if (!hasContent) return null;

  const line = (label: string, items: string[]) =>
    items.length > 0 ? (
      <div>
        <span className="font-bold">{label}</span> {items.join(', ')}
      </div>
    ) : null;

  return (
    <div className={baseStyles['resume-section']}>
      <h3 className={styles.sectionTitle}>{displayName}</h3>
      <div className={`${baseStyles['resume-stack']} ${baseStyles['resume-text-sm']}`}>
        {technicalSkills.length > 0 && (
          <div>
            <span className="font-bold">{mergedLabels.technicalSkills}</span>{' '}
            <ResumeSkillsContent
              skills={technicalSkills}
              skillGroups={skillGroups}
              layout={skillsLayout}
              listSeparator={listSeparator}
            />
          </div>
        )}
        {line(mergedLabels.languages, languages)}
        {line(mergedLabels.certifications, certificationsTraining)}
      </div>
    </div>
  );
};

/**
 * Dynamic (custom) section wrapper for the LaTeX template.
 */
const DynamicResumeSectionLatex: React.FC<{
  sectionMeta: SectionMeta;
  resumeData: ResumeData;
  renderBullets: (items?: string[], styles?: ('bullet' | 'plain')[]) => React.ReactNode;
}> = ({ sectionMeta, resumeData, renderBullets }) => {
  const customSection = resumeData.customSections?.[sectionMeta.key];
  if (!customSection) return null;

  const hasContent = (() => {
    switch (sectionMeta.sectionType) {
      case 'text':
        return Boolean(customSection.text?.trim());
      case 'itemList':
        return Boolean(customSection.items?.length);
      case 'stringList':
        return Boolean(customSection.strings?.length);
      default:
        return false;
    }
  })();

  if (!hasContent) return null;

  return (
    <div className={baseStyles['resume-section']}>
      <h3 className={styles.sectionTitle}>{sectionMeta.displayName}</h3>
      {sectionMeta.sectionType === 'text' && customSection.text?.trim() && (
        <p className={`text-justify ${baseStyles['resume-text']}`}>{customSection.text}</p>
      )}
      {sectionMeta.sectionType === 'itemList' && customSection.items?.length ? (
        <div className={baseStyles['resume-items']}>
          {customSection.items.map((item) => (
            <div key={item.id} className={baseStyles['resume-item']}>
              <div
                className={`flex justify-between items-baseline ${baseStyles['resume-row-tight']}`}
              >
                <span className={styles.entryPrimary}>{item.title}</span>
                {item.years && (
                  <span className={`${styles.entryDates} ml-4`}>{formatDateRange(item.years)}</span>
                )}
              </div>
              {(item.subtitle || item.location) && (
                <div className={`flex justify-between items-baseline ${baseStyles['resume-row']}`}>
                  {item.subtitle && <span className={styles.entrySecondary}>{item.subtitle}</span>}
                  {item.location && (
                    <span
                      className={`${styles.entrySecondary} ml-4 ${baseStyles['resume-location']}`}
                    >
                      {item.location}
                    </span>
                  )}
                </div>
              )}
              {renderBullets(item.description, item.descriptionStyles)}
            </div>
          ))}
        </div>
      ) : null}
      {sectionMeta.sectionType === 'stringList' && customSection.strings?.length ? (
        <div className={baseStyles['resume-text-sm']}>{customSection.strings.join(', ')}</div>
      ) : null}
    </div>
  );
};

export default ResumeLatex;
