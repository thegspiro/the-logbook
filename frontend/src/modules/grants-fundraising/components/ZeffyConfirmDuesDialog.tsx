/**
 * Confirm whose dues a Zeffy membership payment pays (ADV2-11).
 *
 * The payer's email only suggests a member: anyone can type any member's
 * address on a Zeffy membership form, so the sync holds these payments and a
 * treasurer (`finance.manage`) decides. Any current member with open dues on
 * the linked schedule may be chosen — a parent paying for a junior member, a
 * spouse paying from their own address.
 *
 * An overpayment is the treasurer's call too (owner decision 2026-11-21): the
 * extra is recorded as the member's donation only when they tick the box, and
 * until then the payment cannot be confirmed here. Cancelling leaves it held,
 * to be handled by hand in Finance.
 */

import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Modal } from '../../../components/Modal';
import { FIELD_ERROR_CLASS, FormField } from '../../../components/ux/FormField';
import { useDiscardGuard } from '../../../hooks/useDiscardGuard';
import { getErrorMessage } from '../../../utils/errorHandling';
import { zeffyService } from '../services/api';
import type { ZeffyDuesMatch, ZeffyPayment } from '../types';
import { zeffyMoney } from '../utils/labels';

interface ZeffyConfirmDuesDialogProps {
  payment: ZeffyPayment;
  onClose: () => void;
  onConfirmed: () => void;
}

const MEMBER_FIELD_ID = 'zeffy-confirm-member';

export const ZeffyConfirmDuesDialog: React.FC<ZeffyConfirmDuesDialogProps> = ({ payment, onClose, onConfirmed }) => {
  const [match, setMatch] = useState<ZeffyDuesMatch | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [userId, setUserId] = useState('');
  const [initialUserId, setInitialUserId] = useState('');
  const [excessAsDonation, setExcessAsDonation] = useState(false);
  const [memberError, setMemberError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    zeffyService
      .getDuesMatch(payment.zeffyPaymentId)
      .then((result) => {
        if (cancelled) return;
        setMatch(result);
        // Pre-select the email match only when it is someone the payment can
        // actually be credited to.
        const suggested = result.candidates.some((c) => c.userId === result.suggestedUserId)
          ? (result.suggestedUserId ?? '')
          : '';
        setUserId(suggested);
        setInitialUserId(suggested);
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(getErrorMessage(err, 'Could not load the members this payment could pay.'));
      });
    return () => {
      cancelled = true;
    };
  }, [payment.zeffyPaymentId]);

  const requestClose = useDiscardGuard({
    isDirty: userId !== initialUserId || excessAsDonation,
    onClose,
  });

  const chosen = match?.candidates.find((c) => c.userId === userId) ?? null;
  const net = Number(match?.netAmount ?? 0);
  const excess = chosen ? Math.max(net - Number(chosen.balance), 0) : 0;
  const currency = match?.currency ?? payment.currency;
  const blockedByExcess = excess > 0 && !excessAsDonation;

  const save = async () => {
    setError(null);
    if (!userId) {
      setMemberError('Choose the member whose dues this payment pays.');
      window.setTimeout(() => document.getElementById(MEMBER_FIELD_ID)?.focus(), 0);
      return;
    }
    if (blockedByExcess) return;
    setSaving(true);
    try {
      await zeffyService.confirmDues(payment.zeffyPaymentId, { userId, excessAsDonation: excess > 0 });
      toast.success('Payment credited to member dues');
      onConfirmed();
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Could not confirm the payment.'));
    } finally {
      setSaving(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void save();
  };

  return (
    <Modal
      isOpen
      onClose={requestClose}
      title="Confirm member dues"
      titleId="zeffy-confirm-dues-title"
      onSubmit={handleSubmit}
      noValidate
      footer={
        <>
          <button
            type="submit"
            disabled={saving || !match || match.candidates.length === 0 || blockedByExcess}
            className="btn-primary"
          >
            Credit dues
          </button>
          <button type="button" onClick={requestClose} className="btn-secondary">
            Cancel
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-theme-text-secondary text-sm">
          <span className="text-theme-text-primary font-medium">{payment.payerName ?? 'A payer'}</span> paid{' '}
          <span className="text-theme-text-primary font-medium">
            {zeffyMoney(match?.netAmount ?? payment.amount, currency)}
          </span>{' '}
          through Zeffy. The email they typed only suggests a member: choose whose dues it pays.
        </p>

        {loadError && (
          <p role="alert" className={`text-sm ${FIELD_ERROR_CLASS}`}>
            {loadError}
          </p>
        )}
        {error && (
          <p role="alert" className={`text-sm ${FIELD_ERROR_CLASS}`}>
            {error}
          </p>
        )}

        {match && match.candidates.length === 0 && (
          <p className="text-theme-text-secondary text-sm">
            No current member has open dues on the linked schedule. Generate the dues first, or record this payment by
            hand in Finance.
          </p>
        )}

        {match && match.candidates.length > 0 && (
          <FormField
            id={MEMBER_FIELD_ID}
            label="Member"
            required
            error={memberError ?? undefined}
            hint={
              match.suggestedUserId && match.suggestedUserId === initialUserId
                ? 'Pre-selected because the payer’s email matches this member.'
                : 'The payer’s email matches no member with open dues.'
            }
          >
            {(field) => (
              <select
                {...field}
                className="form-input"
                value={userId}
                onChange={(e) => {
                  setUserId(e.target.value);
                  setExcessAsDonation(false);
                  setMemberError(null);
                }}
              >
                <option value="">Choose…</option>
                {match.candidates.map((c) => (
                  <option key={c.userId} value={c.userId}>
                    {c.name} — {zeffyMoney(c.balance, currency)} owing
                  </option>
                ))}
              </select>
            )}
          </FormField>
        )}

        {chosen && excess > 0 && (
          <div className="alert-warning space-y-2 text-sm">
            <p>
              This is {zeffyMoney(excess, currency)} more than the {zeffyMoney(chosen.balance, currency)} {chosen.name}{' '}
              still owes.
            </p>
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                className="form-checkbox mt-0.5"
                checked={excessAsDonation}
                onChange={(e) => setExcessAsDonation(e.target.checked)}
              />
              <span>
                Record the extra {zeffyMoney(excess, currency)} as a donation from {chosen.name}. Otherwise leave this
                payment unconfirmed and record it by hand in Finance.
              </span>
            </label>
          </div>
        )}
      </div>
    </Modal>
  );
};
