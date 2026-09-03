/**
 * Inventory Administration
 *
 * The launching point for whoever runs the department's stock — gear, PPE,
 * uniforms and EMS supplies, which are one catalog on the backend partitioned
 * by `InventoryCategory.item_type`, plus the store the uniforms are bought
 * through.
 *
 * The body is a card wall, and every card comes from `inventoryHubCards.ts`
 * carrying the gate of the route it targets, filtered here through
 * `checkPermission` / `isModuleOn`. That indirection is the point: as JSX
 * literals the cards inherited this page's own `inventory.manage` gate, and
 * two of them targeted routes requiring the check grants — which the seeded
 * Quartermaster does not hold — so the hub offered its primary audience two
 * cards that both refused them.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router';
import { RefreshCw, UserPlus, Sparkles, ArrowRight, AlertTriangle } from 'lucide-react';
import { inventoryService } from '../../../services/api';
import { medicalSuppliesService } from '../../../services/medicalSuppliesService';
import { AdminHubFrame, AdminMetricsSettings } from '../../../components/admin';
import type { AdminHubAction, AdminHubTab } from '../../../components/admin';
import { useAuthStore } from '../../../stores/authStore';
import { useEnabledModules } from '../../../hooks/useEnabledModules';
import { useTimezone } from '../../../hooks/useTimezone';
import { formatCalendarDate, formatDate } from '../../../utils/dateFormatting';
import { MemberPickerModal } from '../../../components/MemberPickerModal';
import { InventoryScanModal } from '../../../components/InventoryScanModal';
import { INVENTORY_HUB_CARDS, INVENTORY_HUB_SECTIONS } from './inventoryHubCards';
import type { InventoryHubCard, InventoryHubSection, InventoryHubTone } from './inventoryHubCards';
import type {
  InventorySummary,
  InventorySetupStatus,
  LowStockAlert,
  ReturnRequestItem,
  EquipmentRequestItem,
  InventoryItem,
  UserCheckoutItem,
  WriteOffRequestItem,
  ReorderRequest,
} from '../types';

type AttentionSeverity = 'Critical' | 'High' | 'Medium';
interface AttentionRow {
  key: string;
  subject: string;
  party: string;
  when: string;
  severity: AttentionSeverity;
  rank: number;
  action: string;
  href: string;
}

// `dateOnly` fields (next_inspection_due, expected_delivery_date) come from
// the backend as calendar dates ("YYYY-MM-DD"), not instants -- formatDate's
// tz-aware Intl formatting would parse that as UTC midnight and then render
// it a day early west of UTC. formatCalendarDate anchors and renders in UTC
// so the date on screen matches the string, for every viewer.
const dateLabel = (value: string | undefined, fallback: string, tz: string, dateOnly = false) => {
  if (!value) return fallback;
  const date = new Date(value);
  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000);
  const formatted = dateOnly ? formatCalendarDate(value) : formatDate(date, tz);
  return days > 0 ? `${days}d overdue · due ${formatted}` : `Due ${formatted}`;
};

const NeedsAttention: React.FC<{
  rows: AttentionRow[];
  loading: boolean;
  failedSources: string[];
  onRetry: () => void;
}> = ({ rows, loading, failedSources, onRetry }) => (
  <section aria-labelledby="inventory-needs-attention" className="card mb-8 overflow-hidden">
    <div className="border-theme-surface-border flex items-center gap-2 border-b px-4 py-3 sm:px-5">
      <AlertTriangle className="h-5 w-5 text-red-600" aria-hidden="true" />
      <h2 id="inventory-needs-attention" className="text-theme-text-primary font-semibold">
        Needs attention
      </h2>
      {!loading && (
        <span
          className="rounded-full bg-red-800 px-2 py-0.5 text-xs font-bold text-white"
          aria-label={`${rows.length} work items awaiting action`}
        >
          {rows.length}
        </span>
      )}
      <span className="text-theme-text-muted ml-auto text-xs">Work awaiting a decision or action</span>
    </div>
    {failedSources.length > 0 && (
      <div
        className="border-theme-alert-warning-border bg-theme-alert-warning-bg text-theme-alert-warning-text flex items-center gap-2 border-b px-4 py-3 text-sm"
        role="alert"
      >
        <span className="flex-1">
          Some inventory services did not respond ({failedSources.join(', ')}). This queue may be incomplete.
        </span>
        <button type="button" className="font-semibold underline" onClick={onRetry}>
          Retry
        </button>
      </div>
    )}
    {loading ? (
      <p className="text-theme-text-muted px-5 py-6 text-sm" role="status">
        Loading actionable work…
      </p>
    ) : rows.length === 0 && failedSources.length === 0 ? (
      <p className="text-theme-text-muted px-5 py-6 text-sm">
        Nothing needs attention. All inventory work is up to date.
      </p>
    ) : (
      <ul className="divide-theme-surface-border divide-y">
        {rows.map((row) => (
          <li
            key={row.key}
            className="grid gap-2 px-4 py-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1.3fr)_minmax(0,1.2fr)_auto_auto] sm:items-center sm:px-5"
          >
            <span className="text-theme-text-primary font-semibold">{row.subject}</span>
            <span className="text-theme-text-secondary text-sm">{row.party}</span>
            <span className="text-theme-text-muted text-sm">{row.when}</span>
            <span
              className={`w-fit rounded-full px-2 py-1 text-xs font-semibold ${row.severity === 'Critical' ? 'bg-red-500/15 text-red-700 dark:text-red-300' : row.severity === 'High' ? 'bg-orange-500/15 text-orange-700 dark:text-orange-300' : 'bg-yellow-500/15 text-yellow-700 dark:text-yellow-300'}`}
            >
              {row.severity}
            </span>
            <Link to={row.href} className="btn-secondary min-h-[36px] text-sm font-semibold">
              {row.action}
            </Link>
          </li>
        ))}
      </ul>
    )}
  </section>
);
/**
 * Icon tints, spelled out as whole class strings.
 *
 * Tailwind scans source for complete class names, so these cannot be built
 * from the tone at runtime — `bg-${tone}-500/10` compiles to nothing. Keeping
 * the literals in one map is also what lets the registry carry a tone name
 * instead of a class string it has no business knowing.
 */
