/**
 * Election Helpers
 *
 * Shared utility functions used across the elections module.
 * Centralizes duplicated logic from ElectionsPage, ElectionDetailPage,
 * ElectionResults, and BallotBuilder to a single source of truth.
 */

import type { BallotItem, Candidate, Election } from '../types/election';
import { ElectionStatus, VictoryCondition as VC } from '../constants/enums';
import { getErrorMessage } from './errorHandling';

/**
 * Returns a human-readable string describing the time remaining until
 * an election's end date (e.g. "2d 5h remaining", "45m remaining").
 * Returns `null` if the end date is in the past.
 */
export const getTimeRemaining = (endDate: string): string | null => {
  const now = new Date();
  const end = new Date(endDate);
  const diffMs = end.getTime() - now.getTime();
  // NaN (unparseable date) fails `<= 0` and would otherwise fall through
  // and render as "NaNm remaining" in the UI.
  if (Number.isNaN(diffMs) || diffMs <= 0) return null;

  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffHours / 24);

  if (diffDays > 0) {
    return `${diffDays}d ${diffHours % 24}h remaining`;
  }
  if (diffHours > 0) {
    const diffMinutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
    return `${diffHours}h ${diffMinutes}m remaining`;
  }
  const diffMinutes = Math.floor(diffMs / (1000 * 60));
  return `${diffMinutes}m remaining`;
};

/**
 * Maps an election status to the appropriate Tailwind badge classes.
 * Uses opacity-based backgrounds (e.g. `bg-green-500/10`) for consistent
 * appearance across light, dark, and high-contrast themes.
 */
export const getStatusBadgeClass = (status: string): string => {
  switch (status) {
    case ElectionStatus.OPEN:
      return 'bg-green-500/10 text-green-700 dark:text-green-400';
    case ElectionStatus.CLOSED:
      return 'bg-theme-surface-secondary text-theme-text-muted';
    case ElectionStatus.DRAFT:
      return 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400';
    case ElectionStatus.CANCELLED:
      return 'bg-red-500/10 text-red-700 dark:text-red-400';
    default:
      return 'bg-theme-surface-secondary text-theme-text-muted';
  }
};

/**
 * Returns a human-readable description of an election's victory condition,
 * including any configured thresholds or percentages.
 */
export const getVictoryDescription = (election: Election): string => {
  const { victory_condition, victory_threshold, victory_percentage } = election;

  switch (victory_condition) {
    case VC.MOST_VOTES:
      return 'Most Votes (Plurality)';
    case VC.MAJORITY:
      return 'Majority (>50% of votes)';
    case VC.SUPERMAJORITY:
      return `Supermajority (${victory_percentage || 67}% of votes)`;
    case VC.THRESHOLD:
      if (victory_threshold) {
        return `Threshold (${victory_threshold} votes required)`;
      }
      if (victory_percentage) {
        return `Threshold (${victory_percentage}% of votes required)`;
      }
      return 'Threshold';
    default:
      return 'Simple Majority';
  }
};

// Mirrors ElectionService.REMINDER_COOLDOWN_MINUTES, which refuses a send
// inside the window with a 400; stated on the dialog so the officer learns of
// the cooldown before pressing Send rather than from the refusal (W50-64).
export const REMINDER_COOLDOWN_MINUTES = 60;

/**
 * Whole minutes until the server will accept another non-voter reminder —
 * the same "try again in about N minute(s)" arithmetic as the backend's
 * refusal — or 0 when a send is allowed.
 */
export const reminderCooldownRemainingMinutes = (reminderSentAt: string | null, now = Date.now()): number => {
  if (!reminderSentAt) return 0;
  const sentAt = new Date(reminderSentAt).getTime();
  if (Number.isNaN(sentAt)) return 0;
  const elapsedMinutes = Math.floor((now - sentAt) / 60_000);
  if (elapsedMinutes < 0 || elapsedMinutes >= REMINDER_COOLDOWN_MINUTES) return 0;
  return Math.max(REMINDER_COOLDOWN_MINUTES - elapsedMinutes, 1);
};

/**
 * A ballot item's contest is keyed by the item's id: the Approve/Deny rows
 * the backend materialises for a motion (and any write-in cast on an item)
 * carry `position = <item id>`. Maps that id back to the item's title so a
 * screen never shows an officer the raw `item_1790747487501_k8vrul` key.
 */
export const ballotItemTitlesById = (ballotItems: BallotItem[] | undefined): Map<string, string> =>
  new Map((ballotItems ?? []).map((item) => [item.id, item.title]));

/** The contest a candidate belongs to, as an officer would name it. */
export const candidateContestLabel = (
  candidate: Pick<Candidate, 'position'>,
  itemTitles: Map<string, string>
): string | undefined => (candidate.position ? (itemTitles.get(candidate.position) ?? candidate.position) : undefined);

/**
 * Whether a candidate row is one of the synthetic Approve/Deny options the
 * backend creates on a ballot item's first vote (election_service
 * `submit_ballot_with_token`). They are choices, not nominees: the
 * candidate list must not offer Edit/Remove on them, and the count of
 * "candidates" must not include them.
 */
export const isBallotItemOption = (
  candidate: Pick<Candidate, 'position' | 'is_write_in'>,
  itemTitles: Map<string, string>
): boolean => !candidate.is_write_in && candidate.position !== undefined && itemTitles.has(candidate.position);

interface RecipientValidationEntry {
  field?: string;
  message?: string;
  loc?: Array<string | number>;
  msg?: string;
}

/**
 * The message to show when `POST …/send-package` refuses the batch.
 *
 * `EmailStr` rejects addresses the browser's own check lets through (a
 * reserved TLD such as `.test`, for one), and the 422 names the offender only
 * as `recipient_emails.2` — an index into a list the secretary cannot see
 * numbered. Resolve the index against the list that was sent so the alert
 * names the address to remove, and say that nobody was sent anything, which
 * the validator's wording never does. Anything that is not a per-address 422
 * falls through to the ordinary message.
 */
export function describePackageSendError(err: unknown, recipientEmails: string[], fallback: string): string {
  const detail = (err as { response?: { data?: { detail?: unknown } } } | null)?.response?.data?.detail;
  if (Array.isArray(detail)) {
    const rejected: string[] = [];
    for (const entry of detail as RecipientValidationEntry[]) {
      // The API's 422 handler spells the location `recipient_emails.<index>`;
      // FastAPI's own spelling is `['body', 'recipient_emails', <index>]`.
      const parts = entry.field ? entry.field.split('.') : (entry.loc ?? []).map(String).filter((p) => p !== 'body');
      const index = parts[0] === 'recipient_emails' && parts.length === 2 ? Number(parts[1]) : NaN;
      const address = Number.isInteger(index) ? recipientEmails[index] : undefined;
      if (address) rejected.push(address);
    }
    if (rejected.length > 0) {
      const list = rejected.join(', ');
      return `${rejected.length === 1 ? 'This address was' : 'These addresses were'} refused by the mail server's address check: ${list}. Nothing was sent — remove or correct ${rejected.length === 1 ? 'it' : 'them'} and send again.`;
    }
  }
  return getErrorMessage(err, fallback);
}
