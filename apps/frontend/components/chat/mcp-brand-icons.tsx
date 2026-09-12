import React from 'react';
import type { LucideProps } from 'lucide-react';

type IconComponent = React.ForwardRefExoticComponent<
  Omit<LucideProps, 'ref'> & React.RefAttributes<SVGSVGElement>
>;

/**
 * Brand icons for MCP integrations.
 * Custom SVGs where lucide-react has no official brand icon.
 */

const LinkedInIcon = React.forwardRef<SVGSVGElement, Omit<LucideProps, 'ref'>>(
  (props, ref) => (
    <svg ref={ref} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z" />
    </svg>
  )
);
LinkedInIcon.displayName = 'LinkedInIcon';

const GithubIcon = React.forwardRef<SVGSVGElement, Omit<LucideProps, 'ref'>>(
  (props, ref) => (
    <svg ref={ref} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
  )
);
GithubIcon.displayName = 'GithubIcon';

const ExaIcon = React.forwardRef<SVGSVGElement, Omit<LucideProps, 'ref'>>(
  (props, ref) => (
    <svg ref={ref} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M4 7h16" />
      <path d="M4 12h10" />
      <path d="M4 17h6" />
      <circle cx="19" cy="17" r="3" fill="currentColor" stroke="none" />
    </svg>
  )
);
ExaIcon.displayName = 'ExaIcon';

const RssIcon = React.forwardRef<SVGSVGElement, Omit<LucideProps, 'ref'>>(
  (props, ref) => (
    <svg ref={ref} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" {...props}>
      <circle cx="6.18" cy="17.82" r="2.18" />
      <path d="M4 4.44v2.83c7.03 0 12.73 5.7 12.73 12.73h2.83c0-8.59-6.97-15.56-15.56-15.56zm0 5.66v2.83c3.9 0 7.07 3.17 7.07 7.07h2.83c0-5.47-4.43-9.9-9.9-9.9z" />
    </svg>
  )
);
RssIcon.displayName = 'RssIcon';

const JinaIcon = React.forwardRef<SVGSVGElement, Omit<LucideProps, 'ref'>>(
  (props, ref) => (
    <svg ref={ref} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <circle cx="12" cy="12" r="10" />
      <path d="M2 12h20" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  )
);
JinaIcon.displayName = 'JinaIcon';

const TunisianIcon = React.forwardRef<SVGSVGElement, Omit<LucideProps, 'ref'>>(
  (props, ref) => (
    <svg ref={ref} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" {...props}>
      <circle cx="12" cy="12" r="10" fill="#E70013" />
      <circle cx="12" cy="12" r="4" fill="white" />
      <circle cx="13.5" cy="12" r="3" fill="#E70013" />
      <path d="M15.5 10.5l.5 1.5 1-.5-.5 1.5 1 .5-1.5.5.5 1-1-.5-.5 1.5-1-.5.5-1.5-1-.5 1.5-.5z" fill="white" />
    </svg>
  )
);
TunisianIcon.displayName = 'TunisianIcon';

const RemoteIcon = React.forwardRef<SVGSVGElement, Omit<LucideProps, 'ref'>>(
  (props, ref) => (
    <svg ref={ref} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  )
);
RemoteIcon.displayName = 'RemoteIcon';

const KeejobIcon = React.forwardRef<SVGSVGElement, Omit<LucideProps, 'ref'>>(
  (props, ref) => (
    <svg ref={ref} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
      <path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2" />
      <path d="M12 12v.01" />
    </svg>
  )
);
KeejobIcon.displayName = 'KeejobIcon';

export const MCP_BRAND_ICONS: Record<string, IconComponent> = {
  linkedin: LinkedInIcon,
  exa: ExaIcon,
  github: GithubIcon,
  rss: RssIcon,
  web: JinaIcon,
  tunisian: TunisianIcon,
  remote_freelance: RemoteIcon,
  keejob: KeejobIcon,
};
