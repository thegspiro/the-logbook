/**
 * Finance Approval Page (public / external approver)
 *
 * Reached from an emailed link that carries a one-time, expiring approval token
 * (/finance/approvals/:token). No login required — the token is the auth. The
 * page loads the pending approval's minimal detail, then lets the approver
 * record an Approve or Deny (with optional notes) against the public finance
 * approval endpoints. These endpoints live under /api/public/v1, so we call
 * them with the raw axios client (the app instance is scoped to /api/v1 and
 * attaches session/CSRF the external approver doesn't have).
 *
 * The page shows the request's title, amount and requester's name (owner
 * decision 2026-11-01) and nothing else of it: the description, vendor and
 * lines stay behind the login, since the link may be forwarded.
 *
 * An expense report with lines submitted after the department's deadline
 * (`late_line_count`) can be approved only once the approver ticks that they
 * have reviewed them; the API refuses the approval without it.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router';
import axios from 'axios';
import { CheckCircle, XCircle, Clock, Loader2 } from 'lucide-react';
import { getErrorMessage } from '../utils/errorHandling';
import { formatCurrency, type Money } from '../utils/currencyFormatting';

interface ApprovalDetail {
  step_name: string;
  entity_type: string;
  status: string;
  actionable: boolean;
  expired: boolean;
  late_line_count?: number;
  /** What is being decided: filled only while the link can be acted on. */
  title?: string | null;
  /** Numeric from the API, which serializes it as a string. */
  amount?: Money;
  requester_name?: string | null;
}

const BASE = '/api/public/v1/finance/approvals';

// Only a PENDING step is actionable, so these are the states a closed link can
// report. `sent` belongs to notification steps, which never ask for a decision.
const CLOSED_STEP_LABELS: Record<string, string> = {
  approved: 'approved',
  denied: 'denied',
  skipped: 'skipped',
  auto_approved: 'approved automatically',
  sent: 'closed',
};

// The token is cleared once it is used, so the approver's own second visit, and
// a link a mail program cut short, both reach the API as "not found" or "too
// short". The server's wording for those ("Approval not found", "path.token:
// Value is too short") means nothing to someone outside the department.
const UNUSABLE_LINK =
  'This approval link can no longer be used. If you already responded, your response was recorded and there is nothing more to do. If you have not, open the link from the email again in case it was copied incompletely, or ask the department to send a new one.';

const isUnusableLink = (err: unknown): boolean =>
  axios.isAxiosError(err) && (err.response?.status === 404 || err.response?.status === 422);

const prettyEntity = (raw: string): string =>
  raw
    .split('_')
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(' ');

// Declared outside the page: a component defined in its render is a new type on
// every render, so React remounted the whole page on each keystroke and the
// notes box lost focus after every character.
const Shell: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="flex min-h-screen items-center justify-center p-4">
    <main id="main-content" className="card w-full max-w-md">
      <h1 className="text-theme-text-primary mb-4 text-xl font-semibold">Approval Request</h1>
      {children}
    </main>
  </div>
);

