/**
 * Apparatus Detail — everything about one rig in one place.
 *
 * The four tabs are the four questions asked about a truck, and each one used
 * to live on a different page: today's checks (the Equipment Checks tab), what
 * it carries (Apparatus Inventory), what is wrong or expiring with it (Supply,
 * plus a failure log only admins could reach), and whether it has been getting
 * checked (nowhere at all). Nothing new is invented here — the surfaces are
 * gathered behind the rig they were always about.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { AlertTriangle, ChevronRight, ClipboardList, Loader2, PackageX, Truck, Wrench } from 'lucide-react';
import toast from 'react-hot-toast';
import { equipmentCheckService } from '@/modules/inventory/services/equipmentCheckApi';
import type {
  CheckLogEntry,
  FleetApparatusReadiness,
  SupplyExpiringItem,
} from '../../../modules/inventory/types/equipmentCheck';
import { CHECK_OUTCOME_LABELS, READINESS_LABELS } from '../../../modules/inventory/types/equipmentCheck';
import {
  OUTCOME_PILL,
  READINESS_PILL,
  READINESS_STRIPE,
  TIMING_LABELS,
  formatRate,
} from '../../../modules/inventory/utils/checkOutcome';
import CheckStrip from '../../../modules/inventory/components/CheckStrip';
import CheckLogPage from './CheckLogPage';
import ApparatusInventoryPage from './ApparatusInventoryPage';
import { formatCalendarDate } from '../../../utils/dateFormatting';
import { lastCheckLabel } from '../utils/lastCheckLabel';
import { useTimezone } from '../../../hooks/useTimezone';
import { getErrorMessage } from '../../../utils/errorHandling';
import { EmptyState } from '../../../components/ux';
import { useAuthStore } from '../../../stores/authStore';
import { useTablist } from '../../../hooks/useTablist';
import { OperationsPageHeader } from '../../../components/operations/OperationsPageHeader';

const TABS = [
  { id: 'checks', label: 'Checks' },
  { id: 'inventory', label: 'Inventory' },
  { id: 'findings', label: 'Findings' },
  { id: 'log', label: 'Check log' },
] as const;

type TabId = (typeof TABS)[number]['id'];

const isTabId = (value: string | null): value is TabId => TABS.some((t) => t.id === value);

export const ApparatusDetailPage: React.FC = () => {
  const tablist = useTablist();
  const { apparatusId = '' } = useParams<{ apparatusId: string }>();
  const navigate = useNavigate();
  const tz = useTimezone();
  const [searchParams, setSearchParams] = useSearchParams();
  // This page admits `scheduling.manage`, the supply worklist does not — its
  // endpoint takes `inventory.check_view` or `inventory.manage`. Linking it
  // unconditionally sent a shift officer to a page that refused them.
  const checkPermission = useAuthStore((state) => state.checkPermission);
  const canOpenSupply = checkPermission('inventory.check_view') || checkPermission('inventory.manage');

  const tabParam = searchParams.get('tab');
  const activeTab: TabId = isTabId(tabParam) ? tabParam : 'checks';

  const [unit, setUnit] = useState<FleetApparatusReadiness | null>(null);
  const [recent, setRecent] = useState<CheckLogEntry[]>([]);
  const [supply, setSupply] = useState<SupplyExpiringItem[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // The fleet endpoint already computes this rig's verdict, last check and
      // counts; asking it for one apparatus rather than adding a second
      // readiness path keeps the two views from ever disagreeing.
      const [fleet, log] = await Promise.all([
        equipmentCheckService.getFleetReadiness(),
        equipmentCheckService.getCheckLog({ dates: 14, apparatus_id: apparatusId }),
      ]);
      setUnit(fleet.apparatus.find((a) => a.apparatusId === apparatusId) ?? null);
      setRecent(log.entries);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to load apparatus'));
    } finally {
      setLoading(false);
    }
  }, [apparatusId]);

  useEffect(() => {
    void load();
  }, [load]);

  // Supply is only needed by the Findings tab, so it is not on the critical
  // path for opening the page.
  useEffect(() => {
    if (activeTab !== 'findings') return;
    void (async () => {
      try {
        const overview = await equipmentCheckService.getSupplyExpiringItems(30);
        setSupply(overview.items.filter((item: SupplyExpiringItem) => item.apparatusId === apparatusId));
      } catch (err: unknown) {
        toast.error(getErrorMessage(err, 'Failed to load supply items'));
      }
    })();
  }, [activeTab, apparatusId]);

  const setTab = (tab: TabId) => {
    const next = new URLSearchParams(searchParams);
    next.set('tab', tab);
    setSearchParams(next, { replace: true });
  };

  /** Checks on this rig in the current window, newest first. */
  const checksToday = useMemo(() => recent.filter((e) => e.status === 'due' || e.status === 'partial'), [recent]);

  /**
   * Each item found failing in the window, once — a radio that fails on every
   * check used to fill the tab with one card per check, each naming it again.
   * Entries arrive newest first, so the first sighting of an item is its last.
   * Counts what the log carries: the server lists up to five findings per
   * check, so an item past the fifth on one check is not counted for it.
   */
  const findings = useMemo(() => {
    const byItem = new Map<string, { item: string; count: number; last: CheckLogEntry }>();
    for (const entry of recent) {
      for (const item of entry.findings) {
        const seen = byItem.get(item);
        if (seen) seen.count += 1;
        else byItem.set(item, { item, count: 1, last: entry });
      }
    }
    return [...byItem.values()];
  }, [recent]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16" role="status" aria-live="polite">
        <Loader2 className="text-theme-text-muted h-6 w-6 animate-spin" aria-hidden="true" />
        <span className="text-theme-text-muted ml-2 text-sm">Loading apparatus...</span>
      </div>
    );
  }

  if (!unit) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-6">
        <EmptyState
          icon={Truck}
          title="Apparatus not found"
          description="This apparatus is not in the fleet, or you do not have access to it."
          actions={[{ label: 'Back to fleet', onClick: () => void navigate('/inventory/checklists') }]}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      {/* The verdict sits beside the unit in the title so the two read as one
          line; the card below keeps why, and the check strip gets its full
          width on a phone. */}
      <OperationsPageHeader
        icon={Truck}
        title={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            {/* The space makes the heading read as two words to a screen
                reader; flex does not draw it. */}
            <span className="font-mono tracking-tight">{unit.unitLabel}</span>{' '}
            <span
              className={`shrink-0 rounded-full border px-2.5 py-1 font-sans text-xs font-semibold tracking-normal ${READINESS_PILL[unit.readiness]}`}
            >
              {READINESS_LABELS[unit.readiness]}
            </span>
          </span>
        }
        breadcrumbLabel={unit.unitLabel}
        subtitle={
          <>
            {unit.name ? `${unit.name} · ` : ''}
            <span className="capitalize">{unit.apparatusType ?? 'Apparatus'}</span>
          </>
        }
      />

      <div
        className={`bg-theme-surface border-theme-surface-border rounded-lg border border-l-[3px] p-3 sm:p-4 ${
          READINESS_STRIPE[unit.readiness]
        }`}
      >
        <p className="text-theme-text-secondary flex items-start gap-1.5 text-sm">
          {unit.readiness === 'out_of_service' ? (
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400" aria-hidden="true" />
          ) : (
            <Wrench className="text-theme-text-muted mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          )}
          <span>
            {unit.readinessReason}
            {unit.statusReason ? ` — ${unit.statusReason}` : ''}
          </span>
        </p>

        <div className="mt-3">
          <CheckStrip entries={unit.recent} size="fill" />
        </div>
        <p className="text-theme-text-muted mt-1.5 text-xs">
          {[
            unit.lastCheckAt ? `Last check ${lastCheckLabel(unit.lastCheckAt, tz)}` : 'No checks recorded yet',
            unit.lastCheckAt ? unit.lastCheckByName : undefined,
            `${formatRate(unit.completionRate)} (${unit.completed} of ${unit.expected})`,
          ]
            .filter(Boolean)
            .join(' · ')}
        </p>
      </div>

      {/* Tabs — four equal columns so none is cut off at a phone's edge, and
          pinned under the app header there so a long inventory or log can
          switch sections without scrolling back up. The bar's height is
          handed down as `--sticky-stack`, so the headings those panels pin
          stop below it rather than under it. */}
      <div className="max-md:bg-theme-bg max-md:mobile-header-inset max-md:sticky max-md:z-20 max-md:-mx-4 max-md:px-4">
        <div
          className="border-theme-surface-border grid grid-cols-4 border-b md:flex md:gap-1"
          role="tablist"
          {...tablist}
          aria-label="Apparatus sections"
        >
          {TABS.map((tab) => {
            const count =
              tab.id === 'findings' ? unit.failedItemCount + unit.outOfServiceItemCount + unit.expiringItemCount : 0;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={activeTab === tab.id}
                onClick={() => setTab(tab.id)}
                className={`flex h-11 min-w-0 items-center justify-center border-b-2 px-1 text-sm font-medium whitespace-nowrap transition-colors md:shrink-0 md:px-3 ${
                  activeTab === tab.id
                    ? 'text-theme-text-primary border-red-800'
                    : 'text-theme-text-muted hover:text-theme-text-primary border-transparent'
                }`}
              >
                {tab.label}
                {count > 0 && (
                  <span className="ml-1 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800 dark:text-amber-400">
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Panels */}
      <div className="space-y-4 [--sticky-stack:2.75rem] md:[--sticky-stack:0px]">
        {activeTab === 'checks' && (
          <div className="space-y-3">
            {checksToday.length === 0 ? (
              <EmptyState
                icon={ClipboardList}
                title="Nothing outstanding"
                description="No check on this apparatus is due or half-finished right now."
              />
            ) : (
              <ul className="border-theme-surface-border bg-theme-surface divide-theme-surface-border divide-y overflow-hidden rounded-lg border">
                {checksToday.map((entry) => (
                  <li key={`${entry.shiftId}-${entry.templateId}`} className="flex items-center gap-3 px-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="text-theme-text-primary text-sm font-medium">{entry.templateName}</span>
                        <span
                          className={`rounded-full border px-1.5 py-0.5 text-[11px] font-semibold ${OUTCOME_PILL[entry.status]}`}
                        >
                          {CHECK_OUTCOME_LABELS[entry.status]}
                        </span>
                      </div>
                      <p className="text-theme-text-muted mt-0.5 text-xs">
                        {TIMING_LABELS[entry.checkTiming] ?? entry.checkTiming}
                        {entry.checkedByName ? ` · ${entry.checkedByName}` : ''}
                        {entry.totalItems ? ` · ${entry.completedItems ?? 0} of ${entry.totalItems} items` : ''}
                      </p>
                    </div>
                    {/* The check is run from the member's own checklist — this
                      page reports on the rig, it does not assign work — so the
                      button goes there with this shift brought to the top. A
                      member not on that shift's crew will not find it there,
                      which is why it does not say "Start". */}
                    <Link
                      to={`/inventory/checklists/my?shift=${encodeURIComponent(entry.shiftId)}`}
                      className="border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-hover touch:min-h-11 inline-flex shrink-0 items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors"
                    >
                      In my checklists
                      <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {activeTab === 'inventory' && <ApparatusInventoryPage apparatusId={apparatusId} />}

        {activeTab === 'findings' && (
          <div className="space-y-4">
            <section>
              <h2 className="text-theme-text-primary mb-2 text-sm font-semibold">Found on recent checks</h2>
              {findings.length === 0 ? (
                <p className="text-theme-text-muted card p-4 text-sm">
                  No failures recorded on this apparatus in the last 14 duty days.
                </p>
              ) : (
                <ul className="border-theme-surface-border bg-theme-surface divide-theme-surface-border divide-y overflow-hidden rounded-lg border border-l-[3px] border-l-amber-500">
                  {findings.map(({ item, count, last }) => (
                    <li key={item} className="flex items-start gap-3 px-3 py-2.5">
                      <div className="min-w-0 flex-1">
                        <p className="text-theme-text-primary text-sm font-medium">{item}</p>
                        <p className="text-theme-text-muted mt-0.5 text-xs">
                          {count > 1 ? `Found on ${count} checks · last ` : 'Found '}
                          {formatCalendarDate(last.shiftDate, { month: 'short', day: 'numeric' })}
                          {last.checkedByName ? ` by ${last.checkedByName}` : ''} · {last.templateName}
                        </p>
                      </div>
                      {count > 1 && (
                        <span className="shrink-0 rounded-full border border-amber-500/25 bg-amber-500/10 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800 tabular-nums dark:text-amber-400">
                          {count}&times;
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section>
              <h2 className="text-theme-text-primary mb-2 text-sm font-semibold">Expiring or short</h2>
              {supply.length === 0 ? (
                <p className="text-theme-text-muted card p-4 text-sm">
                  Nothing aboard this apparatus is expiring within 30 days or reported short.
                </p>
              ) : (
                <ul className="border-theme-surface-border bg-theme-surface divide-theme-surface-border divide-y overflow-hidden rounded-lg border">
                  {supply.map((item) => (
                    <li key={item.templateItemId} className="flex flex-wrap items-center gap-2 px-3 py-2.5">
                      <div className="min-w-0 flex-1">
                        <p className="text-theme-text-primary text-sm font-medium">{item.itemName}</p>
                        <p className="text-theme-text-muted text-xs">
                          {item.compartmentName}
                          {item.lotNumber ? ` · lot ${item.lotNumber}` : ''}
                        </p>
                      </div>
                      {item.isExpired ? (
                        <span className="rounded-full border border-red-500/25 bg-red-500/10 px-1.5 py-0.5 text-[11px] font-semibold text-red-700 dark:text-red-400">
                          Expired
                        </span>
                      ) : item.daysUntilExpiration !== undefined && item.daysUntilExpiration !== null ? (
                        <span className="rounded-full border border-amber-500/25 bg-amber-500/10 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800 dark:text-amber-400">
                          {item.daysUntilExpiration} d
                        </span>
                      ) : null}
                      {item.restockNeeded && (
                        <span className="rounded-full border border-amber-500/25 bg-amber-500/10 px-1.5 py-0.5 text-[11px] font-semibold text-amber-800 dark:text-amber-400">
                          Needs restock
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {canOpenSupply && (
                <Link
                  to="/inventory/admin/checklists/supply"
                  className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-700"
                >
                  <PackageX className="h-3.5 w-3.5" aria-hidden="true" />
                  Open the supply worklist
                </Link>
              )}
            </section>
          </div>
        )}

        {activeTab === 'log' && <CheckLogPage apparatusId={apparatusId} showHeader={false} />}
      </div>
    </div>
  );
};

export default ApparatusDetailPage;
