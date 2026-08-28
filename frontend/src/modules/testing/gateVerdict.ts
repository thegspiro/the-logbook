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
  /**
   * Expected to open, and the tester marked it blocked.
   *
   * Deliberately **not** counted as a defect. "Blocked" covers more than a
   * refusal — the module is off, the sample record does not exist, the data
   * has not been created yet — so a parameterized page marked blocked for want
   * of an id would otherwise be reported as a permissions failure that never
   * happened. Worth surfacing for a human to confirm; not worth asserting.
   */
  | 'blocked-where-expected-open';

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

  // Expected to open. A block here *may* be a missing grant — or simply a page
  // the tester could not reach for want of data. Flagged for confirmation
  // rather than counted as a finding; see the verdict's own doc comment.
  return status === 'blocked' ? 'blocked-where-expected-open' : 'none';
};

/**
 * The verdict that is a finding rather than a confirmation.
 *
 * Only this direction is unambiguous: the tester got into a page the app
 * predicted would refuse them, which no amount of missing data explains.
 */
export type GateMismatch = 'opened-when-refused';

/** A type guard, so a caller that has narrowed can index the label table. */
export const isGateMismatch = (verdict: GateVerdict): verdict is GateMismatch => verdict === 'opened-when-refused';

/** Needs a human to say which it was; not counted as a defect. */
export const needsGateConfirmation = (verdict: GateVerdict): verdict is 'blocked-where-expected-open' =>
  verdict === 'blocked-where-expected-open';

export const GATE_VERDICT_LABELS: Record<Exclude<GateVerdict, 'none'>, string> = {
  'refusal-verified': 'Refusal verified',
  'opened-when-refused': 'Opened when it should have refused',
  'blocked-where-expected-open': 'Blocked, though this account should be able to open it',
};

export interface GateVerdictTally {
  verified: number;
  mismatches: number;
  /** Blocks on pages this account should have been able to open. */
  needsConfirmation: number;
}

export const tallyGateVerdicts = (marks: readonly GateVerdictInput[]): GateVerdictTally => {
  let verified = 0;
  let mismatches = 0;
  let needsConfirmation = 0;
  for (const mark of marks) {
    const verdict = gateVerdict(mark);
    if (verdict === 'refusal-verified') verified += 1;
    else if (isGateMismatch(verdict)) mismatches += 1;
    else if (needsGateConfirmation(verdict)) needsConfirmation += 1;
  }
  return { verified, mismatches, needsConfirmation };
};
