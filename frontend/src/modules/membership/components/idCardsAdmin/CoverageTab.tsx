/**
 * The three lists an ID-card officer works through: current members with no
 * working card, cards nobody has tapped in a while, and cards still held by
 * members who have left.
 *
 * The lists are computed by the server (`GET /nfc-tags/coverage`) rather than
 * from the roster on screen, so "current member" means exactly what the
 * backend's ACTIVE_ACCOUNT_STATUSES means (Pitfall #29).
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { AlertTriangle, CreditCard, Plus, UserX, Clock, XCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { EmptyState } from '../../../../components/ux/EmptyState';
import { useConfirm } from '../../../../contexts/ConfirmContext';
import { useTimezone } from '../../../../hooks/useTimezone';
import { formatDateTime, formatNumber } from '../../../../utils/dateFormatting';
import { getErrorMessage } from '../../../../utils/errorHandling';
import { NfcCardStatus } from '../../../../constants/enums';
import { nfcCardService } from '../../services/nfcCardService';
import { IssueIdCardDialog } from '../IssueIdCardDialog';
import type { NfcCoverage, NfcCoverageCard, NfcCoverageMember } from '../../types/idCard';

const UNUSED_DAY_OPTIONS = [30, 90, 180, 365] as const;
const DEFAULT_UNUSED_DAYS = 180;

const memberStatusLabel = (status?: string | null): string =>
  status ? status.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) : '';

interface CoverageTabProps {
  refreshToken: number;
  onChanged: () => void;
}

export const CoverageTab: React.FC<CoverageTabProps> = ({ refreshToken, onChanged }) => {
  const tz = useTimezone();
  const { confirm } = useConfirm();
  const [unusedDays, setUnusedDays] = useState<number>(DEFAULT_UNUSED_DAYS);
  const [data, setData] = useState<NfcCoverage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [issueFor, setIssueFor] = useState<NfcCoverageMember | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      setData(await nfcCardService.coverage(unusedDays));
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Unable to load card coverage'));
    } finally {
      setLoading(false);
    }
  }, [unusedDays]);

  useEffect(() => {
    void load();
  }, [load, refreshToken]);

  const revoke = useCallback(
    async (cards: NfcCoverageCard[], reason: string) => {
      if (cards.length === 0) return;
      const ok = await confirm({
        title: cards.length === 1 ? 'Revoke this card?' : `Revoke ${cards.length} cards?`,
        message: 'A revoked card stops working for good. The record stays on each member’s history.',
        confirmLabel: 'Revoke',
        cancelLabel: 'Keep them',
      });
      if (!ok) return;
      setBusy(true);
      try {
        const result = await nfcCardService.bulkUpdateStatus({
          tag_ids: cards.map((c) => c.id),
          status: NfcCardStatus.REVOKED,
          revoked_reason: reason,
        });
        if (result.updated.length > 0) toast.success(`${result.updated.length} revoked`);
        if (result.failed.length > 0) toast.error(`${result.failed.length} could not be revoked`);
        await load();
        onChanged();
      } catch (err: unknown) {
        toast.error(getErrorMessage(err, 'Unable to revoke these cards'));
      } finally {
        setBusy(false);
      }
    },
    [confirm, load, onChanged]
  );

  const shownOf = (shown: number, total: number) =>
    shown < total ? `Showing ${formatNumber(shown)} of ${formatNumber(total)}` : formatNumber(total);

  const cardLine = (card: NfcCoverageCard) => (
    <>
      <span className="font-mono">…{card.uidPreview}</span>
      {card.label ? ` · ${card.label}` : ''}
      {card.lastUsedAt ? ` · last used ${formatDateTime(card.lastUsedAt, tz)}` : ' · never used'}
    </>
  );

  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap items-end gap-3 p-4">
        <div>
          <label htmlFor="coverage-unused-days" className="form-label">
            Treat a card as unused after
          </label>
          <select
            id="coverage-unused-days"
            className="form-input"
            value={unusedDays}
            onChange={(e) => setUnusedDays(Number(e.target.value))}
          >
            {UNUSED_DAY_OPTIONS.map((days) => (
              <option key={days} value={days}>
                {days} days
              </option>
            ))}
          </select>
        </div>
        {data && (
          <p className="text-theme-text-secondary text-sm">
            {formatNumber(data.currentMemberCount - data.membersWithoutCardTotal)} of{' '}
            {formatNumber(data.currentMemberCount)} current members have a working card.
          </p>
        )}
      </div>

      {error && (
        <div className="alert-danger flex items-start gap-2">
          <AlertTriangle className="text-theme-alert-danger-icon mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p className="text-theme-alert-danger-text text-sm">{error}</p>
        </div>
      )}

      {!loading && data && (
        <>
          <section className="card p-4" aria-labelledby="coverage-without">
            <h2 id="coverage-without" className="text-theme-text-primary flex items-center gap-2 text-lg font-semibold">
              <UserX className="h-5 w-5" aria-hidden="true" />
              Current members without a working card
              <span className="text-theme-text-secondary text-sm font-normal">
                {shownOf(data.membersWithoutCard.length, data.membersWithoutCardTotal)}
              </span>
            </h2>
            {data.membersWithoutCard.length === 0 ? (
              <EmptyState
                headingLevel={3}
                icon={CreditCard}
                title="Every current member has a working card"
                description="Nothing to issue."
              />
            ) : (
              <ul className="divide-theme-surface-border mt-3 divide-y">
                {data.membersWithoutCard.map((member) => (
                  <li key={member.userId} className="flex flex-wrap items-center justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <Link
                        to={`/members/${member.userId}`}
                        className="text-theme-text-primary font-medium hover:underline"
                      >
                        {member.memberName || 'Unknown member'}
                      </Link>
                      {member.membershipNumber && (
                        <span className="text-theme-text-secondary ml-2 text-sm">#{member.membershipNumber}</span>
                      )}
                    </div>
                    <button
                      type="button"
                      className="btn-primary btn-auto inline-flex items-center gap-1.5"
                      onClick={() => setIssueFor(member)}
                    >
                      <Plus className="h-4 w-4" aria-hidden="true" />
                      Issue card
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card p-4" aria-labelledby="coverage-former">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2
                id="coverage-former"
                className="text-theme-text-primary flex items-center gap-2 text-lg font-semibold"
              >
                <AlertTriangle className="h-5 w-5" aria-hidden="true" />
                Cards held by former members
                <span className="text-theme-text-secondary text-sm font-normal">
                  {shownOf(data.formerMemberCards.length, data.formerMemberCardsTotal)}
                </span>
              </h2>
              {data.formerMemberCards.length > 1 && (
                <button
                  type="button"
                  className="btn-secondary btn-auto inline-flex items-center gap-1.5"
                  disabled={busy}
                  onClick={() => void revoke(data.formerMemberCards, 'Holder is no longer a member')}
                >
                  <XCircle className="h-4 w-4" aria-hidden="true" />
                  Revoke all shown
                </button>
              )}
            </div>
            <p className="text-theme-text-secondary mt-1 text-sm">
              These cards already fail at every reader. Revoking them closes the record for good.
            </p>
            {data.formerMemberCards.length === 0 ? (
              <EmptyState headingLevel={3} icon={CreditCard} title="None" description="No leaver still holds a card." />
            ) : (
              <ul className="divide-theme-surface-border mt-3 divide-y">
                {data.formerMemberCards.map((card) => (
                  <li key={card.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <Link
                        to={`/members/${card.userId}`}
                        className="text-theme-text-primary font-medium hover:underline"
                      >
                        {card.memberName || 'Unknown member'}
                      </Link>
                      <span className="text-theme-text-secondary ml-2 text-sm">
                        {memberStatusLabel(card.memberStatus)}
                      </span>
                      <p className="text-theme-text-secondary text-sm">{cardLine(card)}</p>
                    </div>
                    <button
                      type="button"
                      className="btn-secondary btn-auto"
                      disabled={busy}
                      onClick={() => void revoke([card], 'Holder is no longer a member')}
                    >
                      Revoke
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="card p-4" aria-labelledby="coverage-unused">
            <h2 id="coverage-unused" className="text-theme-text-primary flex items-center gap-2 text-lg font-semibold">
              <Clock className="h-5 w-5" aria-hidden="true" />
              Active cards not used in {data.unusedDays} days
              <span className="text-theme-text-secondary text-sm font-normal">
                {shownOf(data.unusedCards.length, data.unusedCardsTotal)}
              </span>
            </h2>
            {data.unusedCards.length === 0 ? (
              <EmptyState
                headingLevel={3}
                icon={CreditCard}
                title="Every active card is in use"
                description="No card has gone this long without a tap."
              />
            ) : (
              <ul className="divide-theme-surface-border mt-3 divide-y">
                {data.unusedCards.map((card) => (
                  <li key={card.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                    <div className="min-w-0">
                      <Link
                        to={`/members/${card.userId}`}
                        className="text-theme-text-primary font-medium hover:underline"
                      >
                        {card.memberName || 'Unknown member'}
                      </Link>
                      <p className="text-theme-text-secondary text-sm">{cardLine(card)}</p>
                    </div>
                    <button
                      type="button"
                      className="btn-secondary btn-auto"
                      disabled={busy}
                      onClick={() => void revoke([card], 'Card no longer in use')}
                    >
                      Revoke
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      {issueFor && (
        <IssueIdCardDialog
          isOpen
          onClose={() => setIssueFor(null)}
          userId={issueFor.userId}
          memberName={issueFor.memberName}
          onIssued={async () => {
            await load();
            onChanged();
          }}
        />
      )}
    </div>
  );
};
