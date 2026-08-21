import React from 'react';
import { type ListSeparator, type SkillsLayoutMode } from '@/lib/types/template-settings';
import baseStyles from './styles/_base.module.css';

/**
 * A category of technical skills (e.g. "Frontend" -> ["React", "Next.js"]).
 */
export interface SkillGroup {
  name: string;
  skills: string[];
}

/**
 * Renders the technical skills values according to the chosen layout:
 * - grouped:  one line per category, bold "Name:" + comma-joined skills
 * - comma:    inline, joined with the configured list separator (default ", ")
 * - list:     one skill per line
 * - columns:  comma-joined text flowing into two columns
 *
 * Row-based templates (swiss-single, modern, latex, clean) pair this with
 * their own bold label; pill templates keep their pills and swap the
 * container behavior instead.
 */
export const ResumeSkillsContent: React.FC<{
  skills: string[];
  skillGroups?: SkillGroup[];
  layout: SkillsLayoutMode;
  listSeparator?: ListSeparator;
}> = ({ skills, skillGroups, layout, listSeparator = ',' }) => {
  const JOIN: Record<ListSeparator, string> = {
    '*': '* ',
    '-': '- ',
    ',': ', ',
    '|': ' | ',
  };
  const joinWith = (items: string[]) => items.join(JOIN[listSeparator]);

  if (skillGroups && skillGroups.length > 0) {
    const visibleGroups = skillGroups.filter(
      (group) =>
        typeof group?.name === 'string' &&
        group.skills.some((s) => typeof s === 'string' && s.trim() !== '')
    );
    return (
      <span className={baseStyles['resume-skills-grouped']}>
        {visibleGroups.map((group) => (
          <span key={group.name} className={baseStyles['resume-skills-group']}>
            <span className={baseStyles['resume-skills-group-label']}>{group.name}:</span>{' '}
            {joinWith(group.skills.filter((s) => s.trim() !== ''))}
          </span>
        ))}
      </span>
    );
  }
  if (layout === 'list') {
    return (
      <span className={baseStyles['resume-skills-list']}>
        {skills.map((skill, index) => (
          <span key={index} className={baseStyles['resume-skill-line']}>
            {skill}
          </span>
        ))}
      </span>
    );
  }
  if (layout === 'columns') {
    return <span className={baseStyles['resume-skills-columns']}>{joinWith(skills)}</span>;
  }
  return <span>{joinWith(skills)}</span>;
};
