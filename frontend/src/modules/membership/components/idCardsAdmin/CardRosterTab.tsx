/**
 * Every ID card the department has issued, with search, filters and bulk
 * status changes.
 *
 * Only active and suspended cards can be selected: a lost or revoked card is
 * terminal and the server refuses to move it, so offering it in a bulk action
 * would only produce a list of failures.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { AlertTriangle, Ban, History, PenLine, RotateCcw, Search, XCircle } from 'lucide-react';
import toast from 'react-hot-toast';
import { EmptyState } from '../../../../components/ux/EmptyState';
import { PromptDialog } from '../../../../components/ux/PromptDialog';
import { useConfirm } from '../../../../contexts/ConfirmContext';
import { useTimezone } from '../../../../hooks/useTimezone';
import { formatDateTime } from '../../../../utils/dateFormatting';
import { getErrorMessage } from '../../../../utils/errorHandling';
import { NfcCardStatus, NfcCredentialType, NFC_CARD_STATUS_COLORS } from '../../../../constants/enums';
import { NFC_CARD_STATUS_LABELS } from '../../constants/idCards';
import { nfcCardService } from '../../services/nfcCardService';
import type { NfcCard } from '../../types/idCard';

const SELECTABLE: readonly NfcCardStatus[] = [NfcCardStatus.ACTIVE, NfcCardStatus.SUSPENDED];

interface CardRosterTabProps {
  /** Open the tap log filtered to one card. */
  onShowTaps: (card: NfcCard) => void;
  /** Bumped by the page when another tab changed cards, so this list reloads. */
  refreshToken: number;
  onChanged: () => void;
}

