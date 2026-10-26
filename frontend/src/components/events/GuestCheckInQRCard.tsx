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
 */

import React, { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { QRCodeSVG } from 'qrcode.react';
import { Check, Copy, Loader2, Printer, RefreshCw, UserPlus } from 'lucide-react';
import toast from 'react-hot-toast';
import { eventService } from '../../services/api';
import { useAuthStore } from '../../stores/authStore';
import { useConfirm } from '../../contexts/ConfirmContext';
import { getErrorMessage } from '../../utils/errorHandling';
import { copyToClipboard } from '../../utils/clipboard';
import { buildGuestCheckInUrl } from '../../constants/nfc';

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
}

export const GuestCheckInQRCard: React.FC<GuestCheckInQRCardProps> = ({
  eventId,
  eventName,
  allowGuestCheckIn,
  isDraft = false,
  showOffHint = false,
  showFullPageLink = false,
  onPrint,
}) => {
  const canManage = useAuthStore((s) => s.checkPermission)('events.manage');
  const { confirm } = useConfirm();
  const [token, setToken] = useState<string | null>(null);
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
      if (current.guest_token) return current.guest_token;
      const issued = await eventService.issueGuestCheckInLink(eventId);
      return issued.guest_token;
    };
    load()
      .then((value) => {
        if (!cancelled) setToken(value);
      })
      .catch((err: unknown) => {
        if (!cancelled) setFailed(getErrorMessage(err, 'The guest QR code could not be loaded.'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
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

  const url = token ? buildGuestCheckInUrl(token) : '';

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
      setToken(rotated.guest_token);
      toast.success('Guest QR code reset. The old code no longer works.');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'The guest QR code could not be reset.'));
    } finally {
      setRotating(false);
    }
  };

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
      ) : url ? (
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
            {showFullPageLink && (
              <Link to={`/events/${eventId}/qr-code`} className="btn-secondary inline-flex items-center gap-2">
                Show full size
              </Link>
            )}
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
          </div>
        </>
      ) : null}
    </section>
  );
};

export default GuestCheckInQRCard;
