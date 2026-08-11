/**
 * Unsynced skills-evaluation work, for the logout guard.
 *
 * `purgeLocalMemberData` clears every offline store on logout, because fire
 * stations run on shared computers and anything left in the browser profile is
 * readable by whoever sits down next. That policy is right, and it interacts
 * badly with a scored evaluation: an examiner who finishes a drill, cannot
 * reach the server, and signs out loses the evaluation — on a candidate who has
 * already gone home. For an equipment check that is a tolerable trade. For
 * someone's certification record it is not.
 *
 * So logout asks first. This is the module logout asks.
 *
 * Deliberately a tiny registry rather than a store slice: the guard has to work
 * from `AppLayout`, which never renders the examiner screen, and the answer has
 * to be readable at the moment of logout rather than subscribed to for the life
 * of the app.
 *
 * **This is the shape the offline queue will report through.** Today the only
 * unsynced skills work is a live evaluation whose saves are failing, held in
 * React state. When the queue in SKILLS_TESTING_OFFLINE_PLAN.md lands, it
 * registers here too and the guard needs no change — which is why the value is
 * a description of *what* is unsaved rather than a boolean about one screen.
 */

export interface PendingSkillsWork {
  /** Test being scored, for a message that names it. */
  testId: string;
  /** e.g. "SCBA Donning — Timed Evolution for Nadia Belhaj". */
  label: string;
}

let pending: PendingSkillsWork | null = null;

/** Register unsynced work, or clear it by passing null. */
export function setPendingSkillsWork(work: PendingSkillsWork | null): void {
  pending = work;
}

/** What is currently unsynced, or null. Read at the moment of logout. */
export function getPendingSkillsWork(): PendingSkillsWork | null {
  return pending;
}

/**
 * Clear the registration for one specific test.
 *
 * Scoped by id on purpose: an examiner who opens a second evaluation while the
 * first is still unsaved must not have the first one's warning cleared by the
 * second one's unmount. A bare `setPendingSkillsWork(null)` on unmount would do
 * exactly that.
 */
export function clearPendingSkillsWork(testId: string): void {
  if (pending?.testId === testId) pending = null;
}
