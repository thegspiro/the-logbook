/**
 * Fleet Board — the front door for equipment checks.
 *
 * The page is organised around the apparatus rather than the checklist
 * assignment, because "is E-1 good?" is the question an officer actually
 * arrives with and the old checklist grid could not answer it: a truck's
 * state was spread across several cards, a separate inventory page and an
 * admin-only report.
 *
 * A member's own due checks stay on the page — they are the reason most
 * people open it — but as one strip at the top rather than the whole body,
 * and ranked so an overdue check cannot look like one due next Tuesday.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import {
  AlertTriangle,
  ArrowRight,
  ChevronRight,
  ClipboardCheck,
  ClipboardList,
  PackageX,
  Settings,
  Truck,
  Wrench,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { schedulingService } from '../../modules/scheduling/services/api';
import type { FleetApparatusReadiness, FleetReadinessResponse } from '../../modules/scheduling/types/equipmentCheck';
import type { ActiveChecklistRecord } from '../../modules/scheduling/services/api';
import { READINESS_LABELS } from '../../modules/scheduling/types/equipmentCheck';
import {
  OUTCOME_LEGEND,
  OUTCOME_SWATCH,
  READINESS_PILL,
  READINESS_STRIPE,
  formatRate,
} from '../../modules/scheduling/utils/checkOutcome';
import CheckStrip from '../../modules/scheduling/components/CheckStrip';
import { calendarDaysFromToday, formatDateTime } from '../../utils/dateFormatting';
import { useTimezone } from '../../hooks/useTimezone';
import { getErrorMessage } from '../../utils/errorHandling';
import { useAuthStore } from '../../stores/authStore';
import { useRegisterPullToRefresh } from '../../hooks/useRegisterPullToRefresh';
import { SkeletonCardGrid } from '../../components/ux';

interface FleetBoardPageProps {
  /**
   * Opens the member's own checklist view. Supplied by the scheduling tab,
   * which can swap the body in place; absent on the standalone route, where
   * the strip is informational rather than a button.
   */
  onOpenMyChecks?: () => void;
}

/** How late a checklist is, as a phrase rather than a signed number. */
const lateness = (days: number | null): { label: string; overdue: boolean } => {
  if (days === null) return { label: '', overdue: false };
  if (days === 0) return { label: 'due today', overdue: false };
  if (days === 1) return { label: 'due tomorrow', overdue: false };
  if (days > 1) return { label: `due in ${days} days`, overdue: false };
  if (days === -1) return { label: '1 day overdue', overdue: true };
  return { label: `${Math.abs(days)} days overdue`, overdue: true };
};