export const FinanceApprovalPage: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const [detail, setDetail] = useState<ApprovalDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [resultMessage, setResultMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    const load = async () => {
      if (!token) {
        setError('Invalid approval link.');
        setLoading(false);
        return;
      }
      try {
        const res = await axios.get<ApprovalDetail>(`${BASE}/${token}`);
        if (active) setDetail(res.data);
      } catch (err: unknown) {
        if (active) {
          setError(
            isUnusableLink(err) ? UNUSABLE_LINK : getErrorMessage(err, 'This approval link is invalid or has expired.')
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [token]);

  const act = useCallback(
    async (action: 'approve' | 'deny') => {
      if (!token) return;
      setSubmitting(true);
      setError(null);
      try {
        const res = await axios.post<{ status: string; message: string }>(`${BASE}/${token}/${action}`, {
          notes: notes.trim() || undefined,
          ...(action === 'approve' && acknowledged ? { acknowledge_late_substantiation: true } : {}),
        });
        setResultMessage(res.data.message);
      } catch (err: unknown) {
        setError(
          getErrorMessage(err, 'Could not record your response. The link may have expired or already been used.')
        );
      } finally {
        setSubmitting(false);
      }
    },
    [token, notes, acknowledged]
  );

  if (loading) {
    return (
      <Shell>
        <div className="text-theme-text-secondary flex items-center gap-3">
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
          <span>Loading approval…</span>
        </div>
      </Shell>
    );
  }

  if (resultMessage) {
    return (
      <Shell>
        <div className="flex items-start gap-3">
          <CheckCircle className="mt-0.5 h-6 w-6 flex-shrink-0 text-green-700 dark:text-green-600" aria-hidden="true" />
          <p className="text-theme-text-primary">{resultMessage}</p>
        </div>
      </Shell>
    );
  }

  if (error && !detail) {
    return (
      <Shell>
        <div className="flex items-start gap-3">
          <XCircle className="mt-0.5 h-6 w-6 flex-shrink-0 text-red-600" aria-hidden="true" />
          <p className="text-theme-text-primary">{error}</p>
        </div>
      </Shell>
    );
  }

  if (detail && !detail.actionable) {
    const reason = detail.expired
      ? 'This approval link has expired.'
      : `This step has already been ${CLOSED_STEP_LABELS[detail.status] ?? 'closed'}. No action is needed.`;
    return (
      <Shell>
        <div className="flex items-start gap-3">
          <Clock className="text-theme-text-secondary mt-0.5 h-6 w-6 flex-shrink-0" aria-hidden="true" />
          <p className="text-theme-text-primary">{reason}</p>
        </div>
      </Shell>
    );
  }

  if (!detail) {
    return (
      <Shell>
        <p className="text-theme-text-primary">Approval not found.</p>
      </Shell>
    );
  }

  const lateLines = detail.late_line_count ?? 0;

  return (
    <Shell>
      <dl className="mb-4 space-y-2 text-sm">
        {detail.title && (
          <div className="flex justify-between gap-4">
            <dt className="text-theme-text-secondary">Request</dt>
            <dd className="text-theme-text-primary text-right font-medium">{detail.title}</dd>
          </div>
        )}
        {detail.amount != null && detail.amount !== '' && (
          <div className="flex justify-between gap-4">
            <dt className="text-theme-text-secondary">Amount</dt>
            <dd className="text-theme-text-primary font-semibold">{formatCurrency(detail.amount)}</dd>
          </div>
        )}
        {detail.requester_name && (
          <div className="flex justify-between gap-4">
            <dt className="text-theme-text-secondary">Requested by</dt>
            <dd className="text-theme-text-primary text-right">{detail.requester_name}</dd>
          </div>
        )}
        <div className="flex justify-between gap-4">
          <dt className="text-theme-text-secondary">Item</dt>
          <dd className="text-theme-text-primary">{prettyEntity(detail.entity_type)}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-theme-text-secondary">Approval step</dt>
          <dd className="text-theme-text-primary">{detail.step_name}</dd>
        </div>
      </dl>

      {lateLines > 0 && (
        <div className="alert-warning mb-4">
          <p className="text-theme-alert-warning-text text-sm">
            {lateLines === 1
              ? '1 expense on this report was submitted after the department’s deadline for claiming expenses.'
              : `${lateLines} expenses on this report were submitted after the department’s deadline for claiming expenses.`}{' '}
            Reimbursing them falls outside the accountable plan, so the department may have to report them as taxable
            pay.
          </p>
          <label className="text-theme-text-primary mt-2 flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="form-checkbox mt-0.5"
              checked={acknowledged}
              onChange={(e) => setAcknowledged(e.target.checked)}
            />
            I have reviewed the late expenses
          </label>
        </div>
      )}

      <label htmlFor="approval-notes" className="form-label">
        Notes (optional)
      </label>
      <textarea
        id="approval-notes"
        className="form-input mb-4"
        rows={3}
        maxLength={2000}
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Add a comment for the record…"
      />

      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}

      <div className="flex gap-3">
        <button
          type="button"
          className="btn-primary flex-1 justify-center"
          disabled={submitting || (lateLines > 0 && !acknowledged)}
          onClick={() => void act('approve')}
        >
          {submitting ? 'Submitting…' : 'Approve'}
        </button>
        <button
          type="button"
          className="mobile-touch-target flex-1 rounded-md bg-red-800 px-4 font-medium text-white hover:bg-red-900 disabled:opacity-60"
          disabled={submitting}
          onClick={() => void act('deny')}
        >
          Deny
        </button>
      </div>
    </Shell>
  );
};

export default FinanceApprovalPage;
