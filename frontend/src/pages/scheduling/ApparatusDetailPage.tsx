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
import { AlertTriangle, ArrowLeft, ClipboardList, Loader2, PackageX, Truck, Wrench } from 'lucide-react';
import toast from 'react-hot-toast';
import { equipmentCheckService } from '@/modules/inventory/services/equipmentCheckApi';
import type {
  CheckLogEntry,
  FleetApparatusReadiness,
  SupplyExpiringItem,
} from '../../modules/scheduling/types/equipmentCheck';
import { CHECK_OUTCOME_LABELS, READINESS_LABELS } from '../../modules/scheduling/types/equipmentCheck';
import {
  OUTCOME_PILL,
  READINESS_PILL,
  READINESS_STRIPE,
  TIMING_LABELS,
  formatRate,
} from '../../modules/scheduling/utils/checkOutcome';
import CheckStrip from '../../modules/scheduling/components/CheckStrip';
import CheckLogPage from './CheckLogPage';
import ApparatusInventoryPage from './ApparatusInventoryPage';
import { formatCalendarDate, formatDateTime } from '../../utils/dateFormatting';
import { useTimezone } from '../../hooks/useTimezone';
import { getErrorMessage } from '../../utils/errorHandling';
import { EmptyState } from '../../components/ux';

const TABS = [
  { id: 'checks', label: 'Checks' },
  { id: 'inventory', label: 'Inventory' },
  { id: 'findings', label: 'Findings' },
  { id: 'log', label: 'Check log' },
] as const;

type TabId = (typeof TABS)[number]['id'];

const isTabId = (value: string | null): value is TabId => TABS.some((t) => t.id === value);