export const FleetBoardPage: React.FC<FleetBoardPageProps> = ({ onOpenMyChecks }) => {
  const tz = useTimezone();
  const { checkPermission } = useAuthStore();
  const canManage = checkPermission('scheduling.manage') || checkPermission('inventory.check_manage');

  const [fleet, setFleet] = useState<FleetReadinessResponse | null>(null);
  const [mine, setMine] = useState<ActiveChecklistRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      // The member's own checklists come from the endpoint that already
      // resolves them by position; the board does not re-derive that.
      const [readiness, checklists] = await Promise.all([
        schedulingService.getFleetReadiness(),
        schedulingService.getMyChecklists(),
      ]);
      setFleet(readiness);
      setMine(checklists);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to load fleet readiness'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useRegisterPullToRefresh(load);

  /** Checks owed now, worst first — the strip only ever shows what is late or due. */
  const owed = useMemo(() => {
    return mine
      .map((c) => ({ checklist: c, days: calendarDaysFromToday(c.shiftDate, tz) }))
      .filter(({ days }) => days !== null && days <= 0)
      .sort((a, b) => (a.days ?? 0) - (b.days ?? 0));
  }, [mine, tz]);

  const overdueCount = owed.filter(({ days }) => (days ?? 0) < 0).length;
  const inProgress = mine.filter((c) => c.status === 'in_progress' || c.status === 'incomplete').length;

  if (loading) {
    return (
      <div className="space-y-4">
        <SkeletonCardGrid count={4} />
      </div>
    );
  }

  const totals = fleet?.totals;
  const apparatus = fleet?.apparatus ?? [];

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3">
          <Truck className="text-theme-text-primary h-6 w-6 shrink-0" aria-hidden="true" />
          <div>
            <h1 className="text-theme-text-primary text-xl font-bold">Equipment &amp; Readiness</h1>
            {fleet && <p className="text-theme-text-muted text-xs">As of {formatDateTime(fleet.generatedAt, tz)}</p>}
          </div>
        </div>
        <div className="hscroll flex items-center gap-2">
          <Link
            to="/scheduling/equipment/checks"
            className="border-theme-surface-border bg-theme-surface text-theme-text-secondary hover:bg-theme-surface-hover inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors"
          >
            <ClipboardList className="h-3.5 w-3.5" aria-hidden="true" />
            Check log
          </Link>
          <Link
            to="/scheduling/supply/expiring"
            className="border-theme-surface-border bg-theme-surface text-theme-text-secondary hover:bg-theme-surface-hover inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors"
          >
            <PackageX className="h-3.5 w-3.5" aria-hidden="true" />
            Supply
          </Link>
          {canManage && (
            <Link
              to="/scheduling/settings?tab=equipment"
              className="border-theme-surface-border bg-theme-surface text-theme-text-secondary hover:bg-theme-surface-hover inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors"
            >
              <Settings className="h-3.5 w-3.5" aria-hidden="true" />
              Templates
            </Link>
          )}
        </div>
      </div>

      {/* Your own checks — the reason most people open this page */}
      {owed.length > 0 && (
        <button
          type="button"
          onClick={onOpenMyChecks}
          disabled={!onOpenMyChecks}
          className={`bg-theme-surface flex w-full items-center gap-3 rounded-lg border border-l-[3px] p-3 text-left transition-colors ${
            overdueCount > 0 ? 'border-l-red-500' : 'border-l-blue-500'
          } border-theme-surface-border ${
            onOpenMyChecks ? 'hover:bg-theme-surface-hover cursor-pointer' : 'cursor-default'
          }`}
        >
          <div className="min-w-0 flex-1">
            <p className="text-theme-text-primary text-sm font-semibold">
              {owed.length === 1 ? 'You have 1 check waiting' : `You have ${owed.length} checks waiting`}
            </p>
            <div className="text-theme-text-muted mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
              {overdueCount > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full border border-red-500/25 bg-red-500/10 px-1.5 py-0.5 font-semibold text-red-700 dark:text-red-400">
                  {overdueCount} overdue
                </span>
              )}
              {inProgress > 0 && <span>{inProgress} in progress</span>}
              <span className="truncate">
                {owed
                  .slice(0, 3)
                  .map(({ checklist, days }) => {
                    const { label } = lateness(days);
                    return `${checklist.apparatusName} ${checklist.templateName} (${label})`;
                  })
                  .join(' · ')}
                {owed.length > 3 ? ` · +${owed.length - 3} more` : ''}
              </span>
            </div>
          </div>
          {onOpenMyChecks && (
            <span className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white">
              Open mine
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </span>
          )}
        </button>
      )}

      {/* Fleet summary band */}
      {totals && apparatus.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <SummaryTile label="In service" value={totals.inService} tone="ok" />
          <SummaryTile label="Needs attention" value={totals.attention} tone="warn" />
          <SummaryTile label="Out of service" value={totals.outOfService} tone="crit" />
          <SummaryTile
            label={`Expiring ≤ ${fleet?.expiringWindowDays ?? 30} days`}
            value={totals.expiringItems}
            tone="warn"
          />
        </div>
      )}

      {/* The board */}
      {apparatus.length === 0 ? (
        <div className="border-theme-surface-border bg-theme-surface rounded-lg border p-8 text-center">
          <Truck className="text-theme-text-muted mx-auto h-10 w-10" aria-hidden="true" />
          <p className="text-theme-text-muted mt-3 text-sm">
            No apparatus found. Add apparatus to the fleet and configure check templates to see readiness here.
          </p>
          {canManage && (
            <Link
              to="/scheduling/settings?tab=equipment"
              className="mt-3 inline-block text-sm font-medium text-blue-600 hover:text-blue-700"
            >
              Set up check templates
            </Link>
          )}
        </div>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {apparatus.map((unit) => (
              <ApparatusCard key={unit.apparatusId} unit={unit} tz={tz} />
            ))}
          </div>
          <div className="text-theme-text-muted flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs">
            <span>Last {fleet?.stripDates ?? 7} duty days:</span>
            {OUTCOME_LEGEND.map(({ status, label }) => (
              <span key={status} className="inline-flex items-center gap-1.5">
                <span className={`h-2.5 w-2.5 rounded-[2px] ${OUTCOME_SWATCH[status]}`} aria-hidden="true" />
                {label}
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------

const TILE_TONES: Record<string, string> = {
  ok: 'border-l-green-500 text-green-700 dark:text-green-400',
  warn: 'border-l-amber-500 text-amber-700 dark:text-amber-400',
  crit: 'border-l-red-500 text-red-700 dark:text-red-400',
};

const SummaryTile: React.FC<{ label: string; value: number; tone: 'ok' | 'warn' | 'crit' }> = ({
  label,
  value,
  tone,
}) => (
  <div
    className={`border-theme-surface-border bg-theme-surface rounded-lg border border-l-[3px] px-3 py-2 ${
      TILE_TONES[tone] ?? ''
    }`}
  >
    <p className="text-xl leading-tight font-bold tabular-nums">{value}</p>
    <p className="text-theme-text-muted text-[11px]">{label}</p>
  </div>
);

const ApparatusCard: React.FC<{ unit: FleetApparatusReadiness; tz: string }> = ({ unit, tz }) => {
  const findings = unit.failedItemCount + unit.outOfServiceItemCount;

  return (
    <Link
      to={`/scheduling/equipment/${unit.apparatusId}`}
      className={`bg-theme-surface border-theme-surface-border hover:bg-theme-surface-hover block rounded-lg border border-l-[3px] p-3.5 transition-colors ${
        READINESS_STRIPE[unit.readiness]
      }`}
    >
      <div className="mb-1.5 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-theme-text-primary font-mono text-base font-bold tracking-tight">{unit.unitLabel}</p>
          {unit.apparatusType && <p className="text-theme-text-muted text-[11px] capitalize">{unit.apparatusType}</p>}
        </div>
        <span
          className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
            READINESS_PILL[unit.readiness]
          }`}
        >
          {READINESS_LABELS[unit.readiness]}
        </span>
      </div>

      {/* The reason always travels with the verdict — the pill is a claim the
          app is making, and an officer who disagrees needs to see what drove it. */}
      <p className="text-theme-text-secondary mb-2 flex items-start gap-1.5 text-xs">
        {unit.readiness === 'out_of_service' ? (
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-red-600 dark:text-red-400" aria-hidden="true" />
        ) : unit.readiness === 'attention' ? (
          <Wrench className="mt-0.5 h-3 w-3 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
        ) : (
          <ClipboardCheck className="text-theme-text-muted mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
        )}
        <span>{unit.readinessReason}</span>
      </p>

      <p className="text-theme-text-muted mb-2.5 text-[11px]">
        {unit.lastCheckAt
          ? `Last check ${formatDateTime(unit.lastCheckAt, tz)}${
              unit.lastCheckByName ? ` · ${unit.lastCheckByName}` : ''
            }`
          : 'No checks recorded yet'}
      </p>

      <div className="mb-2.5 flex gap-4">
        <Metric value={findings} label={findings === 1 ? 'finding' : 'findings'} tone={findings > 0 ? 'warn' : ''} />
        <Metric value={unit.expiringItemCount} label="expiring" tone={unit.expiringItemCount > 0 ? 'warn' : ''} />
        <Metric value={unit.overdueCount} label="missed" tone={unit.overdueCount > 0 ? 'crit' : ''} />
        <div className="ml-auto text-right">
          <p className="text-theme-text-primary text-sm leading-tight font-semibold tabular-nums">
            {formatRate(unit.completionRate)}
          </p>
          <p className="text-theme-text-muted text-[10px]">completed</p>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <CheckStrip entries={unit.recent} />
        <ChevronRight className="text-theme-text-muted h-3.5 w-3.5" aria-hidden="true" />
      </div>
    </Link>
  );
};

const METRIC_TONES: Record<string, string> = {
  warn: 'text-amber-700 dark:text-amber-400',
  crit: 'text-red-700 dark:text-red-400',
};

const Metric: React.FC<{ value: number; label: string; tone?: string }> = ({ value, label, tone }) => (
  <div>
    <p
      className={`text-sm leading-tight font-semibold tabular-nums ${METRIC_TONES[tone ?? ''] ?? 'text-theme-text-primary'}`}
    >
      {value}
    </p>
    <p className="text-theme-text-muted text-[10px]">{label}</p>
  </div>
);

export default FleetBoardPage;
