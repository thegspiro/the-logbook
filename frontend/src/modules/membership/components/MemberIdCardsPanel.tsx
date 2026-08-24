/**
 * Member ID cards (NFC credentials) for one member.
 *
 * An officer issues a card here and hands it to the member. There is no
 * self-service view and no member-facing control: a card records attendance on
 * the member's behalf, so it is issued the way a key is, by somebody
 * accountable for handing it over. The server enforces the same thing — every
 * `/nfc-tags` route requires `members.manage_id_cards` or `members.check_in`,
 * and none of them is addressed to the calling member.
 *
 * Renders nothing at all unless the organization has turned on the NFC ID
 * Cards integration. That check is a courtesy, not the control; the endpoints
 * refuse independently.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CreditCard, Plus, Trash2, Ban, RotateCcw, AlertTriangle, PenLine } from 'lucide-react';
import toast from 'react-hot-toast';
import { Modal } from '../../../components/Modal';
import { EmptyState } from '../../../components/ux/EmptyState';
import { NfcCardCapture } from './NfcCardCapture';
import { nfcCardService } from '../services/nfcCardService';
import { useConfirm } from '../../../contexts/ConfirmContext';
import { useTimezone } from '../../../hooks/useTimezone';
import { useConnectedIntegrations } from '../../../hooks/useConnectedIntegrations';
import { formatDateTime } from '../../../utils/dateFormatting';
import { getErrorMessage } from '../../../utils/errorHandling';
import { NfcCardStatus, NfcCredentialType, NFC_CARD_STATUS_COLORS } from '../../../constants/enums';
import { NFC_CARD_STATUS_LABELS, NFC_ID_CARDS_INTEGRATION, isPlausibleCardSerial } from '../constants/idCards';
import type { NfcCard } from '../types/idCard';

interface MemberIdCardsPanelProps {
  userId: string;
  /** Shown in the add dialog so an officer can see whose card they are issuing. */
  memberName?: string | undefined;
}

