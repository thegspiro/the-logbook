import type { MotionCreate, MotionThreshold, RollCallEntry, RollCallVote } from '../types/minutes';

/**
 * What the secretary has entered about a vote, before it is sent.
 *
 * Counts are strings because they are what a number input holds: an empty box
 * is "not recorded", which is not the same as zero.
 */
export interface VoteDraft {
  threshold: MotionThreshold;
  mode: 'counts' | 'roll';
  votesFor: string;
  votesAgainst: string;
  votesAbstain: string;
  votesRecused: string;
  /** Member name -> vote, for a roll call; a member with no entry did not vote. */
  roll: Record<string, RollCallVote | ''>;
}

export const DEFAULT_THRESHOLD: MotionThreshold = 'majority_cast';

export const THRESHOLD_LABELS: Record<MotionThreshold, string> = {
  majority_cast: 'Majority of the votes cast',
  majority_present: 'Majority of members present',
  two_thirds: 'Two-thirds of the votes cast',
};

export const VOTE_LABELS: Record<RollCallVote, string> = {
  yes: 'Yes',
  no: 'No',
  abstain: 'Abstain',
  recuse: 'Recuse',
};

export const emptyVoteDraft = (): VoteDraft => ({
  threshold: DEFAULT_THRESHOLD,
  mode: 'counts',
  votesFor: '',
  votesAgainst: '',
  votesAbstain: '',
  votesRecused: '',
  roll: {},
});

const count = (value: string): number | undefined => {
  const trimmed = value.trim();
  if (trimmed === '') return undefined;
  const parsed = Number(trimmed);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : undefined;
};

/** The roll call as sent: members who voted, in the order the roll lists them. */
export const rollCallEntries = (draft: VoteDraft, voters: string[]): RollCallEntry[] =>
  voters.flatMap((name) => {
    const vote = draft.roll[name];
    return vote ? [{ name, vote }] : [];
  });

/** The totals a roll call adds up to, for showing while it is being filled in. */
export const rollTotals = (entries: RollCallEntry[]) => ({
  yes: entries.filter((e) => e.vote === 'yes').length,
  no: entries.filter((e) => e.vote === 'no').length,
  abstain: entries.filter((e) => e.vote === 'abstain').length,
  recuse: entries.filter((e) => e.vote === 'recuse').length,
});

/**
 * The vote fields of a motion payload. In roll-call mode only the roll call is
 * sent: the server counts it, so the totals cannot disagree with it. A
 * threshold is sent only when it is not the default, and nothing is sent for a
 * motion carried without a count.
 */
export const voteDraftPayload = (
  draft: VoteDraft,
  voters: string[]
): Pick<
  MotionCreate,
  'threshold' | 'votes_for' | 'votes_against' | 'votes_abstain' | 'votes_recused' | 'roll_call'
> => {
  const threshold = draft.threshold === DEFAULT_THRESHOLD ? undefined : draft.threshold;
  if (draft.mode === 'roll') {
    const entries = rollCallEntries(draft, voters);
    return { threshold, roll_call: entries.length > 0 ? entries : undefined };
  }
  return {
    threshold,
    votes_for: count(draft.votesFor),
    votes_against: count(draft.votesAgainst),
    votes_abstain: count(draft.votesAbstain),
    votes_recused: count(draft.votesRecused),
  };
};
