/**
 * What the setup-route gate has learned about whether setup is still open.
 *
 * Kept at module level, not in React state, so the thirteen steps of one
 * setup session ask the server once rather than on every step: the status
 * endpoint is rate limited, and a visitor clicking through the wizard should
 * not trip it. Only a definite answer is stored; a failed check is not, so the
 * next navigation asks again.
 */

export type OnboardingGateAnswer = 'open' | 'closed';

let answer: OnboardingGateAnswer | null = null;

export const getOnboardingGateAnswer = (): OnboardingGateAnswer | null => answer;

export const setOnboardingGateAnswer = (next: OnboardingGateAnswer): void => {
  answer = next;
};

/** Forget what was learned. Used by tests; a page reload does the same. */
export const clearOnboardingGateAnswer = (): void => {
  answer = null;
};
