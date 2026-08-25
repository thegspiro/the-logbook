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
 * ticking a box on their behalf would not be consent. Gated on `users.view`
 * at the route.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertCircle, Camera, Check, HelpCircle, Search, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Avatar, Breadcrumbs, EmptyState, SkeletonPage } from '../../../components/ux';
import { userService } from '../../../services/api';
import type { ConsentRoster, ConsentRosterMember } from '../../../types/user';
import { ConsentStatus, CONSENT_STATUS_COLORS, CONSENT_STATUS_LABELS } from '../../../constants/enums';
import { useRanks } from '../../../hooks/useRanks';
import { useTimezone } from '../../../hooks/useTimezone';
import { formatDate } from '../../../utils/dateFormatting';
import { getErrorMessage } from '../../../utils/errorHandling';

type StatusFilter = ConsentStatus | 'all';

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

function memberName(member: ConsentRosterMember): string {
  const name = [member.first_name, member.last_name].filter(Boolean).join(' ').trim();
  return name || member.email || 'Unnamed member';
}

const PhotoUseConsentPage: React.FC = () => {
  const tz = useTimezone();
  const { formatRank } = useRanks();
  const [roster, setRoster] = useState<ConsentRoster | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [includeInactive, setIncludeInactive] = useState(false);

  const loadRoster = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      setRoster(await userService.getPhotoUseConsentRoster(includeInactive));
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Could not load photo use consents.'));
    } finally {
      setIsLoading(false);
    }
  }, [includeInactive]);

  useEffect(() => {
    void loadRoster();
  }, [loadRoster]);

  const members = useMemo(() => roster?.members ?? [], [roster]);

  // Filtering is client-side: the roster is one department's membership, which
  // arrives in a single response, so a round trip per keystroke would buy
  // nothing.
  const visibleMembers = useMemo(() => {
    const term = search.trim().toLowerCase();
    return members.filter((member) => {
      if (statusFilter !== 'all' && member.status !== statusFilter) return false;
      if (!term) return true;
      return [memberName(member), member.email, member.membership_number, member.station]
        .filter(Boolean)
        .some((field) => String(field).toLowerCase().includes(term));
    });
  }, [members, search, statusFilter]);

  if (isLoading && !roster) {
    return <SkeletonPage />;
  }

  const summary = roster?.summary ?? { granted: 0, declined: 0, not_answered: 0, total: 0 };
  const hasFilters = search.trim() !== '' || statusFilter !== 'all';

  return (
    <div className="p-4 sm:p-6">
      <Breadcrumbs items={[{ label: 'Forms & Comms' }, { label: 'Photo Use Consent' }]} />
      <h1 className="text-theme-text-primary mb-2 flex items-center gap-2 text-2xl font-bold">
        <Camera className="h-6 w-6 shrink-0" aria-hidden="true" />
        Photo Use Consent
      </h1>
      <p className="text-theme-text-secondary mb-6 max-w-3xl text-sm">
        Who has agreed to their image being used in publications, social media, and other public material. Members set
        this themselves under Settings &rarr; Security &rarr; Privacy Choices; it cannot be changed on their behalf from
        here. A member who has not answered has not agreed — treat them the same as a member who declined.
      </p>

      {error && (
        <div className="alert-danger mb-4 flex items-start gap-2" role="alert">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        {STATUS_TILES.map((tile) => {
          const TileIcon = tile.icon;
          const active = statusFilter === tile.value;
          return (
            <button
              key={tile.value}
              type="button"
              aria-pressed={active}
              onClick={() => setStatusFilter(active ? 'all' : tile.value)}
              className={`card text-left transition ${
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

      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
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
        <label className="text-theme-text-secondary flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="form-checkbox"
            checked={includeInactive}
            onChange={(e) => setIncludeInactive(e.target.checked)}
          />
          Include inactive members
        </label>
      </div>

      <div className="card-secondary overflow-hidden p-0">
        {visibleMembers.length === 0 ? (
          <EmptyState
            icon={Camera}
            title={hasFilters ? 'No members match these filters' : 'No members to show'}
            description={
              hasFilters
                ? 'Clear the search or status filter to see the rest of the roster.'
                : 'Once members are added to the department they will appear here with their photo use choice.'
            }
            {...(hasFilters
              ? {
                  actions: [
                    {
                      label: 'Clear filters',
                      onClick: () => {
                        setSearch('');
                        setStatusFilter('all');
                      },
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
                <th scope="col" className="text-theme-text-muted px-4 py-3 text-left font-medium">
                  Member
                </th>
                <th scope="col" className="text-theme-text-muted px-4 py-3 text-left font-medium">
                  Rank
                </th>
                <th scope="col" className="text-theme-text-muted px-4 py-3 text-left font-medium">
                  Station
                </th>
                <th scope="col" className="text-theme-text-muted px-4 py-3 text-left font-medium">
                  Photo use
                </th>
                <th scope="col" className="text-theme-text-muted px-4 py-3 text-left font-medium">
                  Decided
                </th>
              </tr>
            </thead>
            <tbody>
              {visibleMembers.map((member) => (
                <tr
                  key={member.user_id}
                  className="border-theme-surface-border hover:bg-theme-surface-hover border-b last:border-b-0"
                >
                  <td className="px-4 py-3" data-label="Member">
                    <div className="flex items-center gap-3">
                      <Avatar
                        firstName={member.first_name}
                        lastName={member.last_name}
                        photoUrl={member.photo_url}
                        size="sm"
                        className="hidden sm:flex"
                      />
                      <div className="min-w-0">
                        <p className="text-theme-text-primary truncate font-medium">{memberName(member)}</p>
                        <p className="text-theme-text-muted truncate text-xs">
                          {member.membership_number ? `#${member.membership_number}` : member.email}
                          {/* Only worth saying when the toggle has let them in;
                              otherwise every row would read "active". */}
                          {includeInactive && member.member_status && member.member_status !== 'active' && (
                            <span className="ml-1 capitalize">&middot; {member.member_status.replace(/_/g, ' ')}</span>
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
                  <td className="text-theme-text-secondary px-4 py-3" data-label="Decided">
                    {member.decided_at ? formatDate(member.decided_at, tz) : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p className="text-theme-text-muted mt-4 text-xs">
        Showing {visibleMembers.length} of {summary.total} {includeInactive ? 'members' : 'active members'}.
      </p>
    </div>
  );
};

export default PhotoUseConsentPage;
