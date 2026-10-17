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
  Info,
  PackageX,
  Settings,
  ShieldCheck,
  Truck,
  Wrench,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { equipmentCheckService } from '@/modules/inventory/services/equipmentCheckApi';
import type {
  FleetApparatusReadiness,
  FleetReadinessResponse,
  Readiness,
} from '../../../modules/inventory/types/equipmentCheck';
import type { ActiveChecklistRecord } from '../services/equipmentCheckApi';
import { READINESS_LABELS, isChecklistSubmitted } from '../../../modules/inventory/types/equipmentCheck';
import {
  OUTCOME_LEGEND,
  OUTCOME_SWATCH,
  READINESS_PILL,
  READINESS_STRIPE,
  formatRate,
} from '../../../modules/inventory/utils/checkOutcome';
import CheckStrip from '../../../modules/inventory/components/CheckStrip';
import { calendarDaysFromToday, formatDateTime } from '../../../utils/dateFormatting';
import { lastCheckLabel } from '../utils/lastCheckLabel';
import { useTimezone } from '../../../hooks/useTimezone';
import { getErrorMessage } from '../../../utils/errorHandling';
import { useAuthStore } from '../../../stores/authStore';
import { useRegisterPullToRefresh } from '../../../hooks/useRegisterPullToRefresh';
import { SkeletonCardGrid } from '../../../components/ux';
import { ScrollCueRow } from '../../../components/ux/ScrollCueRow';
import { OperationsPageHeader } from '../../../components/operations/OperationsPageHeader';
import { Modal } from '../../../components/Modal';

/** How late a checklist is, as a phrase rather than a signed number. */
const lateness = (days: number | null): { label: string; overdue: boolean } => {
  if (days === null) return { label: '', overdue: false };
  if (days === 0) return { label: 'due today', overdue: false };
  if (days === 1) return { label: 'due tomorrow', overdue: false };
  if (days > 1) return { label: `due in ${days} days`, overdue: false };
  if (days === -1) return { label: '1 day overdue', overdue: true };
  return { label: `${Math.abs(days)} days overdue`, overdue: true };
};

/** A summary chip narrows the board to one readiness, or to rigs carrying expiring stock. */
type BoardFilter = 'all' | Readiness | 'expiring';

const matchesFilter = (unit: FleetApparatusReadiness, filter: BoardFilter): boolean =>
  filter === 'all' ? true : filter === 'expiring' ? unit.expiringItemCount > 0 : unit.readiness === filter;