export const ApparatusDetailPage: React.FC = () => {
  const { apparatusId = '' } = useParams<{ apparatusId: string }>();
  const navigate = useNavigate();
  const tz = useTimezone();
  const [searchParams, setSearchParams] = useSearchParams();

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

  const findings = useMemo(() => recent.filter((e) => e.findingCount > 0).slice(0, 10), [recent]);

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
          actions={[{ label: 'Back to fleet', onClick: () => void navigate('/scheduling/equipment') }]}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl space-y-4 px-4 py-6">
      {/* Header */}
      <div
        className={`bg-theme-surface border-theme-surface-border rounded-lg border border-l-[3px] p-4 ${
          READINESS_STRIPE[unit.readiness]
        }`}
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-2">
            <Link
              to="/scheduling/equipment"
              className="text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover mt-0.5 shrink-0 rounded-lg p-1.5 transition-colors"
              aria-label="Back to fleet"
            >
              <ArrowLeft className="h-5 w-5" aria-hidden="true" />
            </Link>
            <div className="min-w-0">
              <h1 className="text-theme-text-primary font-mono text-2xl font-bold tracking-tight">{unit.unitLabel}</h1>
              <p className="text-theme-text-muted text-sm">
                {unit.name ? `${unit.name} · ` : ''}
                <span className="capitalize">{unit.apparatusType ?? 'Apparatus'}</span>
              </p>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${READINESS_PILL[unit.readiness]}`}>
              {READINESS_LABELS[unit.readiness]}
            </span>
            <CheckStrip entries={unit.recent} size="md" />
          </div>
        </div>

        <p className="text-theme-text-secondary mt-3 flex items-start gap-1.5 text-sm">
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

        <div className="text-theme-text-muted mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
          <span>
            {unit.lastCheckAt
              ? `Last check ${formatDateTime(unit.lastCheckAt, tz)}${
                  unit.lastCheckByName ? ` · ${unit.lastCheckByName}` : ''
                }`
              : 'No checks recorded yet'}
          </span>
          <span>
            {formatRate(unit.completionRate)} completed ({unit.completed} of {unit.expected})
          </span>
        </div>
      </div>

      {/* Tabs */}
      <div className="tab-scroll" role="tablist" aria-label="Apparatus sections">
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
              className={`shrink-0 border-b-2 px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors ${
                activeTab === tab.id
                  ? 'border-blue-600 text-blue-600'
                  : 'text-theme-text-muted hover:text-theme-text-primary border-transparent'
              }`}
            >
              {tab.label}
              {count > 0 && (
                <span className="ml-1.5 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-400">
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Panels */}
      {activeTab === 'checks' && (
        <div className="space-y-3">
          {checksToday.length === 0 ? (
            <EmptyState
              icon={ClipboardList}
              title="Nothing outstanding"
              description="No check on this apparatus is due or half-finished right now."
            />
          ) : (
            checksToday.map((entry) => (
              <div
                key={`${entry.shiftId}-${entry.templateId}`}
                className="bg-theme-surface border-theme-surface-border flex flex-wrap items-center gap-3 rounded-lg border p-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-theme-text-primary text-sm font-medium">{entry.templateName}</p>
                  <p className="text-theme-text-muted text-xs">
                    {TIMING_LABELS[entry.checkTiming] ?? entry.checkTiming}
                    {entry.checkedByName ? ` · ${entry.checkedByName}` : ''}
                    {entry.totalItems ? ` · ${entry.completedItems ?? 0} of ${entry.totalItems} items` : ''}
                  </p>
                </div>
                <span
                  className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${OUTCOME_PILL[entry.status]}`}
                >
                  {CHECK_OUTCOME_LABELS[entry.status]}
                </span>
              </div>
            ))
          )}
          {/* The check itself is opened from the member's own checklist — this
              page reports on the rig, it does not assign work. */}
          <p className="text-theme-text-muted text-xs">
            To run a check, open it from{' '}
            <Link to="/scheduling?tab=equipment-checks" className="text-blue-600 hover:text-blue-700">
              your checklists
            </Link>
            .
          </p>
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
              <div className="space-y-2">
                {findings.map((entry) => (
                  <div
                    key={`${entry.shiftId}-${entry.templateId}`}
                    className="bg-theme-surface border-theme-surface-border rounded-lg border border-l-[3px] border-l-amber-500 p-3"
                  >
                    <p className="text-theme-text-primary text-sm font-medium">{entry.findings.join(', ')}</p>
                    <p className="text-theme-text-muted mt-0.5 text-xs">
                      {entry.templateName} · {formatCalendarDate(entry.shiftDate, { month: 'short', day: 'numeric' })}
                      {entry.checkedByName ? ` · found by ${entry.checkedByName}` : ''}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section>
            <h2 className="text-theme-text-primary mb-2 text-sm font-semibold">Expiring or short</h2>
            {supply.length === 0 ? (
              <p className="text-theme-text-muted card p-4 text-sm">
                Nothing aboard this apparatus is expiring within 30 days or reported short.
              </p>
            ) : (
              <div className="space-y-2">
                {supply.map((item) => (
                  <div
                    key={item.templateItemId}
                    className="bg-theme-surface border-theme-surface-border flex flex-wrap items-center gap-2 rounded-lg border p-3"
                  >
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
                      <span className="rounded-full border border-amber-500/25 bg-amber-500/10 px-1.5 py-0.5 text-[11px] font-semibold text-amber-700 dark:text-amber-400">
                        {item.daysUntilExpiration} d
                      </span>
                    ) : null}
                    {item.restockNeeded && (
                      <span className="rounded-full border border-amber-500/25 bg-amber-500/10 px-1.5 py-0.5 text-[11px] font-semibold text-amber-700 dark:text-amber-400">
                        Needs restock
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}
            <Link
              to="/scheduling/supply/expiring"
              className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-700"
            >
              <PackageX className="h-3.5 w-3.5" aria-hidden="true" />
              Open the supply worklist
            </Link>
          </section>
        </div>
      )}

      {activeTab === 'log' && <CheckLogPage apparatusId={apparatusId} showHeader={false} />}
    </div>
  );
};

export default ApparatusDetailPage;
