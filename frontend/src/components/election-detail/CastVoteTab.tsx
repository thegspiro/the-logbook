/**
 * The Cast Vote tab on the election detail page.
 *
 * The in-app ballot (`ElectionBallot`) is built from `election.positions`
 * only: it never shows a ballot item (a motion, a membership vote) and treats
 * every race as pick-one. An election that has ballot items, or lets a voter
 * pick more than one per race, would get an incomplete ballot there — and a
 * member who voted it would then find the race "already voted" on the
 * complete emailed ballot. Until the in-app ballot carries the same contests
 * as the emailed one, such an election is voted from the email link only
 * (W50-10, owner decision 2026-10-05).
 */

import React from 'react';
import { Mail } from 'lucide-react';
import type { Election } from '../../types/election';
import { ElectionBallot } from '../ElectionBallot';
import { inAppBallotIsIncomplete } from '../../utils/electionHelpers';

interface CastVoteTabProps {
  electionId: string;
  election: Election;
  onVoteCast: () => void;
}

export const CastVoteTab: React.FC<CastVoteTabProps> = ({ electionId, election, onVoteCast }) => {
  if (inAppBallotIsIncomplete(election)) {
    return (
      <div role="status" className="card flex items-start gap-3 p-6">
        <Mail className="text-theme-text-muted mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
        <div>
          <h3 className="text-theme-text-primary font-medium">Vote from your ballot email</h3>
          <p className="text-theme-text-secondary mt-1 text-sm">
            This ballot has{' '}
            {(election.ballot_items?.length ?? 0) > 0 ? 'ballot items' : 'races where you choose more than one'} that
            the Cast Vote tab cannot show. Open the <strong>Vote Now</strong> link in the ballot email you were sent —
            it carries the whole ballot.
          </p>
          <p className="text-theme-text-muted mt-2 text-xs">
            No email? Ask the election secretary to send or resend your ballot.
          </p>
        </div>
      </div>
    );
  }

  return <ElectionBallot electionId={electionId} election={election} onVoteCast={onVoteCast} />;
};

export default CastVoteTab;
