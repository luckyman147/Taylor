import * as React from 'react';
import {
  Search,
  FolderKanban,
  Settings,
  FileText,
  Building2,
  LayoutDashboard,
  Users,
  UserRound,
  Sparkles,
} from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { useTranslations } from '@/lib/i18n';
import { useRouter } from 'next/navigation';

interface SidebarNavProps {
  currentPage?:
    | 'dashboard'
    | 'tracker'
    | 'tailor'
    | 'job-scraper'
    | 'settings'
    | 'builder'
    | 'resumes'
    | 'resume-wizard'
    | 'companies'
    | 'contacts'
    | 'profile'
    | 'chat';
  onNavigate?: (page: string) => void;
}

const SidebarNav: React.FC<SidebarNavProps> = ({ currentPage, onNavigate }) => {
  const { t } = useTranslations();
  const router = useRouter();

  // Exclude landing page (/)
  const excludedPages = ['landing'];
  if (currentPage && excludedPages.includes(currentPage)) {
    return null;
  }

  // Determine active page for highlighting
  const isActive = (page: string) => currentPage === page;

  // Map page keys to route paths and icons
  const navLinks = [
    { key: 'dashboard', label: 'dashboard', icon: LayoutDashboard, route: '/dashboard' },
    { key: 'job-scraper', label: 'jobSearch', icon: Search, route: '/job-scraper' },
    { key: 'tracker', label: 'jobTracking', icon: FolderKanban, route: '/tracker' },
    { key: 'companies', label: 'companies', icon: Building2, route: '/companies' },
    { key: 'contacts', label: 'contacts', icon: Users, route: '/contacts' },
    { key: 'profile', label: 'profile', icon: UserRound, route: '/profile' },
    { key: 'chat', label: 'chat', icon: Sparkles, route: '/chat' },
    { key: 'tailor', label: 'resumeBuilder', icon: FileText, route: '/builder' },
    { key: 'settings', label: 'settings', icon: Settings, route: '/settings' },
  ];

  return (
    <aside className="fixed left-0 top-0 bottom-0 w-16 bg-white border-r border-border min-h-screen p-4 flex flex-col items-center space-y-8">
      {/* Logo */}
      <Link href="/" className="flex flex-col items-center mb-8" aria-label="Taylor">
        <Image src="/logo.png" alt="Taylor" width={40} height={40} className="h-10 w-10" />
      </Link>

      {/* Nav Buttons */}
      {navLinks.map(({ key, label, icon: Icon, route }) => {
        const active = isActive(key);
        const labelText = t(`nav.${label}`);
        const onClick = () => {
          onNavigate?.(route);
          router.push(route);
        };

        return (
          <div key={key} className="group relative w-full flex flex-col items-center">
            <button
              onClick={onClick}
              className={cn(
                'w-full rounded-full border border-[#e6e3dc] bg-white p-2 flex flex-col items-center gap-1.5 hover:bg-paper-tint transition-colors',
                active && 'bg-primary text-white'
              )}
              aria-label={labelText}
            >
              <Icon className="h-5 w-5" />
            </button>
            <span
              className="pointer-events-none absolute left-full ml-3 top-1/2 -translate-y-1/2 whitespace-nowrap rounded-md border border-[#e6e3dc] bg-white px-2.5 py-1 text-xs font-bold uppercase tracking-wide text-ink opacity-0 shadow-sw-md transition-opacity group-hover:opacity-100"
              role="tooltip"
            >
              {labelText}
            </span>
          </div>
        );
      })}
    </aside>
  );
};

export default SidebarNav;
