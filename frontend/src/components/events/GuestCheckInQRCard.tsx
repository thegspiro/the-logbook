/**
 * An event's own guest QR code, for the managers who put it on display.
 *
 * Visitors who are not members scan it to sign themselves in on the public
 * guest page — the same sign-in a room kiosk offers, for an event held where
 * there is no kiosk. Shown on the event's QR code page and on its detail page.
 *
 * Rendered only for events.manage holders, unlike the member QR code beside it:
 * the code's token is a credential for an unauthenticated write, and the QR
 * page is open to every member. The token is fetched only while this card is
 * shown and is never cached (see `getGuestCheckInLink`).
 *
 * Like the member code, the guest code is withheld until check-in opens and
 * again once it closes. A code on screen is a code someone photographs: shown
 * early, visitors scan it before the event and meet a sign-in that refuses
 * them. Whether it is open is the backend's call (`is_open`, the same rule the
 * public sign-in enforces), refreshed on the member page's 30-second cadence so
 * the code appears when the window opens without a reload.
 */

import React, { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { QRCodeSVG } from 'qrcode.react';
import { Check, Copy, Loader2, Printer, QrCode, RefreshCw, UserPlus } from 'lucide-react';
import toast from 'react-hot-toast';
import { eventService } from '../../services/api';
import { useAuthStore } from '../../stores/authStore';
import { useConfirm } from '../../contexts/ConfirmContext';
import { getErrorMessage } from '../../utils/errorHandling';
import { copyToClipboard } from '../../utils/clipboard';
import { buildGuestCheckInUrl } from '../../constants/nfc';
import { useTimezone } from '../../hooks/useTimezone';
import { formatShortDateTime } from '../../utils/dateFormatting';
import type { GuestCheckInLink } from '../../types/event';

const REFRESH_INTERVAL_MS = 30000;

interface GuestCheckInQRCardProps {
  eventId: string;
  eventName: string;
  /** The event's "Allow guest check-in" switch; the code opens nothing without it. */
  allowGuestCheckIn: boolean;
  /** An unpublished event's code is issued but refused until it is published. */
  isDraft?: boolean;
  /** Explain how to turn guest check-in on, rather than rendering nothing, when it is off. */
  showOffHint?: boolean;
  /** Offer a link to the full-size code on the QR page. */
  showFullPageLink?: boolean;
  /** Offer a Print button; the caller decides what the printout holds. */
  onPrint?: () => void;
  /** The department's timezone, when the caller has it; else the viewer's. */
  timezone?: string | null | undefined;
}

export const GuestCheckInQRCard: React.FC<GuestCheckInQRCardProps> = ({
  eventId,
  eventName,
  allowGuestCheckIn,
  isDraft = false,
  showOffHint = false,
  showFullPageLink = false,
  onPrint,
  timezone,
}) => {
  const canManage = useAuthStore((s) => s.checkPermission)('events.manage');
  const { confirm } = useConfirm();
  const userTz = useTimezone();
  const tz = timezone || userTz;
  const [link, setLink] = useState<GuestCheckInLink | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [rotating, setRotating] = useState(false);
  const [copied, setCopied] = useState(false);

  const shouldLoad = canManage && allowGuestCheckIn;

  useEffect(() => {
    if (!shouldLoad) return undefined;
    let cancelled = false;
    setLoading(true);
    setFailed(null);
    // Issued on first view rather than by a button: issuing is idempotent, so
    // a code a manager printed yesterday is the one shown today.
    const load = async () => {
      const current = await eventService.getGuestCheckInLink(eventId);
      if (current.guest_token) return current;
      return eventService.issueGuestCheckInLink(eventId);
    };
    load()
      .then((value) => {
        if (!cancelled) setLink(value);
      })
      .catch((err: unknown) => {
        if (!cancelled) setFailed(getErrorMessage(err, 'The guest QR code could not be loaded.'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    // A failed refresh keeps what is on screen: the next one, 30s on, corrects it.
    const interval = setInterval(() => {
      eventService
        .getGuestCheckInLink(eventId)
        .then((value) => {
          if (!cancelled && value.guest_token) setLink(value);
        })
        .catch(() => undefined);
    }, REFRESH_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [eventId, shouldLoad]);

  if (!canManage) return null;

  if (!allowGuestCheckIn) {
    if (!showOffHint) return null;
    return (
      <section className="card p-6" aria-labelledby="guest-qr-heading">
        <h2 id="guest-qr-heading" className="text-theme-text-primary mb-2 flex items-center gap-2 text-lg font-medium">
          <UserPlus className="h-5 w-5" aria-hidden="true" />
          Guest Check-In
        </h2>
        <p className="text-theme-text-secondary text-sm">
          Guest check-in is off for this event, so there is no code for visitors to scan. To let people who are not
          members sign themselves in, turn on <span className="font-medium">Allow guest check-in</span> when you{' '}
          <Link
            to={`/events/${eventId}/edit`}
            className="text-blue-700 underline hover:text-blue-500 dark:text-blue-400"
          >
            edit the event
          </Link>
          .
        </p>
      </section>
    );
  }

  const url = link?.guest_token ? buildGuestCheckInUrl(link.guest_token) : '';
  const isOpen = Boolean(link?.is_open);
  // Before the window rather than after it (or locked by a finalized roster):
  // only then is "it will appear" true.
  const notYetOpen = Boolean(link?.check_in_opens_at && new Date(link.check_in_opens_at) > new Date());

  const handleCopy = async () => {
    if (!url) return;
    try {
      await copyToClipboard(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Could not copy — select and copy the link manually.');
    }
  };

  const handleRotate = async () => {
    const confirmed = await confirm({
      title: 'Reset the guest QR code?',
      message:
        'The current code stops working at once, including every copy already printed or shared. Print or share the new code afterwards.',
      confirmLabel: 'Reset code',
      cancelLabel: 'Keep current code',
      variant: 'warning',
    });
    if (!confirmed) return;
    setRotating(true);
    try {
      const rotated = await eventService.rotateGuestCheckInLink(eventId);
      setLink(rotated);
      toast.success('Guest QR code reset. The old code no longer works.');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'The guest QR code could not be reset.'));
    } finally {
      setRotating(false);
    }
  };

  const fullPageLink = showFullPageLink ? (
    <Link to={`/events/${eventId}/qr-code`} className="btn-secondary inline-flex items-center gap-2">
      Show full size
    </Link>
  ) : null;

  // Offered while the code is hidden too: revoking a code that leaked before
  // the event is exactly when a reset is wanted.
  const resetButton = (
    <button
      type="button"
      onClick={() => void handleRotate()}
      disabled={rotating}
      className="text-theme-text-muted hover:text-theme-text-primary touch:min-h-11 inline-flex items-center gap-1.5 text-sm disabled:opacity-50"
    >
      {rotating ? (
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
      ) : (
        <RefreshCw className="h-4 w-4" aria-hidden="true" />
      )}
      Reset code
    </button>
  );

  return (
    <section className="card p-6 text-center" aria-labelledby="guest-qr-heading" data-testid="guest-qr-card">
      <h2
        id="guest-qr-heading"
        className="text-theme-text-primary mb-2 flex items-center justify-center gap-2 text-xl font-semibold"
      >
        <UserPlus className="h-5 w-5 print:hidden" aria-hidden="true" />
        Guest Check-In
      </h2>
      <p className="text-theme-text-secondary mb-4">
        Not a member? Scan this code to sign in to {eventName}. No account needed.
      </p>

      {isDraft && (
        <div className="alert-warning mb-4 text-left print:hidden" role="status">
          <p className="text-theme-alert-warning-text text-sm">
            This event is not published yet. Guests can sign in with this code once it is.
          </p>
        </div>
      )}

      {loading ? (
        <div className="text-theme-text-muted flex items-center justify-center gap-2 py-8 text-sm" role="status">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading the guest QR code…
        </div>
      ) : failed ? (
        <div className="alert-danger text-left" role="alert">
          <p className="text-sm">{failed}</p>
        </div>
      ) : url && isOpen ? (
        <>
          <div className="mb-4 flex justify-center">
            <div className="qr-container">
              <QRCodeSVG value={url} size={240} level="H" marginSize={4} title={`Guest check-in for ${eventName}`} />
            </div>
          </div>

          <p className="text-theme-text-muted mb-4 text-sm">
            Guests can sign in only while check-in is open for this event.
          </p>

          <div className="mx-auto flex max-w-xl items-center gap-2 print:hidden">
            <input
              type="text"
              readOnly
              value={url}
              onFocus={(e) => e.currentTarget.select()}
              className="form-input flex-1 text-xs"
              aria-label="Guest check-in link"
            />
            <button
              type="button"
              onClick={() => void handleCopy()}
              className="btn-icon shrink-0"
              aria-label="Copy guest check-in link"
              title="Copy link"
            >
              {copied ? <Check className="h-4 w-4 text-green-700" /> : <Copy className="h-4 w-4" />}
            </button>
          </div>

          <div className="mt-4 flex flex-wrap items-center justify-center gap-3 print:hidden">
            {onPrint && (
              <button type="button" onClick={onPrint} className="btn-info inline-flex items-center gap-2 px-6">
                <Printer className="h-4 w-4" aria-hidden="true" />
                Print Guest QR Code
              </button>
            )}
            {fullPageLink}
            {resetButton}
          </div>
        </>
      ) : link ? (
        <>
          {/* The same placeholder the member code shows, and for the same
              reason: a greyed-out code is still a scannable one. */}
          <div className="mb-4 flex justify-center">
            <div
              className="border-theme-surface-border text-theme-text-muted flex h-[250px] w-[250px] flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-6 text-center"
              data-testid="guest-qr-placeholder"
            >
              <QrCode className="h-12 w-12" aria-hidden="true" />
              <span className="text-sm font-medium">
                {notYetOpen ? 'QR code hidden until check-in opens' : 'QR code hidden — check-in is closed'}
              </span>
            </div>
          </div>
          {link.closed_reason && <p className="text-theme-text-secondary mb-2 text-sm">{link.closed_reason}</p>}
          {link.check_in_opens_at && link.check_in_closes_at && (
            <p className="text-theme-text-muted mb-4 text-sm">
              Guests can sign in from {formatShortDateTime(link.check_in_opens_at, tz)} to{' '}
              {formatShortDateTime(link.check_in_closes_at, tz)}.
              {notYetOpen ? ' The code appears here when check-in opens.' : ''}
            </p>
          )}
          <div className="mt-4 flex flex-wrap items-center justify-center gap-3 print:hidden">
            {fullPageLink}
            {resetButton}
          </div>
        </>
      ) : null}
    </section>
  );
};

export default GuestCheckInQRCard;
