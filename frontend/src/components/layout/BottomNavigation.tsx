import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useLocation } from 'react-router';
import {
  Home,
  Calendar,
  Clock,
  GraduationCap,
  Menu,
  Plus,
  Users,
  FileText,
  Store,
  BookOpen,
  Settings,
} from 'lucide-react';
import { useEnabledModules } from '../../hooks/useEnabledModules';
import { prefetchRoute } from '../../utils/routePrefetch';
import { useAuthStore } from '../../stores/authStore';
import { QuickAddSheet } from './QuickAddSheet';
import { availableQuickAddActions } from './quickAddActions';

/**
 * Event that asks whichever navigation component is mounted (side or top) to
 * open its mobile menu. TopNavigation treats it as a toggle — the bar stays
 * visible above its menu backdrop, so a second tap on "More" closes the menu.
 * Using an event keeps the drawer's open state owned by the component that
 * renders it, rather than lifting it into AppLayout just so this bar can
 * reach it.
 */
export const OPEN_MOBILE_NAV_EVENT = 'open-mobile-nav';

interface TabDef {
  label: string;
  path: string;
  icon: React.ElementType;
  /** Module key this tab belongs to; omitted for always-available tabs. */
  module?: string;
  permission?: string;
}

/**
 * Destinations and slot fallbacks are deliberately separate.  This prevents a
 * module toggle from shifting every item to its left, which made muscle-memory
 * navigation unreliable.
 */
const TAB_CANDIDATES: TabDef[] = [
  { label: 'Home', path: '/dashboard', icon: Home },
  { label: 'Events', path: '/events', icon: Calendar },
  // `permission` as well as `module`: the /store route requires
  // storefront.view, and a tab that lands on Access Denied is worse than no
  // tab — the slot fallback chain below hands the space to a destination the
  // member can actually open.
  { label: 'Store', path: '/store', icon: Store, module: 'storefront', permission: 'storefront.view' },
  { label: 'Schedule', path: '/scheduling', icon: Clock, module: 'scheduling' },
  { label: 'Training', path: '/training/my-training', icon: GraduationCap, module: 'training' },
  { label: 'Members', path: '/members', icon: Users },
  { label: 'Documents', path: '/documents', icon: FileText },
  { label: 'Learning', path: '/learning', icon: BookOpen },
  { label: 'Settings', path: '/settings', icon: Settings, permission: 'settings.manage' },
];

export const BOTTOM_NAV_STORAGE_KEY = 'logbook.bottom-navigation.v1';

/**
 * Two configurable slots, not three: the centre of the bar is Quick Add.
 *
 * A stored preference written before Quick Add shipped holds three paths.
 * Slicing keeps its first two rather than versioning the key — the third
 * destination is still one tap away under More, and a version bump would throw
 * away a customization to replace it with a default the member did not ask for.
 */
const CONFIGURABLE_SLOTS = 2;
const DEFAULT_MEMBER_SLOTS = [
  ['/events', '/members', '/documents'],
  ['/scheduling', '/training/my-training', '/learning'],
];

function readPreferredSlots(isAdministrator: boolean): string[][] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(BOTTOM_NAV_STORAGE_KEY) ?? 'null');
    if (Array.isArray(value)) {
      const selected = value.slice(0, CONFIGURABLE_SLOTS).map((path) => (typeof path === 'string' ? path : ''));
      return DEFAULT_MEMBER_SLOTS.map((fallbacks, index) => [selected[index] ?? '', ...fallbacks]);
    }
  } catch {
    // Corrupt or unavailable browser storage simply restores policy defaults.
  }
  const defaults = isAdministrator
    ? [
        ['/events', '/members'],
        ['/settings', '/scheduling', '/training/my-training'],
      ]
    : DEFAULT_MEMBER_SLOTS;
  try {
    localStorage.setItem(BOTTOM_NAV_STORAGE_KEY, JSON.stringify(defaults.map(([path]) => path)));
  } catch {
    // Navigation remains usable when persistence is unavailable.
  }
  return defaults;
}

interface BottomNavigationProps {
  /** Hidden while the on-screen keyboard is up, where it would otherwise sit
   *  on top of the keyboard and cover the field being typed into. */
  hidden?: boolean;
}

