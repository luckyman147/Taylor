import * as React from 'react';
import {
  Search,
  FolderKanban,
  Settings,
  Building2,
  LayoutDashboard,
  Users,
  UserRound,
  Sparkles,
  Plus,
  GraduationCap,
  BarChart3,
  Mail,
  Target,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import Image from 'next/image';
import Link from 'next/link';
import { cn } from '@/lib/utils';
import { useTranslations } from '@/lib/i18n';
import { useRouter } from 'next/navigation';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

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
    | 'interview-practice'
    | 'chat'
    | 'eval-dashboard'
    | 'leads'
    | 'email-analytics';
  onNavigate?: (page: string) => void;
}

interface NavItem {
  key: string;
  label: string;
  icon: LucideIcon;
  route: string;
}

const DEFAULT_NAV_LINKS: NavItem[] = [
  { key: 'dashboard', label: 'dashboard', icon: LayoutDashboard, route: '/dashboard' },
  { key: 'job-scraper', label: 'jobSearch', icon: Search, route: '/job-scraper' },
  { key: 'tracker', label: 'jobTracking', icon: FolderKanban, route: '/tracker' },
  { key: 'companies', label: 'companies', icon: Building2, route: '/companies' },
  { key: 'contacts', label: 'contacts', icon: Users, route: '/contacts' },
  { key: 'leads', label: 'leads', icon: Target, route: '/leads' },
  { key: 'email-analytics', label: 'emailAnalytics', icon: Mail, route: '/email-analytics' },
  { key: 'profile', label: 'profile', icon: UserRound, route: '/profile' },
  {
    key: 'interview-practice',
    label: 'interviewPractice',
    icon: GraduationCap,
    route: '/interview-practice',
  },
  { key: 'chat', label: 'chat', icon: Sparkles, route: '/chat' },
  { key: 'eval-dashboard', label: 'evalDashboard', icon: BarChart3, route: '/eval-dashboard' },
  { key: 'settings', label: 'settings', icon: Settings, route: '/settings' },
];

const NAV_ORDER_KEY = 'sidebar_nav_order';

function loadNavOrder(): string[] | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = localStorage.getItem(NAV_ORDER_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {}
  return null;
}

function saveNavOrder(order: string[]) {
  try {
    localStorage.setItem(NAV_ORDER_KEY, JSON.stringify(order));
  } catch {}
}

function getOrderedNavLinks(links: NavItem[]): NavItem[] {
  const order = loadNavOrder();
  if (!order) return links;
  const byKey = new Map(links.map((l) => [l.key, l]));
  const ordered: NavItem[] = [];
  for (const key of order) {
    const item = byKey.get(key);
    if (item) {
      ordered.push(item);
      byKey.delete(key);
    }
  }
  for (const item of byKey.values()) {
    ordered.push(item);
  }
  return ordered;
}

function SortableNavButton({
  item,
  isActive,
  onNavigate,
  router,
}: {
  item: NavItem;
  isActive: boolean;
  onNavigate?: (page: string) => void;
  router: ReturnType<typeof useRouter>;
}) {
  const { t } = useTranslations();
  const [tooltipTop, setTooltipTop] = React.useState<number | null>(null);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.key,
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : undefined,
    opacity: isDragging ? 0.8 : undefined,
  };

  const labelText = t(`nav.${item.label}`);
  const Icon = item.icon;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="group relative w-full flex flex-col items-center"
    >
      <button
        onClick={() => {
          onNavigate?.(item.route);
          router.push(item.route);
        }}
        onMouseEnter={(e) => setTooltipTop(e.currentTarget.getBoundingClientRect().top)}
        onMouseLeave={() => setTooltipTop(null)}
        className={cn(
          'w-full rounded-full border border-[#e6e3dc] bg-white p-1.5 flex flex-col items-center gap-1 hover:bg-paper-tint transition-colors cursor-grab active:cursor-grabbing touch-none',
          isActive && 'bg-primary text-white'
        )}
        aria-label={labelText}
        {...attributes}
        {...listeners}
      >
        <Icon className="h-4 w-4" />
      </button>
      {tooltipTop !== null && (
        <span
          className="pointer-events-none fixed left-16 z-50 -translate-y-1/2 whitespace-nowrap rounded-md border border-[#e6e3dc] bg-white px-2.5 py-1 text-xs font-bold uppercase tracking-wide text-ink shadow-sw-md"
          style={{ top: tooltipTop + 18 }}
          role="tooltip"
        >
          {labelText}
        </span>
      )}
    </div>
  );
}

const SidebarNav: React.FC<SidebarNavProps> = ({ currentPage, onNavigate }) => {
  const { t } = useTranslations();
  const router = useRouter();

  const [navLinks, setNavLinks] = React.useState<NavItem[]>(() =>
    getOrderedNavLinks(DEFAULT_NAV_LINKS)
  );

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    })
  );

  // Exclude landing page (/)
  const excludedPages = ['landing'];
  if (currentPage && excludedPages.includes(currentPage)) {
    return null;
  }

  // Determine active page for highlighting
  const isActive = (page: string) => currentPage === page;

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    setNavLinks((items) => {
      const oldIndex = items.findIndex((i) => i.key === active.id);
      const newIndex = items.findIndex((i) => i.key === over.id);
      const reordered = arrayMove(items, oldIndex, newIndex);
      saveNavOrder(reordered.map((i) => i.key));
      return reordered;
    });
  };

  return (
    <aside className="fixed left-0 top-0 bottom-0 w-16 bg-white border-r border-border h-[100dvh] p-3 flex flex-col items-center space-y-3">
      {/* Logo */}
      <Link href="/" className="flex flex-col items-center mb-1 shrink-0" aria-label="Taylor">
        <Image
          src="/logo.png"
          alt="Taylor"
          width={32}
          height={32}
          unoptimized
          className="h-8 w-8"
        />
      </Link>

      {/* Create Resume — primary action */}
      <div className="group relative w-full flex flex-col items-center shrink-0">
        <button
          onClick={() => {
            onNavigate?.('/tailor');
            router.push('/tailor');
          }}
          className={cn(
            'w-full rounded-full bg-primary text-white p-1.5 flex flex-col items-center gap-1 hover:bg-[#17304f] transition-colors',
            currentPage === 'tailor' && 'ring-2 ring-primary ring-offset-2'
          )}
          aria-label={t('nav.createResume')}
        >
          <Plus className="h-4 w-4" />
        </button>
        <span
          className="pointer-events-none absolute left-full ml-3 top-1/2 -translate-y-1/2 whitespace-nowrap rounded-md border border-[#e6e3dc] bg-white px-2.5 py-1 text-xs font-bold uppercase tracking-wide text-ink opacity-0 shadow-sw-md transition-opacity group-hover:opacity-100"
          role="tooltip"
        >
          {t('nav.createResume')}
        </span>
      </div>

      {/* Nav Buttons — draggable */}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={navLinks.map((i) => i.key)} strategy={verticalListSortingStrategy}>
          <div className="flex-1 min-h-0 w-full overflow-y-auto overflow-x-hidden overscroll-contain flex flex-col items-center space-y-1.5 py-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {navLinks.map((item) => (
              <SortableNavButton
                key={item.key}
                item={item}
                isActive={isActive(item.key)}
                onNavigate={onNavigate}
                router={router}
              />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </aside>
  );
};

export default SidebarNav;
