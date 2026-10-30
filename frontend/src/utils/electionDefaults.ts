/**
 * Election Defaults
 *
 * The department's starting values for a new election, set under Election
 * Settings → Defaults and read by the create-election form (ELEC2-9). Before
 * this the API stored them and nothing read them.
 *
 * The backend sanitises what it returns, but this side checks again before a
 * value reaches the form, because the form submits whatever it starts with: a
 * method/condition pair the winner-rule picker does not offer, or a quorum
 * with no value, would be sent and refused.
 */

import { QuorumType, VictoryCondition, VotingMethod } from '../constants/enums';
import type { ElectionSettings } from '../types/election';

interface WinnerRule {
  value: string;
  label: string;
  method: VotingMethod;
  condition: VictoryCondition;
}

const rule = (label: string, method: VotingMethod, condition: VictoryCondition): WinnerRule => ({
  value: `${method}|${condition}`,
  label,
  method,
  condition,
});

/** The winner rules the create form offers, as `voting_method|victory_condition`. */
export const WINNER_RULES: readonly WinnerRule[] = [
  rule('Most Votes Wins (Plurality)', VotingMethod.SIMPLE_MAJORITY, VictoryCondition.MOST_VOTES),
  rule('Majority Required (>50%)', VotingMethod.SIMPLE_MAJORITY, VictoryCondition.MAJORITY),
  rule('Supermajority Required (2/3)', VotingMethod.SIMPLE_MAJORITY, VictoryCondition.SUPERMAJORITY),
  rule('Ranked Choice Voting', VotingMethod.RANKED_CHOICE, VictoryCondition.MAJORITY),
  rule('Approval Voting (Yes/No per candidate)', VotingMethod.APPROVAL, VictoryCondition.MOST_VOTES),
  rule('Custom Threshold', VotingMethod.SIMPLE_MAJORITY, VictoryCondition.THRESHOLD),
];

export interface ElectionFormDefaults {
  voting_method: VotingMethod;
  victory_condition: VictoryCondition;
  victory_percentage: number | undefined;
  anonymous_voting: boolean;
  allow_write_ins: boolean;
  quorum_type: QuorumType;
  quorum_value: number | undefined;
}

/** The create form's starting values when the department has set none. */
export const BUILT_IN_ELECTION_DEFAULTS: ElectionFormDefaults = {
  voting_method: VotingMethod.SIMPLE_MAJORITY,
  victory_condition: VictoryCondition.MOST_VOTES,
  victory_percentage: undefined,
  anonymous_voting: true,
  allow_write_ins: false,
  quorum_type: QuorumType.NONE,
  quorum_value: undefined,
};

const isWholeAtLeastOne = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 1;

/** The defaults the create form should start from, given the saved settings. */
export function electionDefaultsFrom(settings: ElectionSettings): ElectionFormDefaults {
  const built = BUILT_IN_ELECTION_DEFAULTS;
  const rule = `${settings.default_voting_method ?? ''}|${settings.default_victory_condition ?? ''}`;
  const knownRule = WINNER_RULES.some((r) => r.value === rule);
  const voting_method = knownRule ? (settings.default_voting_method ?? built.voting_method) : built.voting_method;
  const victory_condition = knownRule
    ? (settings.default_victory_condition ?? built.victory_condition)
    : built.victory_condition;

  // A percentage only means something to the two rules that ask for one.
  const usesPercentage =
    victory_condition === VictoryCondition.SUPERMAJORITY || victory_condition === VictoryCondition.THRESHOLD;
  const pct = settings.default_victory_percentage;
  const victory_percentage = usesPercentage && isWholeAtLeastOne(pct) && pct <= 100 ? pct : undefined;

  // A quorum the create schema would refuse (no value, or over 100%) falls
  // back to none rather than making every new election fail to save.
  const qType = settings.default_quorum_type;
  const qValue = settings.default_quorum_value;
  const quorumValid =
    (qType === QuorumType.COUNT && isWholeAtLeastOne(qValue)) ||
    (qType === QuorumType.PERCENTAGE && isWholeAtLeastOne(qValue) && qValue <= 100);

  return {
    voting_method,
    victory_condition,
    victory_percentage,
    anonymous_voting: settings.default_anonymous_voting ?? built.anonymous_voting,
    allow_write_ins: settings.default_allow_write_ins ?? built.allow_write_ins,
    quorum_type: quorumValid ? qType : QuorumType.NONE,
    quorum_value: quorumValid ? qValue : undefined,
  };
}

/** A sentence naming the quorum, or null when there is none. */
export function describeQuorum(defaults: Pick<ElectionFormDefaults, 'quorum_type' | 'quorum_value'>): string | null {
  if (defaults.quorum_value === undefined) return null;
  if (defaults.quorum_type === QuorumType.PERCENTAGE) return `${defaults.quorum_value}% of eligible voters must vote`;
  if (defaults.quorum_type === QuorumType.COUNT) {
    return `${defaults.quorum_value} ${defaults.quorum_value === 1 ? 'voter' : 'voters'} must vote`;
  }
  return null;
}
