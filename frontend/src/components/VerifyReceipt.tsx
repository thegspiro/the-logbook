/**
 * Verify Receipt
 *
 * A small public form that checks a vote receipt hash against
 * POST /elections/{id}/verify-receipt. A voter is told to save the hash when
 * they cast a ballot; this is the one place in the app that lets them use it
 * (W50-53). It distinguishes the three matched states the backend reports —
 * counted, test (recorded but never tallied) and voided by an officer — from
 * an unknown receipt, keying each off its own flag rather than parsing the
 * message (W50-54).
 */

import React, { useState } from 'react';
import { electionService } from '../services/api';
import type { VoteReceiptResponse } from '../types/election';
import { getErrorMessage } from '../utils/errorHandling';
import { formatDateTime } from '../utils/dateFormatting';
import { useTimezone } from '../hooks/useTimezone';

interface VerifyReceiptProps {
  electionId: string;
}

type ReceiptState = 'counted' | 'test' | 'voided' | 'unknown';

const classifyReceipt = (result: VoteReceiptResponse): ReceiptState => {
  if (result.voided) return 'voided';
  if (!result.verified) return 'unknown';
  return result.counted ? 'counted' : 'test';
};

const STATE_LABEL: Record<ReceiptState, string> = {
  counted: 'Vote counted',
  test: 'Test vote — not counted',
  voided: 'Vote voided',
  unknown: 'No matching vote',
};

const STATE_CLASS: Record<ReceiptState, string> = {
  counted: 'border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-300',
  test: 'border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300',
  voided: 'border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300',
  unknown: 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-300',
};

export const VerifyReceipt: React.FC<VerifyReceiptProps> = ({ electionId }) => {
  const tz = useTimezone();
  const [receipt, setReceipt] = useState('');
  const [result, setResult] = useState<VoteReceiptResponse | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = receipt.trim();
    setResult(null);
    if (!trimmed) {
      setError('Enter the receipt you were given when you voted');
      return;
    }
    try {
      setChecking(true);
      setError(null);
      setResult(await electionService.verifyReceipt(electionId, trimmed));
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Failed to verify receipt'));
    } finally {
      setChecking(false);
    }
  };

  const state = result ? classifyReceipt(result) : null;

  return (
    <section
      aria-labelledby={`verify-receipt-${electionId}`}
      className="bg-theme-surface rounded-lg p-4 text-left backdrop-blur-xs"
    >
      <h3 id={`verify-receipt-${electionId}`} className="text-theme-text-primary text-sm font-medium">
        Verify a vote receipt
      </h3>
      <p className="text-theme-text-muted mt-1 text-xs">
        Paste the receipt you saved when you voted to confirm it was recorded. It cannot reveal how you voted.
      </p>
      <form
        onSubmit={(e) => {
          void handleSubmit(e);
        }}
        className="mt-3 flex flex-col gap-2 sm:flex-row"
      >
        <label htmlFor={`verify-receipt-input-${electionId}`} className="sr-only">
          Receipt
        </label>
        <input
          id={`verify-receipt-input-${electionId}`}
          type="text"
          value={receipt}
          onChange={(e) => setReceipt(e.target.value)}
          placeholder="Receipt hash"
          autoComplete="off"
          spellCheck={false}
          className="form-input-sm flex-1 font-mono"
        />
        <button type="submit" disabled={checking} className="btn-secondary rounded-md px-4 text-sm">
          {checking ? 'Checking...' : 'Verify'}
        </button>
      </form>

      {error && (
        <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-300">
          {error}
        </p>
      )}

      {result && state && (
        <div role="status" aria-live="polite" className={`mt-3 rounded-md border p-3 text-sm ${STATE_CLASS[state]}`}>
          <p className="font-medium">{STATE_LABEL[state]}</p>
          <p className="mt-1">{result.message}</p>
          {result.voted_at && <p className="mt-1 text-xs">Recorded {formatDateTime(result.voted_at, tz)}</p>}
          {result.position && <p className="text-xs">Position: {result.position}</p>}
        </div>
      )}
    </section>
  );
};

export default VerifyReceipt;
