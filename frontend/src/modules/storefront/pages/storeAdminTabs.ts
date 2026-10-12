/**
 * The Department Store console's sections, kept apart from the page so the
 * command palette — part of the always-loaded shell — can offer each one
 * without pulling the console into the main bundle.
 */

import { CalendarClock, ClipboardList, CreditCard, LayoutDashboard, Settings, ShoppingBag } from 'lucide-react';
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
