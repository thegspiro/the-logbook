/**
 * Self-service checkout kiosk — `/inventory/kiosk`.
 *
 * An officer holding `inventory.kiosk` opens this on a shared Android tablet
 * and presses Start. From then on members serve themselves:
 *
 * 1. Tap your ID card. The kiosk greets you and lists what you have out.
 * 2. Tap an item's tag. If you have it, the kiosk offers to take it back and
 *    asks whether it is damaged; otherwise it offers to lend it to you, with
 *    its due date.
 * 3. Tap Done, or walk away: after a minute without a tap the kiosk forgets
 *    you, so the next person cannot act as you.
 *
 * Every request carries what was read off the member's card, and the server
 * reads it again each time; this page never tells the server who the member
 * is. The card read is kept in memory only, and cleared when the kiosk
 * forgets the member.
 *
 * Each tap also counts as activity for the officer's own session, as on the
 * check-in station, so a kiosk in use is not logged out mid-queue. An idle
 * one still is.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { AlertTriangle, CheckCircle2, Loader2, Nfc, PackageCheck, UserRound } from 'lucide-react';
import { inventoryService } from '../../../services/api';
import { useNfcScanner } from '../../../hooks/useNfcScanner';
import { useScanFeedback } from '../../../hooks/useScanFeedback';
import { useTimezone } from '../../../hooks/useTimezone';
import { useConnectedIntegrations } from '../../../hooks/useConnectedIntegrations';
import { signalUserActivity } from '../../../hooks/useIdleTimer';
import { ScanSuccessFlash } from '../../../components/ux/ScanSuccessFlash';
import { Breadcrumbs } from '../../../components/ux';
import { parseInventoryTagCode } from '../../../constants/nfc';
import { formatDate } from '../../../utils/dateFormatting';
import { getErrorMessage } from '../../../utils/errorHandling';
import { NFC_ID_CARDS_INTEGRATION, isIssuedCardCode, normalizeCardSerial } from '../../membership/constants/idCards';
import { useInventoryNfcEnabled } from '../hooks/useInventoryNfcEnabled';
import type { InventoryNfcResolveRequest, KioskIdentifyResponse, KioskPreviewResponse } from '../types/nfc';

/** How long a member's session lasts without a tap or a press. */
export const MEMBER_TIMEOUT_MS = 60_000;
/** How long a success message stays before the member screen returns. */
const MESSAGE_MS = 4_000;

type Phase = 'idle' | 'member' | 'confirm' | 'damage';

interface Pending {
  preview: KioskPreviewResponse;
  item: InventoryNfcResolveRequest;
}

function readCard(tag: { serialNumber: string; payload: string | null }): InventoryNfcResolveRequest | null {
  const serial = normalizeCardSerial(tag.serialNumber);
  const code = isIssuedCardCode(tag.payload) ? normalizeCardSerial(tag.payload ?? '') : undefined;
  if (!code && serial.length < 4) return null;
  return { code, serial_number: serial.length >= 4 ? serial : undefined };
}

function readItem(tag: { serialNumber: string; payload: string | null }): InventoryNfcResolveRequest | null {
  const serial = tag.serialNumber.replace(/[^0-9A-Za-z]/g, '');
  const code = parseInventoryTagCode(tag.payload) ?? undefined;
  if (!code && serial.length < 4) return null;
  return { code, serial_number: serial.length >= 4 ? serial : undefined };
}

