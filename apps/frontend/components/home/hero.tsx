'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import {
  ArrowRight,
  Sparkles,
  FileText,
  Target,
  Zap,
  BarChart3,
  Briefcase,
  Github,
  ChevronDown,
} from 'lucide-react';

interface RevealProps {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}

function Reveal({ children, className = '', delay = 0 }: RevealProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { threshold: 0.15 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={`${className} transition-all duration-700 ease-out will-change-transform ${
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-6'
      }`}
      style={{ transitionDelay: `${delay}ms` }}
    >
      {children}
    </div>
  );
}

interface Feature {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  desc: string;
  medallion: string;
  iconColor: string;
  featured?: boolean;
}

const FEATURES: Feature[] = [
  {
    icon: Sparkles,
    title: 'AI-powered tailoring',
    desc: 'Every resume is rewritten to match the job description. Keyword-optimized, ATS-friendly.',
    medallion: 'bg-primary/10',
    iconColor: 'text-primary',
    featured: true,
  },
  {
    icon: Target,
    title: 'ATS scoring',
    desc: 'See your match score before you apply. Know exactly where you stand.',
    medallion: 'bg-green-50',
    iconColor: 'text-green-700',
  },
  {
    icon: Zap,
    title: 'Diff preview',
    desc: 'See every change the AI makes. Accept, reject, or regenerate. Full control.',
    medallion: 'bg-amber-50',
    iconColor: 'text-amber-700',
  },
  {
    icon: Briefcase,
    title: 'Job scraping',
    desc: 'Pull jobs from LinkedIn, RemoteOK, and freelance platforms. All in one place.',
    medallion: 'bg-purple-50',
    iconColor: 'text-purple-700',
  },
  {
    icon: FileText,
    title: 'LaTeX templates',
    desc: 'Professional, recruiter-approved templates. Clean typography, zero fluff.',
    medallion: 'bg-secondary',
    iconColor: 'text-ink',
  },
  {
    icon: BarChart3,
    title: 'Application tracker',
    desc: 'Kanban board to track every application. Never lose track again.',
    medallion: 'bg-red-50',
    iconColor: 'text-red-600',
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
    <div className="min-h-dvh bg-background">
      {/* Skip link for keyboard users */}
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[60] focus:rounded-full focus:bg-primary focus:px-5 focus:py-2 focus:text-xs focus:font-bold focus:uppercase focus:tracking-wide focus:text-white"
      >
        Skip to content
      </a>

      {/* Nav */}
      <nav className="fixed top-0 left-0 right-0 z-50 border-b border-[#e6e3dc] bg-white/80 backdrop-blur-md">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2 group">
            <Image src="/logo.png" alt="Taylor logo" width={24} height={24} className="w-6 h-6" />
            <span className="text-sm font-bold tracking-wide text-ink">Taylor</span>
          </Link>
          <div className="flex items-center gap-2">
            <a
              href="https://github.com/luckyman147/Taylor"
              target="_blank"
              rel="noopener noreferrer"
              className="hidden sm:inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs font-semibold tracking-wide text-ink-soft hover:bg-secondary hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 transition-colors"
            >
              <Github className="w-4 h-4" />
              GitHub
            </a>
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-2 rounded-full bg-primary px-5 py-2 text-xs font-bold uppercase tracking-wide text-white shadow-sw-sm hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 active:scale-[0.98] transition-all"
            >
              Open App
            </Link>
          </div>
        </div>
      </nav>

      {/* Hero */}
      <section
        id="main"
        className="pt-16"
        style={{
          backgroundImage:
            'radial-gradient(ellipse 80% 60% at 50% -10%, rgba(30, 58, 95, 0.07), transparent)',
        }}
      >
        <div className="min-h-dvh flex flex-col items-center justify-center px-6 relative overflow-hidden">
          {/* Ambient surface */}
          <div
            className="absolute inset-0 pointer-events-none opacity-60"
            style={{
              backgroundImage:
                'linear-gradient(rgba(30, 58, 95, 0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(30, 58, 95, 0.04) 1px, transparent 1px)',
              backgroundSize: '56px 56px',
              maskImage: 'radial-gradient(ellipse 90% 70% at 50% 30%, black, transparent)',
              WebkitMaskImage: 'radial-gradient(ellipse 90% 70% at 50% 30%, black, transparent)',
            }}
          />
          <div className="absolute top-28 right-[10%] hidden md:block w-48 h-48 rounded-full bg-primary/[0.04] pointer-events-none" />
          <div className="absolute bottom-40 left-[6%] hidden md:block w-32 h-32 rounded-full bg-amber-600/[0.05] pointer-events-none" />

          <div className="text-center max-w-5xl relative z-10">
            <Reveal>
              <div className="inline-flex items-center gap-2 rounded-full border border-[#e6e3dc] bg-white px-4 py-1.5 shadow-sw-xs">
                <Sparkles className="w-3.5 h-3.5 text-primary" />
                <span className="text-xs font-semibold tracking-widest text-primary">
                  Open-source resume builder
                </span>
              </div>
            </Reveal>

            <Reveal delay={120}>
              <h1 className="mt-10 text-5xl sm:text-6xl md:text-8xl font-bold leading-[0.92] tracking-tight text-ink text-balance">
                Stop writing <span className="text-primary">resumes.</span>
                <br />
                Start tailoring.
              </h1>
            </Reveal>

            <Reveal delay={240}>
              <p className="mt-8 text-sm md:text-base text-ink-soft max-w-xl mx-auto leading-relaxed text-pretty">
                One master resume. Infinite tailored versions. AI rewrites every bullet to match the
                job — you review the diff and approve.
              </p>
            </Reveal>

            <Reveal delay={360}>
              <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
                <Link
                  href="/dashboard"
                  className="group inline-flex items-center gap-2 rounded-full bg-primary px-8 py-3.5 text-sm font-bold uppercase tracking-wide text-white shadow-sw-lg hover:bg-primary/90 hover:shadow-sw-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 active:scale-[0.98] transition-all"
                >
                  Get Started
                  <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
                </Link>
                <a
                  href="https://github.com/luckyman147/Taylor"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 rounded-full border border-[#e6e3dc] bg-white px-8 py-3.5 text-sm font-bold tracking-wide text-primary shadow-sw-xs hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 active:scale-[0.98] transition-colors"
                >
                  <Github className="w-4 h-4" />
                  View on GitHub
                </a>
              </div>
            </Reveal>
          </div>

          {/* Scroll indicator */}
          <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex flex-col items-center gap-2">
            <span className="text-[10px] tracking-[0.2em] text-ink-soft">Scroll</span>
            <ChevronDown className="w-4 h-4 text-ink-soft animate-bounce" />
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-20 md:py-28">
        <div className="max-w-7xl mx-auto px-6">
          <Reveal>
            <div className="max-w-2xl mb-14">
              <span className="text-xs font-bold uppercase tracking-widest text-primary">
                What you get
              </span>
              <h2 className="mt-3 text-4xl md:text-5xl font-semibold tracking-tight text-ink text-balance">
                Everything you need
              </h2>
            </div>
          </Reveal>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {FEATURES.map((f, i) => (
              <Reveal key={f.title} delay={(i % 3) * 100}>
                <div
                  className={`group rounded-2xl p-7 transition-all duration-300 hover:-translate-y-1 ${
                    f.featured
                      ? 'md:col-span-2 bg-primary text-white shadow-sw-lg hover:shadow-sw-xl'
                      : 'bg-paper-tint hover:bg-white hover:shadow-sw-card'
                  } ${i === 1 ? 'lg:mt-12' : ''} ${i === 4 ? 'lg:mt-12' : ''}`}
                >
                  <div
                    className={`flex h-10 w-10 items-center justify-center rounded-full ${
                      f.featured ? 'bg-white/10' : f.medallion
                    } mb-6`}
                  >
                    <f.icon className={`w-5 h-5 ${f.featured ? 'text-white' : f.iconColor}`} />
                  </div>
                  <h3
                    className={`text-sm font-bold uppercase tracking-wide mb-2 ${
                      f.featured ? 'text-white' : 'text-ink'
                    }`}
                  >
                    {f.title}
                  </h3>
                  <p
                    className={`text-sm leading-relaxed ${
                      f.featured ? 'text-white/70' : 'text-ink-soft'
                    }`}
                  >
                    {f.desc}
                  </p>

                  {f.featured && (
                    <div className="mt-8 grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div className="rounded-xl bg-white/[0.06] p-4 group-hover:scale-[1.02] transition-transform duration-300">
                        <p className="text-[10px] uppercase tracking-widest text-white/40 mb-2">
                          Before
                        </p>
                        <p className="text-xs text-white/70 leading-relaxed">
                          Assisted in managing day-to-day operations and various administrative
                          tasks across departments.
                        </p>
                      </div>
                      <div className="rounded-xl bg-white/10 p-4 ring-1 ring-white/10 group-hover:scale-[1.02] transition-transform duration-300">
                        <p className="text-[10px] uppercase tracking-widest text-white/40 mb-2">
                          Tailored
                        </p>
                        <p className="text-xs text-white/90 leading-relaxed">
                          Streamlined cross-department workflows, cutting reporting time 40% for the
                          operations leadership team.
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="py-20 md:py-28 border-y border-[#e6e3dc] bg-paper-tint">
        <div className="max-w-7xl mx-auto px-6">
          <Reveal>
            <div className="max-w-2xl mb-14">
              <span className="text-xs font-bold uppercase tracking-widest text-primary">
                How it works
              </span>
              <h2 className="mt-3 text-4xl md:text-5xl font-semibold tracking-tight text-ink text-balance">
                Four steps. Zero fluff.
              </h2>
            </div>
          </Reveal>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {STEPS.map((s, i) => (
              <Reveal key={s.num} delay={i * 100}>
                <div className="rounded-2xl bg-white p-7 shadow-sw-xs transition-all duration-300 hover:-translate-y-1 hover:shadow-sw-card">
                  <span className="text-sm font-bold tabular-nums tracking-widest text-primary">
                    {s.num}
                  </span>
                  <h3 className="mt-5 text-lg font-semibold tracking-tight text-ink">{s.title}</h3>
                  <p className="mt-2 text-sm text-ink-soft leading-relaxed">{s.desc}</p>
                </div>
              </Reveal>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-24 md:py-32">
        <div className="max-w-5xl mx-auto px-6">
          <Reveal>
            <div className="relative overflow-hidden rounded-3xl bg-primary px-8 py-16 md:px-16 md:py-20 text-center shadow-sw-xl">
              <div
                className="absolute inset-0 pointer-events-none"
                style={{
                  backgroundImage:
                    'radial-gradient(ellipse 60% 80% at 80% 0%, rgba(255,255,255,0.08), transparent)',
                }}
              />
              <h2 className="relative text-4xl md:text-6xl font-bold tracking-tight leading-[0.95] text-white text-balance">
                Your next job deserves a tailored resume.
              </h2>
              <p className="relative mt-6 text-sm text-white/70 max-w-md mx-auto">
                Stop sending the same PDF to every company. Let AI do the heavy lifting.
              </p>
              <Link
                href="/dashboard"
                className="relative mt-10 inline-flex items-center gap-2 rounded-full bg-white px-10 py-4 text-sm font-bold uppercase tracking-wide text-primary shadow-sw-lg hover:bg-white/90 hover:shadow-sw-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 focus-visible:ring-offset-2 focus-visible:ring-offset-primary active:scale-[0.98] transition-all"
              >
                Launch Taylor
                <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          </Reveal>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-[#e6e3dc] bg-white">
        <div className="max-w-7xl mx-auto px-6 py-10 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Image src="/logo.png" alt="Taylor logo" width={20} height={20} className="w-5 h-5" />
            <span className="text-xs font-bold uppercase tracking-wider text-ink">Taylor</span>
          </div>
          <div className="flex items-center gap-6 text-xs font-medium text-steel-grey">
            <a
              href="https://github.com/luckyman147/Taylor"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-ink transition-colors"
            >
              GitHub
            </a>
            <Link href="/dashboard" className="hover:text-ink transition-colors">
              App
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
