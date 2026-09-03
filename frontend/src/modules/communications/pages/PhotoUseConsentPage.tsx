/**
 * Photo Use Consent Page
 *
 * The department collects a photo-use consent from every member in User
 * Settings, but until this page it was only readable one member at a time —
 * which is not a check anybody performs while picking images out of a folder
 * of incident photos. The PIO needs the whole roster in one view, before the
 * newsletter goes out rather than after.
 *
 * Read-only by design: consent belongs to the member, and a coordinator
 * ticking a box on their behalf would not be consent.
 *
 * Gated on users.view_consents, notifications.manage, members.manage, or
 * users.edit — NOT users.view, which 25 of the 30 default positions carry and
 * which would have made this a weaker gate than reading one member's consent.
 * users.view_consents is what lets the Historian and Public Outreach positions
 * in without widening to a grant that means something else.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import {
  AlertCircle,
  Building2,
  Camera,
  Check,
  HelpCircle,
  RefreshCw,
  Search,
  ShieldAlert,
  SlidersHorizontal,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Avatar, Breadcrumbs, EmptyState, SkeletonPage, SortableHeader } from '../../../components/ux';
import type { SortDirection } from '../../../components/ux';
import { userService } from '../../../services/api';
import type { ConsentRoster, ConsentRosterMember } from '../../../types/user';
import { ConsentStatus, CONSENT_STATUS_COLORS, CONSENT_STATUS_LABELS } from '../../../constants/enums';
import { useRanks } from '../../../hooks/useRanks';
import { useRegisterPullToRefresh } from '../../../hooks/useRegisterPullToRefresh';
import { useTimezone } from '../../../hooks/useTimezone';
import { formatDate } from '../../../utils/dateFormatting';
import { getErrorMessage } from '../../../utils/errorHandling';

type StatusFilter = ConsentStatus | 'all';

/**
 * The bucket for members whose record carries no station at all. Without it
 * the filter cannot isolate the rows most likely to be a data-entry gap, and
 * those members are unreachable from a station-shaped question.
 */
const NO_STATION = '__none__';

type SortField = 'name' | 'rank' | 'station' | 'status' | 'decided_at';

const STATUS_TILES: { value: ConsentStatus; icon: LucideIcon; caption: string }[] = [
  {
    value: ConsentStatus.GRANTED,
    icon: Check,
    caption: 'Their photo may be published',
  },
  {
    value: ConsentStatus.DECLINED,
    icon: X,
    caption: 'Do not publish their photo',
  },
  {
    value: ConsentStatus.NOT_ANSWERED,
    icon: HelpCircle,
    caption: 'Treat as "do not publish" — but they can still be asked',
  },
];

/**
 * One ordering for the status column, derived from the tiles rather than
 * declared twice: ascending reads top-to-bottom the way the summary reads
 * left-to-right. Ordering the *labels* alphabetically would be an accident of
 * the words "Agreed"/"Declined"/"Not answered" and would silently change the
 * moment one of them was reworded.
 */
const STATUS_ORDER = Object.fromEntries(STATUS_TILES.map((tile, index) => [tile.value, index])) as Record<
  ConsentStatus,
  number
>;

/** Fill for each status in the coverage bar and its legend. */
const MIX_COLORS: Record<ConsentStatus, string> = {
  [ConsentStatus.GRANTED]: 'bg-theme-accent-green',
  [ConsentStatus.DECLINED]: 'bg-theme-accent-red',
  [ConsentStatus.NOT_ANSWERED]: 'bg-theme-accent-orange',
};

/**
 * The orderings the compact control offers. Every field/direction pair the
 * column headers can produce is listed, so the select always has an option to
 * show for the current state instead of going blank when a header was used.
 */
