import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Maximize2, RefreshCw } from 'lucide-react';
import { electionService } from '../../services/electionService';
import type { Election, ElectionStats } from '../../types/election';
import { formatTime } from '../../utils/dateFormatting';
import { useTimezone } from '../../hooks/useTimezone';

interface LiveTurnoutPanelProps {
  electionId: string;
  election: Election;
}

const REFRESH_MS = 15000;

/**
 * Meeting-night turnout dashboard: ballots received vs eligible and the
 * quorum progress bar, auto-refreshing while voting is open. Deliberately
 * shows NO per-candidate numbers — results stay sealed until close.
 */
const LiveTurnoutPanel: React.FC<LiveTurnoutPanelProps> = ({ electionId, election }) => {
  const [stats, setStats] = useState<ElectionStats | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const tz = useTimezone();

  const refresh = useCallback(async () => {
    try {
      const data = await electionService.getStats(electionId);
      setStats(data);
      setLastUpdated(new Date());
    } catch {
      // Transient failure: keep showing the last numbers.
    }
  }, [electionId]);

  useEffect(() => {
    void refresh();
    const interval = setInterval(() => {
      if (!document.hidden) {
        void refresh();
      }
    }, REFRESH_MS);
    return () => clearInterval(interval);
  }, [refresh]);

  const handleFullscreen = () => {
    const el = containerRef.current;
    if (!el) return;
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void el.requestFullscreen();
    }
  };

  const eligible = stats?.total_eligible_voters ?? 0;
  const voters = stats?.total_voters ?? 0;
  const turnout = stats?.voter_turnout_percentage ?? 0;

  const quorumTarget =
    election.quorum_type === 'percentage'
      ? (election.quorum_value ?? 0)
      : election.quorum_type === 'count' && eligible > 0
        ? ((election.quorum_value ?? 0) / eligible) * 100
        : null;
  const quorumMet = quorumTarget !== null && turnout >= quorumTarget;

  return (
    <div ref={containerRef} className="card bg-theme-surface mb-6" role="status" aria-live="polite">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-theme-text-primary text-lg font-medium">Live Turnout</h3>
        <div className="flex items-center gap-2">
          {lastUpdated && (
            <span className="text-theme-text-muted text-xs">Updated {formatTime(lastUpdated.toISOString(), tz)}</span>
          )}
          <button
            type="button"
            onClick={() => {
              void refresh();
            }}
            className="btn-icon"
            aria-label="Refresh turnout"
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
          </button>
          <button type="button" onClick={handleFullscreen} className="btn-icon" aria-label="Toggle fullscreen">
            <Maximize2 className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4 text-center">
        <div>
          <div className="text-theme-text-primary text-4xl font-bold">{voters}</div>
          <div className="text-theme-text-secondary text-sm">Ballots received</div>
        </div>
        <div>
          <div className="text-theme-text-primary text-4xl font-bold">{eligible}</div>
          <div className="text-theme-text-secondary text-sm">Eligible voters</div>
        </div>
        <div>
          <div className="text-theme-text-primary text-4xl font-bold">{Math.round(turnout)}%</div>
          <div className="text-theme-text-secondary text-sm">Turnout</div>
        </div>
      </div>

      {quorumTarget !== null && (
        <div className="mt-4">
          <div className="mb-1 flex justify-between text-sm">
            <span className="text-theme-text-secondary">
              Quorum {quorumMet ? 'met' : 'progress'} (target{' '}
              {election.quorum_type === 'count' ? `${election.quorum_value} voters` : `${election.quorum_value}%`})
            </span>
            <span
              className={quorumMet ? 'font-medium text-green-600 dark:text-green-400' : 'text-theme-text-secondary'}
            >
              {quorumMet ? 'MET' : `${Math.round(turnout)}%`}
            </span>
          </div>
          <div className="bg-theme-surface-hover h-3 w-full overflow-hidden rounded-full">
            <div
              className={`h-full rounded-full ${quorumMet ? 'bg-green-500' : 'bg-amber-500'}`}
              style={{ width: `${Math.min(100, (turnout / quorumTarget) * 100)}%` }}
            />
          </div>
        </div>
      )}

      <p className="text-theme-text-muted mt-3 text-xs">
        Auto-refreshes every 15 seconds. Candidate tallies stay sealed until the election closes.
      </p>
    </div>
  );
};

export default LiveTurnoutPanel;