export const BottomNavigation: React.FC<BottomNavigationProps> = ({ hidden = false }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { isModuleOn } = useEnabledModules();
  const checkPermission = useAuthStore((state) => state.checkPermission);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const addRef = useRef<HTMLButtonElement>(null);
  const [restoreAddFocus, setRestoreAddFocus] = useState(false);

  // A tab that opens an empty sheet is worse than no tab, for the same reason
  // the Store slot is permission-gated: the space goes to something usable.
  const hasQuickAdd = availableQuickAddActions(isModuleOn, checkPermission).length > 0;

  /**
   * Put focus back on the Add tab after the sheet closes.
   *
   * The focus trap restores focus to whatever was active when it opened, which
   * here is a button the sheet's own arrival removed from the page — the bar
   * hides behind it. Focusing a detached node is a silent no-op, so focus fell
   * to `<body>` and a keyboard or screen-reader user had to tab from the top of
   * the document again. Measured, not assumed: `document.activeElement` after
   * Escape was BODY.
   *
   * `hidden` is in the deps because the bar is not back on the render where the
   * flag is set — the effect re-runs once it is, and the null check is what
   * makes waiting for that safe rather than a missed restore.
   */
  useEffect(() => {
    if (!restoreAddFocus || !addRef.current) return;
    addRef.current.focus();
    setRestoreAddFocus(false);
  }, [restoreAddFocus, hidden, hasQuickAdd]);

  const closeQuickAdd = () => {
    setQuickAddOpen(false);
    setRestoreAddFocus(true);
  };

  const available = TAB_CANDIDATES.filter(
    (tab) => (!tab.module || isModuleOn(tab.module)) && (!tab.permission || checkPermission(tab.permission))
  );
  const availableByPath = new Map(available.map((tab) => [tab.path, tab]));
  const used = new Set<string>(['/dashboard']);
  const slots = readPreferredSlots(checkPermission('settings.manage')).map((priorities) => {
    const path = priorities.find((candidate) => availableByPath.has(candidate) && !used.has(candidate));
    if (path) used.add(path);
    return path ? availableByPath.get(path) : undefined;
  });
  // A slot whose entire fallback chain is unavailable gets the first remaining
  // safe destination rather than becoming a dead button.
  const resolvedSlots = slots.map((tab) => {
    if (tab) return tab;
    const fallback = available.find((item) => !used.has(item.path));
    if (fallback) used.add(fallback.path);
    return fallback;
  });
  const tabs = [availableByPath.get('/dashboard'), ...resolvedSlots].filter((tab): tab is TabDef => Boolean(tab));

  const isActive = (path: string) => {
    const base = path.split('?')[0] ?? path;
    return location.pathname === base || location.pathname.startsWith(base + '/');
  };
  const moreIsActive = !tabs.some((tab) => isActive(tab.path));

  const renderTab = (tab: TabDef) => {
    const Icon = tab.icon;
    const active = isActive(tab.path);
    return (
      <li key={tab.path} className="flex-1">
        <button
          onClick={() => void navigate(tab.path)}
          onTouchStart={() => prefetchRoute(tab.path)}
          aria-current={active ? 'page' : undefined}
          className={`focus:ring-theme-focus-ring flex min-h-[56px] w-full flex-col items-center justify-center gap-0.5 px-1 py-1.5 transition-colors focus:ring-2 focus:outline-hidden focus:ring-inset ${
            active ? 'text-red-800 dark:text-red-300' : 'text-theme-text-muted hover:text-theme-text-primary'
          }`}
        >
          <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
          <span className="text-[11px] leading-none font-medium">{tab.label}</span>
        </button>
      </li>
    );
  };

  // Home and the first slot, then Quick Add, then the second slot and More —
  // so the action sits under the thumb rather than at an edge.
  const leadingTabs = tabs.slice(0, 2);
  const trailingTabs = tabs.slice(2);

  return (
    <>
      {!hidden && (
        <nav
          // md:hidden — above that the side/top navigation is always visible and a
          // bottom bar would be redundant.
          className="border-theme-surface-border bg-theme-nav-bg fixed inset-x-0 bottom-0 z-50 border-t pb-[env(safe-area-inset-bottom)] md:hidden"
          aria-label="Primary"
        >
          <ul className="flex items-stretch">
            {leadingTabs.map(renderTab)}
            {hasQuickAdd && (
              <li className="flex-1">
                <button
                  ref={addRef}
                  onClick={() => setQuickAddOpen(true)}
                  aria-haspopup="dialog"
                  aria-expanded={quickAddOpen}
                  className="focus:ring-theme-focus-ring text-theme-text-muted hover:text-theme-text-primary flex min-h-[56px] w-full flex-col items-center justify-center gap-0.5 px-1 py-1.5 transition-colors focus:ring-2 focus:outline-hidden focus:ring-inset"
                >
                  <span
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-red-800 text-white dark:bg-red-700"
                    aria-hidden="true"
                  >
                    <Plus className="h-4 w-4" />
                  </span>
                  <span className="text-[11px] leading-none font-medium">Add</span>
                </button>
              </li>
            )}
            {trailingTabs.map(renderTab)}
            <li className="flex-1">
              <button
                onClick={() => window.dispatchEvent(new CustomEvent(OPEN_MOBILE_NAV_EVENT))}
                aria-current={moreIsActive ? 'page' : undefined}
                aria-label="Open full navigation menu"
                className={`focus:ring-theme-focus-ring flex min-h-[56px] w-full flex-col items-center justify-center gap-0.5 px-1 py-1.5 transition-colors focus:ring-2 focus:outline-hidden focus:ring-inset ${
                  moreIsActive
                    ? 'text-red-800 dark:text-red-300'
                    : 'text-theme-text-muted hover:text-theme-text-primary'
                }`}
              >
                <Menu className="h-5 w-5 shrink-0" aria-hidden="true" />
                <span className="text-[11px] leading-none font-medium">More</span>
              </button>
            </li>
          </ul>
        </nav>
      )}
      {/* Kept at a fixed position in this fragment rather than inside the nav.
          The sheet registers as an overlay surface, which is what sets
          `hidden` on the bar above — so a sheet mounted inside the bar would
          unmount itself the moment it opened, and a sheet whose position moved
          with `hidden` would remount into a register/unregister loop. */}
      {quickAddOpen && <QuickAddSheet isOpen onClose={closeQuickAdd} onSelected={() => setQuickAddOpen(false)} />}
    </>
  );
};
