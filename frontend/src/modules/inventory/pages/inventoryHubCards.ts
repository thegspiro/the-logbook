/**
 * The inventory administration hub's card registry.
 *
 * Every card is a navigation control, and a navigation control that offers a
 * page the viewer's permissions will not open is worse than no control: the
 * officer gets Access Denied from something the app itself put in front of
 * them. So each card carries the gate of the route it targets, and
 * `inventoryHubCards.test.ts` resolves that route's real gate out of the route
 * source and fails if the two ever drift.
 *
 * A gate here must be a SUBSET of the gate on the route it targets.
 * `checkPermission` is exact match plus module wildcard, so `inventory.manage`
 * implies neither `inventory.view` nor `inventory.check_*`. That is not
 * pedantry: the seeded Quartermaster holds `inventory.manage` and *neither*
 * check grant, so for as long as the checklist cards were unguarded literals
 * this hub showed its primary audience two cards that both refused them.
 *
 * Narrower than the route is always safe — it hides a card. Wider is the bug.
 *
 * Shape deliberately mirrors `components/layout/quickAddActions.ts`, the app's
 * other typed navigation registry, so the two read alike and the same test
 * helper checks both.
 */

import {
  ArrowDownToLine,
  Box,
  BoxSelect,
  Building2,
  ClipboardCheck,
  ClipboardList,
  Clock,
  CornerDownLeft,
  DollarSign,
  FileX,
  Layers,
  type LucideIcon,
  MapPin,
  Package,
  Ruler,
  SlidersHorizontal,
  Sparkles,
  Stethoscope,
  Store,
  Tag,
  Target,
  Truck,
  Upload,
  Users,
  Wrench,
} from 'lucide-react';

/**
 * Section headings, in render order.
 *
 * Grouped by what the officer is doing rather than by which table the page
 * reads — "Requests & Approvals" is one queue of decisions whether the thing
 * being decided is a gear request, a return or a write-off.
 */
export const INVENTORY_HUB_SECTIONS = [
  'Supply lines',
  'Catalog',
  'Issuance & Members',
  'Requests & Approvals',
  'Readiness & Compliance',
  'Department Store',
  'Setup & Tools',
] as const;
export type InventoryHubSection = (typeof INVENTORY_HUB_SECTIONS)[number];

/** Icon tint. A union rather than a class string so Tailwind's scanner sees
 *  every literal in one place (`InventoryAdminHub`'s TONE_CLASSES map). */
export type InventoryHubTone =
  'blue' | 'purple' | 'orange' | 'cyan' | 'yellow' | 'green' | 'red' | 'indigo' | 'amber' | 'sky' | 'emerald' | 'slate';

export interface InventoryHubCard {
  /** Stable id — React key, and how the hub attaches live counts. */
  id: string;
  label: string;
  description: string;
  path: string;
  icon: LucideIcon;
  section: InventoryHubSection;
  tone: InventoryHubTone;
  /** Required permission (exact match plus module wildcard). */
  permission?: string;
  /** Any one of these grants access (OR), mirroring the route's own. */
  anyPermission?: string[];
  /** Hidden unless the organization has this module enabled. */
  requiresModule?: string;
}

/**
 * Ordered within each section by how often an officer reaches for it.
 *
 * Most cards target `/inventory/admin/*`, whose routes gate on
 * `inventory.manage` — the same grant this hub's own route requires, so those
 * gates are redundant today. They are stated anyway: the test checks the
 * registry against the routes, and a redundant-but-correct gate is what keeps
 * that check meaningful if a route's own gate is ever narrowed.
 */
