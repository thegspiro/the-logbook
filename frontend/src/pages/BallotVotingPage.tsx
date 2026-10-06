/**
 * Ballot Voting Page (Public — Token-Based)
 *
 * Standalone page that members access via the "Vote Now" link in their
 * email. Authentication is via the 32-character token in the URL, not
 * a user login. The token maps to a voter_hash for anonymous voting.
 *
 * Flow:
 * 1. Member clicks "Vote Now" in email → /ballot#token=xxx (the token rides
 *    in the URL fragment — browsers never send fragments to any server, so
 *    the live credential stays out of access logs; ?token= is still accepted
 *    for links emailed before the fragment change)
 * 2. Page captures the token into state, scrubs it from the address bar,
 *    and loads election data + candidates via POST /elections/ballot/lookup
 * 3. Member votes on each item (approve, deny, write-in, or abstain)
 * 4. Member clicks "Submit Ballot"
 * 5. Confirmation modal shows summary of all choices
 * 6. Member confirms → ballot submitted atomically
 * 7. Success confirmation displayed
 */

import React, { useEffect, useRef, useState } from 'react';
import { DialogPanel } from '../components/ux/DialogPanel';
import { VerifyReceipt } from '../components/VerifyReceipt';
import { electionService } from '../services/api';
import type { BallotElection, Candidate, BallotSubmissionResponse } from '../types/election';
import { toAppError } from '../utils/errorHandling';
import { formatDate } from '../utils/dateFormatting';
import { BallotChoice } from '../constants/enums';
import { useTimezone } from '../hooks/useTimezone';
import { BallotItemCard } from '../components/ballot/BallotItemCard';
import { useBallotChoices } from '../components/ballot/useBallotChoices';
import { candidatesForItem, choiceLabel, choiceToVote, missingWriteIn } from '../components/ballot/ballotChoices';

/**
 * Capture the voting token from the URL (fragment preferred, query-string
 * fallback for pre-fragment emails) and scrub it from the address bar so it
 * can't linger in browser history or be leaked via a copied URL.
 */
