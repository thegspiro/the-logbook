import React from 'react';
import { useNavigate, useLocation } from 'react-router';
import { Home, Calendar, Clock, GraduationCap, Menu, Users, FileText } from 'lucide-react';
import { useEnabledModules } from '../../hooks/useEnabledModules';
import { prefetchRoute } from '../../utils/routePrefetch';

/**
 * Event that asks whichever navigation component is mounted (side or top) to
 * open its mobile menu. Using an event keeps the drawer's open state owned by
 * the component that renders it, rather than lifting it into AppLayout just so
 * this bar can reach it.
 */
export const OPEN_MOBILE_NAV_EVENT = 'open-mobile-nav';

interface TabDef {
  label: string;
  path: string;
  icon: React.ElementType;
  /** Module key this tab belongs to; omitted for always-available tabs. */
  module?: string;
}

/**
 * Candidate tabs in priority order. The first four available ones are shown,
 * followed by "More" — five is the practical maximum before labels stop fitting
 * on a 320px phone. Modules a department has switched off drop out and the next
 * candidate moves up, so the bar is never left with a dead slot.
 */
const TAB_CANDIDATES: TabDef[] = [
  { label: 'Home', path: '/dashboard', icon: Home },
  { label: 'Events', path: '/events', icon: Calendar },
  { label: 'Schedule', path: '/scheduling', icon: Clock, module: 'scheduling' },
  { label: 'Training', path: '/training/my-training', icon: GraduationCap, module: 'training' },
  { label: 'Members', path: '/members', icon: Users },
  { label: 'Documents', path: '/documents', icon: FileText },
];

const MAX_TABS = 4;

interface BottomNavigationProps {
  /** Hidden while the on-screen keyboard is up, where it would otherwise sit
   *  on top of the keyboard and cover the field being typed into. */
  hidden?: boolean;
}

export const BottomNavigation: React.FC<BottomNavigationProps> = ({ hidden = false }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { isModuleOn } = useEnabledModules();

  const tabs = TAB_CANDIDATES.filter((t) => !t.module || isModuleOn(t.module)).slice(0, MAX_TABS);

  const isActive = (path: string) => {
    const base = path.split('?')[0] ?? path;
    return location.pathname === base || location.pathname.startsWith(base + '/');
  };

  if (hidden) return null;

  return (
    <nav
      // md:hidden — above that the side/top navigation is always visible and a
      // bottom bar would be redundant.
      className="border-theme-surface-border bg-theme-nav-bg fixed inset-x-0 bottom-0 z-50 border-t pb-[env(safe-area-inset-bottom)] md:hidden"
      aria-label="Primary"
    >
      <ul className="flex items-stretch">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const active = isActive(tab.path);
          return (
            <li key={tab.path} className="flex-1">
              <button
                onClick={() => void navigate(tab.path)}
                onTouchStart={() => prefetchRoute(tab.path)}
                aria-current={active ? 'page' : undefined}
                className={`focus:ring-theme-focus-ring flex min-h-[56px] w-full flex-col items-center justify-center gap-0.5 px-1 py-1.5 transition-colors focus:ring-2 focus:outline-hidden focus:ring-inset ${
                  active ? 'text-red-600 dark:text-red-400' : 'text-theme-text-muted hover:text-theme-text-primary'
                }`}
              >
                <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
                <span className="text-[11px] leading-none font-medium">{tab.label}</span>
              </button>
            </li>
          );
        })}
        <li className="flex-1">
          <button
            onClick={() => window.dispatchEvent(new CustomEvent(OPEN_MOBILE_NAV_EVENT))}
            aria-label="Open full navigation menu"
            className="text-theme-text-muted hover:text-theme-text-primary focus:ring-theme-focus-ring flex min-h-[56px] w-full flex-col items-center justify-center gap-0.5 px-1 py-1.5 transition-colors focus:ring-2 focus:outline-hidden focus:ring-inset"
          >
            <Menu className="h-5 w-5 shrink-0" aria-hidden="true" />
            <span className="text-[11px] leading-none font-medium">More</span>
          </button>
        </li>
      </ul>
    </nav>
  );
};
