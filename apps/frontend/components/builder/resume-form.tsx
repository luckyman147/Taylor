'use client';

import React from 'react';
import {
  ResumeData,
  PersonalInfo,
  SectionMeta,
  CustomSection,
} from '@/components/dashboard/resume-component';
import { PersonalInfoForm } from './forms/personal-info-form';
import { SummaryForm } from './forms/summary-form';
import { ExperienceForm } from './forms/experience-form';
import { EducationForm } from './forms/education-form';
import { ProjectsForm } from './forms/projects-form';
import { CertificationsForm } from './forms/certifications-form';
import { AwardsForm } from './forms/awards-form';
import { SkillsForm } from './forms/skills-form';
import { LanguagesForm } from './forms/languages-form';
import { SectionHeader } from './section-header';
import { GenericTextForm } from './forms/generic-text-form';
import { GenericItemForm } from './forms/generic-item-form';
import { GenericListForm } from './forms/generic-list-form';
import {
  getAllSections,
  renameSection,
  toggleSectionVisibility,
  deleteSection,
} from '@/lib/utils/section-helpers';
import { useTranslations } from '@/lib/i18n';

interface ResumeFormProps {
  resumeData: ResumeData;
  onUpdate: (data: ResumeData) => void;
  outputLanguage: string;
}

export const ResumeForm: React.FC<ResumeFormProps> = ({ resumeData, onUpdate, outputLanguage }) => {
  const { t } = useTranslations();

  // Use getAllSections for form - shows ALL sections including hidden ones
  // (Hidden sections are editable but marked with visual indicator)
  const allSections = getAllSections(resumeData);

  // Handle section metadata updates
  const handleSectionMetaUpdate = (sections: SectionMeta[]) => {
    onUpdate({
      ...resumeData,
      sectionMeta: sections,
    });
  };

  // Handler for section rename
  const handleRename = (sectionId: string, newName: string) => {
    handleSectionMetaUpdate(renameSection(allSections, sectionId, newName));
  };

  // Handler for section delete
  const handleDelete = (sectionId: string) => {
    const section = allSections.find((s) => s.id === sectionId);
    if (!section) return;

    if (section.isDefault) {
      // For default sections, just hide them
      handleToggleVisibility(sectionId);
    } else {
      // For custom sections, remove from both sectionMeta and customSections
      const { sectionMeta, customSections } = deleteSection(resumeData, sectionId);
      onUpdate({
        ...resumeData,
        sectionMeta,
        customSections,
      });
    }
  };

  // Handler for section visibility toggle
  const handleToggleVisibility = (sectionId: string) => {
    handleSectionMetaUpdate(toggleSectionVisibility(allSections, sectionId));
  };

  // Render default section forms
  const renderDefaultSection = (section: SectionMeta) => {
    const isPersonalInfo = section.id === 'personalInfo';

    // Render content based on section key
    const renderContent = () => {
      switch (section.key) {
        case 'personalInfo':
          return (
            <PersonalInfoForm
              data={resumeData.personalInfo || ({} as PersonalInfo)}
              onChange={(data) => onUpdate({ ...resumeData, personalInfo: data })}
            />
          );

        case 'summary':
          return (
            <SummaryForm
              value={resumeData.summary || ''}
              onChange={(value) => onUpdate({ ...resumeData, summary: value })}
            />
          );

        case 'workExperience':
          return (
            <ExperienceForm
              data={resumeData.workExperience || []}
              onChange={(data) => onUpdate({ ...resumeData, workExperience: data })}
            />
          );

        case 'education':
          return (
            <EducationForm
              data={resumeData.education || []}
              onChange={(data) => onUpdate({ ...resumeData, education: data })}
            />
          );

        case 'personalProjects':
          return (
            <ProjectsForm
              data={resumeData.personalProjects || []}
              onChange={(data) => onUpdate({ ...resumeData, personalProjects: data })}
              outputLanguage={outputLanguage}
            />
          );

        case 'certifications':
          return (
            <CertificationsForm
              data={resumeData.additional?.certificationsTraining ?? []}
              onChange={(data) =>
                onUpdate({
                  ...resumeData,
                  additional: { ...(resumeData.additional ?? {}), certificationsTraining: data },
                })
              }
            />
          );

        case 'awards':
          return (
            <AwardsForm
              data={resumeData.additional?.awards ?? []}
              onChange={(data) =>
                onUpdate({
                  ...resumeData,
                  additional: { ...(resumeData.additional ?? {}), awards: data },
                })
              }
            />
          );

        case 'skills':
          return (
            <SkillsForm
              data={
                resumeData.additional || {
                  technicalSkills: [],
                  languages: [],
                  certificationsTraining: [],
                  awards: [],
                }
              }
              onChange={(data) => onUpdate({ ...resumeData, additional: data })}
            />
          );

        case 'languages':
          return (
            <LanguagesForm
              data={resumeData.additional?.languages ?? []}
              onChange={(data) =>
                onUpdate({
                  ...resumeData,
                  additional: { ...(resumeData.additional ?? {}), languages: data },
                })
              }
            />
          );

        default:
          return null;
      }
    };

    // The form components provide their own container styling
    return (
      <SectionHeader
        section={section}
        onRename={(name) => handleRename(section.id, name)}
        onDelete={() => handleDelete(section.id)}
        onToggleVisibility={() => handleToggleVisibility(section.id)}
        canDelete={isPersonalInfo ? false : true}
      >
        {renderContent()}
      </SectionHeader>
    );
  };

  // Render custom section forms
  const renderCustomSection = (section: SectionMeta) => {
    const customSection = resumeData.customSections?.[section.key];

    const updateCustomSection = (updates: Partial<CustomSection>) => {
      onUpdate({
        ...resumeData,
        customSections: {
          ...resumeData.customSections,
          [section.key]: {
            ...customSection,
            sectionType: section.sectionType,
            ...updates,
          } as CustomSection,
        },
      });
    };

    const renderContent = () => {
      switch (section.sectionType) {
        case 'text':
          return (
            <GenericTextForm
              value={customSection?.text || ''}
              onChange={(value) => updateCustomSection({ text: value })}
              label={t('builder.customSections.contentLabel')}
              placeholder={t('builder.customSections.contentPlaceholder', {
                name: section.displayName,
              })}
            />
          );

        case 'itemList':
          return (
            <GenericItemForm
              items={customSection?.items || []}
              onChange={(items) => updateCustomSection({ items })}
              itemLabel={t('builder.customSections.entryLabel')}
              addLabel={t('builder.customSections.addEntryLabel')}
            />
          );

        case 'stringList':
          return (
            <GenericListForm
              items={customSection?.strings || []}
              onChange={(strings) => updateCustomSection({ strings })}
              label={t('builder.customSections.itemsLabel')}
              placeholder={t('builder.customSections.itemsPlaceholder')}
            />
          );

        default:
          return (
            <div className="text-steel-grey">
              {t('builder.customSections.unknownSectionType', { type: section.sectionType })}
            </div>
          );
      }
    };

    return (
      <SectionHeader
        section={section}
        onRename={(name) => handleRename(section.id, name)}
        onDelete={() => handleDelete(section.id)}
        onToggleVisibility={() => handleToggleVisibility(section.id)}
        canDelete={true}
      >
        {renderContent()}
      </SectionHeader>
    );
  };

  return (
    <div className="space-y-4 pb-16">
      {allSections.map((section) => {
        const sectionContent = section.isDefault
          ? renderDefaultSection(section)
          : renderCustomSection(section);

        return <div key={section.id}>{sectionContent}</div>;
      })}
    </div>
  );
};
