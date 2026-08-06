'use client';

import React from 'react';
import Link from 'next/link';
import ArrowRight from 'lucide-react/dist/esm/icons/arrow-right';
import Sparkles from 'lucide-react/dist/esm/icons/sparkles';
import FileText from 'lucide-react/dist/esm/icons/file-text';
import Target from 'lucide-react/dist/esm/icons/target';
import Zap from 'lucide-react/dist/esm/icons/zap';
import BarChart3 from 'lucide-react/dist/esm/icons/bar-chart-3';
import Briefcase from 'lucide-react/dist/esm/icons/briefcase';

const FEATURES = [
  {
    icon: Sparkles,
    title: 'AI-Powered Tailoring',
    desc: 'Every resume is rewritten to match the job description. Keyword-optimized, ATS-friendly.',
    color: 'text-primary',
    border: 'border-primary',
  },
  {
    icon: Target,
    title: 'ATS Scoring',
    desc: 'See your match score before you apply. Know exactly where you stand.',
    color: 'text-green-700',
    border: 'border-green-700',
  },
  {
    icon: Zap,
    title: 'Diff Preview',
    desc: 'See every change the AI makes. Accept, reject, or regenerate. Full control.',
    color: 'text-orange-600',
    border: 'border-orange-600',
  },
  {
    icon: Briefcase,
    title: 'Job Scraping',
    desc: 'Pull jobs from LinkedIn, RemoteOK, and freelance platforms. All in one place.',
    color: 'text-purple-700',
    border: 'border-purple-700',
  },
  {
    icon: FileText,
    title: 'LaTeX Templates',
    desc: 'Professional, recruiter-approved templates. Clean typography, zero fluff.',
    color: 'border-ink',
    border: 'border-ink',
  },
  {
    icon: BarChart3,
    title: 'Application Tracker',
    desc: 'Kanban board to track every application. Never lose track again.',
    color: 'text-red-600',
    border: 'border-red-600',
  },
];

const STEPS = [
  {
    num: '01',
    title: 'Upload',
    desc: 'Drop your master resume. We parse it into structured data.',
  },
  { num: '02', title: 'Paste JD', desc: 'Paste the job description. One click to tailor.' },
  {
    num: '03',
    title: 'Review',
    desc: "See the diff. Accept changes you like, reject what you don't.",
  },
  { num: '04', title: 'Apply', desc: 'Download the tailored PDF. Track it in your pipeline.' },
];

