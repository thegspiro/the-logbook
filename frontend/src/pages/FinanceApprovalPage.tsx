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
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import { CheckCircle, XCircle, Clock, Loader2 } from 'lucide-react';
import { getErrorMessage } from '../utils/errorHandling';

interface ApprovalDetail {
  step_name: string;
  entity_type: string;
  status: string;
  actionable: boolean;
  expired: boolean;
}

const BASE = '/api/public/v1/finance/approvals';

const prettyEntity = (raw: string): string =>
  raw
    .split('_')
    .map((w) => (w ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(' ');

export const FinanceApprovalPage: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const [detail, setDetail] = useState<ApprovalDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
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
            getErrorMessage(err, 'This approval link is invalid or has expired.')
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
        const res = await axios.post<{ status: string; message: string }>(
          `${BASE}/${token}/${action}`,
          { notes: notes.trim() || undefined }
        );
        setResultMessage(res.data.message);
      } catch (err: unknown) {
        setError(
          getErrorMessage(
            err,
            'Could not record your response. The link may have expired or already been used.'
          )
        );
      } finally {
        setSubmitting(false);
      }
    },
    [token, notes]
  );

  const Shell: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <div className="flex min-h-screen items-center justify-center bg-theme-background p-4">
      <div className="card w-full max-w-md">
        <h1 className="mb-4 text-xl font-semibold text-theme-text-primary">
          Approval Request
        </h1>
        {children}
      </div>
    </div>
  );

  if (loading) {
    return (
      <Shell>
        <div className="flex items-center gap-3 text-theme-text-secondary">
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
          <CheckCircle
            className="mt-0.5 h-6 w-6 flex-shrink-0 text-green-600"
            aria-hidden="true"
          />
          <p className="text-theme-text-primary">{resultMessage}</p>
        </div>
      </Shell>
    );
  }

  if (error && !detail) {
    return (
      <Shell>
        <div className="flex items-start gap-3">
          <XCircle
            className="mt-0.5 h-6 w-6 flex-shrink-0 text-red-600"
            aria-hidden="true"
          />
          <p className="text-theme-text-primary">{error}</p>
        </div>
      </Shell>
    );
  }

  if (detail && !detail.actionable) {
    const reason = detail.expired
      ? 'This approval link has expired.'
      : `This request has already been ${detail.status}.`;
    return (
      <Shell>
        <div className="flex items-start gap-3">
          <Clock
            className="mt-0.5 h-6 w-6 flex-shrink-0 text-theme-text-secondary"
            aria-hidden="true"
          />
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

  return (
    <Shell>
      <dl className="mb-4 space-y-2 text-sm">
        <div className="flex justify-between gap-4">
          <dt className="text-theme-text-secondary">Item</dt>
          <dd className="text-theme-text-primary">
            {prettyEntity(detail.entity_type)}
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-theme-text-secondary">Approval step</dt>
          <dd className="text-theme-text-primary">{detail.step_name}</dd>
        </div>
      </dl>

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
          disabled={submitting}
          onClick={() => void act('approve')}
        >
          {submitting ? 'Submitting…' : 'Approve'}
        </button>
        <button
          type="button"
          className="mobile-touch-target flex-1 rounded-md bg-red-600 px-4 font-medium text-white hover:bg-red-700 disabled:opacity-60"
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
