/**
 * Compliance Matrix Tab (TC2)
 *
 * A triage queue rather than a grid. The member × requirement table it
 * replaced could be read but not worked: it said who was short without saying
 * by how much, and offered nowhere to go next. This view groups members by
 * standing, orders the queue worst-first, and steps through it one at a time,
 * with the numbers behind each status on the row.
 *
 * Arrives filtered when linked from the dashboard's non-compliant widget
 * (`?status=noncompliant`); the chip in the meta bar says so and clears it.
 *
 * Lazy-loaded as a tab in TrainingAdminPage.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import {
  AlertTriangle,
  CalendarCheck,
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  Info,
  Printer,
  Search,
} from 'lucide-react';
import { trainingService } from '../services/api';
import type { ComplianceMatrix } from '../services/api';
import { useTimezone } from '../hooks/useTimezone';
import { formatCalendarDate, formatShortDateTime } from '../utils/dateFormatting';
import { buildCsv, downloadCsv } from '../utils/csv';
import { EmptyState } from '../components/ux/EmptyState';
import { SkeletonPage } from '../components/ux/Skeleton';
import {
  CellTone,
  Standing,
  cellFor,
  evaluateMatrix,
  rankMembers,
  requirementMeta,
  requirementStanding,
  rollUpRequirements,
} from './training/complianceMatrixModel';
import type { EvaluatedCell, EvaluatedMember, RequirementRollup } from './training/complianceMatrixModel';

type Axis = 'members' | 'requirements';
type Sort = 'worst' | 'az';

/** A rail entry — a member or a requirement, reduced to what the rail draws. */
interface QueueItem {
  id: string;
  title: string;
  sub: string;
  badge: string;
  pips: CellTone[];
  standing: Standing;
}

interface QueueGroup {
  key: string;
  label: string;
  standing: Standing;
  items: QueueItem[];
}

/**
 * Tone classes, one string per cell state.
 *
 * Kept as complete class strings rather than assembled from parts: Tailwind
 * scans source text, and a class built by interpolation is not in the build.
 */
const TONE_CLASSES: Record<CellTone, { pill: string; bar: string; pip: string }> = {
  [CellTone.MET]: {
    pill: 'border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-300',
    bar: 'bg-green-600 dark:bg-green-400',
    pip: 'bg-green-600 dark:bg-green-400',
  },
  [CellTone.SHORT]: {
    pill: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
    bar: 'bg-amber-500 dark:bg-amber-400',
    pip: 'bg-amber-500 dark:bg-amber-400',
  },
  [CellTone.SOON]: {
    pill: 'border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-300',
    bar: 'bg-orange-500 dark:bg-orange-400',
    pip: 'bg-orange-500 dark:bg-orange-400',
  },
  [CellTone.LAPSED]: {
    pill: 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300',
    bar: 'bg-red-800 dark:bg-red-400',
    pip: 'bg-red-800 dark:bg-red-400',
  },
  [CellTone.MISSING]: {
    pill: 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300',
    bar: 'bg-red-800 dark:bg-red-400',
    pip: 'bg-red-800 dark:bg-red-400',
  },
};

const TONE_LABELS: Record<CellTone, string> = {
  [CellTone.MET]: 'Met',
  [CellTone.SHORT]: 'Short',
  [CellTone.SOON]: 'Due soon',
  [CellTone.LAPSED]: 'Lapsed',
  [CellTone.MISSING]: 'Nothing on file',
};

const STANDING_CLASSES: Record<Standing, { pill: string; dot: string; head: string }> = {
  [Standing.NON_COMPLIANT]: {
    pill: 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300',
    dot: 'bg-red-800 dark:bg-red-400',
    head: 'bg-red-500/10 text-red-700 dark:text-red-300',
  },
  [Standing.AT_RISK]: {
    pill: 'border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-300',
    dot: 'bg-orange-500 dark:bg-orange-400',
    head: 'bg-orange-500/10 text-orange-700 dark:text-orange-300',
  },
  [Standing.COMPLIANT]: {
    pill: 'border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-300',
    dot: 'bg-green-600 dark:bg-green-400',
    head: 'bg-green-500/10 text-green-700 dark:text-green-300',
  },
};

