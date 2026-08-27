/**
 * Did the gate behave?
 *
 * Each mark carries what the screen predicted the account would meet and what
 * the tester actually found. Comparing the two is the payoff of testing from
 * several accounts: a page that opens for somebody it should refuse is a
 * defect nobody would otherwise notice, because from inside that account it
 * looks exactly like a page that worked.
 *
 * The good case is worth counting too. A refusal that happened as predicted is
 * evidence the gate holds, and a report that can say "84 refusals verified
 * across three accounts" says something a pass count cannot.
 */

import type { TestingAccessExpectation } from './services/api';
import type { TestStatus } from './useTestingChecklist';

export type GateVerdict =
  /** Nothing to say: not tested yet, no prediction stored, or an ordinary bug. */
  | 'none'
  /** Expected to refuse, and it refused. The gate is proved. */
  | 'refusal-verified'
  /** Expected to refuse, and it opened. A gate defect. */
  | 'opened-when-refused'
  /** Expected to open, and it refused. A grant defect. */
  | 'refused-when-allowed';

export interface GateVerdictInput {
  status: TestStatus;
  expectedAccess?: TestingAccessExpectation | undefined;
}

const SHOULD_REFUSE: readonly TestingAccessExpectation[] = ['denied', 'module-off'];

export const gateVerdict = ({ status, expectedAccess }: GateVerdictInput): GateVerdict => {
  if (!expectedAccess || status === 'untested') return 'none';

  if (SHOULD_REFUSE.includes(expectedAccess)) {
    if (status === 'blocked') return 'refusal-verified';
    // A page that opened for an account the app expected to turn away. `fail`
    // is deliberately not this: the tester got in and something else was
    // broken, which is an ordinary defect and says nothing about the gate.
    if (status === 'pass') return 'opened-when-refused';
    return 'none';
  }

  // Expected to open. A refusal here is a missing grant, not a bug on the page.
  return status === 'blocked' ? 'refused-when-allowed' : 'none';
};

/** The two verdicts that are findings rather than confirmations. */
export type GateMismatch = 'opened-when-refused' | 'refused-when-allowed';

/** A type guard, so a caller that has narrowed can index the label table. */
export const isGateMismatch = (verdict: GateVerdict): verdict is GateMismatch =>
  verdict === 'opened-when-refused' || verdict === 'refused-when-allowed';

export const GATE_VERDICT_LABELS: Record<Exclude<GateVerdict, 'none'>, string> = {
  'refusal-verified': 'Refusal verified',
  'opened-when-refused': 'Opened when it should have refused',
  'refused-when-allowed': 'Refused when it should have opened',
};

export interface GateVerdictTally {
  verified: number;
  mismatches: number;
}

export const tallyGateVerdicts = (marks: readonly GateVerdictInput[]): GateVerdictTally => {
  let verified = 0;
  let mismatches = 0;
  for (const mark of marks) {
    const verdict = gateVerdict(mark);
    if (verdict === 'refusal-verified') verified += 1;
    else if (isGateMismatch(verdict)) mismatches += 1;
  }
  return { verified, mismatches };
};
