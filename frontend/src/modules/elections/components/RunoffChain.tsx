/**
 * Runoff Chain Component
 *
 * Visualizes multi-stage elections as a horizontal chain: Original → Runoff 1 → Runoff 2.
 * Each node shows status, vote count, and links to the election detail page.
 * The current election is highlighted with a ring indicator.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowRight,
  CheckCircle2,
  Circle,
  Loader2,
  RotateCcw,
  Vote,
  XCircle,
} from 'lucide-react';
import { electionService } from '../../../services/api';
import type { Election } from '../../../types/election';
import { ElectionStatus } from '../../../constants/enums';
import { getStatusBadgeClass } from '../../../utils/electionHelpers';

interface RunoffChainProps {
  election: Election;
}

interface ChainNode {
  id: string;
  title: string;
  status: string;
  runoff_round: number;
  total_votes?: number | undefined;
}

const StatusIcon: React.FC<{ status: string }> = ({ status }) => {
  switch (status) {
    case ElectionStatus.CLOSED:
      return <CheckCircle2 className="h-4 w-4" />;
    case ElectionStatus.OPEN:
      return <Vote className="h-4 w-4" />;
    case ElectionStatus.CANCELLED:
      return <XCircle className="h-4 w-4" />;
    default:
      return <Circle className="h-4 w-4" />;
  }
};

export const RunoffChain: React.FC<RunoffChainProps> = ({ election }) => {
  const [chain, setChain] = useState<ChainNode[]>([]);
  const [loading, setLoading] = useState(true);

  const buildChain = useCallback(async () => {
    try {
      setLoading(true);
      const elections = await electionService.getElections();
      const nodes: ChainNode[] = [];

      // Find root election (walk up parent chain)
      let rootId = election.id;
      if (election.parent_election_id) {
        rootId = election.parent_election_id;
        // The parent might also have a parent — fetch it
        try {
          const parent = await electionService.getElection(rootId);
          if (parent.parent_election_id) {
            rootId = parent.parent_election_id;
          }
        } catch {
          // Use what we have
        }
      }

      // Add root
      const rootItem = elections.find((e) => e.id === rootId);
      if (rootItem) {
        nodes.push({
          id: rootItem.id,
          title: rootItem.title,
          status: rootItem.status,
          runoff_round: 0,
          total_votes: rootItem.total_votes,
        });
      } else if (rootId === election.id) {
        nodes.push({
          id: election.id,
          title: election.title,
          status: election.status,
          runoff_round: election.runoff_round,
          total_votes: election.total_votes,
        });
      }

      // Find children by iterating list items (they don't expose parent_election_id
      // in the list schema, so we fetch each potential runoff)
      for (const e of elections) {
        if (e.id === rootId) continue;
        try {
          const full = await electionService.getElection(e.id);
          if (full.parent_election_id === rootId || full.parent_election_id === election.id) {
            nodes.push({
              id: full.id,
              title: full.title,
              status: full.status,
              runoff_round: full.runoff_round,
              total_votes: full.total_votes,
            });
          }
        } catch {
          // Skip inaccessible elections
        }
      }

      // Sort by runoff_round
      nodes.sort((a, b) => a.runoff_round - b.runoff_round);
      setChain(nodes);
    } catch {
      // Non-critical — section just won't show
    } finally {
      setLoading(false);
    }
  }, [election]);

  useEffect(() => {
    if (election.is_runoff || election.enable_runoffs) {
      void buildChain();
    } else {
      setLoading(false);
    }
  }, [election, buildChain]);

  // Only show if this is part of a multi-stage election
  if (!election.is_runoff && !election.enable_runoffs) return null;
  if (!loading && chain.length <= 1) return null;

  return (
    <div className="bg-theme-surface backdrop-blur-xs shadow-sm rounded-lg p-4 mb-6">
      <div className="flex items-center gap-2 mb-3">
        <RotateCcw className="h-4 w-4 text-purple-600 dark:text-purple-400" />
        <h3 className="text-sm font-semibold text-theme-text-primary">
          Multi-Stage Election Chain
        </h3>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-theme-text-muted py-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading election chain...
        </div>
      ) : (
        <div className="flex items-center gap-1 overflow-x-auto pb-1">
          {chain.map((node, idx) => {
            const isCurrent = node.id === election.id;
            return (
              <React.Fragment key={node.id}>
                {idx > 0 && (
                  <ArrowRight className="h-4 w-4 text-theme-text-muted shrink-0 mx-1" />
                )}
                <Link
                  to={`/elections/${node.id}`}
                  aria-current={isCurrent ? 'page' : undefined}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg border-2 shrink-0 transition-colors ${
                    isCurrent
                      ? 'border-purple-500 bg-purple-500/10 ring-2 ring-purple-500/20'
                      : 'border-theme-surface-border bg-theme-surface hover:bg-theme-surface-hover'
                  }`}
                >
                  <div className={getStatusBadgeClass(node.status) + ' rounded-full p-1'}>
                    <StatusIcon status={node.status} />
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-theme-text-primary truncate max-w-[140px]">
                      {node.runoff_round === 0 ? 'Original' : `Runoff ${node.runoff_round}`}
                    </div>
                    <div className="text-xs text-theme-text-muted">
                      {node.status}
                      {node.total_votes != null && node.total_votes > 0
                        ? ` · ${node.total_votes} votes`
                        : ''}
                    </div>
                  </div>
                </Link>
              </React.Fragment>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default RunoffChain;