const STANDING_LABELS: Record<Standing, string> = {
  [Standing.NON_COMPLIANT]: 'Non-compliant',
  [Standing.AT_RISK]: 'At risk',
  [Standing.COMPLIANT]: 'Compliant',
};

const Pips: React.FC<{ tones: CellTone[] }> = ({ tones }) => (
  <div className="flex gap-0.5" aria-hidden="true">
    {tones.slice(0, 8).map((tone, i) => (
      <span key={i} className={`h-1.5 w-4 rounded-xs ${TONE_CLASSES[tone].pip}`} />
    ))}
  </div>
);

const StatTile: React.FC<{ label: string; value: string; note: string }> = ({ label, value, note }) => (
  <div className="border-theme-surface-border bg-theme-surface-secondary flex-1 rounded-lg border p-3">
    <p className="text-theme-text-muted text-[11px] font-bold tracking-wider uppercase">{label}</p>
    <p className="text-theme-text-primary mt-1 text-2xl leading-none font-bold tabular-nums">{value}</p>
    <p className="text-theme-text-muted mt-1 text-[11px]">{note}</p>
  </div>
);

const ComplianceMatrixTab: React.FC = () => {
  const tz = useTimezone();
  const [searchParams, setSearchParams] = useSearchParams();
  const [matrix, setMatrix] = useState<ComplianceMatrix | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [axis, setAxis] = useState<Axis>('members');
  const [sort, setSort] = useState<Sort>('worst');
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Honour the dashboard's non-compliant deep link on arrival. Opened
  // directly, the matrix shows everyone — hiding members nobody asked to hide
  // is how a roster comes to look shorter than it is.
  const [onlyBehind, setOnlyBehind] = useState(() => searchParams.get('status') === 'noncompliant');

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        setLoading(true);
        const data = await trainingService.getComplianceMatrix();
        if (!cancelled) setMatrix(data);
      } catch {
        if (!cancelled) setError('Failed to load compliance matrix');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const clearStatusFilter = useCallback(() => {
    setOnlyBehind(false);
    // Drop the param too, or a refresh silently re-applies a filter the
    // coordinator just dismissed.
    if (searchParams.get('status')) {
      const next = new URLSearchParams(searchParams);
      next.delete('status');
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const evaluated = useMemo(() => (matrix ? evaluateMatrix(matrix, tz) : []), [matrix, tz]);
  const requirements = useMemo(() => matrix?.requirements ?? [], [matrix]);
  const rollups = useMemo(() => rollUpRequirements(evaluated, requirements), [evaluated, requirements]);

  const groups = useMemo<QueueGroup[]>(() => {
    const q = query.trim().toLowerCase();
    if (axis === 'members') {
      // Filter on open items, not standing. The dashboard's Members Needing
      // Intervention list — which is what links here with status=noncompliant —
      // is built from a non-empty unmet list with no threshold applied. Where
      // an org sets a compliant threshold below 100%, a member can hold unmet
      // requirements and still be labelled compliant, so filtering by standing
      // hid the very member the coordinator was sent to look at, and could
      // report that nobody is behind.
      let people = onlyBehind ? evaluated.filter((m) => m.open > 0) : evaluated;
      if (q) people = people.filter((m) => m.member.member_name.toLowerCase().includes(q));
      const ordered =
        sort === 'az'
          ? [...people].sort((a, b) => a.member.member_name.localeCompare(b.member.member_name))
          : rankMembers(people);
      const toItem = (m: EvaluatedMember): QueueItem => ({
        id: m.member.user_id,
        title: m.member.member_name,
        sub: [m.member.membership_type, `${m.met} of ${m.total} met`].filter(Boolean).join(' · '),
        badge: m.open > 0 ? `${m.open} open` : `${m.pct}%`,
        pips: m.cells.map((c) => c.tone),
        standing: m.standing,
      });
      return (
        [
          { key: 'nc', label: 'Non-compliant', standing: Standing.NON_COMPLIANT },
          { key: 'ar', label: 'At risk', standing: Standing.AT_RISK },
          { key: 'ok', label: 'Compliant', standing: Standing.COMPLIANT },
        ] as const
      )
        .map((g) => ({
          ...g,
          items: ordered.filter((m) => m.standing === g.standing).map(toItem),
        }))
        .filter((g) => g.items.length > 0);
    }

    // The chip has to mean something on this axis too. Percentages stay
    // department-wide — they are computed from every member, not the filtered
    // set — but a requirement nobody is behind on is not part of the queue.
    let rolled = onlyBehind ? rollups.filter((r) => r.behind.length > 0) : rollups;
    if (q) rolled = rolled.filter((r) => r.requirement.name.toLowerCase().includes(q));
    const ordered =
      sort === 'az'
        ? [...rolled].sort((a, b) => a.requirement.name.localeCompare(b.requirement.name))
        : [...rolled].sort(
            (a, b) => (a.pct ?? 101) - (b.pct ?? 101) || a.requirement.name.localeCompare(b.requirement.name)
          );
    const toItem = (r: RequirementRollup): QueueItem => ({
      id: r.requirement.id,
      title: r.requirement.name,
      sub:
        r.pct === null
          ? 'No members are graded against this'
          : `${r.pct}% of ${r.total} member${r.total === 1 ? '' : 's'} met`,
      badge: r.total === 0 ? 'n/a' : `${r.behind.length} behind`,
      pips: Array.from({ length: 6 }, (_, i) =>
        i < Math.round(((r.pct ?? 0) / 100) * 6) ? CellTone.MET : CellTone.LAPSED
      ),
      standing: requirementStanding(r),
    });
    return [
      {
        key: 'behind',
        label: 'Behind',
        standing: Standing.AT_RISK,
        items: ordered.filter((r) => r.total > 0 && r.behind.length > 0).map(toItem),
      },
      {
        key: 'met',
        label: 'Fully met',
        standing: Standing.COMPLIANT,
        items: ordered.filter((r) => r.total > 0 && r.behind.length === 0).map(toItem),
      },
      {
        key: 'na',
        label: 'No applicable members',
        standing: Standing.AT_RISK,
        items: ordered.filter((r) => r.total === 0).map(toItem),
      },
    ].filter((g) => g.items.length > 0);
  }, [axis, evaluated, onlyBehind, query, rollups, sort]);

  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  const activeId = flat.some((i) => i.id === selectedId) ? selectedId : (flat[0]?.id ?? null);
  const activeIndex = flat.findIndex((i) => i.id === activeId);

  const step = useCallback(
    (delta: number) => {
      if (flat.length === 0) return;
      const next = flat[(activeIndex + delta + flat.length) % flat.length];
      if (next) setSelectedId(next.id);
    },
    [activeIndex, flat]
  );

  const exportCsv = useCallback(() => {
    const header = ['Member', 'Membership type', 'Standing', 'Met', 'Total', 'Percent'];
    const rows = evaluated.map((m) => [
      m.member.member_name,
      m.member.membership_type ?? '',
      STANDING_LABELS[m.standing],
      m.met,
      m.total,
      m.pct,
    ]);
    downloadCsv(buildCsv([header, ...rows]), 'compliance-matrix.csv');
  }, [evaluated]);

  if (loading) {
    // SkeletonPage is itself the live region. Wrapping it in a second
    // role="status" nests one status inside another, and a screen reader
    // announces only the inner one.
    return (
      <div className="mx-auto max-w-full px-4 py-6 sm:px-6 lg:px-8">
        <SkeletonPage rows={6} />
      </div>
    );
  }

  if (error || !matrix) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8">
        <div className="alert-danger" role="alert">
          {error || 'No data available'}
        </div>
      </div>
    );
  }

  if (requirements.length === 0) {
    return (
      <div className="mx-auto max-w-7xl px-4 py-8">
        <EmptyState
          icon={AlertTriangle}
          title="No active training requirements"
          description="Create a requirement before the compliance matrix has anything to evaluate."
        />
      </div>
    );
  }

  const nonCompliant = evaluated.filter((m) => m.standing === Standing.NON_COMPLIANT).length;
  const atRisk = evaluated.filter((m) => m.standing === Standing.AT_RISK).length;

  const activeMember = axis === 'members' ? evaluated.find((m) => m.member.user_id === activeId) : undefined;
  const activeRollup = axis === 'requirements' ? rollups.find((r) => r.requirement.id === activeId) : undefined;

  const detailRows: Array<{
    key: string;
    title: string;
    sub: string;
    cell: EvaluatedCell;
    /** Present only where there is a real page to open. */
    href?: string;
  }> = activeMember
    ? activeMember.cells.map((c) => ({
        key: c.cell.requirement_id,
        title: c.cell.requirement_name,
        // The date is the row's last column here, so it must not repeat in
        // the sub-line — it printed twice and wrapped the title onto 3 lines.
        sub: requirementMeta(c.requirement),
        cell: c,
      }))
    : (activeRollup?.behind ?? []).flatMap((m) => {
        const c = cellFor(m, activeRollup?.requirement.id ?? '');
        if (!c) return [];
        return [
          {
            key: m.member.user_id,
            title: m.member.member_name,
            sub: [m.member.membership_type, c.dateLabel].filter(Boolean).join(' · '),
            cell: c,
            href: `/members/${m.member.user_id}/training`,
          },
        ];
      });

  const detailStandingKey: Standing = activeMember
    ? activeMember.standing
    : activeRollup
      ? requirementStanding(activeRollup)
      : Standing.COMPLIANT;

  const stepNoun = axis === 'members' ? 'Member' : 'Requirement';

  return (
    <div className="mx-auto max-w-full px-4 py-6 sm:px-6 lg:px-8">
      <div className="card overflow-hidden">
        {/* Header — what this is, and which way round it is being read */}
        <div className="border-theme-surface-border flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className="text-theme-text-primary text-lg font-bold">Compliance</h2>
            <p className="text-theme-text-muted text-sm">
              {evaluated.length} tracked member{evaluated.length === 1 ? '' : 's'} · {requirements.length} requirement
              {requirements.length === 1 ? '' : 's'} · {nonCompliant} non-compliant, {atRisk} at risk
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="segmented-group-secondary hscroll flex" role="tablist" aria-label="Matrix axis">
              {(
                [
                  ['members', 'By member'],
                  ['requirements', 'By requirement'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={axis === value}
                  onClick={() => {
                    setAxis(value);
                    setSelectedId(null);
                  }}
                  className={`mobile-touch-target rounded-md px-3 py-1.5 text-sm font-semibold transition-colors ${
                    axis === value
                      ? 'bg-theme-surface text-theme-text-primary shadow-sm'
                      : 'text-theme-text-muted hover:text-theme-text-primary'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => window.open('/training/print/compliance', '_blank')}
              className="btn-secondary btn-sm inline-flex items-center gap-1.5 print:hidden"
            >
              <Printer className="h-4 w-4" aria-hidden="true" />
              Print
            </button>
          </div>
        </div>

        {/* Meta bar — the window everything below was judged against */}
        <div className="border-theme-surface-border bg-theme-surface-secondary flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-2.5">
          <span className="text-theme-text-secondary inline-flex items-center gap-1.5 text-xs">
            <CalendarCheck className="text-theme-text-muted h-4 w-4" aria-hidden="true" />
            Evaluated through <strong className="font-bold">{formatCalendarDate(matrix.as_of)}</strong>
          </span>
          <span className="text-theme-text-secondary text-xs">
            Threshold:{' '}
            <strong className="font-bold">
              {matrix.threshold_type === 'all_required' ? 'all requirements met' : 'org compliance thresholds'}
            </strong>
          </span>
          <span className="text-theme-text-muted text-xs">
            Waiver-adjusted targets are noted on the row they change
          </span>
          {onlyBehind && (
            <span className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-red-500/30 bg-red-500/10 py-1 pr-1 pl-2.5 text-xs font-semibold text-red-700 dark:text-red-300">
              Non-compliant + at risk only
              <button
                type="button"
                onClick={clearStatusFilter}
                aria-label="Show all members"
                className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-red-500/20 leading-none"
              >
                ×
              </button>
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[22rem_minmax(0,1fr)]">
          {/* Rail — the queue */}
          <div className="border-theme-surface-border bg-theme-surface-secondary flex flex-col border-b lg:border-r lg:border-b-0">
            <div className="border-theme-surface-border relative border-b p-2">
              <Search
                className="text-theme-text-muted pointer-events-none absolute top-1/2 left-4 h-4 w-4 -translate-y-1/2"
                aria-hidden="true"
              />
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                aria-label={axis === 'members' ? 'Search members' : 'Search requirements'}
                placeholder={axis === 'members' ? 'Search members' : 'Search requirements'}
                className="form-input-sm pr-3 pl-8"
              />
            </div>

            <div className="border-theme-surface-border flex items-center justify-between gap-2 border-b px-2 py-1.5">
              <div className="segmented-group flex">
                {(
                  [
                    ['worst', 'Worst first'],
                    ['az', 'A–Z'],
                  ] as const
                ).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={sort === value}
                    onClick={() => setSort(value)}
                    className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors ${
                      sort === value ? 'bg-red-800 text-white' : 'text-theme-text-muted hover:text-theme-text-primary'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <span className="text-theme-text-muted text-[11px] font-bold tracking-wider uppercase">
                {flat.length} {axis === 'members' ? 'members' : 'requirements'}
              </span>
            </div>

            <nav aria-label="Compliance queue" className="max-h-[32rem] flex-1 scrollbar-thin overflow-y-auto">
              {flat.length === 0 ? (
                <p className="text-theme-text-muted p-6 text-center text-sm">Nothing matches the current filter.</p>
              ) : (
                groups.map((group) => (
                  <div key={group.key}>
                    <div
                      className={`border-theme-surface-border sticky top-0 z-10 flex items-center gap-2 border-b px-4 py-1.5 ${STANDING_CLASSES[group.standing].head}`}
                    >
                      <span
                        className={`h-2 w-2 rounded-full ${STANDING_CLASSES[group.standing].dot}`}
                        aria-hidden="true"
                      />
                      <span className="text-[11px] font-bold tracking-widest uppercase">{group.label}</span>
                      <span className="ml-auto text-[11px] font-bold tabular-nums">{group.items.length}</span>
                    </div>
                    {group.items.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        aria-current={item.id === activeId}
                        onClick={() => setSelectedId(item.id)}
                        className={`border-theme-surface-border block w-full border-b border-l-[3px] px-4 py-2.5 text-left transition-colors ${
                          item.id === activeId
                            ? 'bg-theme-surface border-l-red-800 dark:border-l-red-400'
                            : 'hover:bg-theme-surface-hover border-l-transparent'
                        }`}
                      >
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-theme-text-primary truncate text-sm font-semibold">{item.title}</span>
                          <span
                            className={`shrink-0 text-xs font-bold tabular-nums ${
                              item.standing === Standing.COMPLIANT
                                ? 'text-green-700 dark:text-green-300'
                                : item.standing === Standing.AT_RISK
                                  ? 'text-orange-700 dark:text-orange-300'
                                  : 'text-red-700 dark:text-red-300'
                            }`}
                          >
                            {item.badge}
                          </span>
                        </div>
                        <div className="mt-1.5 flex items-center gap-2">
                          <Pips tones={item.pips} />
                          <span className="text-theme-text-muted truncate text-xs">{item.sub}</span>
                        </div>
                      </button>
                    ))}
                  </div>
                ))
              )}
            </nav>

            <div className="border-theme-surface-border bg-theme-surface flex items-center gap-2 border-t p-2">
              <button
                type="button"
                onClick={exportCsv}
                className="btn-secondary btn-sm inline-flex flex-1 items-center justify-center gap-1.5"
              >
                <Download className="h-4 w-4" aria-hidden="true" />
                Export CSV
              </button>
            </div>
          </div>

          {/* Detail — one item at a time, with somewhere to go next */}
          <div className="flex flex-col">
            <div className="border-theme-surface-border bg-theme-surface-secondary flex flex-wrap items-center justify-between gap-2 border-b px-4 py-2">
              <span className="text-theme-text-muted text-xs font-bold tracking-wider uppercase">
                {flat.length === 0
                  ? 'Nothing in the queue'
                  : `${stepNoun} ${activeIndex + 1} of ${flat.length} in the queue`}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => step(-1)}
                  disabled={flat.length === 0}
                  className="btn-secondary btn-sm inline-flex items-center gap-1"
                >
                  <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
                  Previous
                </button>
                <button
                  type="button"
                  onClick={() => step(1)}
                  disabled={flat.length === 0}
                  className="btn-primary btn-sm inline-flex items-center gap-1"
                >
                  Next
                  <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
            </div>

            {flat.length === 0 ? (
              <div className="p-6">
                <EmptyState
                  icon={CalendarCheck}
                  title={onlyBehind ? 'Nobody is behind' : 'Nothing to show'}
                  description={
                    onlyBehind
                      ? 'Every tracked member meets their requirements as evaluated. Clear the filter to see the full roster.'
                      : 'No members matched this search.'
                  }
                />
              </div>
            ) : (
              <div className="p-4 sm:p-6">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <p className="text-theme-text-muted text-[11px] font-bold tracking-widest uppercase">
                      {activeMember
                        ? [activeMember.member.membership_type, 'member'].filter(Boolean).join(' ')
                        : requirementMeta(activeRollup?.requirement)}
                    </p>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2">
                      <h3 className="text-theme-text-primary text-xl font-bold">
                        {activeMember?.member.member_name ?? activeRollup?.requirement.name}
                      </h3>
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-bold ${STANDING_CLASSES[detailStandingKey].pill}`}
                      >
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${STANDING_CLASSES[detailStandingKey].dot}`}
                          aria-hidden="true"
                        />
                        {activeMember
                          ? STANDING_LABELS[activeMember.standing]
                          : activeRollup?.pct === null || activeRollup === undefined
                            ? 'Not applicable'
                            : `${activeRollup.pct}% met`}
                      </span>
                    </div>
                    <p className="text-theme-text-muted mt-1 text-sm">
                      {activeMember
                        ? `${activeMember.met} of ${activeMember.total} requirements met · ${
                            activeMember.open > 0
                              ? `${activeMember.open} open item${activeMember.open === 1 ? '' : 's'}`
                              : 'nothing outstanding'
                          }`
                        : activeRollup && activeRollup.total === 0
                          ? 'No tracked member is graded against this requirement'
                          : `${activeRollup?.met ?? 0} of ${activeRollup?.total ?? 0} members met · ${
                              activeRollup?.behind.length ?? 0
                            } behind${activeRollup?.waived ? ` · ${activeRollup.waived} on a waiver` : ''}`}
                    </p>
                  </div>
                  {activeMember && (
                    <Link
                      to={`/members/${activeMember.member.user_id}/training`}
                      className="btn-secondary btn-sm inline-flex shrink-0 items-center gap-1.5"
                    >
                      <ExternalLink className="h-4 w-4" aria-hidden="true" />
                      Training record
                    </Link>
                  )}
                </div>

                {activeMember && (
                  <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                    <StatTile
                      label="Met"
                      value={`${activeMember.met}/${activeMember.total}`}
                      note="of what applies to this member"
                    />
                    <StatTile
                      label="Open items"
                      value={String(activeMember.open)}
                      note="lapsed, short or nothing on file"
                    />
                    <StatTile
                      label="Standing"
                      value={`${activeMember.pct}%`}
                      note={STANDING_LABELS[activeMember.standing].toLowerCase()}
                    />
                  </div>
                )}

                <div className="mt-5 mb-2 flex items-center gap-2">
                  <p className="text-theme-text-muted text-[11px] font-bold tracking-widest uppercase">
                    {activeMember ? 'Requirements' : 'Members behind'}
                  </p>
                  <span className="bg-theme-surface-border h-px flex-1" aria-hidden="true" />
                </div>

                <div className="border-theme-surface-border overflow-hidden rounded-lg border">
                  {detailRows.length === 0 ? (
                    <p className="text-theme-text-muted p-5 text-center text-sm">
                      {activeRollup && activeRollup.total === 0
                        ? 'Nobody is graded against this requirement, so there is nothing to report.'
                        : 'Every member meets this requirement.'}
                    </p>
                  ) : (
                    detailRows.map((row, index) => (
                      <div key={row.key} className={`p-3 ${index > 0 ? 'border-theme-surface-border border-t' : ''}`}>
                        <div className="grid grid-cols-1 items-center gap-3 md:grid-cols-[minmax(0,1.4fr)_10rem_7.5rem_minmax(0,0.85fr)]">
                          <div className="min-w-0">
                            <p className="text-theme-text-primary text-sm font-semibold">{row.title}</p>
                            <p className="text-theme-text-muted mt-0.5 text-xs">{row.sub}</p>
                          </div>
                          <div>
                            <div className="bg-theme-surface-hover h-2 overflow-hidden rounded-full">
                              <div
                                className={`h-full rounded-full ${TONE_CLASSES[row.cell.tone].bar}`}
                                style={{ width: `${Math.max(row.cell.pct, 2)}%` }}
                              />
                            </div>
                            <p className="text-theme-text-secondary mt-1 font-mono text-xs tabular-nums">
                              {row.cell.progressLabel}
                            </p>
                          </div>
                          <span
                            className={`inline-flex w-fit items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold ${TONE_CLASSES[row.cell.tone].pill}`}
                          >
                            <span
                              className={`h-1.5 w-1.5 rounded-full ${TONE_CLASSES[row.cell.tone].pip}`}
                              aria-hidden="true"
                            />
                            {TONE_LABELS[row.cell.tone]}
                          </span>
                          {row.href ? (
                            <Link
                              to={row.href}
                              className="btn-secondary btn-sm inline-flex w-fit items-center gap-1.5 md:justify-self-end"
                            >
                              <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                              Record
                            </Link>
                          ) : (
                            <span className="text-theme-text-muted text-xs md:justify-self-end md:text-right">
                              {row.cell.dateLabel}
                            </span>
                          )}
                        </div>
                        {row.cell.waiverNote && (
                          <p className="alert-info mt-2 flex items-center gap-1.5 px-2.5 py-1.5 text-xs">
                            <Info className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                            {row.cell.waiverNote}
                          </p>
                        )}
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Legend + provenance */}
        <div className="border-theme-surface-border bg-theme-surface-secondary text-theme-text-muted flex flex-wrap items-center gap-x-4 gap-y-2 border-t px-4 py-2.5 text-xs">
          {([CellTone.MET, CellTone.SHORT, CellTone.SOON, CellTone.LAPSED] as const).map((tone) => (
            <span key={tone} className="inline-flex items-center gap-1.5">
              <span className={`h-3 w-3 rounded-xs ${TONE_CLASSES[tone].pip}`} aria-hidden="true" />
              {TONE_LABELS[tone]}
            </span>
          ))}
          <span className="ml-auto">Generated {formatShortDateTime(matrix.generated_at, tz)}</span>
        </div>
      </div>
    </div>
  );
};

export default ComplianceMatrixTab;
