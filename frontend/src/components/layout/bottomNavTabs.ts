/**
 * Which tabs the phone bottom bar shows.
 *
 * Shared by the bar and by the picker on My Account → Appearance, so the
 * picker's "currently showing" is the bar's own answer rather than a second
 * derivation of it that could drift (CLAUDE.md pitfall #29).
 */
import type React from 'react';
import { Home, Calendar, Clock, GraduationCap, Users, FileText, Store, BookOpen, Settings } from 'lucide-react';

export interface TabDef {
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
export const TAB_CANDIDATES: TabDef[] = [
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
  // The member's own settings, not the organization's: /settings needs
  // settings.manage, which most members lack, and an officer who has it
  // reaches it from More.
  { label: 'Settings', path: '/account', icon: Settings },
];

const HOME_PATH = '/dashboard';

/** Two configurable slots, not three: the centre of the bar is Quick Add. */
export const CONFIGURABLE_SLOTS = 2;

const DEFAULT_MEMBER_SLOTS = [
  ['/events', '/members', '/documents'],
  ['/scheduling', '/training/my-training', '/learning'],
];

const DEFAULT_ADMINISTRATOR_SLOTS = [
  ['/events', '/members'],
  ['/account', '/scheduling', '/training/my-training'],
];

interface TabGates {
  isModuleOn: (module: string) => boolean;
  checkPermission: (permission: string) => boolean;
}

function availableTabs({ isModuleOn, checkPermission }: TabGates): TabDef[] {
  return TAB_CANDIDATES.filter(
    (tab) => (!tab.module || isModuleOn(tab.module)) && (!tab.permission || checkPermission(tab.permission))
  );
}

/** The tabs a member may put in a configurable slot: everything but Home. */
export function bottomNavChoices(gates: TabGates): TabDef[] {
  return availableTabs(gates).filter((tab) => tab.path !== HOME_PATH);
}

interface ResolveOptions extends TabGates {
  /** The member's saved choice from their account; null when never chosen. */
  chosen: readonly string[] | null | undefined;
}

/**
 * Home followed by the configurable slots, as the bar renders them.
 *
 * A chosen tab the member can no longer open — its module switched off, its
 * permission revoked — falls back through the slot's defaults rather than
 * leaving a dead button, and the choice itself is kept for when it is usable
 * again.
 */
export function resolveBottomNavTabs({ chosen, isModuleOn, checkPermission }: ResolveOptions): TabDef[] {
  const available = availableTabs({ isModuleOn, checkPermission });
  const availableByPath = new Map(available.map((tab) => [tab.path, tab]));
  const used = new Set<string>([HOME_PATH]);
  // Role defaults only for a member who has never chosen; a chosen slot keeps
  // the member defaults as its fallback chain.
  const priorities: string[][] = chosen?.length
    ? DEFAULT_MEMBER_SLOTS.map((fallbacks, index) => [chosen[index] ?? '', ...fallbacks])
    : checkPermission('settings.manage')
      ? DEFAULT_ADMINISTRATOR_SLOTS
      : DEFAULT_MEMBER_SLOTS;
  const slots = priorities.map((candidates) => {
    const path = candidates.find((candidate) => availableByPath.has(candidate) && !used.has(candidate));
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
  return [availableByPath.get(HOME_PATH), ...resolvedSlots].filter((tab): tab is TabDef => Boolean(tab));
}