const TONE_CLASSES: Record<InventoryHubTone, string> = {
  blue: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  purple: 'bg-purple-500/10 text-purple-600 dark:text-purple-400',
  orange: 'bg-orange-500/10 text-orange-600 dark:text-orange-400',
  cyan: 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400',
  yellow: 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400',
  green: 'bg-green-500/10 text-green-600 dark:text-green-400',
  red: 'bg-red-500/10 text-red-600 dark:text-red-400',
  indigo: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400',
  amber: 'bg-amber-500/10 text-amber-600 dark:text-amber-400',
  sky: 'bg-sky-500/10 text-sky-600 dark:text-sky-400',
  emerald: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  slate: 'bg-theme-surface-secondary text-theme-text-muted group-hover:text-theme-text-primary',
};

/** Live figures the registry cannot carry, attached to a card by its id. */
interface CardStat {
  /** Large number on a supply-line card. */
  stat?: number | undefined;
  statLabel?: string | undefined;
  /** Small pill beside a nav card's title. */
  badge?: number | undefined;
  badgeColor?: string | undefined;
}

const NavCard: React.FC<{ card: InventoryHubCard; stat: CardStat }> = ({ card, stat }) => (
  <Link
    to={card.path}
    className="card-secondary hover:bg-theme-surface-hover active:bg-theme-surface-hover group flex items-center gap-3 p-3 sm:items-start sm:gap-4 sm:p-4"
  >
    <div
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors sm:h-10 sm:w-10 ${TONE_CLASSES[card.tone]}`}
    >
      <card.icon className="h-5 w-5" aria-hidden="true" />
    </div>
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-2">
        <h3 className="text-theme-text-primary group-hover:text-theme-text-primary text-sm font-semibold">
          {card.label}
        </h3>
        {stat.badge != null && stat.badge > 0 && (
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${stat.badgeColor ?? 'bg-blue-500/10 text-blue-700 dark:text-blue-400'}`}
          >
            {stat.badge}
          </span>
        )}
      </div>
      <p className="text-theme-text-muted mt-0.5 hidden text-xs sm:block">{card.description}</p>
    </div>
  </Link>
);

