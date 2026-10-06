/**
 * The one ballot model both ballots share (the emailed token page and the
 * in-app Cast Vote tab). A ballot is a list of ballot items — a plain
 * election position arrives as an item too, synthesized by the server with an
 * id of `position:<name>` — and each item's selection is sent as a
 * `BallotItemVote`. Before 2026-10-05 the in-app tab derived its own ballot
 * from `election.positions` and missed every ballot item; keeping the choice
 * logic here is what stops the two from drifting apart again.
 */

import type { BallotItem, BallotItemVote, Candidate } from '../../types/election';
import { BallotChoice, VoteType, VotingMethod } from '../../constants/enums';

export type ItemChoice = {
  choice: string; // 'approve' | 'deny' | 'write_in' | 'abstain' | candidate UUID | '' (multi/ranked)
  write_in_name: string;
  // Multi-select for approval / multi-vote items (candidate UUIDs)
  candidate_ids: string[];
  // Ranked choice: candidate UUID → rank number (unique per item)
  ranks: Record<string, number>;
};

/** The election settings an item's form depends on. */
export interface BallotSettings {
  allow_write_ins: boolean;
  voting_method: string;
  max_votes_per_position: number;
}

export const emptyChoice = (): ItemChoice => ({
  choice: BallotChoice.ABSTAIN,
  write_in_name: '',
  candidate_ids: [],
  ranks: {},
});

/** Ordered candidate ids for the wire payload — index 0 = rank 1. */
export const ranksToOrderedIds = (ranks: Record<string, number>): string[] =>
  Object.entries(ranks)
    .sort((a, b) => a[1] - b[1])
    .map(([cid]) => cid);

/**
 * Accepted candidates for a ballot item, matched by exact position. Substring
 * matching against the item title is deliberately avoided — a position named
 * "Chief" would match an item titled "Assistant Chief Election". A legacy item
 * persisted without a position keys its candidates by its title or its id,
 * the same aliases the server resolves (`ballot_item_candidate_positions`).
 */
export const candidatesForItem = (item: BallotItem, candidates: Candidate[]): Candidate[] => {
  if (item.position) {
    return candidates.filter((c) => c.position === item.position && !c.is_write_in);
  }
  return candidates.filter(
    (c) => c.position != null && (c.position === item.title || c.position === item.id) && !c.is_write_in
  );
};

/** How an item is answered, read the same way the server reads it. */
export interface ItemForm {
  isApprovalType: boolean;
  isRanked: boolean;
  isMultiSelect: boolean;
  /** null = no cap (approval method) */
  selectionCap: number | null;
}

export const itemForm = (item: BallotItem, settings: BallotSettings): ItemForm => {
  const isApprovalType = item.vote_type === VoteType.APPROVAL;
  // Items may override the election-level method (mirrors backend)
  const effectiveMethod = item.voting_method ?? settings.voting_method;
  const maxVotes = settings.max_votes_per_position || 1;
  const isRanked = !isApprovalType && effectiveMethod === VotingMethod.RANKED_CHOICE;
  const isMultiSelect = !isApprovalType && !isRanked && (effectiveMethod === VotingMethod.APPROVAL || maxVotes > 1);
  // Approval-method items have no selection cap; multi-vote items do
  const selectionCap = effectiveMethod === VotingMethod.APPROVAL ? null : maxVotes;
  return { isApprovalType, isRanked, isMultiSelect, selectionCap };
};

/** One item's selection as the wire form the server accepts. */
export const choiceToVote = (itemId: string, itemChoice: ItemChoice): BallotItemVote => {
  if (itemChoice.candidate_ids.length > 0) {
    return { ballot_item_id: itemId, candidate_ids: itemChoice.candidate_ids };
  }
  const ordered = ranksToOrderedIds(itemChoice.ranks);
  if (ordered.length > 0) {
    return { ballot_item_id: itemId, rankings: ordered };
  }
  return {
    ballot_item_id: itemId,
    choice: itemChoice.choice || BallotChoice.ABSTAIN,
    write_in_name: itemChoice.choice === BallotChoice.WRITE_IN ? itemChoice.write_in_name.trim() : undefined,
  };
};

/** Converts a selection (choice/multi-select/rankings) to a display label. */
export const choiceLabel = (itemChoice: ItemChoice | undefined, candidates: Candidate[]): string => {
  if (!itemChoice) return 'Abstain (No Vote)';
  const name = (candidateId: string): string => candidates.find((c) => c.id === candidateId)?.name ?? candidateId;

  if (itemChoice.candidate_ids.length > 0) {
    return `Approved: ${itemChoice.candidate_ids.map(name).join(', ')}`;
  }
  const ordered = ranksToOrderedIds(itemChoice.ranks);
  if (ordered.length > 0) {
    return `Ranked: ${ordered.map((cid, i) => `${i + 1}. ${name(cid)}`).join(', ')}`;
  }
  switch (itemChoice.choice) {
    case '':
    case BallotChoice.ABSTAIN:
      return 'Abstain (No Vote)';
    case BallotChoice.APPROVE:
      return 'Approve';
    case BallotChoice.DENY:
      return 'Deny';
    case BallotChoice.WRITE_IN:
      return `Write-in: ${itemChoice.write_in_name || '(empty)'}`;
    default:
      return name(itemChoice.choice);
  }
};

/** The first write-in left without a name, for the pre-submit check. */
export const missingWriteIn = (choices: Record<string, ItemChoice>, items: BallotItem[]): BallotItem | undefined =>
  items.find((item) => {
    const c = choices[item.id];
    return c?.choice === BallotChoice.WRITE_IN && !c.write_in_name.trim();
  });