export default function Hero() {
  return (
    <div className="min-h-screen bg-background">
      {/* Nav */}
      <nav className="fixed top-0 left-0 right-0 z-50 border-b border-ink bg-background/80 backdrop-blur-sm">
        <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between">
          <div className=" text-sm font-bold uppercase tracking-wider">Taylor</div>
          <div className="flex items-center gap-3">
            <a
              href="https://github.com/srbhr/Resume-Matcher"
              target="_blank"
              rel="noopener noreferrer"
              className=" text-xs uppercase tracking-wide text-ink-soft hover:text-black transition-colors"
            >
              GitHub
            </a>
            <Link
              href="/dashboard"
              className="rounded-xl border border-ink bg-primary text-white px-5 py-1.5  text-xs font-bold uppercase tracking-wide hover:bg-white hover:text-black transition-colors"
            >
              Open App
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section className="pt-14">
        <div
          className="min-h-screen border-x border-b border-ink flex flex-col items-center justify-center px-6 relative overflow-hidden"
          style={{
            backgroundImage:
              'linear-gradient(rgba(29, 78, 216, 0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(29, 78, 216, 0.06) 1px, transparent 1px)',
            backgroundSize: '48px 48px',
          }}
        >
          {/* Floating accent */}
          <div className="absolute top-20 right-[15%] w-32 h-32 border border-primary/20 rotate-12 pointer-events-none" />
          <div className="absolute bottom-32 left-[10%] w-24 h-24 border border-purple-700/20 -rotate-6 pointer-events-none" />

          <div className="text-center max-w-5xl relative z-10">
            <div className="inline-block border border-ink px-4 py-1.5 mb-8 bg-white shadow-sw-xs">
              <span className=" text-xs font-bold uppercase tracking-widest text-primary">
                {'// Open-source resume builder'}
              </span>
            </div>

            <h1 className=" text-6xl sm:text-7xl md:text-8xl lg:text-9xl font-bold uppercase leading-[0.88] tracking-tighter">
              <span className="block">Stop writing</span>
              <span className="block text-primary">resumes.</span>
              <span className="block">Start tailoring.</span>
            </h1>

            <p className="mt-8  text-sm md:text-base text-ink-soft max-w-xl mx-auto leading-relaxed">
              One master resume. Infinite tailored versions. AI rewrites every bullet to match the
              job — you review the diff and approve.
            </p>

            <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link
                href="/dashboard"
                className="group rounded-xl border border-ink bg-primary text-white px-8 py-3.5  text-sm font-bold uppercase tracking-wide shadow-sw-default hover:translate-y-[1px] hover:translate-x-[1px] hover:bg-white hover:text-black hover:shadow-none transition-all flex items-center gap-2"
              >
                Get Started
                <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
              </Link>
              <a
                href="https://github.com/srbhr/Resume-Matcher"
                target="_blank"
                rel="noopener noreferrer"
                className="rounded-xl border border-ink px-8 py-3.5  text-sm font-bold uppercase tracking-wide text-primary hover:bg-primary hover:text-white transition-colors"
              >
                View on GitHub
              </a>
            </div>
          </div>

          {/* Scroll indicator */}
          <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2">
            <span className=" text-[10px] uppercase tracking-widest text-ink-soft">Scroll</span>
            <div className="w-px h-8 bg-black/30 animate-pulse" />
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="border-x border-b border-ink">
        <div className="max-w-7xl mx-auto">
          <div className="border-b border-ink px-6 py-12 md:px-12">
            <span className=" text-xs font-bold uppercase tracking-widest text-primary">
              {'// What you get'}
            </span>
            <h2 className="mt-4 text-4xl md:text-5xl font-bold uppercase tracking-tight">
              Everything you need
            </h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 border-t border-ink">
            {FEATURES.map((f, i) => (
              <div
                key={f.title}
                className={`p-8 md:p-10 border-b border-ink ${
                  i % 3 !== 2 ? 'lg:border-r' : ''
                } ${i % 2 !== 1 ? 'md:border-r lg:border-r-0' : ''} ${
                  i < 3 ? 'border-b lg:border-b' : ''
                } hover:bg-primary/[0.03] transition-colors group`}
              >
                <div
                  className={`w-10 h-10 border ${f.border} flex items-center justify-center mb-5 group-hover:shadow-sw-xs transition-shadow`}
                >
                  <f.icon className={`w-5 h-5 ${f.color}`} />
                </div>
                <h3 className=" text-sm font-bold uppercase tracking-wide mb-2">{f.title}</h3>
                <p className="text-sm text-ink-soft leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="border-x border-b border-ink bg-primary text-white">
        <div className="max-w-7xl mx-auto">
          <div className="border-b border-white/20 px-6 py-12 md:px-12">
            <span className=" text-xs font-bold uppercase tracking-widest text-blue-400">
              {'// How it works'}
            </span>
            <h2 className="mt-4 text-4xl md:text-5xl font-bold uppercase tracking-tight">
              Four steps. Zero fluff.
            </h2>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s, i) => (
              <div
                key={s.num}
                className={`p-8 md:p-10 border-white/20 ${
                  i < 3 ? 'border-r' : ''
                } ${i < 2 ? 'lg:border-r' : ''} group`}
              >
                <span className=" text-5xl font-bold text-white/10 group-hover:text-blue-400/40 transition-colors">
                  {s.num}
                </span>
                <h3 className="mt-4  text-lg font-bold uppercase tracking-wide">{s.title}</h3>
                <p className="mt-2 text-sm text-white/60 leading-relaxed">{s.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="border-x border-b border-ink">
        <div className="max-w-4xl mx-auto px-6 py-24 md:py-32 text-center">
          <h2 className="text-5xl md:text-6xl font-bold uppercase tracking-tight leading-[0.9]">
            Your next job
            <br />
            <span className="text-primary">deserves a tailored resume.</span>
          </h2>
          <p className="mt-6  text-sm text-ink-soft max-w-md mx-auto">
            Stop sending the same PDF to every company. Let AI do the heavy lifting.
          </p>
          <Link
            href="/dashboard"
            className="mt-10 inline-block rounded-xl border border-ink bg-primary text-white px-10 py-4  text-sm font-bold uppercase tracking-wide shadow-sw-lg hover:translate-y-[2px] hover:translate-x-[2px] hover:bg-white hover:text-black hover:shadow-none transition-all"
          >
            Launch Taylor
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-x border-b border-ink bg-primary text-white">
        <div className="max-w-7xl mx-auto px-6 py-8 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className=" text-xs font-bold uppercase tracking-wider">Taylor</div>
          <div className="flex items-center gap-6  text-xs text-white/50">
            <a
              href="https://github.com/srbhr/Resume-Matcher"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-white transition-colors"
            >
              GitHub
            </a>
            <a
              href="https://resumematcher.fyi"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-white transition-colors"
            >
              Docs
            </a>
            <Link href="/dashboard" className="hover:text-white transition-colors">
              App
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
