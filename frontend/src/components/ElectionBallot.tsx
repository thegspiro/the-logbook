/**
 * Election Ballot — the in-app Cast Vote tab.
 *
 * The same ballot the emailed link carries (owner decision 2026-10-05):
 * every ballot item and every plain position, served by
 * `GET /elections/{id}/ballot` as ballot items and rendered through the
 * shared `BallotItemCard`. It used to be built from `election.positions`
 * alone, so a motion or membership item was invisible here and a
 * "choose up to N" race was pick-one (W50-10, ELEC-28).
 *
 * Unlike the emailed link it is not single-use: an item left on Abstain
 * stays open, and an item already voted on is shown as done. A member who
 * holds someone's proxy chooses whom they are voting for; the proxy ballot
 * is that member's, with their eligibility and their votes so far.
 */

import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { electionService } from '../services/api';
import type { Election, MemberBallotProxy, MemberBallotResponse } from '../types/election';
import { getErrorMessage } from '../utils/errorHandling';
import { useConfirm } from '../contexts/ConfirmContext';
import { VerifyReceipt } from './VerifyReceipt';
import { BallotItemCard } from './ballot/BallotItemCard';
import { useBallotChoices } from './ballot/useBallotChoices';
import { candidatesForItem, choiceLabel, choiceToVote, emptyChoice, missingWriteIn } from './ballot/ballotChoices';

interface ElectionBallotProps {
  electionId: string;
  election: Election;
  onVoteCast?: () => void;
}