export const FleetBoardPage: React.FC = () => {
  const tz = useTimezone();
  const { checkPermission } = useAuthStore();
  // The links this gates all open the checklist admin console, whose route
  // requires `inventory.check_manage`. It used to accept `scheduling.manage`
  // too, from when they pointed at a signpost card inside Scheduling Settings —
  // which meant a checklist officer holding only the check grant was shown a
  // link that refused them, and now would mean a scheduling officer without it
  // is. A control is offered to whoever its destination admits, and nobody else.
  const canManage = checkPermission('inventory.check_manage');
  // This board admits `scheduling.manage`, the supply worklist does not — its
  // endpoint takes `inventory.check_view` or `inventory.manage`. Linking it
  // unconditionally sent a shift officer to a page that refused them.
  const canOpenSupply = checkPermission('inventory.check_view') || checkPermission('inventory.manage');

  const [fleet, setFleet] = useState<FleetReadinessResponse | null>(null);
  const [mine, setMine] = useState<ActiveChecklistRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<BoardFilter>('all');
  const [legendOpen, setLegendOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      // The member's own checklists come from the endpoint that already
      // resolves them by position; the board does not re-derive that.
      const [readiness, checklists] = await Promise.all([
        equipmentCheckService.getFleetReadiness(),
        equipmentCheckService.getMyChecklists(),
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

  /** Checks owed now, worst first — the strip only ever shows what is late or due.
   *  A filed check is not owed, whatever its date: My Checklists already says
   *  "Submitted for this shift" for it, and this strip must not disagree. */
  const owed = useMemo(() => {
    return mine
      .filter((c) => !isChecklistSubmitted(c.status))
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
  // Counts are the server's totals (CLAUDE.md #29), not a re-count of the
  // list; the filter only decides which cards show. A chip whose count fell to
  // zero on refresh drops out, and a filter left pointing at it falls back.
  const allChips: BoardChip[] = totals
    ? [
        { key: 'all', count: apparatus.length, label: 'apparatus', tone: '' },
        { key: 'out_of_service', count: totals.outOfService, label: 'out of service', tone: CHIP_TONES.crit },
        { key: 'attention', count: totals.attention, label: 'need attention', tone: CHIP_TONES.warn },
        { key: 'no_checks', count: totals.noChecks, label: 'no checks yet', tone: '' },
        { key: 'in_service', count: totals.inService, label: 'in service', tone: CHIP_TONES.ok },
        {
          key: 'expiring',
          count: apparatus.filter((unit) => unit.expiringItemCount > 0).length,
          label: `with items expiring ≤ ${fleet?.expiringWindowDays ?? 30} days`,
          tone: CHIP_TONES.warn,
        },
      ]
    : [];
  const chips = allChips.filter((chip) => chip.key === 'all' || chip.count > 0);
  const activeFilter: BoardFilter = chips.some((chip) => chip.key === filter) ? filter : 'all';
  const visible = apparatus.filter((unit) => matchesFilter(unit, activeFilter));

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <OperationsPageHeader
        icon={ShieldCheck}
        title="Fleet Readiness"
        subtitle={fleet ? `As of ${formatDateTime(fleet.generatedAt, tz)}` : undefined}
        actions={
          <>
            <Link to="/inventory/checklists/log" className="btn-secondary inline-flex items-center gap-1.5">
              <ClipboardList className="h-4 w-4" aria-hidden="true" />
              Check log
            </Link>
            {canOpenSupply && (
              <Link to="/inventory/admin/checklists/supply" className="btn-secondary inline-flex items-center gap-1.5">
                <PackageX className="h-4 w-4" aria-hidden="true" />
                Supply
              </Link>
            )}
            {canManage && (
              <Link to="/inventory/admin/checklists" className="btn-secondary inline-flex items-center gap-1.5">
                <Settings className="h-4 w-4" aria-hidden="true" />
                Templates
              </Link>
            )}
          </>
        }
      />

      {/* Your own checks — the reason most people open this page.

          A link now, not an in-place swap: the scheduling tab that used to
          host both views is gone, and an officer's own checklists have a route
          of their own. */}
      {owed.length > 0 && (
        <Link
          to="/inventory/checklists/my"
          className={`bg-theme-surface hover:bg-theme-surface-hover flex w-full items-center gap-3 rounded-lg border border-l-[3px] p-3 text-left transition-colors ${
            overdueCount > 0 ? 'border-l-red-500' : 'border-l-blue-500'
          } border-theme-surface-border`}
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
          <span className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white">
            Open mine
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </span>
        </Link>
      )}

      {/* Fleet summary. Chips rather than a 2x2 of tiles: on a phone the
          tiles took a third of the first screen to say what the cards below
          already said, and they could not take you to the rigs they counted. */}
      {totals && apparatus.length > 0 && (
        <div className="flex items-center gap-2">
          {/* ScrollCueRow renders its own outer box; it is that box which
              has to be allowed to shrink, or the chips widen the whole page. */}
          <div className="min-w-0 flex-1">
            <ScrollCueRow className="flex gap-2" data-mobile-scroll-region role="group" aria-label="Filter apparatus">
              {chips.map(({ key, count, label, tone }) => {
                const active = activeFilter === key;
                return (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setFilter(active || key === 'all' ? 'all' : key)}
                    className={`touch-target-phone flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-medium whitespace-nowrap transition-colors ${
                      active
                        ? 'border-theme-text-primary bg-theme-surface-secondary text-theme-text-primary'
                        : `border-theme-surface-border hover:bg-theme-surface-hover ${tone || 'text-theme-text-muted'}`
                    }`}
                  >
                    <span className="font-bold tabular-nums">{count}</span> {label}
                  </button>
                );
              })}
            </ScrollCueRow>
          </div>
          <button
            type="button"
            onClick={() => setLegendOpen(true)}
            className="btn-icon text-theme-text-muted hover:text-theme-text-primary shrink-0"
            aria-label="What the coloured squares mean"
            title="What the coloured squares mean"
          >
            <Info className="h-4 w-4" aria-hidden="true" />
          </button>
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
              to="/inventory/admin/checklists"
              className="mt-3 inline-block text-sm font-medium text-blue-600 hover:text-blue-700"
            >
              Set up check templates
            </Link>
          )}
        </div>
      ) : (
        <>
          <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
            {visible.map((unit) => (
              <ApparatusCard key={unit.apparatusId} unit={unit} tz={tz} />
            ))}
          </div>
          <Modal isOpen={legendOpen} onClose={() => setLegendOpen(false)} title="Reading the check strip" size="sm">
            <p className="text-theme-text-secondary mb-3 text-sm">
              Each square is one of the last {fleet?.stripDates ?? 7} duty days, oldest on the left.
            </p>
            <ul className="space-y-2 text-sm">
              {OUTCOME_LEGEND.map(({ status, label }) => (
                <li key={status} className="text-theme-text-primary flex items-center gap-2.5">
                  <span className={`h-3.5 w-3.5 shrink-0 rounded-[3px] ${OUTCOME_SWATCH[status]}`} aria-hidden="true" />
                  {label}
                </li>
              ))}
            </ul>
          </Modal>
        </>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------

interface BoardChip {
  key: BoardFilter;
  count: number;
  label: string;
  tone: string;
}

const CHIP_TONES = {
  ok: 'text-green-700 dark:text-green-400',
  warn: 'text-amber-700 dark:text-amber-400',
  crit: 'text-red-700 dark:text-red-400',
};

/** "7:10 AM" for a check made today, "Oct 13, 7:10 AM" otherwise. */

/**
 * One apparatus. Compact on purpose: at a quarter of a phone screen each, a
 * five-rig station took three screens to scan, and most of the height went on
 * zero counts. A count is shown only when it is not zero; completion always is.
 */
const ApparatusCard: React.FC<{ unit: FleetApparatusReadiness; tz: string }> = ({ unit, tz }) => {
  const findings = unit.failedItemCount + unit.outOfServiceItemCount;
  const counts = [
    findings > 0 && { text: `${findings} ${findings === 1 ? 'finding' : 'findings'}`, tone: 'warn' },
    unit.expiringItemCount > 0 && { text: `${unit.expiringItemCount} expiring`, tone: 'warn' },
    unit.overdueCount > 0 && { text: `${unit.overdueCount} missed`, tone: 'crit' },
  ].filter((entry): entry is { text: string; tone: string } => Boolean(entry));

  return (
    <Link
      to={`/inventory/checklists/apparatus/${unit.apparatusId}`}
      className={`bg-theme-surface border-theme-surface-border hover:bg-theme-surface-hover block space-y-1.5 rounded-lg border border-l-[3px] px-3 py-2.5 transition-colors ${
        READINESS_STRIPE[unit.readiness]
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 truncate">
          <span className="text-theme-text-primary font-mono text-base font-bold tracking-tight">{unit.unitLabel}</span>
          {unit.apparatusType && (
            <span className="text-theme-text-muted ml-2 text-xs capitalize">{unit.apparatusType}</span>
          )}
        </p>
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
      <p className="text-theme-text-secondary flex items-start gap-1.5 text-xs">
        {unit.readiness === 'out_of_service' ? (
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-red-600 dark:text-red-400" aria-hidden="true" />
        ) : unit.readiness === 'attention' ? (
          <Wrench className="mt-0.5 h-3 w-3 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden="true" />
        ) : (
          <ClipboardCheck className="text-theme-text-muted mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
        )}
        <span>{unit.readinessReason}</span>
      </p>

      <div className="flex items-center gap-2">
        <CheckStrip entries={unit.recent} />
        <p className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-x-2 text-xs tabular-nums">
          {counts.map(({ text, tone }) => (
            <span key={text} className={`font-semibold ${METRIC_TONES[tone] ?? ''}`}>
              {text}
            </span>
          ))}
          <span className="text-theme-text-primary font-semibold" title="Checks completed when owed">
            {formatRate(unit.completionRate)}
          </span>
        </p>
        <ChevronRight className="text-theme-text-muted h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      </div>

      <p className="text-theme-text-muted text-[11px]">
        {unit.lastCheckAt
          ? `Last check ${lastCheckLabel(unit.lastCheckAt, tz)}${
              unit.lastCheckByName ? ` · ${unit.lastCheckByName}` : ''
            }`
          : 'No checks recorded yet'}
      </p>
    </Link>
  );
};

const METRIC_TONES: Record<string, string> = {
  warn: 'text-amber-700 dark:text-amber-400',
  crit: 'text-red-700 dark:text-red-400',
};

export default FleetBoardPage;
