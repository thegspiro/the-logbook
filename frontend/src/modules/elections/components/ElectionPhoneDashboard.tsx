/**
 * An election's Overview on a phone, for whoever runs it: the meeting-night
 * view.
 *
 * Setting an election up is a tablet or computer task; on a phone the officer
 * is in the room, running the vote and reading the result out. So the phone
 * leads with what that needs — how many have voted, how long is left, the one
 * step that moves the election on — then the things done on the night, as a
 * list of large rows. Everything else is one tap away under More: every
 * section, and the full Overview with all of its controls, so nothing the
 * larger screen offers is out of reach.
 *
 * The count is the stats endpoint's, as LiveTurnoutPanel reads it, refreshed
 * while voting is open. It never carries per-candidate numbers: results stay
 * sealed until close.
 */

import React, { useCallback, useEffect, useId, useState } from 'react';
import { Link } from 'react-router';
import { ChevronDown, ChevronRight, Clock, Monitor } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { Election, ElectionStats } from '../../../types/election';
import { ElectionStatus } from '../../../constants/enums';
import { electionService } from '../../../services/electionService';
import { BACKGROUND_REQUEST_CONFIG } from '../../../utils/backgroundRequest';
import { formatDateTime } from '../../../utils/dateFormatting';
import { getTimeRemaining } from '../../../utils/electionHelpers';
import { electionSectionPath, visibleElectionSections } from '../electionSections';

const REFRESH_MS = 15000;

/** A row in the night-of list: a button that opens a dialog, or a link to a section. */
export interface DashboardAction {
  key: string;
  label: string;
  icon: LucideIcon;
  onClick?: (() => void) | undefined;
  to?: string | undefined;
  disabled?: boolean | undefined;
}

interface ElectionPhoneDashboardProps {
  electionId: string;
  election: Election;
  tz: string;
  /** The step that moves this election on, as the header offers it. */
  primaryAction: { label: string; onClick: () => void } | null;
  actions: DashboardAction[];
  candidateCount?: number | undefined;
  /** Whether the full Overview (details and every control) is shown below. */
  showDetails: boolean;
  onToggleDetails: () => void;
}

const rowClass =
  'text-theme-text-primary hover:bg-theme-surface-hover flex min-h-14 w-full items-center justify-between gap-3 px-4 py-3 text-left text-sm disabled:opacity-50';