export const MemberIdCardsPanel: React.FC<MemberIdCardsPanelProps> = ({ userId, memberName }) => {
  const tz = useTimezone();
  const { confirm } = useConfirm();
  const { isConnected, loading: integrationsLoading } = useConnectedIntegrations();
  const cardsEnabled = isConnected(NFC_ID_CARDS_INTEGRATION);

  const [cards, setCards] = useState<NfcCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [addOpen, setAddOpen] = useState(false);
  const [credential, setCredential] = useState('');
  const [credentialType, setCredentialType] = useState<NfcCredentialType>(NfcCredentialType.SERIAL);
  const [label, setLabel] = useState('');
  const [saving, setSaving] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      setLoadError(null);
      const data = await nfcCardService.list({ userId });
      setCards(data.items);
    } catch (err: unknown) {
      setLoadError(getErrorMessage(err, 'Unable to load ID cards'));
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    if (!cardsEnabled) return;
    void load();
  }, [load, cardsEnabled]);

  const activeCount = useMemo(() => cards.filter((c) => c.status === NfcCardStatus.ACTIVE).length, [cards]);

  const closeAdd = useCallback(() => {
    setAddOpen(false);
    setCredential('');
    setCredentialType(NfcCredentialType.SERIAL);
    setLabel('');
    setAddError(null);
  }, []);

  const handleCapture = useCallback((value: string, type: NfcCredentialType) => {
    setCredential(value);
    setCredentialType(type);
  }, []);

  const handleAdd = useCallback(async () => {
    if (!isPlausibleCardSerial(credential)) {
      setAddError('No card has been read yet. Write a code to a blank card, tap a printed one, or type its serial.');
      return;
    }
    setSaving(true);
    setAddError(null);
    try {
      await nfcCardService.register({
        user_id: userId,
        tag_uid: credential,
        credential_type: credentialType,
        // Create payload: a blank label is omitted rather than sent as "".
        label: label.trim() || undefined,
      });
      toast.success('ID card issued');
      closeAdd();
      await load();
    } catch (err: unknown) {
      setAddError(getErrorMessage(err, 'Unable to register this card'));
    } finally {
      setSaving(false);
    }
  }, [credential, credentialType, label, userId, closeAdd, load]);

  const setStatus = useCallback(
    async (card: NfcCard, status: NfcCardStatus, reason?: string) => {
      try {
        await nfcCardService.update(card.id, {
          status,
          // Update payload: an explicit null clears a stale reason when a card
          // is reactivated, where omitting the key would leave it behind.
          revoked_reason: reason ?? null,
        });
        await load();
      } catch (err: unknown) {
        toast.error(getErrorMessage(err, 'Unable to update this card'));
      }
    },
    [load]
  );

  const handleReportLost = useCallback(
    async (card: NfcCard) => {
      const ok = await confirm({
        title: 'Report this card lost?',
        message:
          'The card stops working immediately and cannot be reactivated — whoever has it could otherwise still tap ' +
          'it. Issue a replacement card afterwards.',
        confirmLabel: 'Report lost',
        cancelLabel: 'Keep it active',
      });
      if (!ok) return;
      await setStatus(card, NfcCardStatus.LOST, 'Reported lost');
    },
    [confirm, setStatus]
  );

  const handleDelete = useCallback(
    async (card: NfcCard) => {
      const ok = await confirm({
        title: 'Remove this card registration?',
        message:
          'The card and its history disappear from this member entirely. To keep the record while stopping the ' +
          'card from working, suspend or report it lost instead.',
        confirmLabel: 'Remove',
        cancelLabel: 'Keep it',
      });
      if (!ok) return;
      try {
        await nfcCardService.remove(card.id);
        toast.success('Card removed');
        await load();
      } catch (err: unknown) {
        toast.error(getErrorMessage(err, 'Unable to remove this card'));
      }
    },
    [confirm, load]
  );

  // An organization that has not turned cards on gets no section — an empty
  // "ID Cards" panel reads as "none issued", which is a different statement.
  if (integrationsLoading || !cardsEnabled) return null;

  return (
    <div className="card">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <CreditCard className="text-theme-text-secondary h-5 w-5" aria-hidden="true" />
          <h2 className="text-theme-text-primary text-lg font-semibold">ID Cards</h2>
          {!loading && (
            <span className="text-theme-text-secondary text-sm">
              {activeCount} active of {cards.length}
            </span>
          )}
        </div>
        <button type="button" onClick={() => setAddOpen(true)} className="btn-primary inline-flex items-center gap-2">
          <Plus className="h-4 w-4" aria-hidden="true" />
          Issue card
        </button>
      </div>

      {loadError && (
        <div className="alert-danger flex items-start gap-2">
          <AlertTriangle className="text-theme-alert-danger-icon mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p className="text-theme-alert-danger-text text-sm">{loadError}</p>
        </div>
      )}

      {!loading && !loadError && cards.length === 0 && (
        <EmptyState
          icon={CreditCard}
          title="No ID cards issued"
          description="Write a code to a blank NFC tag, or record a printed card's serial, so this member can tap in at a check-in station."
        />
      )}

      {cards.length > 0 && (
        <ul className="divide-theme-surface-border divide-y">
          {cards.map((card) => (
            <li key={card.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-theme-text-primary font-medium">{card.label || 'ID card'}</span>
                  <span className={`badge ${NFC_CARD_STATUS_COLORS[card.status] ?? ''}`}>
                    {NFC_CARD_STATUS_LABELS[card.status]}
                  </span>
                  {card.credentialType === NfcCredentialType.WRITTEN && (
                    <span
                      className="text-theme-text-muted inline-flex items-center gap-1 text-xs"
                      title="A code was written to this tag; it can be rewritten and reused"
                    >
                      <PenLine className="h-3 w-3" aria-hidden="true" />
                      Written
                    </span>
                  )}
                </div>
                <p className="text-theme-text-secondary text-sm">
                  <span className="font-mono">…{card.uidPreview}</span>
                  {' · issued '}
                  {formatDateTime(card.issuedAt, tz)}
                  {card.lastUsedAt ? ` · last used ${formatDateTime(card.lastUsedAt, tz)}` : ' · never used'}
                </p>
              </div>

              <div className="flex items-center gap-2">
                {card.status === NfcCardStatus.ACTIVE ? (
                  <>
                    <button
                      type="button"
                      onClick={() => void setStatus(card, NfcCardStatus.SUSPENDED, 'Suspended by an officer')}
                      className="btn-secondary btn-auto inline-flex items-center gap-1.5"
                    >
                      <Ban className="h-4 w-4" aria-hidden="true" />
                      Suspend
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleReportLost(card)}
                      className="btn-secondary btn-auto inline-flex items-center gap-1.5"
                    >
                      <AlertTriangle className="h-4 w-4" aria-hidden="true" />
                      Lost
                    </button>
                  </>
                ) : (
                  card.status === NfcCardStatus.SUSPENDED && (
                    <button
                      type="button"
                      onClick={() => void setStatus(card, NfcCardStatus.ACTIVE)}
                      className="btn-secondary btn-auto inline-flex items-center gap-1.5"
                    >
                      <RotateCcw className="h-4 w-4" aria-hidden="true" />
                      Reactivate
                    </button>
                  )
                )}
                <button
                  type="button"
                  onClick={() => void handleDelete(card)}
                  className="btn-icon"
                  aria-label={`Remove card ending ${card.uidPreview}`}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Modal
        isOpen={addOpen}
        onClose={closeAdd}
        title={memberName ? `Issue an ID card to ${memberName}` : 'Issue an ID card'}
        size="sm"
        footer={
          <>
            <button type="button" onClick={closeAdd} className="btn-secondary">
              Cancel
            </button>
            <button type="button" onClick={() => void handleAdd()} disabled={saving} className="btn-primary">
              {saving ? 'Registering…' : 'Register card'}
            </button>
          </>
        }
      >
        <div className="modal-body space-y-4">
          <NfcCardCapture
            value={credential}
            onChange={handleCapture}
            credentialType={credentialType}
            error={addError}
          />
          <div>
            <label className="form-label" htmlFor="nfc-card-label">
              Label <span className="text-theme-text-secondary font-normal">(optional)</span>
            </label>
            <input
              id="nfc-card-label"
              type="text"
              className="form-input"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Blue ID card"
              maxLength={100}
            />
          </div>
        </div>
      </Modal>
    </div>
  );
};
