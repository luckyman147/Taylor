/**
 * Static scenario library for the Interview Practice Hub.
 *
 * Each scenario maps to an i18n block under
 * ``interviewPractice.scenarios.<key>.{title,description}``.
 */

export interface PracticeScenario {
  id: string;
  i18nKey: string;
  durationMinutes: number;
}

export const PRACTICE_SCENARIOS: PracticeScenario[] = [
  { id: 'tell_me_about_yourself', i18nKey: 'tellMeAboutYourself', durationMinutes: 15 },
  { id: 'why_work_here', i18nKey: 'whyWorkHere', durationMinutes: 15 },
  { id: 'career_gaps', i18nKey: 'careerGaps', durationMinutes: 10 },
  { id: 'salary_expectations', i18nKey: 'salaryExpectations', durationMinutes: 10 },
  { id: 'weaknesses', i18nKey: 'weaknesses', durationMinutes: 10 },
  { id: 'job_specific', i18nKey: 'jobSpecific', durationMinutes: 20 },
  { id: 'proudest_accomplishment', i18nKey: 'proudestAccomplishment', durationMinutes: 10 },
  { id: 'handle_conflict', i18nKey: 'handleConflict', durationMinutes: 10 },
];

export interface ActiveScenario {
  id: string | null;
  title: string;
  description: string | null;
  durationMinutes: number | null;
}