const ProminentCard: React.FC<{ card: InventoryHubCard; stat: CardStat }> = ({ card, stat }) => (
  <Link
    to={card.path}
    className="card-secondary hover:bg-theme-surface-hover active:bg-theme-surface-hover group flex flex-col gap-3 p-4 transition-all sm:p-5"
  >
    <div className="flex items-center justify-between">
      <div
        className={`flex h-10 w-10 items-center justify-center rounded-xl sm:h-11 sm:w-11 ${TONE_CLASSES[card.tone]}`}
      >
        <card.icon className="h-5 w-5" aria-hidden="true" />
      </div>
      {stat.stat != null && (
        <div className="text-right">
          <p className="text-theme-text-primary text-xl font-bold sm:text-2xl">{stat.stat}</p>
          {stat.statLabel && <p className="text-theme-text-muted text-[11px]">{stat.statLabel}</p>}
        </div>
      )}
    </div>
    <div>
      <h3 className="text-theme-text-primary text-sm font-semibold">{card.label}</h3>
      <p className="text-theme-text-muted mt-0.5 text-xs">{card.description}</p>
    </div>
  </Link>
);

interface SectionProps {
  title: string;
  children: React.ReactNode;
}

const Section: React.FC<SectionProps> = ({ title, children }) => (
  <div>
    <h2 className="text-theme-text-muted mb-3 text-xs font-semibold tracking-wider uppercase">{title}</h2>
    {children}
  </div>
);

type AdminTab = 'overview' | 'settings';

/** Settings is always last — the frame's rule, on every module. */
const TABS: AdminHubTab<AdminTab>[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'settings', label: 'Settings' },
];

