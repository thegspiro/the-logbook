/**
 * The figures behind Inventory Administration: the record-level "Needs
 * attention" queue, the supply-line counts, the setup status, and the pending
 * counts that badge the header's areas and pages.
 *
 * Lifted out of the hub page so `InventoryAdminLayout` can load it once for
 * the header it draws around every admin page, and the Overview can read the
 * same answer instead of asking again.
 */

import { useCallback, useEffect, useState } from 'react';
import { inventoryService } from '../../../services/api';
import { medicalSuppliesService } from '../../../services/medicalSuppliesService';
import { formatCalendarDate, formatDate } from '../../../utils/dateFormatting';
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

export type AttentionSeverity = 'Critical' | 'High' | 'Medium';
export interface AttentionRow {
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

/** A clearance still waiting on the member: the backend's INITIATED and IN_PROGRESS. */
const OPEN_CLEARANCE_STATUSES = new Set(['initiated', 'in_progress']);

const isRecord = (body: unknown): body is Record<string, unknown> => typeof body === 'object' && body !== null;

/** An object carrying an array under `key`, the shape the paged inventory endpoints return. */
const hasList = (body: unknown, key: string): body is Record<string, unknown> =>
  isRecord(body) && Array.isArray(body[key]);

export interface InventoryAdminData {
  summary: InventorySummary | null;
  lowStockAlerts: LowStockAlert[];
  pendingReturns: number;
  pendingRequests: number;
  pendingWriteOffs: number;
  setupStatus: InventorySetupStatus | null;
  attentionRows: AttentionRow[];
  failedSources: string[];
  medicalExpiring: number | null;
  loading: boolean;
  reload: () => Promise<void>;
}

interface Options {
  /** Whether to ask for the inventory figures at all — see the comment on `sources`. */
  canManage: boolean;
  /** Whether the EMS card is on screen, which is what its request is raised for. */
  showsMedical: boolean;
  /**
   * False until the module flags settle: `showsMedical` is derived from the
   * card list, so firing before then spends one request set on a guess and a
   * second on the truth.
   */
  enabled: boolean;
  tz: string;
  /**
   * Reloads when this changes. The layout passes its path, so moving between
   * pages after approving a request or a write-off updates the header's
   * counts; the response cache keeps that from costing a round trip each.
   */
  refreshKey?: string | undefined;
}

export function useInventoryAdminData({
  canManage,
  showsMedical,
  enabled,
  tz,
  refreshKey,
}: Options): InventoryAdminData {
  const [summary, setSummary] = useState<InventorySummary | null>(null);
  const [lowStockAlerts, setLowStockAlerts] = useState<LowStockAlert[]>([]);
  const [pendingReturns, setPendingReturns] = useState(0);
  const [pendingRequests, setPendingRequests] = useState(0);
  const [setupStatus, setSetupStatus] = useState<InventorySetupStatus | null>(null);
  const [attentionRows, setAttentionRows] = useState<AttentionRow[]>([]);
  const [failedSources, setFailedSources] = useState<string[]>([]);
  const [medicalExpiring, setMedicalExpiring] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [pendingWriteOffs, setPendingWriteOffs] = useState(0);

  const loadSummary = useCallback(async () => {
    setLoading(true);

    // Medical stock is its own module with its own grant, so it is requested
    // separately, and only when the card that shows the number is on screen —
    // folding it into the tuple below would spend a 403 on every department
    // that runs no EMS supply line. The count is what expires soon rather than
    // what is on the shelf: that is the number an EMS officer opens the page
    // for, and it is what /medical-supplies itself leads with.
    //
    // It is settled alongside the batch and reports into the same
    // `failedSources` banner. Swallowing its rejection would show the card
    // without a stat, which is indistinguishable from a department that has
    // nothing expiring — and would leave no Retry for the one request the
    // banner could not mention.
    const medicalRequest = showsMedical ? medicalSuppliesService.getSummary() : null;

    // Only for the inventory grant. This page also admits a checklist officer
    // and a store manager -- they come for their own card -- and every one of
    // these ten endpoints requires an inventory grant they do not hold. Firing
    // them anyway spends ten 403s on every visit and names all ten in the
    // "some figures are unavailable" banner, which tells an officer the system
    // is broken when it is working exactly as configured. The figures these
    // fill are inventory figures; there is nothing for them to say to someone
    // who administers neither.
    // Each source carries the shape check its consumer below depends on. A
    // request can succeed with a body that is not what it declares — a captive
    // portal's HTML page answers 200 — and `value()` used to cast that straight
    // through, so `{}` reached `.clearances.filter` and took the hub down. A
    // malformed body is now a failed source like any other: named in the
    // banner, with the fallback shown, rather than a crash or a silent zero.
    const sources: readonly (readonly [string, Promise<unknown>, (body: unknown) => boolean])[] = canManage
      ? [
          ['summary', inventoryService.getSummary(), isRecord],
          ['low stock', inventoryService.getLowStockItems(), Array.isArray],
          ['returns', inventoryService.getReturnRequests({ status: 'requested' }), Array.isArray],
          [
            'gear requests',
            inventoryService.getEquipmentRequests({ status: 'pending' }),
            (body) => hasList(body, 'requests') && typeof body.total === 'number',
          ],
          ['setup', inventoryService.getSetupStatus(), isRecord],
          ['temporary loans', inventoryService.getOverdueCheckouts(), (body) => hasList(body, 'checkouts')],
          ['maintenance', inventoryService.getMaintenanceDueItems(30), Array.isArray],
          ['write-offs', inventoryService.getWriteOffRequests({ status: 'pending' }), Array.isArray],
          ['purchase deliveries', inventoryService.getReorderRequests({ status: 'ordered' }), Array.isArray],
          // Every status, filtered below: a clearance opens as `initiated` and
          // only becomes `in_progress` once something is returned, so asking for
          // `in_progress` alone left a freshly dropped member's clearance off this
          // list entirely (workflow review W15).
          ['departure clearances', inventoryService.getDepartureClearances(), (body) => hasList(body, 'clearances')],
        ]
      : [];
    const [results, medicalSettled] = await Promise.all([
      Promise.allSettled(sources.map(([, promise]) => promise)),
      Promise.allSettled(medicalRequest ? [medicalRequest] : []),
    ]);
    // Widened from the `as const` tuple's literal union: the medical request is
    // not one of its members, and it reports into the same banner.
    const usable = (index: number): boolean => {
      const result = results[index];
      const check = sources[index]?.[2];
      return result?.status === 'fulfilled' && check !== undefined && check(result.value);
    };
    const failed: string[] = sources.flatMap(([name], index) => (usable(index) ? [] : [name]));

    const medicalResult = medicalSettled[0];
    if (medicalResult?.status === 'rejected') failed.push('EMS supplies');
    setMedicalExpiring(medicalResult?.status === 'fulfilled' ? medicalResult.value.expiring_soon : null);

    setFailedSources(failed);
    const value = <T>(index: number, fallback: T): T => {
      const result = results[index];
      return result?.status === 'fulfilled' && usable(index) ? (result.value as T) : fallback;
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
        member_name?: string | null;
        status: string;
        items_outstanding: number;
        initiated_at: string;
        return_deadline?: string;
      }>;
    }>(9, { clearances: [] }).clearances.filter((c) => OPEN_CLEARANCE_STATUSES.has(c.status));

    setSummary(summaryData);
    setLowStockAlerts(lowStock);
    setPendingReturns(returns.length);
    setPendingRequests(requests.total);
    setPendingWriteOffs(writeOffs.length);
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
        party: `${clearance.member_name || 'A departed member'} · ${clearance.items_outstanding} outstanding`,
        when: dateLabel(clearance.return_deadline, dateLabel(clearance.initiated_at, 'In progress', tz), tz),
        severity:
          clearance.return_deadline && new Date(clearance.return_deadline).getTime() < now
            ? ('High' as const)
            : ('Medium' as const),
        rank: clearance.return_deadline && new Date(clearance.return_deadline).getTime() < now ? 1 : 4,
        action: 'Review',
        href: `/inventory/admin/clearances/${clearance.id}`,
      })),
    ];
    setAttentionRows(rows.sort((a, b) => a.rank - b.rank || a.when.localeCompare(b.when)));
    setLoading(false);
  }, [tz, showsMedical, canManage]);

  useEffect(() => {
    if (!enabled) return;
    void loadSummary();
    // refreshKey is a deliberate re-run trigger, not a value loadSummary reads.
  }, [loadSummary, enabled, refreshKey]);

  return {
    summary,
    lowStockAlerts,
    pendingReturns,
    pendingRequests,
    pendingWriteOffs,
    setupStatus,
    attentionRows,
    failedSources,
    medicalExpiring,
    loading,
    reload: loadSummary,
  };
}
