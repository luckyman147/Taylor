import React from 'react';
import {
  type ListSeparator,
  type SkillsLayoutMode,
} from '@/lib/types/template-settings';
import baseStyles from './styles/_base.module.css';

/**
 * Renders the technical skills values according to the chosen layout:
 * - comma:   inline, joined with the configured list separator (default ", ")
 * - list:    one skill per line
 * - columns: comma-joined text flowing into two columns
 *
 * Row-based templates (swiss-single, modern, latex, clean) pair this with
 * their own bold label; pill templates keep their pills and swap the
 * container behavior instead.
 */
export const ResumeSkillsContent: React.FC<{
  skills: string[];
  layout: SkillsLayoutMode;
  listSeparator?: ListSeparator;
}> = ({ skills, layout, listSeparator = ',' }) => {
  const JOIN: Record<ListSeparator, string> = {
    '*': '* ',
    '-': '- ',
    ',': ', ',
    '|': ' | ',
  };
  const joinWith = (items: string[]) => items.join(JOIN[listSeparator]);

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
    return (
      <span className={baseStyles['resume-skills-columns']}>{joinWith(skills)}</span>
    );
  }
  return <span>{joinWith(skills)}</span>;
};