export const InventoryAdminHub: React.FC = () => {
  const checkPermission = useAuthStore((s) => s.checkPermission);
  const canManage = checkPermission('inventory.manage');
  const { isModuleOn } = useEnabledModules();
  const tz = useTimezone();

  // Every card resolves its own gate here rather than inheriting the page's.
  // The store and EMS cards are the visible reason — both are separate modules
  // with their own grants, and an unguarded card is the one door into a
  // console the department has not enabled — but the checklist cards are the
  // reason it is done for all of them: they refuse `inventory.manage`, which
  // is the grant everyone reaching this page holds.
  const visibleCards = useMemo(
    () =>
      INVENTORY_HUB_CARDS.filter((card) => {
        if (card.requiresModule && !isModuleOn(card.requiresModule)) return false;
        if (card.anyPermission) return card.anyPermission.some((permission) => checkPermission(permission));
        return card.permission ? checkPermission(card.permission) : true;
      }),
    [checkPermission, isModuleOn]
  );
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab') as AdminTab | null;
  const activeTab: AdminTab = tabParam === 'settings' ? 'settings' : 'overview';
  // Bumped when the settings tab saves, so the metrics row above it reflects
  // the new selection without a page reload.
  const [frameToken, setFrameToken] = useState(0);
  const [summary, setSummary] = useState<InventorySummary | null>(null);
  const [lowStockAlerts, setLowStockAlerts] = useState<LowStockAlert[]>([]);
  const [pendingReturns, setPendingReturns] = useState(0);
  const [pendingRequests, setPendingRequests] = useState(0);
  const [setupStatus, setSetupStatus] = useState<InventorySetupStatus | null>(null);
  const [attentionRows, setAttentionRows] = useState<AttentionRow[]>([]);
  const [failedSources, setFailedSources] = useState<string[]>([]);
  const [medicalExpiring, setMedicalExpiring] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  // A primitive, not the card object: this goes in a dependency array, and
  // `visibleCards` is only as stable as the two callbacks it memoizes on.
  const showsMedical = visibleCards.some((card) => card.id === 'supply-medical');

  // Quick-assign flow: pick a member, then assign items to them via the scan modal.
  const [memberPickerOpen, setMemberPickerOpen] = useState(false);
  const [assignTarget, setAssignTarget] = useState<{ userId: string; memberName: string } | null>(null);

  const loadSummary = useCallback(async () => {
    setLoading(true);

    // Medical stock is its own module with its own grant, so it is fetched
    // apart from the batch below and only when the card that shows the number
    // is on screen — folding it in would spend a 403 on every department that
    // runs no EMS supply line. The count is what expires soon rather than what
    // is on the shelf: that is the number an EMS officer opens the page for,
    // and it is what /medical-supplies itself leads with.
    if (showsMedical) {
      void medicalSuppliesService
        .getSummary()
        .then((medical) => setMedicalExpiring(medical.expiring_soon))
        // A missing figure leaves the card without its stat rather than
        // taking the hub down; the card still works as a door.
        .catch(() => setMedicalExpiring(null));
    } else {
      setMedicalExpiring(null);
    }

    const sources = [
      ['summary', inventoryService.getSummary()],
      ['low stock', inventoryService.getLowStockItems()],
      ['returns', inventoryService.getReturnRequests({ status: 'pending' })],
      ['gear requests', inventoryService.getEquipmentRequests({ status: 'pending' })],
      ['setup', inventoryService.getSetupStatus()],
      ['temporary loans', inventoryService.getOverdueCheckouts()],
      ['maintenance', inventoryService.getMaintenanceDueItems(30)],
      ['write-offs', inventoryService.getWriteOffRequests({ status: 'pending' })],
      ['purchase deliveries', inventoryService.getReorderRequests({ status: 'ordered' })],
      ['departure clearances', inventoryService.getDepartureClearances({ status: 'in_progress' })],
    ] as const;
    const results = await Promise.allSettled(sources.map(([, promise]) => promise));
    const failed = results.flatMap((result, index) => {
      const source = sources[index];
      return result.status === 'rejected' && source ? [source[0]] : [];
    });
    setFailedSources(failed);
    const value = <T,>(index: number, fallback: T): T => {
      const result = results[index];
      return result?.status === 'fulfilled' ? (result.value as T) : fallback;
    };
    const summaryData = value<InventorySummary | null>(0, null);
    const lowStock = value<LowStockAlert[]>(1, []);
    const returns = value<ReturnRequestItem[]>(2, []);
    const requests = value<{ requests: EquipmentRequestItem[]; total: number }>(3, { requests: [], total: 0 });
    const setup = value<InventorySetupStatus | null>(4, null);
    const checkouts = value<{ checkouts: UserCheckoutItem[] }>(5, { checkouts: [] }).checkouts;
    const maintenance = value<InventoryItem[]>(6, []);
    const writeOffs = value<WriteOffRequestItem[]>(7, []);
    const deliveries = value<ReorderRequest[]>(8, []);
    const clearances = value<{
      clearances: Array<{
        id: string;
        user_id: string;
        items_outstanding: number;
        initiated_at: string;
        return_deadline?: string;
      }>;
    }>(9, { clearances: [] }).clearances;

    setSummary(summaryData);
    setLowStockAlerts(lowStock);
    setPendingReturns(returns.length);
    setPendingRequests(requests.total);
    setSetupStatus(setup);

    const now = Date.now();
    const rows: AttentionRow[] = [
      ...maintenance.map((item) => ({
        key: `maintenance-${item.id}`,
        subject: 'Maintenance due or overdue',
        party: item.name,
        when: dateLabel(item.next_inspection_due, 'Due now', tz, true),
        severity:
          item.next_inspection_due && new Date(item.next_inspection_due).getTime() < now
            ? ('Critical' as const)
            : ('High' as const),
        rank: item.next_inspection_due && new Date(item.next_inspection_due).getTime() < now ? 0 : 2,
        action: 'Open item',
        // /inventory/items/:id, not /inventory/admin/items/:id — the latter
        // matches no route, so this row spent its life dropping the reader on
        // the dashboard via App.tsx's catch-all. The inspections tab is the
        // half of the record the row is about.
        href: `/inventory/items/${item.id}?tab=inspections`,
      })),
      ...checkouts.map((checkout) => ({
        key: `loan-${checkout.checkout_id}`,
        subject: 'Overdue temporary loan',
        party: `${checkout.user_name ?? 'Member'} · ${checkout.item_name}`,
        when: dateLabel(checkout.expected_return_at, dateLabel(checkout.checked_out_at, 'Overdue', tz), tz),
        severity: 'High' as const,
        rank: 1,
        action: 'Check in',
        href: `/inventory/checkouts?checkout=${checkout.checkout_id}`,
      })),
      ...deliveries
        .filter(
          (delivery) => delivery.expected_delivery_date && new Date(delivery.expected_delivery_date).getTime() < now
        )
        .map((delivery) => ({
          key: `delivery-${delivery.id}`,
          subject: 'Overdue purchase delivery',
          party: delivery.item_name,
          when: dateLabel(delivery.expected_delivery_date, 'Overdue', tz, true),
          severity: 'High' as const,
          rank: 1,
          action: 'Receive',
          // A query parameter, not a path segment: /inventory/admin/reorder is
          // an exact-match route, so the id-in-the-path form matched nothing.
          href: `/inventory/admin/reorder?request=${delivery.id}`,
        })),
      ...requests.requests.map((request) => ({
        key: `request-${request.id}`,
        subject: 'Pending gear request',
        party: `${request.requester_name ?? 'Member'} · ${request.item_name}`,
        when: dateLabel(request.created_at, 'Awaiting review', tz),
        // RequestPriority tops out at "high" (low/normal/high); the earlier
        // "urgent" comparison matched a value the backend cannot emit, so a
        // top-priority gear request never got escalated in this queue.
        severity: request.priority === 'high' ? ('High' as const) : ('Medium' as const),
        rank: request.priority === 'high' ? 2 : 4,
        action: 'Review',
        href: `/inventory/admin/requests?request=${request.id}`,
      })),
      ...returns.map((request) => ({
        key: `return-${request.id}`,
        subject: 'Pending return',
        party: `${request.requester_name ?? 'Member'} · ${request.item_name}`,
        when: dateLabel(request.created_at, 'Awaiting review', tz),
        severity: 'Medium' as const,
        rank: 4,
        action: 'Review',
        href: `/inventory/admin/returns?request=${request.id}`,
      })),
      ...writeOffs.map((request) => ({
        key: `writeoff-${request.id}`,
        subject: 'Pending write-off',
        party: `${request.requester_name ?? 'Member'} · ${request.item_name}`,
        when: dateLabel(request.created_at, 'Awaiting review', tz),
        severity: 'Medium' as const,
        rank: 4,
        action: 'Review',
        href: `/inventory/admin/write-offs?request=${request.id}`,
      })),
      ...lowStock.map((alert) => ({
        key: `stock-${alert.category_id}`,
        subject: 'Low-stock item',
        party: alert.category_name,
        when: `${alert.current_stock} on hand · par ${alert.threshold}`,
        severity: alert.current_stock === 0 ? ('High' as const) : ('Medium' as const),
        rank: alert.current_stock === 0 ? 2 : 5,
        action: 'Open item',
        href: `/inventory/admin/reorder?category=${alert.category_id}`,
      })),
      ...clearances.map((clearance) => ({
        key: `clearance-${clearance.id}`,
        subject: 'Unresolved departure clearance',
        party: `Member ${clearance.user_id} · ${clearance.items_outstanding} outstanding`,
        when: dateLabel(clearance.return_deadline, dateLabel(clearance.initiated_at, 'In progress', tz), tz),
        severity:
          clearance.return_deadline && new Date(clearance.return_deadline).getTime() < now
            ? ('High' as const)
            : ('Medium' as const),
        rank: clearance.return_deadline && new Date(clearance.return_deadline).getTime() < now ? 1 : 4,
        action: 'Review',
        href: `/inventory/admin/members?user=${clearance.user_id}`,
      })),
    ];
    setAttentionRows(rows.sort((a, b) => a.rank - b.rank || a.when.localeCompare(b.when)));
    setLoading(false);
  }, [tz, showsMedical]);

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);

  const actions: AdminHubAction[] = [
    {
      key: 'refresh',
      label: 'Refresh inventory counts',
      icon: RefreshCw,
      busy: loading,
      onClick: () => {
        void loadSummary();
        setFrameToken((token) => token + 1);
      },
    },
  ];

  /** Live figures per card id. Everything else about a card is static data. */
  const cardStats: Record<string, CardStat> = {
    'supply-ppe': { stat: summary?.items_by_type?.ppe, statLabel: 'items' },
    'supply-uniform': { stat: summary?.items_by_type?.uniform, statLabel: 'items' },
    'supply-medical': { stat: medicalExpiring ?? undefined, statLabel: 'expiring soon' },
    items: { stat: summary?.total_items, statLabel: 'total' },
    checkouts: {
      badge: summary?.overdue_checkouts,
      badgeColor: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
    },
    maintenance: {
      badge: summary?.maintenance_due_count,
      badgeColor: 'bg-orange-500/10 text-orange-700 dark:text-orange-400',
    },
    requests: {
      badge: pendingRequests > 0 ? pendingRequests : undefined,
      badgeColor: 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400',
    },
    returns: {
      badge: pendingReturns > 0 ? pendingReturns : undefined,
      badgeColor: 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400',
    },
    reorder: {
      badge: lowStockAlerts.length > 0 ? lowStockAlerts.length : undefined,
      badgeColor: 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400',
    },
  };
  const statFor = (id: string): CardStat => cardStats[id] ?? {};

  const cardsIn = (section: InventoryHubSection) => visibleCards.filter((card) => card.section === section);
  const supplyLines = cardsIn('Supply lines');
  // Sections after the supply-line row, rendered in registry order. A section
  // whose every card is filtered out renders nothing — a heading over an empty
  // grid tells the reader they are missing something without saying what.
  const bodySections = INVENTORY_HUB_SECTIONS.filter((section) => section !== 'Supply lines')
    .map((section) => ({ section, cards: cardsIn(section) }))
    .filter((group) => group.cards.length > 0);

  return (
    <AdminHubFrame<AdminTab>
      moduleKey="inventory"
      title="Inventory Administration"
      description="Gear, uniforms and EMS supplies — stock, issuance, and what needs a decision today"
      actions={actions}
      primaryAction={
        canManage
          ? {
              key: 'assign',
              label: 'Assign to Member',
              icon: UserPlus,
              onClick: () => setMemberPickerOpen(true),
            }
          : undefined
      }
      tabs={TABS}
      activeTab={activeTab}
      onTabChange={(tab) => setSearchParams(tab === 'overview' ? {} : { tab })}
      refreshToken={frameToken}
      showAttentionQueue={false}
    >
      {activeTab === 'settings' ? (
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          <AdminMetricsSettings
            moduleKey="inventory"
            moduleLabel="Inventory"
            permission="inventory.manage"
            onSaved={() => setFrameToken((token) => token + 1)}
          />
        </div>
      ) : (
        <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
          <NeedsAttention
            rows={attentionRows}
            loading={loading}
            failedSources={failedSources}
            onRetry={() => void loadSummary()}
          />
          {/* Setup prompt — shown until rooms, storage, categories, and items all exist.
            Without it a new quartermaster meets the item form first and fills in
            three dropdowns that have nothing in them. */}
          {setupStatus && !setupStatus.is_complete && (
            <Link
              to="/inventory/admin/setup"
              className="mb-8 flex items-center gap-3 rounded-lg border border-blue-500/30 bg-blue-500/10 p-3 transition-colors hover:bg-blue-500/15 sm:p-4"
            >
              <div className="shrink-0 rounded-lg bg-blue-600 p-2">
                <Sparkles className="h-5 w-5 text-white" />
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-sm font-semibold text-blue-700 dark:text-blue-300">Finish inventory setup</h3>
                <p className="text-xs text-blue-600 dark:text-blue-400">
                  Still to set up:{' '}
                  {[
                    setupStatus.rooms === 0 ? 'rooms' : null,
                    setupStatus.storage_areas === 0 ? 'storage areas' : null,
                    setupStatus.categories === 0 ? 'categories' : null,
                    setupStatus.items === 0 ? 'items' : null,
                  ]
                    .filter(Boolean)
                    .join(', ')}
                  . The guide walks through them in order.
                </p>
              </div>
              <ArrowRight className="h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400" />
            </Link>
          )}

          {/* Supply lines — the three stock lines a department staffs.
              Not a partition of the catalog: tools, equipment, electronics and
              consumables are real item types nobody is appointed to run, and
              they are reached through All Items below. */}
          {supplyLines.length > 0 && (
            <div className="mb-8 grid grid-cols-1 gap-3 sm:grid-cols-3">
              {supplyLines.map((card) => (
                <ProminentCard key={card.id} card={card} stat={statFor(card.id)} />
              ))}
            </div>
          )}

          <div className="space-y-8">
            {bodySections.map(({ section, cards }) => (
              <Section key={section} title={section}>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {cards.map((card) => (
                    <NavCard key={card.id} card={card} stat={statFor(card.id)} />
                  ))}
                </div>
              </Section>
            ))}
          </div>
        </div>
      )}

      {/* Quick-assign: pick a member, then assign items to them */}
      <MemberPickerModal
        isOpen={memberPickerOpen}
        onClose={() => setMemberPickerOpen(false)}
        title="Distribute Items — Select a Member"
        onSelect={(member) => {
          setMemberPickerOpen(false);
          setAssignTarget(member);
        }}
      />
      <InventoryScanModal
        isOpen={assignTarget !== null}
        onClose={() => setAssignTarget(null)}
        mode="distribute"
        userId={assignTarget?.userId ?? ''}
        memberName={assignTarget?.memberName ?? ''}
        onComplete={() => {
          void loadSummary();
          setFrameToken((token) => token + 1);
        }}
      />
    </AdminHubFrame>
  );
};

export default InventoryAdminHub;
