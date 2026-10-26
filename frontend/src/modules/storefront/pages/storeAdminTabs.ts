/**
 * The Department Store console's sections, kept apart from the page so the
 * command palette — part of the always-loaded shell — can offer each one
 * without pulling the console into the main bundle.
 *
 * The console draws them two levels deep, the way Training, Events, Members,
 * Inventory and Scheduling Administration do: area cards above a strip of the
 * chosen area's pages. The URL stays `?tab=<page>` (none for Overview) — page
 * ids are unique, so the area is derived from the page, and the Inventory
 * hub's store cards, the command palette and the backend's attention queue
 * resolve unchanged.
 */

import type { LucideIcon } from 'lucide-react';
import {
  CalendarClock,
  ClipboardList,
  CreditCard,
  Gauge,
  LayoutDashboard,
  Settings,
  ShoppingBag,
  SlidersHorizontal,
  Tags,
} from 'lucide-react';
import type { AdminHubCardTab } from '../../../components/admin/AdminHubCardTabs';

export type StoreAdminTab = 'overview' | 'windows' | 'catalog' | 'orders' | 'payments' | 'settings';

/**
 * Settings is always last — the frame's rule, on every module. Every tab is
 * described, so the frame draws them as cards that say what each one holds;
 * the card type makes the line and icon required, which the command palette
 * relies on too.
 */
export const STORE_ADMIN_TABS: AdminHubCardTab<StoreAdminTab>[] = [
  { id: 'overview', label: 'Overview', description: 'Store status and the latest orders', icon: LayoutDashboard },
  { id: 'windows', label: 'Order Windows', description: 'Open and close ordering periods', icon: CalendarClock },
  { id: 'catalog', label: 'Catalog', description: 'The items members can order', icon: ShoppingBag },
  {
    id: 'orders',
    label: 'Orders',
    description: 'Move orders along and export them for the vendor',
    icon: ClipboardList,
  },
  { id: 'payments', label: 'Payments', description: 'Payments that need matching by hand', icon: CreditCard },
  { id: 'settings', label: 'Settings', description: 'Payment methods, pricing and notices', icon: Settings },
];

export type StoreAdminAreaId = 'glance' | 'selling' | 'fulfilment' | 'setup';

export interface StoreAdminArea {
  id: StoreAdminAreaId;
  label: string;
  description: string;
  icon: LucideIcon;
  /** The area's pages, in strip order. */
  destinations: AdminHubCardTab<StoreAdminTab>[];
}

const tabById = (id: StoreAdminTab): AdminHubCardTab<StoreAdminTab> => {
  const tab = STORE_ADMIN_TABS.find((candidate) => candidate.id === id);
  if (!tab) throw new Error(`Unknown store admin tab: ${id}`);
  return tab;
};

/**
 * Every tab belongs to exactly one area — `storeAdminTabs.test.ts` holds that.
 * No area shares a name with a page: an area card and a page tab both read as
 * a tab to assistive technology, and "Orders, tab" announced for two
 * different controls would not say which one is meant.
 */
export const STORE_ADMIN_AREAS: StoreAdminArea[] = [
  {
    id: 'glance',
    label: 'At a Glance',
    description: 'Store status and the latest orders',
    icon: Gauge,
    destinations: [tabById('overview')],
  },
  {
    id: 'selling',
    label: 'Selling',
    description: 'When members can order, and what',
    icon: Tags,
    destinations: [tabById('windows'), tabById('catalog')],
  },
  {
    id: 'fulfilment',
    label: 'Orders & Payments',
    description: 'Move orders along and match payments',
    icon: ClipboardList,
    destinations: [tabById('orders'), tabById('payments')],
  },
  {
    id: 'setup',
    label: 'Store Settings',
    description: 'Payment methods, pricing, notices and metrics',
    icon: SlidersHorizontal,
    destinations: [tabById('settings')],
  },
];

const DEFAULT_TAB: StoreAdminTab = 'overview';

const isStoreAdminTab = (value: string | null): value is StoreAdminTab =>
  value !== null && STORE_ADMIN_TABS.some((tab) => tab.id === value);

export interface StoreAdminLocation {
  area: StoreAdminArea;
  tab: StoreAdminTab;
}

/** Resolve `?tab=` to its area and page; a missing or unknown tab opens Overview. */
export const resolveStoreAdminLocation = (tabParam: string | null): StoreAdminLocation => {
  const tab = isStoreAdminTab(tabParam) ? tabParam : DEFAULT_TAB;
  const area =
    STORE_ADMIN_AREAS.find((candidate) => candidate.destinations.some((destination) => destination.id === tab)) ??
    STORE_ADMIN_AREAS[0];
  if (!area) throw new Error('Store admin console has no areas');
  return { area, tab };
};

/** Element ids shared by the nav's tabs and the panels the page renders for them. */
export const STORE_ADMIN_AREA_ID_PREFIX = 'store-admin-area';
export const storeAdminTabId = (tab: string) => `store-admin-tab-${tab}`;
export const storeAdminTabPanelId = (tab: string) => `store-admin-tabpanel-${tab}`;
