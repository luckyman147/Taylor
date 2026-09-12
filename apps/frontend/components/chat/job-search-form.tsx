'use client';

import { useState } from 'react';
import { Search, MapPin, Briefcase, X } from 'lucide-react';

const ROLE_SUGGESTIONS = [
  'React Developer', 'Python Developer', 'Full Stack Engineer',
  'Frontend Developer', 'Backend Developer', 'DevOps Engineer',
  'Data Engineer', 'Machine Learning Engineer', 'Product Manager',
  'UI/UX Designer', 'Mobile Developer', 'QA Engineer',
];

const LOCATION_SUGGESTIONS = [
  'Remote', 'Tunisia', 'Paris, France', 'Berlin, Germany',
  'Amsterdam, Netherlands', 'London, UK', 'New York, USA',
  'San Francisco, USA', 'Toronto, Canada', 'Dubai, UAE',
];

const SKILL_SUGGESTIONS = [
  'React', 'Python', 'TypeScript', 'Node.js', 'AWS', 'Docker',
  'PostgreSQL', 'GraphQL', 'Go', 'Rust', 'Java', 'Kubernetes',
];

const SENIORITY_OPTIONS = [
  { value: '', label: 'Any level' },
  { value: 'intern', label: 'Intern' },
  { value: 'junior', label: 'Junior' },
  { value: 'mid', label: 'Mid-level' },
  { value: 'senior', label: 'Senior' },
  { value: 'lead', label: 'Lead' },
  { value: 'principal', label: 'Principal' },
];

interface JobSearchFormProps {
  onSubmit: (query: string) => void;
}

export function JobSearchForm({ onSubmit }: JobSearchFormProps) {
  const [role, setRole] = useState('');
  const [location, setLocation] = useState('');
  const [skills, setSkills] = useState<string[]>([]);
  const [seniority, setSeniority] = useState('');
  const [skillInput, setSkillInput] = useState('');

  const addSkill = (skill: string) => {
    const s = skill.trim();
    if (s && !skills.includes(s)) {
      setSkills([...skills, s]);
    }
    setSkillInput('');
  };

  const removeSkill = (skill: string) => {
    setSkills(skills.filter((s) => s !== skill));
  };

  const handleInputEnter = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      handleSubmit();
    }
  };

  const handleSkillKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      e.stopPropagation();
      addSkill(skillInput);
    }
  };

  const buildQuery = () => {
    const parts: string[] = [];
    if (role) parts.push(role);
    if (seniority) parts.push(seniority);
    if (skills.length > 0) parts.push(skills.join(' '));
    if (location) parts.push(`in ${location}`);
    return parts.join(' ') || 'software engineer';
  };

  const handleSubmit = () => {
    onSubmit(buildQuery());
  };

  return (
    <div className="rounded-xl border border-[#e6e3dc] bg-[#faf9f7] p-4 space-y-4">
      {/* Role / Position */}
      <div className="space-y-2">
        <label className="flex items-center gap-1.5 text-xs font-semibold text-ink-soft">
          <Briefcase className="h-3 w-3" />
          Role / Position
        </label>
        <input
          type="text"
          value={role}
          onChange={(e) => setRole(e.target.value)}
          onKeyDown={handleInputEnter}
          placeholder="e.g. React Developer"
          className="w-full rounded-lg border border-[#e6e3dc] bg-white px-3 py-2 text-sm text-ink outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
        />
        <div className="flex flex-wrap gap-1.5">
          {ROLE_SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setRole(s)}
              className={`rounded-full border px-2 py-0.5 text-[11px] transition-colors ${
                role === s
                  ? 'border-primary bg-primary text-white'
                  : 'border-[#e6e3dc] bg-white text-ink-soft hover:bg-[#e6e3dc]'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Location */}
      <div className="space-y-2">
        <label className="flex items-center gap-1.5 text-xs font-semibold text-ink-soft">
          <MapPin className="h-3 w-3" />
          Location
        </label>
        <input
          type="text"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          onKeyDown={handleInputEnter}
          placeholder="e.g. Remote, Tunisia, Paris"
          className="w-full rounded-lg border border-[#e6e3dc] bg-white px-3 py-2 text-sm text-ink outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
        />
        <div className="flex flex-wrap gap-1.5">
          {LOCATION_SUGGESTIONS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setLocation(location === s ? '' : s)}
              className={`rounded-full border px-2 py-0.5 text-[11px] transition-colors ${
                location === s
                  ? 'border-primary bg-primary text-white'
                  : 'border-[#e6e3dc] bg-white text-ink-soft hover:bg-[#e6e3dc]'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Skills */}
      <div className="space-y-2">
        <label className="flex items-center gap-1.5 text-xs font-semibold text-ink-soft">
          Skills (optional)
        </label>
        {skills.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {skills.map((s) => (
              <span
                key={s}
                className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary"
              >
                {s}
                <button type="button" onClick={() => removeSkill(s)} className="hover:text-primary/70">
                  <X className="h-2.5 w-2.5" />
                </button>
              </span>
            ))}
          </div>
        )}
        <input
          type="text"
          value={skillInput}
          onChange={(e) => setSkillInput(e.target.value)}
          onKeyDown={handleSkillKeyDown}
          onBlur={() => { if (skillInput.trim()) addSkill(skillInput); }}
          placeholder="Type a skill and press Enter"
          className="w-full rounded-lg border border-[#e6e3dc] bg-white px-3 py-2 text-sm text-ink outline-none focus:border-primary focus:ring-1 focus:ring-primary/20"
        />
        <div className="flex flex-wrap gap-1.5">
          {SKILL_SUGGESTIONS.filter((s) => !skills.includes(s)).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => addSkill(s)}
              className="rounded-full border border-[#e6e3dc] bg-white px-2 py-0.5 text-[11px] text-ink-soft transition-colors hover:bg-[#e6e3dc]"
            >
              + {s}
            </button>
          ))}
        </div>
      </div>

      {/* Seniority */}
      <div className="space-y-2">
        <label className="text-xs font-semibold text-ink-soft">Seniority (optional)</label>
        <div className="flex flex-wrap gap-1.5">
          {SENIORITY_OPTIONS.map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setSeniority(seniority === opt.value ? '' : opt.value)}
              className={`rounded-full border px-2 py-0.5 text-[11px] transition-colors ${
                seniority === opt.value
                  ? 'border-primary bg-primary text-white'
                  : 'border-[#e6e3dc] bg-white text-ink-soft hover:bg-[#e6e3dc]'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Search button */}
      <button
        type="button"
        onClick={handleSubmit}
        className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-[#17304f]"
      >
        <Search className="h-4 w-4" />
        Search Jobs
      </button>
    </div>
  );
}