export const ElectionBallot: React.FC<ElectionBallotProps> = ({ electionId, onVoteCast }) => {
  const { confirm } = useConfirm();
  const [ballot, setBallot] = useState<MemberBallotResponse | null>(null);
  const [proxies, setProxies] = useState<MemberBallotProxy[]>([]);
  const [proxyUnavailable, setProxyUnavailable] = useState<string | null>(null);
  const [votingFor, setVotingFor] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Receipts from casts made in this session. The API hands each hash back
  // exactly once; a voter who leaves without it has nothing to verify (W50-53).
  const [receipts, setReceipts] = useState<string[]>([]);
  const { choices, resetChoices, updateChoice, updateWriteInName, toggleCandidate, setCandidateRank } =
    useBallotChoices();

  const loadBallot = useCallback(
    async (proxyAuthorizationId: string) => {
      try {
        setLoading(true);
        setError(null);
        const data = await electionService.getMemberBallot(electionId, proxyAuthorizationId || undefined);
        setBallot(data);
        resetChoices(data.election.ballot_items ?? []);
      } catch (err: unknown) {
        setBallot(null);
        setError(getErrorMessage(err, 'Failed to load ballot'));
      } finally {
        setLoading(false);
      }
    },
    [electionId, resetChoices]
  );

  useEffect(() => {
    void loadBallot('');
    // A member with no proxies, or an election where they cannot be used,
    // just sees their own ballot; the list is a convenience, never a gate.
    electionService
      .getMyProxies(electionId)
      .then((data) => {
        setProxies(data.proxies);
        setProxyUnavailable(data.unavailable_reason ?? null);
      })
      .catch(() => {
        setProxies([]);
      });
  }, [electionId, loadBallot]);

  const handleVotingFor = (proxyAuthorizationId: string) => {
    setVotingFor(proxyAuthorizationId);
    setReceipts([]);
    void loadBallot(proxyAuthorizationId);
  };

  const items = ballot?.election.ballot_items ?? [];
  const statusById = new Map((ballot?.items ?? []).map((s) => [s.ballot_item_id, s]));
  const openItems = items.filter((item) => {
    const status = statusById.get(item.id);
    return status?.eligible === true && !status.voted;
  });
  const votedItems = items.filter((item) => statusById.get(item.id)?.voted === true);
  const proxyName = ballot?.proxy?.delegating_user_name || 'the member';

  const handleSubmit = async () => {
    if (!ballot) return;
    const unnamed = missingWriteIn(choices, openItems);
    if (unnamed) {
      setError(`Enter a name for your write-in on: ${unnamed.title}`);
      return;
    }
    const summary = openItems
      .map((item) => `${item.title}: ${choiceLabel(choices[item.id], ballot.candidates)}`)
      .join('; ');
    const ok = await confirm({
      title: ballot.proxy ? `Cast ${proxyName}'s ballot` : 'Cast your ballot',
      message: `${summary}. Votes cannot be changed once cast; an item left on Abstain stays open to vote on later.`,
      confirmLabel: 'Cast ballot',
      cancelLabel: 'Change ballot',
    });
    if (!ok) return;

    try {
      setSubmitting(true);
      setError(null);
      const result = await electionService.submitMemberBallot(
        electionId,
        openItems.map((item) => choiceToVote(item.id, choices[item.id] ?? emptyChoice())),
        votingFor || undefined
      );
      setReceipts((prev) => [...prev, ...(result.receipt_hashes ?? [])]);
      toast.success(result.message);
      onVoteCast?.();
      await loadBallot(votingFor);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to cast ballot'));
    } finally {
      setSubmitting(false);
    }
  };

  const proxyChooser =
    proxies.length > 0 ? (
      <div className="mb-4">
        <label htmlFor="ballot-voting-for" className="form-label">
          Voting for
        </label>
        <select
          id="ballot-voting-for"
          value={votingFor}
          onChange={(e) => handleVotingFor(e.target.value)}
          className="form-input"
        >
          <option value="">Myself</option>
          {proxies.map((p) => (
            <option key={p.authorization_id} value={p.authorization_id}>
              {`${p.delegating_user_name || 'A member'} (as their proxy)`}
            </option>
          ))}
        </select>
      </div>
    ) : proxyUnavailable ? (
      <p className="text-theme-text-muted mb-4 text-xs">{proxyUnavailable}</p>
    ) : null;

  const receiptBlock =
    receipts.length > 0 ? (
      <div className="border-theme-surface-border mt-4 border-t pt-3 text-sm" data-testid="ballot-receipts">
        <p className="text-theme-text-secondary font-medium">Vote Receipt</p>
        <p className="text-theme-text-muted mb-2 text-xs">
          Save this receipt to verify your vote was counted. It cannot reveal how you voted.
        </p>
        {receipts.map((hash) => (
          <code
            key={hash}
            className="bg-theme-surface text-theme-text-primary mb-1 block rounded px-2 py-1 font-mono text-xs break-all"
          >
            {hash}
          </code>
        ))}
      </div>
    ) : null;

  if (loading) {
    return (
      <div className="bg-theme-surface rounded-lg p-6 backdrop-blur-xs">
        <div className="text-theme-text-muted py-4 text-center">Loading ballot...</div>
      </div>
    );
  }

  if (!ballot) {
    return (
      <div className="space-y-4">
        {proxyChooser}
        <div role="alert" className="rounded-lg border border-red-500/30 bg-red-500/10 p-4">
          <p className="text-sm text-red-700 dark:text-red-300">{error ?? 'Failed to load ballot'}</p>
        </div>
      </div>
    );
  }

  if (openItems.length === 0) {
    const reason = items.map((item) => statusById.get(item.id)?.reason).find((r) => r);
    const allDone = votedItems.length > 0;
    return (
      <div className="space-y-6">
        {proxyChooser}
        <div
          className={`rounded-lg border p-6 ${
            allDone ? 'border-green-500/30 bg-green-500/10' : 'border-yellow-500/30 bg-yellow-500/10'
          }`}
        >
          <p
            className={
              allDone ? 'font-medium text-green-700 dark:text-green-300' : 'text-yellow-700 dark:text-yellow-300'
            }
          >
            {allDone
              ? ballot.proxy
                ? `${proxyName} has voted on every item they can vote on.`
                : 'You have already voted in this election.'
              : reason ||
                'You are not eligible to vote in this election. Contact the election administrator for details.'}
          </p>
          {receiptBlock}
        </div>
        <VerifyReceipt electionId={electionId} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="bg-theme-surface rounded-lg p-6 backdrop-blur-xs">
        <h3 className="text-theme-text-primary mb-2 text-lg font-medium">Cast Your Vote</h3>
        {proxyChooser}
        {ballot.proxy && (
          <div role="status" className="alert-warning mb-4">
            <p className="text-sm font-medium">Voting as proxy for: {proxyName}</p>
            <p className="text-xs">This is their ballot. The votes are recorded as theirs, cast by you.</p>
          </div>
        )}
        <p className="text-theme-text-muted mb-4 text-sm">
          Make a selection on the items you are voting on now. An item left on Abstain stays open.
        </p>

        {error && (
          <div
            role="alert"
            aria-live="assertive"
            className="mb-4 rounded-sm border border-red-500/30 bg-red-500/10 p-3"
          >
            <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
          </div>
        )}

        <div className="space-y-6">
          {items.map((item, index) => {
            const status = statusById.get(item.id);
            const closedNote = status?.voted
              ? ballot.proxy
                ? `${proxyName} has already voted on this item.`
                : 'You have already voted on this item.'
              : status && !status.eligible
                ? status.reason || 'Not eligible to vote on this item.'
                : undefined;
            return (
              <BallotItemCard
                key={item.id}
                item={item}
                index={index}
                settings={ballot.election}
                candidates={candidatesForItem(item, ballot.candidates)}
                choice={choices[item.id]}
                onChoice={updateChoice}
                onWriteInName={updateWriteInName}
                onToggleCandidate={toggleCandidate}
                onRank={setCandidateRank}
                closedNote={closedNote ? <p className="text-theme-text-muted text-sm">{closedNote}</p> : undefined}
              />
            );
          })}
        </div>

        <div className="mt-6 flex justify-end">
          <button type="button" onClick={() => void handleSubmit()} disabled={submitting} className="btn-primary">
            {submitting ? 'Casting...' : ballot.proxy ? `Cast ${proxyName}'s Ballot` : 'Cast Ballot'}
          </button>
        </div>
        {receiptBlock}
      </div>
      <VerifyReceipt electionId={electionId} />
    </div>
  );
};

export default ElectionBallot;
