'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api/client';
import type { ProfileBundle } from '@/lib/api/profile';

function proficiencyLabel(n: number | null): string {
  if (!n) return '';
  const labels = ['', 'Beginner', 'Elementary', 'Intermediate', 'Advanced', 'Expert'];
  return labels[n] || '';
}

export default function ProfilePrintPage() {
  const [bundle, setBundle] = useState<ProfileBundle | null>(null);

  useEffect(() => {
    apiFetch('/profile').then((res) => {
      if (res.ok) return res.json();
      throw new Error('Failed to load profile');
    }).then((data: ProfileBundle) => setBundle(data)).catch(console.error);
  }, []);

  if (!bundle) return <div className="profile-print bg-white p-10 text-sm">Loading...</div>;

  const { profile, skills, certifications, education, projects, achievements } = bundle;

  return (
    <div className="profile-print bg-white px-10 py-8 font-sans text-sm text-gray-900 leading-relaxed">
      {/* Header */}
      <header className="mb-6 border-b border-gray-300 pb-4">
        <h1 className="text-2xl font-bold uppercase tracking-wide">
          {profile.name || 'My Profile'}
        </h1>
        {profile.title && (
          <p className="text-base text-gray-600 mt-1">{profile.title}</p>
        )}
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-gray-500">
          {profile.email && <span>{profile.email}</span>}
          {profile.phone && <span>{profile.phone}</span>}
          {profile.location && <span>{profile.location}</span>}
          {profile.website && <span>{profile.website}</span>}
          {profile.linkedin && <span>{profile.linkedin}</span>}
          {profile.github && <span>{profile.github}</span>}
        </div>
      </header>

      {/* Summary */}
      {profile.summary && (
        <section className="mb-5">
          <h2 className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-2">
            Summary
          </h2>
          <p className="text-sm whitespace-pre-line">{profile.summary}</p>
        </section>
      )}

      {/* Work Experience */}
      {profile.work_experience.length > 0 && (
        <section className="mb-5">
          <h2 className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-2">
            Work Experience
          </h2>
          {profile.work_experience.map((exp, i) => (
            <div key={i} className="mb-3">
              <div className="flex justify-between items-baseline">
                <p className="font-bold text-sm">
                  {exp.role}
                  {exp.company && <span className="font-normal text-gray-600"> — {exp.company}</span>}
                </p>
                {exp.years && <span className="text-xs text-gray-500">{exp.years}</span>}
              </div>
              {exp.location && <p className="text-xs text-gray-500">{exp.location}</p>}
              {exp.description.length > 0 && (
                <ul className="mt-1 list-disc list-inside space-y-0.5">
                  {exp.description.map((bullet, j) => (
                    <li key={j} className="text-sm">{bullet}</li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </section>
      )}

      {/* Education */}
      {education.length > 0 && (
        <section className="mb-5">
          <h2 className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-2">
            Education
          </h2>
          {education.map((edu) => (
            <div key={edu.education_id} className="mb-2">
              <div className="flex justify-between items-baseline">
                <p className="font-bold text-sm">
                  {edu.degree || 'Education'}
                  {edu.institution && <span className="font-normal text-gray-600"> — {edu.institution}</span>}
                </p>
                {edu.years && <span className="text-xs text-gray-500">{edu.years}</span>}
              </div>
              {edu.description && <p className="text-sm mt-0.5">{edu.description}</p>}
            </div>
          ))}
        </section>
      )}

      {/* Projects */}
      {projects.length > 0 && (
        <section className="mb-5">
          <h2 className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-2">
            Projects
          </h2>
          {projects.map((proj) => (
            <div key={proj.project_id} className="mb-3">
              <div className="flex justify-between items-baseline">
                <p className="font-bold text-sm">
                  {proj.name}
                  {proj.role && <span className="font-normal text-gray-600"> — {proj.role}</span>}
                </p>
                {proj.years && <span className="text-xs text-gray-500">{proj.years}</span>}
              </div>
              <div className="flex gap-3 text-xs text-gray-500 mt-0.5">
                {proj.github && <span>{proj.github}</span>}
                {proj.website && <span>{proj.website}</span>}
              </div>
              {proj.description.length > 0 && (
                <ul className="mt-1 list-disc list-inside space-y-0.5">
                  {proj.description.map((desc, j) => (
                    <li key={j} className="text-sm">{desc}</li>
                  ))}
                </ul>
              )}
              {proj.languages.length > 0 && (
                <p className="text-xs text-gray-500 mt-1">Languages: {proj.languages.join(', ')}</p>
              )}
            </div>
          ))}
        </section>
      )}

      {/* Skills */}
      {skills.length > 0 && (
        <section className="mb-5">
          <h2 className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-2">
            Skills
          </h2>
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-gray-200 text-left text-xs text-gray-500">
                <th className="py-1 pr-4">Skill</th>
                <th className="py-1 pr-4">Category</th>
                <th className="py-1 pr-4">Proficiency</th>
                <th className="py-1">Years</th>
              </tr>
            </thead>
            <tbody>
              {skills.map((skill) => (
                <tr key={skill.skill_id} className="border-b border-gray-100">
                  <td className="py-1 pr-4 font-medium">{skill.name}</td>
                  <td className="py-1 pr-4 text-gray-600">{skill.category || '—'}</td>
                  <td className="py-1 pr-4 text-gray-600">
                    {skill.proficiency ? `${skill.proficiency}/5 ${proficiencyLabel(skill.proficiency)}` : '—'}
                  </td>
                  <td className="py-1 text-gray-600">
                    {skill.years_experience != null ? `${skill.years_experience}y` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* Certifications */}
      {certifications.length > 0 && (
        <section className="mb-5">
          <h2 className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-2">
            Certifications
          </h2>
          {certifications.map((cert) => (
            <div key={cert.certification_id} className="mb-1">
              <span className="font-medium text-sm">{cert.name}</span>
              {cert.issuer && <span className="text-gray-600"> — {cert.issuer}</span>}
              {cert.date_obtained && <span className="text-xs text-gray-500 ml-2">{cert.date_obtained}</span>}
            </div>
          ))}
        </section>
      )}

      {/* Achievements */}
      {achievements.length > 0 && (
        <section className="mb-5">
          <h2 className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-2">
            Achievements
          </h2>
          {achievements.map((ach) => (
            <div key={ach.achievement_id} className="mb-2">
              <p className="font-bold text-sm">
                {ach.title}
                {ach.date && <span className="font-normal text-gray-500 ml-2 text-xs">{ach.date}</span>}
              </p>
              {ach.description && <p className="text-sm mt-0.5">{ach.description}</p>}
            </div>
          ))}
        </section>
      )}

      {/* Languages & Awards */}
      {(profile.languages.length > 0 || profile.awards.length > 0) && (
        <section className="mb-5">
          {profile.languages.length > 0 && (
            <div className="mb-2">
              <h2 className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-1">
                Languages
              </h2>
              <p className="text-sm">{profile.languages.join(', ')}</p>
            </div>
          )}
          {profile.awards.length > 0 && (
            <div>
              <h2 className="text-xs font-bold uppercase tracking-widest text-gray-400 mb-1">
                Awards
              </h2>
              <ul className="list-disc list-inside space-y-0.5">
                {profile.awards.map((award, i) => (
                  <li key={i} className="text-sm">{award}</li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