export const CardRosterTab: React.FC<CardRosterTabProps> = ({ onShowTaps, refreshToken, onChanged }) => {
  const tz = useTimezone();
  const { confirm } = useConfirm();

  const [cards, setCards] = useState<NfcCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<NfcCardStatus | ''>('');
  const [typeFilter, setTypeFilter] = useState<NfcCredentialType | ''>('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [revokeOpen, setRevokeOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setLoadError(null);
      const data = await nfcCardService.list();
      setCards(data.items);
      // A card that changed state may no longer be selectable.
      setSelected((prev) => {
        const keep = new Set<string>();
        for (const card of data.items) {
          if (prev.has(card.id) && SELECTABLE.includes(card.status)) keep.add(card.id);
        }
        return keep;
      });
    } catch (err: unknown) {
      setLoadError(getErrorMessage(err, 'Unable to load ID cards'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshToken]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return cards.filter((card) => {
      if (statusFilter && card.status !== statusFilter) return false;
      if (typeFilter && card.credentialType !== typeFilter) return false;
      if (!term) return true;
      return [card.memberName, card.label, card.uidPreview].some((v) => (v ?? '').toLowerCase().includes(term));
    });
  }, [cards, search, statusFilter, typeFilter]);

  const selectableVisible = visible.filter((c) => SELECTABLE.includes(c.status));
  const allVisibleSelected = selectableVisible.length > 0 && selectableVisible.every((c) => selected.has(c.id));

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleAllVisible = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) selectableVisible.forEach((c) => next.delete(c.id));
      else selectableVisible.forEach((c) => next.add(c.id));
      return next;
    });

  const applyStatus = useCallback(
    async (ids: string[], status: NfcCardStatus, reason: string | null) => {
      if (ids.length === 0) return;
      setBusy(true);
      try {
        const result = await nfcCardService.bulkUpdateStatus({ tag_ids: ids, status, revoked_reason: reason });
        if (result.updated.length > 0) {
          toast.success(result.updated.length === 1 ? '1 card updated' : `${result.updated.length} cards updated`);
        }
        if (result.failed.length > 0) {
          const first = result.failed[0]?.detail ?? '';
          toast.error(
            result.failed.length === 1
              ? `1 card was not changed: ${first}`
              : `${result.failed.length} cards were not changed. ${first}`
          );
        }
        await load();
        onChanged();
      } catch (err: unknown) {
        toast.error(getErrorMessage(err, 'Unable to update these cards'));
      } finally {
        setBusy(false);
      }
    },
    [load, onChanged]
  );

  const selectedIds = Array.from(selected);

  const reportLost = async (ids: string[]) => {
    const ok = await confirm({
      title: ids.length === 1 ? 'Report this card lost?' : `Report ${ids.length} cards lost?`,
      message:
        'A lost card stops working immediately and can never be reactivated — whoever has it could otherwise ' +
        'still tap it. Issue replacements afterwards.',
      confirmLabel: 'Report lost',
      cancelLabel: 'Keep them active',
    });
    if (ok) await applyStatus(ids, NfcCardStatus.LOST, 'Reported lost');
  };

  return (
    <div className="space-y-4">
      <div className="card space-y-3 p-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="relative">
            <label htmlFor="id-card-search" className="sr-only">
              Search cards
            </label>
            <Search
              className="text-theme-text-muted pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2"
              aria-hidden="true"
            />
            <input
              id="id-card-search"
              type="search"
              className="form-input pl-9"
              placeholder="Member, label or last 4"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="id-card-status" className="sr-only">
              Status
            </label>
            <select
              id="id-card-status"
              className="form-input"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as NfcCardStatus | '')}
            >
              <option value="">All statuses</option>
              {Object.values(NfcCardStatus).map((s) => (
                <option key={s} value={s}>
                  {NFC_CARD_STATUS_LABELS[s]}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="id-card-type" className="sr-only">
              Card type
            </label>
            <select
              id="id-card-type"
              className="form-input"
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as NfcCredentialType | '')}
            >
              <option value="">All card types</option>
              <option value={NfcCredentialType.SERIAL}>Printed card (serial)</option>
              <option value={NfcCredentialType.WRITTEN}>Written tag</option>
            </select>
          </div>
        </div>
        <p className="text-theme-text-secondary text-sm">
          Issue a card from a member&apos;s profile, or from <strong>Coverage</strong> for members who have none.
        </p>
      </div>

      {selected.size > 0 && (
        <div
          className="card flex flex-wrap items-center gap-2 p-3"
          role="region"
          aria-label="Actions for selected cards"
        >
          <span className="text-theme-text-primary mr-2 text-sm font-medium">{selected.size} selected</span>
          <button
            type="button"
            className="btn-secondary btn-auto inline-flex items-center gap-1.5"
            disabled={busy}
            onClick={() => void applyStatus(selectedIds, NfcCardStatus.SUSPENDED, 'Suspended by an officer')}
          >
            <Ban className="h-4 w-4" aria-hidden="true" />
            Suspend
          </button>
          <button
            type="button"
            className="btn-secondary btn-auto inline-flex items-center gap-1.5"
            disabled={busy}
            onClick={() => void applyStatus(selectedIds, NfcCardStatus.ACTIVE, null)}
          >
            <RotateCcw className="h-4 w-4" aria-hidden="true" />
            Reactivate
          </button>
          <button
            type="button"
            className="btn-secondary btn-auto inline-flex items-center gap-1.5"
            disabled={busy}
            onClick={() => void reportLost(selectedIds)}
          >
            <AlertTriangle className="h-4 w-4" aria-hidden="true" />
            Report lost
          </button>
          <button
            type="button"
            className="btn-secondary btn-auto inline-flex items-center gap-1.5"
            disabled={busy}
            onClick={() => setRevokeOpen(true)}
          >
            <XCircle className="h-4 w-4" aria-hidden="true" />
            Revoke
          </button>
          <button
            type="button"
            className="text-theme-text-secondary ml-auto text-sm underline"
            onClick={() => setSelected(new Set())}
          >
            Clear selection
          </button>
        </div>
      )}

      {loadError && (
        <div className="alert-danger flex items-start gap-2">
          <AlertTriangle className="text-theme-alert-danger-icon mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p className="text-theme-alert-danger-text text-sm">{loadError}</p>
        </div>
      )}

      {!loading && !loadError && visible.length === 0 && (
        <div className="card p-4">
          <EmptyState
            headingLevel={3}
            icon={Search}
            title={cards.length === 0 ? 'No ID cards issued yet' : 'No cards match these filters'}
            description={
              cards.length === 0
                ? 'Issue a card from a member’s profile, or from the Coverage tab.'
                : 'Clear the search or choose a different status.'
            }
          />
        </div>
      )}

      {visible.length > 0 && (
        <div className="card overflow-hidden">
          <table className="rwd-table w-full text-sm">
            <thead>
              <tr className="text-theme-text-secondary text-left">
                <th className="w-10 p-3">
                  <input
                    type="checkbox"
                    className="form-checkbox"
                    aria-label="Select every card shown"
                    checked={allVisibleSelected}
                    disabled={selectableVisible.length === 0}
                    onChange={toggleAllVisible}
                  />
                </th>
                <th className="p-3">Member</th>
                <th className="p-3">Card</th>
                <th className="p-3">Status</th>
                <th className="p-3">Last used</th>
                <th className="p-3">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody className="divide-theme-surface-border divide-y">
              {visible.map((card) => {
                const selectable = SELECTABLE.includes(card.status);
                return (
                  <tr key={card.id}>
                    <td className="p-3" data-label="Select">
                      <input
                        type="checkbox"
                        className="form-checkbox"
                        aria-label={`Select card ending ${card.uidPreview}`}
                        checked={selected.has(card.id)}
                        disabled={!selectable}
                        onChange={() => toggle(card.id)}
                      />
                    </td>
                    <td className="p-3" data-label="Member">
                      <Link
                        to={`/members/${card.userId}`}
                        className="text-theme-text-primary font-medium hover:underline"
                      >
                        {card.memberName || 'Unknown member'}
                      </Link>
                    </td>
                    <td className="p-3" data-label="Card">
                      <span className="text-theme-text-primary">{card.label || 'ID card'}</span>{' '}
                      <span className="text-theme-text-secondary font-mono">…{card.uidPreview}</span>
                      {card.credentialType === NfcCredentialType.WRITTEN && (
                        <span className="text-theme-text-muted ml-2 inline-flex items-center gap-1 text-xs">
                          <PenLine className="h-3 w-3" aria-hidden="true" />
                          Written
                        </span>
                      )}
                      <div className="text-theme-text-muted text-xs">Issued {formatDateTime(card.issuedAt, tz)}</div>
                    </td>
                    <td className="p-3" data-label="Status">
                      <span className={`badge ${NFC_CARD_STATUS_COLORS[card.status] ?? ''}`}>
                        {NFC_CARD_STATUS_LABELS[card.status]}
                      </span>
                      {card.autoSuspended && (
                        <div className="text-theme-text-muted mt-1 text-xs">Holder left — returns if they rejoin</div>
                      )}
                    </td>
                    <td className="text-theme-text-secondary p-3" data-label="Last used">
                      {card.lastUsedAt ? formatDateTime(card.lastUsedAt, tz) : 'Never'}
                    </td>
                    <td className="p-3" data-label="Actions">
                      <button
                        type="button"
                        className="btn-secondary btn-auto inline-flex items-center gap-1.5"
                        onClick={() => onShowTaps(card)}
                      >
                        <History className="h-4 w-4" aria-hidden="true" />
                        Taps
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <PromptDialog
        isOpen={revokeOpen}
        onClose={() => setRevokeOpen(false)}
        onSubmit={(reason) => {
          setRevokeOpen(false);
          void applyStatus(selectedIds, NfcCardStatus.REVOKED, reason.trim() || null);
        }}
        title={selected.size === 1 ? 'Revoke this card?' : `Revoke ${selected.size} cards?`}
        message="A revoked card stops working for good. The record stays on each member's history."
        label="Reason (optional)"
        required={false}
        placeholder="Member left the department"
        confirmLabel="Revoke"
        confirmVariant="warning"
        loading={busy}
      />
    </div>
  );
};