const captureTokenFromUrl = (): string => {
  const hashToken = new URLSearchParams(window.location.hash.replace(/^#/, '')).get('token');
  const queryToken = new URLSearchParams(window.location.search).get('token');
  const token = hashToken || queryToken || '';
  if (token) {
    window.history.replaceState(null, '', window.location.pathname);
  }
  return token;
};

/**
 * The backend's `detail` for a failed lookup, without the "(Error code: …)"
 * suffix `getErrorMessage` appends. A voter on the public page has no IT desk
 * to quote a code to, and the suffix broke the equality that picks a friendly
 * sentence for a used link (W50-52) — so every comparison below is against
 * the bare sentence the service returns.
 */
const publicErrorText = (err: unknown, fallback: string): string => toAppError(err).message || fallback;

/**
 * The public ballot's error card is read by a member, not an officer. The
 * generic "if you think this is a mistake, contact your secretary" footer is
 * wrong under the detail sentences the service returns for a dead token after
 * close or reopen (W50-44) and for a link a reminder retired (W50-27): nothing
 * is a mistake, and the reader may be the secretary. Each of those states
 * gets its own sentence and either its own hint or none.
 */
type LoadError = { message: string; hint: string | null };

const CONTACT_SECRETARY_HINT = "If you think this is a mistake, contact your organization's secretary.";
const REOPENED_PREFIX = 'This election was closed and reopened';

const describeLoadError = (detail: string): LoadError => {
  if (detail === 'This ballot has already been fully submitted') {
    return {
      message: 'This ballot has already been submitted. Each voting link can only be used once.',
      hint: CONTACT_SECRETARY_HINT,
    };
  }
  if (detail === 'Voting has closed' || detail === 'Voting has ended') {
    return {
      message: 'Voting has closed for this election.',
      hint: 'Results will be shared by your organization.',
    };
  }
  if (detail.startsWith(REOPENED_PREFIX)) {
    return {
      message:
        'This election was closed and reopened, so this ballot link no longer works. Ask your secretary for a new ballot link.',
      hint: null,
    };
  }
  if (detail === 'This link was replaced by a newer ballot email') {
    return {
      message:
        'This link was replaced by a newer ballot email. Open your most recent ballot email and use the link there.',
      hint: null,
    };
  }
  return { message: detail, hint: CONTACT_SECRETARY_HINT };
};

/**
 * Shown on the form and the submitted card of a token minted by
 * send-test-ballot. Without it a preview and the real ballot are identical
 * (W50-18), and an officer's test submission looked like a counted vote.
 */
const TestBallotBanner: React.FC = () => (
  <div role="status" aria-label="Test ballot notice" className="alert-warning mb-6 text-left">
    <p className="text-theme-alert-warning-title font-semibold">TEST BALLOT</p>
    <p className="text-theme-alert-warning-text text-sm">
      This is a preview. Votes cast here are recorded for testing only and are not counted toward the election results.
    </p>
  </div>
);

export const BallotVotingPage: React.FC = () => {
  const tz = useTimezone();
  const [token, setToken] = useState<string>(captureTokenFromUrl);

  const [election, setElection] = useState<BallotElection | null>(null);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [isTest, setIsTest] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadErrorHint, setLoadErrorHint] = useState<string | null>(CONTACT_SECRETARY_HINT);
  const { choices, resetChoices, updateChoice, updateWriteInName, toggleCandidate, setCandidateRank } =
    useBallotChoices();
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitResult, setSubmitResult] = useState<BallotSubmissionResponse | null>(null);

  // StrictMode mounts twice in development, and each mount ran the lookup —
  // two POSTs per page load against a public endpoint capped at 10/min that
  // every voter on the same address shares (W50-43). One token, one lookup;
  // a new token from the hashchange listener below still gets its own.
  const lookedUpTokenRef = useRef<string | null>(null);

  useEffect(() => {
    if (token) {
      if (lookedUpTokenRef.current === token) return;
      lookedUpTokenRef.current = token;
      void loadBallot();
    } else {
      setError('This link has no voting token. Open the ballot link from your email.');
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // A link pasted into a tab already on /ballot only changes the fragment,
  // which is not a navigation: without this the page ignored it and left the
  // token sitting in the address bar (W50-52). Capturing scrubs it again.
  useEffect(() => {
    const onHashChange = () => {
      const next = captureTokenFromUrl();
      if (next) setToken(next);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const loadBallot = async () => {
    try {
      setLoading(true);
      setError(null);
      const {
        election: electionData,
        candidates: candidateData,
        is_test: testBallot,
      } = await electionService.lookupBallot(token);
      setElection(electionData);
      setCandidates(candidateData);
      setIsTest(testBallot === true);

      // Every item starts on Abstain
      resetChoices(electionData.ballot_items || []);
    } catch (err: unknown) {
      const { message, hint } = describeLoadError(
        publicErrorText(err, "Couldn't load your ballot. The link may have expired or be invalid.")
      );
      setError(message);
      setLoadErrorHint(hint);
    } finally {
      setLoading(false);
    }
  };

  /** Validates all choices (e.g. write-ins must have names) then shows the confirmation modal. */
  const handleSubmitBallot = () => {
    const unnamed = missingWriteIn(choices, election?.ballot_items || []);
    if (unnamed) {
      setError(`Enter a name for your write-in on: ${unnamed.title || unnamed.id}`);
      return;
    }
    setError(null);
    setShowConfirmation(true);
  };

  /** Transforms choices into BallotItemVote[] and submits them atomically via the token endpoint. */
  const handleConfirmSubmit = async () => {
    if (!election) return;

    try {
      setSubmitting(true);
      setError(null);

      const votes = Object.entries(choices).map(([itemId, itemChoice]) => choiceToVote(itemId, itemChoice));

      const result = await electionService.submitBallot(token, votes);
      setSubmitResult(result);
      setSubmitted(true);
      setShowConfirmation(false);
    } catch (err: unknown) {
      setError(publicErrorText(err, 'Failed to submit ballot. Try again.'));
      setShowConfirmation(false);
    } finally {
      setSubmitting(false);
    }
  };

  const getChoiceLabel = (itemId: string): string => choiceLabel(choices[itemId], candidates);

  // ---- Render states ----

  if (loading) {
    return (
      <main
        id="main-content"
        className="from-theme-bg-from via-theme-bg-via to-theme-bg-to flex min-h-screen items-center justify-center bg-linear-to-br"
      >
        <div className="text-center" role="status" aria-live="polite">
          <div className="mb-4 inline-block h-10 w-10 animate-spin rounded-full border-t-4 border-b-4 border-red-600"></div>
          <p className="text-theme-text-secondary">Loading your ballot...</p>
        </div>
      </main>
    );
  }

  if (error && !election) {
    return (
      <main
        id="main-content"
        className="from-theme-bg-from via-theme-bg-via to-theme-bg-to flex min-h-screen items-center justify-center bg-linear-to-br p-4"
      >
        <div className="bg-theme-surface w-full max-w-md rounded-lg p-8 text-center shadow-lg">
          <div className="mb-4 text-5xl text-red-600">!</div>
          <h1 className="text-theme-text-primary mb-2 text-xl font-bold">Unable to Load Ballot</h1>
          <p className="text-theme-text-secondary">{error}</p>
          {loadErrorHint && <p className="text-theme-text-muted mt-4 text-sm">{loadErrorHint}</p>}
        </div>
      </main>
    );
  }

  if (submitted && submitResult) {
    return (
      <main
        id="main-content"
        className="from-theme-bg-from via-theme-bg-via to-theme-bg-to flex min-h-screen items-center justify-center bg-linear-to-br p-4"
      >
        <div className="bg-theme-surface w-full max-w-md rounded-lg p-8 text-center shadow-lg">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100 dark:bg-green-500/20">
            <svg
              className="h-8 w-8 text-green-600"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h1 className="text-theme-text-primary mb-2 text-2xl font-bold">
            {isTest ? 'Test Ballot Submitted' : 'Ballot Submitted'}
          </h1>
          {isTest && <TestBallotBanner />}
          <p className="text-theme-text-secondary mb-4">{submitResult.message}</p>
          <div className="bg-theme-surface-secondary text-theme-text-muted rounded-lg p-4 text-sm">
            <p>
              {isTest
                ? 'This was a test ballot. It was recorded for preview only and is not counted toward the results.'
                : 'Your ballot has been securely recorded.'}
            </p>
            {submitResult.receipt_hashes && submitResult.receipt_hashes.length > 0 && (
              <div className="border-theme-surface-border mt-3 border-t pt-3">
                <p className="text-theme-text-secondary mb-1 font-medium">Vote Receipt</p>
                <p className="mb-2 text-xs">
                  {isTest
                    ? 'This receipt verifies the test vote was recorded, not counted. It cannot reveal how you voted.'
                    : 'Save this receipt to verify your vote was counted. It cannot reveal how you voted.'}
                </p>
                {submitResult.receipt_hashes.map((hash, i) => (
                  <code key={i} className="bg-theme-surface mb-1 block rounded px-2 py-1 font-mono text-xs break-all">
                    {hash}
                  </code>
                ))}
              </div>
            )}
            <p className="mt-2">You may close this page.</p>
          </div>
          {election && (
            <div className="mt-4">
              <VerifyReceipt electionId={election.id} />
            </div>
          )}
        </div>
      </main>
    );
  }

  if (!election) return null;

  const ballotItems = election.ballot_items || [];

  return (
    <div className="from-theme-bg-from via-theme-bg-via to-theme-bg-to min-h-screen bg-linear-to-br">
      {/* Header */}
      <div className="bg-red-700 text-white">
        <div className="mx-auto max-w-2xl px-4 py-8 text-center">
          <h1 className="text-2xl font-bold">{election.title}</h1>
          {election.description && <p className="mt-2 text-red-100">{election.description}</p>}
          {election.meeting_date && (
            <p className="mt-1 text-sm text-red-200">Meeting Date: {formatDate(election.meeting_date, tz)}</p>
          )}
        </div>
      </div>

      {/* Ballot Content */}
      <main id="main-content" className="mx-auto max-w-2xl px-4 py-8">
        {isTest && <TestBallotBanner />}
        {error && (
          <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-500/30 dark:bg-red-500/10">
            <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
          </div>
        )}

        <div className="mb-6">
          <p className="text-theme-text-secondary text-sm">
            Make a selection for each item below. You can vote for an option, write in your own choice where allowed, or
            abstain on any item.
          </p>
        </div>

        {/* Ballot Items */}
        <div className="space-y-6">
          {ballotItems.map((item, index) => (
            <BallotItemCard
              key={item.id}
              item={item}
              index={index}
              settings={election}
              candidates={candidatesForItem(item, candidates)}
              choice={choices[item.id]}
              onChoice={updateChoice}
              onWriteInName={updateWriteInName}
              onToggleCandidate={toggleCandidate}
              onRank={setCandidateRank}
            />
          ))}
        </div>

        {/* Submit Button */}
        <div className="mt-8 text-center">
          <button
            type="button"
            onClick={handleSubmitBallot}
            className="rounded-lg bg-red-700 px-8 py-3 text-lg font-semibold text-white shadow-lg transition-colors hover:bg-red-800"
          >
            Submit Ballot
          </button>
          <p className="text-theme-text-muted mt-2 text-sm">
            You will have a chance to review your choices before they are submitted.
          </p>
        </div>

        {/* Security notice */}
        <div className="text-theme-text-muted mt-8 text-center text-xs">
          <p>{isTest ? 'Votes cast on this test ballot are not counted.' : 'Your vote is securely recorded.'}</p>
          <p>This voting link is unique to you. Do not share it with others.</p>
        </div>

        <div className="mt-6">
          <VerifyReceipt electionId={election.id} />
        </div>
      </main>

      {/* Confirmation Modal */}
      {showConfirmation && (
        <div
          className="modal-overlay z-50 flex items-center justify-center bg-black/75 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-ballot-title"
          onKeyDown={(e) => {
            if (e.key === 'Escape' && !submitting) setShowConfirmation(false);
          }}
        >
          <DialogPanel
            onClose={() => setShowConfirmation(false)}
            closeOnEscape={!submitting}
            className="max-h-[90dvh] w-full max-w-lg overflow-y-auto"
          >
            <div className="border-theme-surface-border bg-theme-surface-secondary border-b px-6 py-4">
              <h3 id="confirm-ballot-title" className="text-theme-text-primary text-lg font-bold">
                Confirm Your Ballot
              </h3>
              <p className="text-theme-text-muted mt-1 text-sm">
                Check your selections. Once you cast your ballot, you cannot change it.
              </p>
            </div>

            <div className="px-6 py-4">
              <div className="space-y-4">
                {ballotItems.map((item, index) => {
                  const label = getChoiceLabel(item.id);
                  const isAbstain = label.startsWith('Abstain');

                  return (
                    <div
                      key={item.id}
                      className={`flex items-start gap-3 rounded-lg p-3 ${
                        isAbstain ? 'bg-theme-surface-secondary' : 'bg-blue-50 dark:bg-blue-500/10'
                      }`}
                    >
                      <span className="bg-theme-surface-secondary text-theme-text-secondary flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold">
                        {index + 1}
                      </span>
                      <div className="flex-1">
                        <div className="text-theme-text-primary text-sm font-medium">{item.title}</div>
                        <div
                          className={`mt-0.5 text-sm font-semibold ${
                            isAbstain
                              ? 'text-theme-text-muted'
                              : choices[item.id]?.choice === BallotChoice.APPROVE
                                ? 'text-green-700'
                                : choices[item.id]?.choice === BallotChoice.DENY
                                  ? 'text-red-700'
                                  : 'text-blue-700'
                          }`}
                        >
                          {label}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="border-theme-surface-border bg-theme-surface-secondary flex flex-wrap justify-between gap-2 border-t px-6 py-4">
              <button
                type="button"
                onClick={() => setShowConfirmation(false)}
                disabled={submitting}
                className="border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-hover mobile-touch-target rounded-md border px-4 py-2 disabled:opacity-50"
              >
                Change Ballot
              </button>
              <button
                type="button"
                onClick={() => {
                  void handleConfirmSubmit();
                }}
                disabled={submitting}
                className="mobile-touch-target rounded-md bg-red-700 px-6 py-2 font-semibold text-white hover:bg-red-800 disabled:opacity-50"
              >
                {submitting ? 'Submitting...' : 'Cast Ballot'}
              </button>
            </div>
          </DialogPanel>
        </div>
      )}
    </div>
  );
};

export default BallotVotingPage;