export const InventoryKioskPage: React.FC = () => {
  const tz = useTimezone();
  const { flashing, signalScanSuccess } = useScanFeedback();
  const { enabled: nfcEnabled, loading: loadingSwitch } = useInventoryNfcEnabled();
  const { isConnected, loading: loadingIntegrations } = useConnectedIntegrations();

  const [phase, setPhase] = useState<Phase>('idle');
  const [member, setMember] = useState<KioskIdentifyResponse | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [damageNote, setDamageNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [lastActivity, setLastActivity] = useState(() => Date.now());

  // Read by the tap handler, which the scanner keeps from when it started.
  const phaseRef = useRef<Phase>('idle');
  const cardRef = useRef<InventoryNfcResolveRequest | null>(null);
  const busyRef = useRef(false);

  const go = (next: Phase) => {
    phaseRef.current = next;
    setPhase(next);
  };

  const touch = () => {
    signalUserActivity();
    setLastActivity(Date.now());
  };

  const forget = useCallback(() => {
    cardRef.current = null;
    phaseRef.current = 'idle';
    setPhase('idle');
    setMember(null);
    setPending(null);
    setDamageNote('');
    setMessage(null);
  }, []);

  // Forget the member after a minute with nothing happening.
  useEffect(() => {
    if (phase === 'idle') return undefined;
    const timer = window.setTimeout(forget, MEMBER_TIMEOUT_MS - (Date.now() - lastActivity));
    return () => window.clearTimeout(timer);
  }, [phase, lastActivity, forget]);

  // A success message clears itself; an error stays until the next tap.
  useEffect(() => {
    if (message?.kind !== 'ok') return undefined;
    const timer = window.setTimeout(() => setMessage(null), MESSAGE_MS);
    return () => window.clearTimeout(timer);
  }, [message]);

  const run = async (work: () => Promise<void>) => {
    busyRef.current = true;
    setBusy(true);
    try {
      await work();
    } catch (err: unknown) {
      setMessage({ kind: 'error', text: getErrorMessage(err, 'That did not work. Please try again.') });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const identify = (card: InventoryNfcResolveRequest) =>
    run(async () => {
      const me = await inventoryService.kioskIdentify(card);
      cardRef.current = card;
      setMember(me);
      setPending(null);
      setMessage(null);
      go('member');
      signalScanSuccess();
    });

  const refreshMember = async () => {
    const card = cardRef.current;
    if (card) setMember(await inventoryService.kioskIdentify(card));
  };

  const onTag = (tag: { serialNumber: string; payload: string | null }) => {
    if (busyRef.current) return;
    touch();
    const current = phaseRef.current;
    // A tag that carries an issued card code is always a card: the next member
    // can start without the previous one pressing Done.
    if (current === 'idle' || isIssuedCardCode(tag.payload)) {
      const card = readCard(tag);
      if (!card) {
        setMessage({ kind: 'error', text: 'That card could not be read. Hold it still and try again.' });
        return;
      }
      void identify(card);
      return;
    }
    if (current !== 'member') return;
    const item = readItem(tag);
    const card = cardRef.current;
    if (!item || !card) {
      setMessage({ kind: 'error', text: 'That tag could not be read. Hold it still and try again.' });
      return;
    }
    void run(async () => {
      const preview = await inventoryService.kioskPreview({ card, item });
      setPending({ preview, item });
      setMessage(null);
      go('confirm');
      signalScanSuccess();
    });
  };

  const onTagRef = useRef(onTag);
  onTagRef.current = onTag;
  const handleTag = useCallback((tag: { serialNumber: string; payload: string | null }) => onTagRef.current(tag), []);

  const { supported, scanning, error: scanError, unavailableReason, start, stop } = useNfcScanner({ onTag: handleTag });
  useEffect(() => () => stop(), [stop]);

  const confirmCheckout = () => {
    const card = cardRef.current;
    if (!pending || !card) return;
    touch();
    void run(async () => {
      const result = await inventoryService.kioskCheckout({ card, item: pending.item });
      await refreshMember();
      setPending(null);
      go('member');
      setMessage({
        kind: 'ok',
        text: result.due_at
          ? `${result.item_name} is yours until ${formatDate(result.due_at, tz)}.`
          : `${result.item_name} is checked out to you.`,
      });
    });
  };

  const confirmReturn = (damaged: boolean) => {
    const card = cardRef.current;
    if (!pending || !card) return;
    touch();
    void run(async () => {
      const result = await inventoryService.kioskReturn({
        card,
        item: pending.item,
        damaged,
        damage_notes: damaged ? damageNote.trim() || undefined : undefined,
      });
      await refreshMember();
      setPending(null);
      setDamageNote('');
      go('member');
      setMessage({
        kind: 'ok',
        text: result.damaged
          ? `${result.item_name} is returned. Thanks for reporting the damage.`
          : `${result.item_name} is returned. Thank you.`,
      });
    });
  };

  const cancelPending = () => {
    touch();
    setPending(null);
    setDamageNote('');
    go('member');
  };

  if (loadingSwitch || loadingIntegrations) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="text-theme-text-muted h-6 w-6 animate-spin" aria-label="Loading" />
      </div>
    );
  }

  const cardsOn = isConnected(NFC_ID_CARDS_INTEGRATION);
  if (!nfcEnabled || !cardsOn) {
    return (
      <div className="mx-auto max-w-2xl space-y-4 px-4 py-6 sm:px-6">
        <h1 className="text-theme-text-primary text-2xl font-bold">Self-Service Kiosk</h1>
        <div className="alert-warning" role="status">
          The kiosk needs {!nfcEnabled ? 'NFC tag tracking' : 'NFC ID cards'} turned on.{' '}
          {!nfcEnabled ? (
            <Link to="/inventory/admin/nfc" className="underline">
              Turn on NFC tags
            </Link>
          ) : (
            'An administrator can connect NFC ID Cards under Settings → Integrations.'
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-6 sm:px-6">
      <ScanSuccessFlash active={flashing} />
      <Breadcrumbs underHub="/inventory/admin" />
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-theme-text-primary flex items-center gap-2 text-2xl font-bold">
          <PackageCheck className="h-6 w-6" aria-hidden="true" /> Self-Service Kiosk
        </h1>
        {supported &&
          (scanning ? (
            <button type="button" className="btn-secondary btn-sm" onClick={stop}>
              Stop kiosk
            </button>
          ) : (
            <button type="button" className="btn-primary" onClick={() => void start()}>
              <Nfc className="h-4 w-4" aria-hidden="true" /> Start kiosk
            </button>
          ))}
      </header>

      {!supported && (
        <div className="alert-warning" role="status">
          {unavailableReason} The kiosk needs an Android tablet with Chrome.
        </div>
      )}
      {scanError && (
        <div className="alert-danger" role="alert">
          <p className="text-theme-alert-danger-text text-sm">{scanError}</p>
        </div>
      )}

      {message && (
        <div
          className={`flex items-start gap-2 ${message.kind === 'ok' ? 'alert-success' : 'alert-danger'}`}
          role={message.kind === 'ok' ? 'status' : 'alert'}
        >
          {message.kind === 'ok' ? (
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          ) : (
            <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
          )}
          <p className="text-base">{message.text}</p>
        </div>
      )}

      <section className="card space-y-4 p-6" aria-live="polite" aria-label="Kiosk">
        {busy && (
          <p className="text-theme-text-muted flex items-center gap-2 text-sm" role="status">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> One moment…
          </p>
        )}

        {phase === 'idle' && (
          <div className="py-8 text-center">
            <Nfc
              className={`text-theme-text-muted mx-auto h-16 w-16 ${scanning ? 'animate-pulse' : ''}`}
              aria-hidden="true"
            />
            <p className="text-theme-text-primary mt-4 text-2xl font-semibold">
              {scanning ? 'Tap your ID card to start' : 'Press Start kiosk to begin'}
            </p>
          </div>
        )}

        {phase === 'member' && member && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-theme-text-primary flex items-center gap-2 text-xl font-semibold">
                <UserRound className="h-6 w-6" aria-hidden="true" /> Hi, {member.member_name}
              </p>
              <button type="button" className="btn-secondary" onClick={forget}>
                Done
              </button>
            </div>
            <p className="text-theme-text-primary text-lg">Tap an item to borrow it or bring it back.</p>
            <div>
              <h2 className="text-theme-text-secondary text-sm font-semibold">You have out</h2>
              {member.loans.length === 0 ? (
                <p className="text-theme-text-secondary text-sm">Nothing right now.</p>
              ) : (
                <ul className="divide-theme-surface-border divide-y">
                  {member.loans.map((loan) => (
                    <li key={loan.checkout_id} className="flex justify-between gap-2 py-2 text-sm">
                      <span className="text-theme-text-primary">{loan.item_name}</span>
                      <span className="text-theme-text-secondary">
                        {loan.due_at ? `due ${formatDate(loan.due_at, tz)}` : 'no due date'}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}

        {phase === 'confirm' && pending && pending.preview.action === 'checkout' && (
          <div className="space-y-4 text-center">
            <p className="text-theme-text-primary text-2xl font-semibold">Borrow {pending.preview.item_name}?</p>
            <p className="text-theme-text-secondary">
              {pending.preview.due_at
                ? `Due back ${formatDate(pending.preview.due_at, tz)}.`
                : 'No due date: return it when you are finished.'}
            </p>
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
              <button type="button" className="btn-primary" onClick={confirmCheckout} disabled={busy}>
                Borrow it
              </button>
              <button type="button" className="btn-secondary" onClick={cancelPending} disabled={busy}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {phase === 'confirm' && pending && pending.preview.action === 'return' && (
          <div className="space-y-4 text-center">
            <p className="text-theme-text-primary text-2xl font-semibold">Return {pending.preview.item_name}?</p>
            <p className="text-theme-text-secondary">Is anything damaged or missing?</p>
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-center">
              <button type="button" className="btn-primary" onClick={() => confirmReturn(false)} disabled={busy}>
                No, return it
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  touch();
                  go('damage');
                }}
                disabled={busy}
              >
                Yes, it&apos;s damaged
              </button>
              <button type="button" className="btn-secondary" onClick={cancelPending} disabled={busy}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {phase === 'damage' && pending && (
          <div className="space-y-3">
            <p className="text-theme-text-primary text-xl font-semibold">
              What&apos;s wrong with {pending.preview.item_name}?
            </p>
            <label htmlFor="kiosk-damage" className="form-label">
              Describe the damage
            </label>
            <textarea
              id="kiosk-damage"
              className="form-input"
              rows={3}
              maxLength={500}
              value={damageNote}
              onChange={(e) => {
                touch();
                setDamageNote(e.target.value);
              }}
            />
            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                className="btn-primary"
                onClick={() => confirmReturn(true)}
                disabled={busy || !damageNote.trim()}
              >
                Return as damaged
              </button>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => {
                  touch();
                  go('confirm');
                }}
                disabled={busy}
              >
                Back
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
};

export default InventoryKioskPage;