export const INVENTORY_HUB_CARDS: InventoryHubCard[] = [
  // ── Supply lines ───────────────────────────────────────────────────────
  //
  // Entry points, not a taxonomy: tools, equipment, electronics and
  // consumables are real item types that no supply line is staffed around, and
  // they are reached through "All Items" below. What these three have in
  // common is that a department appoints somebody to run them.
  {
    id: 'supply-ppe',
    label: 'PPE & Turnout Gear',
    description: 'Structural gear, SCBA and the NFPA clock on each set',
    path: '/inventory/admin/items?item_type=ppe',
    icon: Package,
    section: 'Supply lines',
    tone: 'blue',
    permission: 'inventory.manage',
    requiresModule: 'inventory',
  },
  {
    id: 'supply-uniform',
    label: 'Uniforms',
    description: 'Class A and duty uniforms, by size and style',
    path: '/inventory/admin/items?item_type=uniform',
    icon: Ruler,
    section: 'Supply lines',
    tone: 'purple',
    permission: 'inventory.manage',
    requiresModule: 'inventory',
  },
  {
    // The route accepts `inventory.view` as well, but this card is gated on
    // the medical grant alone — `inventory.view` is held by both seeded
    // rank-and-file positions, and navGateIntegrity has a dedicated test
    // keeping the stock room off the everyone-grant. The seeded Quartermaster
    // holds `view_medical`, so a department running one supply line still
    // sees this.
    id: 'supply-medical',
    label: 'EMS Supplies',
    description: 'Lot- and expiry-tracked medical stock',
    path: '/medical-supplies',
    icon: Stethoscope,
    section: 'Supply lines',
    tone: 'emerald',
    permission: 'inventory.view_medical',
    requiresModule: 'medical_supplies',
  },

  // ── Catalog ────────────────────────────────────────────────────────────
  {
    id: 'items',
    label: 'All Items',
    description: 'Every item on the books, across all types',
    path: '/inventory/admin/items',
    icon: Box,
    section: 'Catalog',
    tone: 'blue',
    permission: 'inventory.manage',
    requiresModule: 'inventory',
  },
  {
    id: 'pool',
    label: 'Pool Items',
    description: 'Quantity-tracked stock, issued to members',
    path: '/inventory/admin/pool',
    icon: Layers,
    section: 'Catalog',
    tone: 'blue',
    permission: 'inventory.manage',
    requiresModule: 'inventory',
  },
  {
    id: 'categories',
    label: 'Categories',
    description: 'Organize items by type with tracking settings',
    path: '/inventory/admin/categories',
    icon: Tag,
    section: 'Catalog',
    tone: 'blue',
    permission: 'inventory.manage',
    requiresModule: 'inventory',
  },
  {
    id: 'variant-groups',
    label: 'Variant Groups',
    description: 'Group pool item variants by size, style, and color',
    path: '/inventory/admin/variant-groups',
    icon: Ruler,
    section: 'Catalog',
    tone: 'purple',
    permission: 'inventory.manage',
    requiresModule: 'inventory',
  },
  {
    id: 'storage-areas',
    label: 'Storage Areas',
    description: 'Manage storage locations within facilities',
    path: '/inventory/storage-areas',
    icon: MapPin,
    section: 'Catalog',
    tone: 'cyan',
    permission: 'inventory.manage',
    requiresModule: 'inventory',
  },
  {
    id: 'vendors',
    label: 'Vendors',
    description: 'Suppliers, their contacts, and what we buy from them',
    path: '/inventory/admin/vendors',
    icon: Building2,
    section: 'Catalog',
    tone: 'cyan',
    permission: 'inventory.manage',
    requiresModule: 'inventory',
  },

  // ── Issuance & Members ─────────────────────────────────────────────────
  {
    id: 'members',
    label: 'Members',
    description: 'View and manage per-member equipment assignments',
    path: '/inventory/admin/members',
    icon: Users,
    section: 'Issuance & Members',
    tone: 'emerald',
    permission: 'inventory.manage',
    requiresModule: 'inventory',
  },
  {
    id: 'checkouts',
    label: 'Temporary Loans',
    description: 'Serialized gear due back on a specific date',
    path: '/inventory/checkouts',
    icon: ArrowDownToLine,
    section: 'Issuance & Members',
    tone: 'amber',
    permission: 'inventory.manage',
    requiresModule: 'inventory',
  },
  {
    id: 'kits',
    label: 'Gear Kits',
    description: 'Kit templates for multi-item issuance',
    path: '/inventory/admin/kits',
    icon: BoxSelect,
    section: 'Issuance & Members',
    tone: 'purple',
    permission: 'inventory.manage',
    requiresModule: 'inventory',
  },
  {
    id: 'allowances',
    label: 'Issuance Allowances',
    description: 'Cap how many units per category a member can be issued',
    path: '/inventory/admin/allowances',
    icon: SlidersHorizontal,
    section: 'Issuance & Members',
    tone: 'blue',
    permission: 'inventory.manage',
    requiresModule: 'inventory',
  },
  {
    id: 'impact-planner',
    label: 'Impact Planner',
    description: "Plan a new issue: who's impacted, sizes needed, who to contact",
    path: '/inventory/admin/impact-planner',
    icon: Target,
    section: 'Issuance & Members',
    tone: 'purple',
    permission: 'inventory.manage',
    requiresModule: 'inventory',
  },

  // ── Requests & Approvals ───────────────────────────────────────────────
  {
    id: 'requests',
    label: 'Gear Requests',
    description: 'Review member requests for equipment',
    path: '/inventory/admin/requests',
    icon: ClipboardList,
    section: 'Requests & Approvals',
    tone: 'yellow',
    permission: 'inventory.manage',
    requiresModule: 'inventory',
  },
  {
    id: 'returns',
    label: 'Return Requests',
    description: 'Review and process member return requests',
    path: '/inventory/admin/returns',
    icon: CornerDownLeft,
    section: 'Requests & Approvals',
    tone: 'yellow',
    permission: 'inventory.manage',
    requiresModule: 'inventory',
  },
  {
    id: 'reorder',
    label: 'Reorder Requests',
    description: 'Track and manage supply reorder requests',
    path: '/inventory/admin/reorder',
    icon: Truck,
    section: 'Requests & Approvals',
    tone: 'indigo',
    permission: 'inventory.manage',
    requiresModule: 'inventory',
  },
  {
    id: 'write-offs',
    label: 'Write-Offs',
    description: 'Process loss and damage write-off requests',
    path: '/inventory/admin/write-offs',
    icon: FileX,
    section: 'Requests & Approvals',
    tone: 'red',
    permission: 'inventory.manage',
    requiresModule: 'inventory',
  },
  {
    id: 'charges',
    label: 'Charges',
    description: 'Cost recovery for lost or damaged items',
    path: '/inventory/admin/charges',
    icon: DollarSign,
    section: 'Requests & Approvals',
    tone: 'green',
    permission: 'inventory.manage',
    requiresModule: 'inventory',
  },

  // ── Readiness & Compliance ─────────────────────────────────────────────
  {
    id: 'maintenance',
    label: 'Maintenance',
    description: 'Track inspections, repairs, and compliance',
    path: '/inventory/admin/maintenance',
    icon: Wrench,
    section: 'Readiness & Compliance',
    tone: 'orange',
    permission: 'inventory.manage',
    requiresModule: 'inventory',
  },
  {
    // `inventory.check_manage`, NOT `inventory.manage`: the seeded
    // Quartermaster holds the latter and not the former, so this card was a
    // link to Access Denied for the officer this hub is built for.
    id: 'checklists',
    label: 'Equipment Checklists',
    description: 'The checklists themselves, plus fleet readiness and the check log',
    path: '/inventory/admin/checklists',
    icon: ClipboardList,
    section: 'Readiness & Compliance',
    tone: 'sky',
    permission: 'inventory.check_manage',
    requiresModule: 'inventory',
  },
  {
    id: 'check-reports',
    label: 'Check Reports',
    description: 'Compliance, failures and item trends across completed checks',
    path: '/inventory/admin/checklists/reports',
    icon: ClipboardCheck,
    section: 'Readiness & Compliance',
    tone: 'emerald',
    permission: 'inventory.check_view',
    requiresModule: 'inventory',
  },
  {
    id: 'supply-expiring',
    label: 'Expiring on Apparatus',
    description: 'Items expiring on the trucks and ready replacement stock',
    path: '/inventory/admin/checklists/supply',
    icon: Clock,
    section: 'Readiness & Compliance',
    tone: 'amber',
    anyPermission: ['scheduling.manage', 'inventory.check_view', 'inventory.manage'],
    requiresModule: 'inventory',
  },

  // ── Department Store ───────────────────────────────────────────────────
  //
  // Its own section rather than a stray entry under Tools: the store is where
  // uniforms are actually bought, which makes it part of this officer's job
  // rather than an adjacent app. Every card carries the store's own grant and
  // module flag — they are orthogonal to the inventory permissions, and a
  // department can run one without the other.
  {
    id: 'store',
    label: 'Department Store',
    description: 'Manage the catalog, orders, payments, and ordering windows',
    path: '/inventory/admin/store',
    icon: Store,
    section: 'Department Store',
    tone: 'blue',
    permission: 'storefront.manage',
    requiresModule: 'storefront',
  },

  // ── Setup & Tools ──────────────────────────────────────────────────────
  {
    id: 'setup',
    label: 'Setup Guide',
    description: 'Rooms, storage, categories, and first items in order',
    path: '/inventory/admin/setup',
    icon: Sparkles,
    section: 'Setup & Tools',
    tone: 'blue',
    permission: 'inventory.manage',
    requiresModule: 'inventory',
  },
  {
    id: 'import',
    label: 'Import / Export',
    description: 'Bulk import from CSV or export inventory data',
    path: '/inventory/import',
    icon: Upload,
    section: 'Setup & Tools',
    tone: 'slate',
    permission: 'inventory.manage',
    requiresModule: 'inventory',
  },
];