const SORT_CHOICES: { value: string; label: string }[] = [
  { value: '', label: 'Roster order' },
  { value: 'name:asc', label: 'Name A–Z' },
  { value: 'name:desc', label: 'Name Z–A' },
  { value: 'rank:asc', label: 'Rank, senior first' },
  { value: 'rank:desc', label: 'Rank, junior first' },
  { value: 'station:asc', label: 'Station A–Z' },
  { value: 'station:desc', label: 'Station Z–A' },
  { value: 'status:asc', label: 'Photo use, agreed first' },
  { value: 'status:desc', label: 'Photo use, not answered first' },
  { value: 'decided_at:desc', label: 'Decided, newest first' },
  { value: 'decided_at:asc', label: 'Decided, oldest first' },
];

function memberName(member: ConsentRosterMember): string {
  const name = [member.first_name, member.last_name].filter(Boolean).join(' ').trim();
  return name || 'Unnamed member';
}

/**
 * `SortableHeader` puts `aria-sort` on its own <button>, where ARIA does not
 * define it — the attribute belongs on the columnheader. Moving it into the
 * shared component would change six other tables in a commit scoped to this
 * page, and the component renders the button rather than the <th> that owns
 * the attribute, so the call site has to apply it either way.
 */
const SortTh: React.FC<{
  label: string;
  field: SortField;
  sortField: SortField | null;
  sortDirection: SortDirection;
  onSort: (field: string, direction: SortDirection) => void;
}> = ({ label, field, sortField, sortDirection, onSort }) => (
  <th
    scope="col"
    className="px-4 py-3 text-left"
    aria-sort={sortField === field && sortDirection ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}
  >
    <SortableHeader
      label={label}
      field={field}
      currentSort={sortField}
      currentDirection={sortDirection}
      onSort={onSort}
    />
  </th>
);