export const ElectionPhoneDashboard: React.FC<ElectionPhoneDashboardProps> = ({
  electionId,
  election,
  tz,
  primaryAction,
  actions,
  candidateCount,
  showDetails,
  onToggleDetails,
}) => {
  const moreId = useId();
  const [showMore, setShowMore] = useState(false);
  const [stats, setStats] = useState<ElectionStats | null>(null);
  const isOpen = election.status === ElectionStatus.OPEN;
  const isClosed = election.status === ElectionStatus.CLOSED;
  const tallied = isOpen || isClosed;

  const refresh = useCallback(async () => {
    try {
      setStats(await electionService.getStats(electionId, BACKGROUND_REQUEST_CONFIG));
    } catch {
      // Transient failure: keep the last numbers, or the election's own.
    }
  }, [electionId]);

  useEffect(() => {
    if (!tallied) return undefined;
    void refresh();
    if (!isOpen) return undefined;
    const interval = setInterval(() => {
      if (!document.hidden) void refresh();
    }, REFRESH_MS);
    return () => clearInterval(interval);
  }, [refresh, tallied, isOpen]);

  const voters = stats?.total_voters ?? election.total_voters ?? null;
  const eligible = stats?.total_eligible_voters ?? null;
  const percent = eligible && voters != null ? Math.min(100, Math.round((voters / eligible) * 100)) : null;
  const remaining = isOpen ? getTimeRemaining(election.end_date) : null;
  const resultsAvailable = isClosed || election.results_visible_immediately;
  const sections = visibleElectionSections(election, true, candidateCount);

  return (
    <div className="mb-6 space-y-4">
      <div className="card p-5 text-center">
        {/* No status badge: the title above already carries it. */}

        {tallied && voters != null ? (
          <>
            <p className="text-theme-text-primary text-5xl font-bold" data-testid="dashboard-voted">
              {voters}
              {eligible ? <span className="text-theme-text-muted text-2xl font-semibold"> / {eligible}</span> : null}
            </p>
            <p className="text-theme-text-secondary text-sm">
              {voters === 1 ? 'member has voted' : 'members have voted'}
            </p>
            {percent != null && (
              <div
                className="bg-theme-surface-secondary mt-4 h-2 overflow-hidden rounded-full"
                role="progressbar"
                aria-label="Turnout"
                aria-valuenow={percent}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div className="h-2 rounded-full bg-green-700" style={{ width: `${percent}%` }} />
              </div>
            )}
          </>
        ) : (
          <p className="text-theme-text-secondary flex items-start justify-center gap-2 text-sm">
            <Monitor className="text-theme-text-muted mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            <span>Set up the ballot, candidates and voters on a tablet or computer.</span>
          </p>
        )}

        <p className="text-theme-text-primary mt-4 flex items-center justify-center gap-1.5 text-sm font-medium">
          <Clock className="text-theme-text-muted h-4 w-4 shrink-0" aria-hidden="true" />
          {isOpen
            ? remaining
              ? remaining
              : 'Voting period has ended'
            : isClosed
              ? `Closed ${formatDateTime(election.closed_at ?? election.end_date, tz)}`
              : `Voting opens ${formatDateTime(election.start_date, tz)}`}
        </p>

        {primaryAction && (
          <button type="button" onClick={primaryAction.onClick} className="btn-primary mt-4 w-full">
            {primaryAction.label}
          </button>
        )}
      </div>

      {/* Live / Results / More. Results is a link to its own address — the one
          a secretary sends round — so it is shown only once there are results. */}
      <div className="bg-theme-surface-secondary grid grid-cols-3 gap-1 rounded-lg p-1 text-sm font-medium">
        <span
          aria-current="page"
          className="bg-theme-surface text-theme-text-primary rounded-md py-2.5 text-center shadow-sm"
        >
          {isOpen ? 'Live' : 'Now'}
        </span>
        {resultsAvailable ? (
          <Link
            to={electionSectionPath(electionId, 'results')}
            className="text-theme-text-muted hover:text-theme-text-primary rounded-md py-2.5 text-center"
          >
            Results
          </Link>
        ) : (
          <span className="text-theme-text-muted rounded-md py-2.5 text-center opacity-60" aria-disabled="true">
            Results
          </span>
        )}
        <button
          type="button"
          aria-expanded={showMore}
          aria-controls={moreId}
          onClick={() => setShowMore((open) => !open)}
          className={`inline-flex items-center justify-center gap-1 rounded-md py-2.5 ${
            showMore ? 'bg-theme-surface text-theme-text-primary shadow-sm' : 'text-theme-text-muted'
          }`}
        >
          More
          <ChevronDown className={`h-4 w-4 transition-transform ${showMore ? 'rotate-180' : ''}`} aria-hidden="true" />
        </button>
      </div>

      {showMore ? (
        <nav id={moreId} aria-label="All of this election" className="card divide-theme-surface-border divide-y">
          {sections.map((section) => {
            const Icon = section.icon;
            return (
              <Link key={section.id} to={electionSectionPath(electionId, section.id)} className={rowClass}>
                <span className="flex items-center gap-3">
                  <Icon className="text-theme-text-muted h-5 w-5 shrink-0" aria-hidden="true" />
                  {section.label}
                </span>
                <ChevronRight className="text-theme-text-muted h-4 w-4 shrink-0" aria-hidden="true" />
              </Link>
            );
          })}
          <button type="button" onClick={onToggleDetails} aria-expanded={showDetails} className={rowClass}>
            <span>{showDetails ? 'Hide details and all controls' : 'Details and all controls'}</span>
            <ChevronDown
              className={`text-theme-text-muted h-4 w-4 shrink-0 transition-transform ${showDetails ? 'rotate-180' : ''}`}
              aria-hidden="true"
            />
          </button>
        </nav>
      ) : (
        actions.length > 0 && (
          <ul className="card divide-theme-surface-border divide-y" aria-label="Tonight">
            {actions.map((action) => {
              const Icon = action.icon;
              const body = (
                <>
                  <span className="flex items-center gap-3">
                    <Icon className="text-theme-text-muted h-5 w-5 shrink-0" aria-hidden="true" />
                    {action.label}
                  </span>
                  <ChevronRight className="text-theme-text-muted h-4 w-4 shrink-0" aria-hidden="true" />
                </>
              );
              return (
                <li key={action.key}>
                  {action.to ? (
                    <Link to={action.to} className={rowClass}>
                      {body}
                    </Link>
                  ) : (
                    <button type="button" onClick={action.onClick} disabled={action.disabled} className={rowClass}>
                      {body}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )
      )}
    </div>
  );
};

export default ElectionPhoneDashboard;
