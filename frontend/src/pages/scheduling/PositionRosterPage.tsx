/**
 * Position Qualification Roster
 *
 * "Who is cleared to drive?" — answered in one screen instead of opening each
 * apparatus's operator tab in turn.
 *
 * Eligibility for a shift position comes from three independent sources OR'd
 * together (rank, completed training, the org's open-position list), so a
 * member can hold a position for a reason that is not obvious from their
 * profile. This page shows the sources alongside each name, and pairs them
 * with the member's EVOC standing so the gap that matters is visible: someone
 * whose rank lets them sign up as a driver with no EVOC certification behind
 * it.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import toast from 'react-hot-toast';
import { AlertTriangle, GraduationCap, Loader2, Search, Shield, Truck, Unlock, Users } from 'lucide-react';
import { schedulingService } from '../../modules/scheduling/services/api';
import type { PositionRosterMember, PositionRosterResponse } from '../../modules/scheduling/types';
import { POSITION_LABELS } from '../../constants/enums';
import { formatDate } from '../../utils/dateFormatting';
import { useTimezone } from '../../hooks/useTimezone';
import { getErrorMessage } from '../../utils/errorHandling';
import { EmptyState } from '../../components/ux/EmptyState';
import SchedulingHeader from './SchedulingHeader';
import DriverExceptionsPanel from './DriverExceptionsPanel';

const POSITIONS = ['driver', 'officer', 'firefighter', 'ems', 'captain', 'lieutenant', 'probationary'] as const;

const TABS = [
  { id: 'roster', label: 'Cleared roster' },
  { id: 'exceptions', label: 'Driver exceptions' },
] as const;

type TabId = (typeof TABS)[number]['id'];

const SOURCE_STYLES: Record<string, { icon: React.ElementType; className: string }> = {
  rank: { icon: Shield, className: 'bg-violet-500/15 text-violet-700 dark:text-violet-400' },
  training: { icon: GraduationCap, className: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' },
  open: { icon: Unlock, className: 'bg-sky-500/15 text-sky-700 dark:text-sky-400' },
};

const PositionRosterPage: React.FC = () => {
  const tz = useTimezone();
  const [activeTab, setActiveTab] = useState<TabId>('roster');
  const [position, setPosition] = useState<string>('driver');
  const [roster, setRoster] = useState<PositionRosterResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const load = useCallback(async (target: string) => {
    setLoading(true);
    try {
      setRoster(await schedulingService.getPositionRoster(target));
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to load the qualification roster'));
      setRoster(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(position);
  }, [load, position]);

  const members = useMemo(() => {
    const all = roster?.members ?? [];
    const term = search.trim().toLowerCase();
    if (!term) return all;
    return all.filter(
      (member) =>
        member.user_name.toLowerCase().includes(term) || (member.rank_display_name ?? '').toLowerCase().includes(term)
    );
  }, [roster, search]);

  // Derived from the loaded roster, not the selected value: during a refetch
  // the two differ, and labelling rows for a position they were not fetched
  // for is worse than lagging by a moment.
  const loadedPosition = roster?.position ?? position;

  // Only meaningful for driving positions, where an EVOC card is the
  // department's actual record of clearance.
  const isDrivingPosition = loadedPosition === 'driver';
  const uncertifiedCount = useMemo(
    () => (roster?.members ?? []).filter((member) => member.evoc_level_number === null).length,
    [roster]
  );

  const positionLabel = POSITION_LABELS[loadedPosition] ?? loadedPosition;

  const renderSources = (member: PositionRosterMember) => (
    <div className="mt-1 flex flex-wrap gap-1">
      {member.sources.map((source, idx) => {
        const style = SOURCE_STYLES[source.type] ?? SOURCE_STYLES.rank;
        const Icon = style?.icon ?? Shield;
        return (
          <span
            key={`${source.type}-${source.label}-${idx}`}
            className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium ${style?.className ?? ''}`}
          >
            <Icon className="h-3 w-3" aria-hidden="true" />
            {source.label}
          </span>
        );
      })}
    </div>
  );

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <SchedulingHeader backTo="/scheduling" description="Who is cleared for each shift position, and why" />

      <div className="tab-scroll mb-4" role="tablist" aria-label="Qualification views">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`mobile-touch-target px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors ${
              activeTab === tab.id
                ? 'border-b-2 border-violet-600 text-violet-700 dark:text-violet-400'
                : 'text-theme-text-muted hover:text-theme-text-primary'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'exceptions' ? (
        <DriverExceptionsPanel />
      ) : (
        <>
          <div className="card mb-4 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="sm:w-64">
                <label htmlFor="roster-position" className="form-label">
                  Position
                </label>
                <select
                  id="roster-position"
                  value={position}
                  onChange={(e) => setPosition(e.target.value)}
                  className="form-input"
                >
                  {POSITIONS.map((value) => (
                    <option key={value} value={value}>
                      {POSITION_LABELS[value] ?? value}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex-1">
                <label htmlFor="roster-search" className="form-label">
                  Search
                </label>
                <div className="relative">
                  <Search
                    className="text-theme-text-muted pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2"
                    aria-hidden="true"
                  />
                  <input
                    id="roster-search"
                    type="search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Filter by name or rank"
                    className="form-input pl-9"
                  />
                </div>
              </div>
            </div>

            {roster?.is_open_position && (
              <p className="text-theme-text-muted mt-3 inline-flex items-center gap-1.5 text-xs">
                <Unlock className="h-3.5 w-3.5" aria-hidden="true" />
                {positionLabel} is on the department&apos;s open-position list, so every member who is not an excluded
                membership type may sign up for it.
              </p>
            )}
          </div>

          {loading ? (
            <div className="flex justify-center py-16" role="status" aria-live="polite">
              <Loader2 className="text-theme-text-muted h-8 w-8 animate-spin" />
            </div>
          ) : !roster ? null : roster.members.length === 0 ? (
            <EmptyState
              icon={Users}
              title={`Nobody is cleared as ${positionLabel}`}
              description={
                'Grant the position to a rank under Settings → Ranks, set a training program’s target ' +
                'position, or add it to the open-position list in scheduling settings.'
              }
            />
          ) : (
            <>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <p className="text-theme-text-secondary text-sm">
                  <span className="font-semibold">{roster.members.length}</span> member
                  {roster.members.length === 1 ? '' : 's'} cleared as {positionLabel}
                  {search.trim() && members.length !== roster.members.length && (
                    <span className="text-theme-text-muted"> · {members.length} shown</span>
                  )}
                </p>
                {isDrivingPosition && uncertifiedCount > 0 && (
                  <span className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/5 px-2 py-1 text-xs font-medium text-amber-700 dark:text-amber-400">
                    <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                    {uncertifiedCount} with no EVOC certification on file
                  </span>
                )}
              </div>

              <div className="card divide-theme-surface-border divide-y">
                {members.map((member) => (
                  <div key={member.user_id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-start sm:gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          to={`/members/${member.user_id}`}
                          className="text-theme-text-primary hover:text-theme-accent-blue text-sm font-semibold"
                        >
                          {member.user_name}
                        </Link>
                        {member.rank_display_name && (
                          <span className="text-theme-text-muted text-xs">{member.rank_display_name}</span>
                        )}
                        {member.platoon && (
                          <span className="bg-theme-surface-secondary text-theme-text-muted rounded px-1.5 py-0.5 text-[10px] font-medium">
                            Platoon {member.platoon}
                          </span>
                        )}
                      </div>
                      {renderSources(member)}
                    </div>

                    <div className="sm:w-72 sm:shrink-0">
                      {member.evoc_level_number !== null ? (
                        <p className="text-theme-text-secondary inline-flex items-center gap-1.5 text-xs font-medium">
                          <Shield className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                          EVOC {member.evoc_level_number}
                          {member.evoc_level_name ? ` · ${member.evoc_level_name}` : ''}
                        </p>
                      ) : (
                        isDrivingPosition && (
                          <p className="inline-flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400">
                            <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />
                            No EVOC certification on file
                          </p>
                        )
                      )}

                      {member.apparatus_cleared.length > 0 ? (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {member.apparatus_cleared.map((clearance) => (
                            <span
                              key={clearance.apparatus_id}
                              className="border-theme-surface-border text-theme-text-secondary inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px]"
                              title={
                                clearance.certification_expiration
                                  ? `Certification expires ${formatDate(clearance.certification_expiration, tz)}`
                                  : 'No expiration recorded'
                              }
                            >
                              <Truck className="h-3 w-3" aria-hidden="true" />
                              {clearance.unit_number}
                            </span>
                          ))}
                        </div>
                      ) : (
                        isDrivingPosition && (
                          <p className="text-theme-text-muted mt-1 text-[11px]">
                            Not listed as an operator on any apparatus
                          </p>
                        )
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {members.length === 0 && (
                <p className="text-theme-text-muted py-8 text-center text-sm">No members match “{search.trim()}”.</p>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
};

export default PositionRosterPage;