const PhotoUseConsentPage: React.FC = () => {
  const tz = useTimezone();
  const { ranks, formatRank } = useRanks();
  const [roster, setRoster] = useState<ConsentRoster | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [stationFilter, setStationFilter] = useState<string>('all');
  const [sortField, setSortField] = useState<SortField | null>(null);
  const [sortDirection, setSortDirection] = useState<SortDirection>(null);
  const [includeInactive, setIncludeInactive] = useState(false);

  // A monotonic id rather than a per-effect `cancelled` flag: the flag covered
  // the toggle but left the refresh button racing itself, because two manual
  // refreshes belong to the same effect run and so shared one flag. Only the
  // newest request may write, whichever control started it.
  const requestId = useRef(0);

  const load = useCallback(async () => {
    const id = ++requestId.current;
    setIsLoading(true);
    setError(null);
    try {
      const data = await userService.getPhotoUseConsentRoster(includeInactive);
      if (requestId.current === id) setRoster(data);
    } catch (err: unknown) {
      if (requestId.current === id) setError(getErrorMessage(err, 'Could not load photo use consents.'));
    } finally {
      if (requestId.current === id) setIsLoading(false);
    }
  }, [includeInactive]);

  useEffect(() => {
    void load();
  }, [load]);

  // Any in-flight response that resolves after unmount loses the comparison,
  // which is what the `cancelled` flag's cleanup used to do.
  useEffect(
    () => () => {
      requestId.current = -1;
    },
    []
  );

  useRegisterPullToRefresh(load);

  const members = useMemo(() => roster?.members ?? [], [roster]);

  const stationOptions = useMemo(() => {
    const named = new Set<string>();
    let hasUnassigned = false;
    for (const member of members) {
      const station = member.station?.trim() ?? '';
      if (station) named.add(station);
      else hasUnassigned = true;
    }
    // Numeric collation so "Station 2" precedes "Station 10".
    const sorted = [...named].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    return hasUnassigned ? [...sorted, NO_STATION] : sorted;
  }, [members]);

  // A station chosen while inactive members were shown can disappear when the
  // toggle is cleared. Leaving it selected would show an empty table with its
  // cause collapsed inside a <select> the reader has stopped looking at.
  useEffect(() => {
    if (stationFilter !== 'all' && !stationOptions.includes(stationFilter)) {
      setStationFilter('all');
    }
  }, [stationOptions, stationFilter]);

  // Filtering is client-side: the roster is one department's membership, which
  // arrives in a single response, so a round trip per keystroke would buy
  // nothing.
  const filteredMembers = useMemo(() => {
    const term = search.trim().toLowerCase();
    return members.filter((member) => {
      if (statusFilter !== 'all' && member.status !== statusFilter) return false;
      if (stationFilter !== 'all') {
        const station = member.station?.trim() ?? '';
        if (stationFilter === NO_STATION ? station !== '' : station !== stationFilter) return false;
      }
      if (!term) return true;
      return [memberName(member), member.membership_number, member.station]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(term));
    });
  }, [members, search, statusFilter, stationFilter]);

  const rankOrder = useMemo(() => {
    // useRanks hands back the department's own ranks already ordered by
    // sort_order, senior first. Sorting the display names alphabetically would
    // file a Captain between a Battalion Chief and a Firefighter.
    const order = new Map<string, number>();
    ranks.forEach((rank, index) => order.set(rank.rank_code, index));
    return order;
  }, [ranks]);

  const visibleMembers = useMemo(() => {
    if (!sortField || !sortDirection) return filteredMembers;

    const sortValue = (member: ConsentRosterMember): string | number | null => {
      switch (sortField) {
        case 'name':
          // Surname first: it is how a roster is read, and it is the order the
          // server already returns, so the first click confirms the arrow
          // rather than reshuffling the page under the reader.
          return [member.last_name, member.first_name].filter(Boolean).join(' ').trim().toLowerCase() || null;
        case 'rank':
          // A code the department has since retired still sorts — just after
          // every rank it still defines, and ahead of members who have none.
          return member.rank ? (rankOrder.get(member.rank) ?? ranks.length) : null;
        case 'station':
          return member.station?.trim().toLowerCase() || null;
        case 'status':
          return STATUS_ORDER[member.status];
        case 'decided_at':
          // UTC ISO 8601 sorts lexicographically, so no Date per comparison.
          return member.decided_at ?? null;
      }
    };

    const direction = sortDirection === 'asc' ? 1 : -1;
    // Array.prototype.sort is stable, so ties keep the server's surname order.
    return [...filteredMembers].sort((a, b) => {
      const aVal = sortValue(a);
      const bVal = sortValue(b);
      // Rows with nothing in the sorted column stay at the bottom in BOTH
      // directions. Reversing a sort should reorder the answers, not float
      // every "—" to the top of a page whose subject is who has not answered.
      if (aVal === null || bVal === null) {
        if (aVal === bVal) return 0;
        return aVal === null ? 1 : -1;
      }
      const cmp =
        typeof aVal === 'string' && typeof bVal === 'string'
          ? aVal.localeCompare(bVal, undefined, { numeric: true })
          : Number(aVal) - Number(bVal);
      return cmp * direction;
    });
  }, [filteredMembers, sortField, sortDirection, rankOrder, ranks.length]);

  const handleSort = (field: string, direction: SortDirection) => {
    setSortField(direction ? (field as SortField) : null);
    setSortDirection(direction);
  };

  const clearFilters = () => {
    setSearch('');
    setStatusFilter('all');
    setStationFilter('all');
  };

  if (isLoading && !roster) {
    return <SkeletonPage />;
  }

  const summary = roster?.summary ?? { granted: 0, declined: 0, not_answered: 0, total: 0 };
  // A sort hides nothing, so it is deliberately not a "filter": counting it
  // would make the empty state blame the column order for an empty roster, and
  // would make Clear filters discard an ordering chosen for another reason.
  const hasFilters = search.trim() !== '' || statusFilter !== 'all' || stationFilter !== 'all';
  const answered = summary.granted + summary.declined;
  const stationLabel = (station: string) => (station === NO_STATION ? 'No station' : station);

  const pct = (count: number) => (summary.total > 0 ? (count / summary.total) * 100 : 0);
  // A zero-width segment is dropped rather than rendered as a hairline.
  const mixSegments = STATUS_TILES.map((tile) => ({ key: tile.value, count: summary[tile.value] })).filter(
    (segment) => segment.count > 0
  );

  const chips: { key: string; label: string; clearLabel: string; onClear: () => void }[] = [];
  if (statusFilter !== 'all') {
    chips.push({
      key: 'status',
      label: `Photo use: ${CONSENT_STATUS_LABELS[statusFilter]}`,
      clearLabel: 'Remove the photo use filter',
      onClear: () => setStatusFilter('all'),
    });
  }
  if (stationFilter !== 'all') {
    chips.push({
      key: 'station',
      label: stationLabel(stationFilter),
      clearLabel: 'Remove the station filter',
      onClear: () => setStationFilter('all'),
    });
  }
  if (search.trim() !== '') {
    chips.push({
      key: 'search',
      label: `Search: “${search.trim()}”`,
      clearLabel: 'Clear the search',
      onClear: () => setSearch(''),
    });
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <div>
        <Breadcrumbs items={[{ label: 'Forms & Comms' }, { label: 'Photo Use Consent' }]} />
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-theme-text-primary flex items-center gap-2 text-2xl font-bold">
              <Camera className="h-6 w-6 shrink-0" aria-hidden="true" />
              Photo Use Consent
            </h1>
            <p className="text-theme-text-secondary mt-1 max-w-3xl text-sm">
              Who has agreed to their image being used in publications, social media, and other public material. Members
              set this themselves under Settings &rarr; Security &rarr; Privacy Choices; it cannot be changed on their
              behalf from here.
            </p>
          </div>
          <div className="hscroll flex items-center gap-2">
            <button
              type="button"
              onClick={() => void load()}
              className="btn-icon"
              aria-label="Refresh photo use consents"
            >
              <RefreshCw className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`} aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>

      {error && (
        <div className="alert-danger flex items-start gap-2" role="alert">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      {/* The rule that causes harm when it is missed, and body text is where it
          was missed: a member who never answered is not a member who agreed. */}
      <div className="alert-warning flex items-start gap-3">
        <ShieldAlert className="text-theme-alert-warning-icon mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
        <div>
          <p className="text-theme-alert-warning-title text-sm font-semibold">
            A member who has not answered has not agreed.
          </p>
          {/* The counts live in the tiles above; interpolating them here only
              bought a sentence that reads wrong at one member and at none. */}
          <p className="text-theme-alert-warning-text text-sm">
            Treat them the same as a member who declined — do not publish their image until they answer.
          </p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        {STATUS_TILES.map((tile) => {
          const TileIcon = tile.icon;
          const active = statusFilter === tile.value;
          return (
            <button
              key={tile.value}
              type="button"
              aria-pressed={active}
              onClick={() => setStatusFilter(active ? 'all' : tile.value)}
              className={`stat-card text-left ${
                active ? 'border-theme-text-primary ring-theme-focus-ring ring-2' : 'hover:border-theme-text-muted/40'
              }`}
            >
              <div className="flex items-center gap-2">
                <TileIcon className="text-theme-text-muted h-4 w-4 shrink-0" aria-hidden="true" />
                <span className="text-theme-text-secondary text-sm font-medium">
                  {CONSENT_STATUS_LABELS[tile.value]}
                </span>
              </div>
              <p className="text-theme-text-primary mt-1 text-3xl font-bold">{summary[tile.value]}</p>
              <p className="text-theme-text-muted mt-1 text-xs">{tile.caption}</p>
            </button>
          );
        })}
      </div>

      {/* Three counts make the reader do the arithmetic; the bar answers "how
          much of the roster is settled" without it. No text sits inside the
          bar, so it needs no contrast budget in any of the three themes. */}
      <div className="card p-4">
        <div className="mb-2.5 flex items-baseline justify-between gap-3">
          <span className="text-theme-text-primary text-sm font-semibold">Roster coverage</span>
          {/* The one number the three tiles never state: how much of the
              roster has answered at all. Their counts are not repeated here. */}
          <span className="text-theme-text-muted text-xs">
            {answered} of {summary.total} answered
          </span>
        </div>
        <div
          className="bg-theme-surface-secondary border-theme-surface-border flex h-3 overflow-hidden rounded-full border"
          role="img"
          aria-label={`Of ${summary.total} members, ${summary.granted} agreed, ${summary.declined} declined and ${summary.not_answered} have not answered.`}
        >
          {mixSegments.map((segment) => (
            <div
              key={segment.key}
              className={MIX_COLORS[segment.key]}
              style={{ width: `${pct(segment.count)}%` }}
              title={`${CONSENT_STATUS_LABELS[segment.key]} — ${segment.count}`}
            />
          ))}
        </div>
        {/* Labels only: the legend exists to say which colour is which, and
            the counts are already in the tiles directly above. */}
        <div className="mt-2.5 flex flex-wrap gap-x-4 gap-y-2">
          {STATUS_TILES.map((tile) => (
            <span key={tile.value} className="text-theme-text-secondary inline-flex items-center gap-1.5 text-xs">
              <span className={`h-2 w-2 rounded-full ${MIX_COLORS[tile.value]}`} aria-hidden="true" />
              {CONSENT_STATUS_LABELS[tile.value]}
            </span>
          ))}
        </div>
      </div>

      <div className="space-y-4">
        <div className="card flex flex-col gap-3 p-4 sm:flex-row sm:flex-wrap sm:items-center">
          <div className="relative w-full sm:max-w-xs">
            <Search
              className="text-theme-text-muted pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2"
              aria-hidden="true"
            />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search members"
              aria-label="Search members"
              className="form-input w-full pl-9"
            />
          </div>

          {/* A filter offering one real choice is furniture, not a control. */}
          {stationOptions.length > 1 && (
            <div className="relative">
              <Building2
                className="text-theme-text-muted pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2"
                aria-hidden="true"
              />
              <select
                value={stationFilter}
                onChange={(e) => setStationFilter(e.target.value)}
                aria-label="Filter by station"
                className="form-input appearance-none pr-8 pl-9 sm:w-auto"
              >
                <option value="all">All stations</option>
                {stationOptions.map((station) => (
                  <option key={station} value={station}>
                    {stationLabel(station)}
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* `.rwd-table thead` is display:none under 768px, so the column
              buttons are unreachable on a phone. This drives the same two
              pieces of state rather than a second, separately sorted DOM. */}
          <div className="relative md:hidden">
            <SlidersHorizontal
              className="text-theme-text-muted pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2"
              aria-hidden="true"
            />
            <select
              value={sortField && sortDirection ? `${sortField}:${sortDirection}` : ''}
              onChange={(e) => {
                const [field, direction] = e.target.value.split(':');
                setSortField(field ? (field as SortField) : null);
                setSortDirection(direction ? (direction as SortDirection) : null);
              }}
              aria-label="Sort members"
              className="form-input appearance-none pr-8 pl-9 sm:w-auto"
            >
              {SORT_CHOICES.map((choice) => (
                <option key={choice.value} value={choice.value}>
                  {choice.label}
                </option>
              ))}
            </select>
          </div>

          <label className="text-theme-text-secondary flex items-center gap-2 text-sm sm:ml-auto">
            <input
              type="checkbox"
              className="form-checkbox"
              checked={includeInactive}
              onChange={(e) => setIncludeInactive(e.target.checked)}
            />
            Include inactive members
          </label>
        </div>

        {/* Once a tile, a search term and a station are all in play, nothing
            else on the page can say why the list is short. */}
        {chips.length > 0 && (
          <div role="group" aria-labelledby="active-filters-label" className="flex flex-wrap items-center gap-2">
            <span id="active-filters-label" className="text-theme-text-muted text-xs">
              Filtered by
            </span>
            {chips.map((chip) => (
              <span
                key={chip.key}
                className="badge border-theme-surface-border bg-theme-surface text-theme-text-primary gap-1.5 border py-1 pr-1.5 pl-2.5"
              >
                {chip.label}
                <button
                  type="button"
                  onClick={chip.onClear}
                  aria-label={chip.clearLabel}
                  className="bg-theme-surface-hover text-theme-text-secondary hover:text-theme-text-primary inline-flex h-4.5 w-4.5 items-center justify-center rounded-full"
                >
                  <X className="h-2.5 w-2.5" aria-hidden="true" />
                </button>
              </span>
            ))}
            <button
              type="button"
              onClick={clearFilters}
              className="text-theme-text-secondary hover:text-theme-text-primary text-xs font-medium underline"
            >
              Clear all
            </button>
          </div>
        )}

        <div className="card overflow-x-auto p-0">
          {visibleMembers.length === 0 ? (
            <EmptyState
              icon={Camera}
              title={hasFilters ? 'No members match these filters' : 'No members to show'}
              description={
                hasFilters
                  ? 'Clear the search, station, or status filter to see the rest of the roster.'
                  : 'Once members are added to the department they will appear here with their photo use choice.'
              }
              {...(hasFilters
                ? {
                    actions: [
                      {
                        label: 'Clear filters',
                        onClick: clearFilters,
                        variant: 'secondary' as const,
                      },
                    ],
                  }
                : {})}
            />
          ) : (
            <table className="rwd-table w-full text-sm">
              <thead>
                <tr className="border-theme-surface-border bg-theme-surface-secondary border-b">
                  <SortTh
                    label="Member"
                    field="name"
                    sortField={sortField}
                    sortDirection={sortDirection}
                    onSort={handleSort}
                  />
                  <SortTh
                    label="Rank"
                    field="rank"
                    sortField={sortField}
                    sortDirection={sortDirection}
                    onSort={handleSort}
                  />
                  <SortTh
                    label="Station"
                    field="station"
                    sortField={sortField}
                    sortDirection={sortDirection}
                    onSort={handleSort}
                  />
                  <SortTh
                    label="Photo use"
                    field="status"
                    sortField={sortField}
                    sortDirection={sortDirection}
                    onSort={handleSort}
                  />
                  <SortTh
                    label="Decided"
                    field="decided_at"
                    sortField={sortField}
                    sortDirection={sortDirection}
                    onSort={handleSort}
                  />
                </tr>
              </thead>
              <tbody>
                {visibleMembers.map((member) => (
                  <tr
                    key={member.user_id}
                    className="border-theme-surface-border hover:bg-theme-surface-hover border-b last:border-b-0"
                  >
                    <td className="rwd-table-lead px-4 py-3" data-label="Member">
                      <div className="flex items-center gap-3">
                        <Avatar
                          firstName={member.first_name}
                          lastName={member.last_name}
                          photoUrl={member.photo_url}
                          size="sm"
                          className="hidden sm:flex"
                        />
                        <div className="min-w-0">
                          {/* `block` is load-bearing: `truncate` sets
                              overflow/white-space, which do nothing on the
                              inline box a <Link> renders by default. */}
                          <Link
                            to={`/members/${member.user_id}`}
                            className="text-theme-text-primary block truncate font-medium hover:underline"
                          >
                            {memberName(member)}
                          </Link>
                          <p className="text-theme-text-muted truncate text-xs">
                            {member.membership_number ? `#${member.membership_number}` : ''}
                            {/* Only worth saying when the toggle has let them in;
                                otherwise every row would read "active". */}
                            {includeInactive && member.member_status && member.member_status !== 'active' && (
                              <span className="ml-1 capitalize">
                                &middot; {member.member_status.replace(/_/g, ' ')}
                              </span>
                            )}
                          </p>
                        </div>
                      </div>
                    </td>
                    <td className="text-theme-text-secondary px-4 py-3" data-label="Rank">
                      {formatRank(member.rank) || '—'}
                    </td>
                    <td className="text-theme-text-secondary px-4 py-3" data-label="Station">
                      {member.station || '—'}
                    </td>
                    <td className="px-4 py-3" data-label="Photo use">
                      <span className={`badge border ${CONSENT_STATUS_COLORS[member.status]}`}>
                        {CONSENT_STATUS_LABELS[member.status]}
                      </span>
                    </td>
                    <td className="text-theme-text-muted px-4 py-3" data-label="Decided">
                      {member.decided_at ? formatDate(member.decided_at, tz) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <p className="text-theme-text-muted text-xs">
          Showing {visibleMembers.length} of {summary.total} {includeInactive ? 'members' : 'active members'}.
        </p>
      </div>
    </div>
  );
};

export default PhotoUseConsentPage;
