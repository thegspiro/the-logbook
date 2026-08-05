/**
 * Store Payments Tab
 *
 * The review queue for payments a connected provider (PayPal) reported.
 * Anything the matcher could settle on its own is already gone from here by
 * the time this loads; what remains is the residue that needs a person —
 * a payment with no order number in the reference, a short payment, a payment
 * against an order that is already square.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Loader2, RefreshCw, Wallet, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { EmptyState } from '../../../components/ux/EmptyState';
import { useTimezone } from '../../../hooks/useTimezone';
import { formatCurrency, formatDateTime } from '../../../utils/dateFormatting';
import { getErrorMessage } from '../../../utils/errorHandling';
import { storefrontService } from '../services/api';
import { StorePaymentEventStatus, type StorePaymentEvent } from '../types';

interface StorePaymentsTabProps {
  onChanged: () => void;
}

const STATUS_LABELS: Record<string, string> = {
  applied: 'Applied',
  matched: 'Matched — not applied',
  unmatched: 'No order found',
  ambiguous: 'Needs a decision',
  ignored: 'Dismissed',
  duplicate: 'Duplicate',
};

const STATUS_STYLES: Record<string, string> = {
  applied: 'bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/30',
  matched: 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/30',
  unmatched: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30',
  ambiguous: 'bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-500/30',
  ignored: 'bg-theme-surface-secondary text-theme-text-muted border-theme-surface-border',
  duplicate: 'bg-theme-surface-secondary text-theme-text-muted border-theme-surface-border',
};

const isResolved = (event: StorePaymentEvent): boolean =>
  event.status === StorePaymentEventStatus.APPLIED ||
  event.status === StorePaymentEventStatus.IGNORED ||
  event.status === StorePaymentEventStatus.DUPLICATE;

export const StorePaymentsTab: React.FC<StorePaymentsTabProps> = ({ onChanged }) => {
  const tz = useTimezone();
  const [events, setEvents] = useState<StorePaymentEvent[]>([]);
  const [unresolvedCount, setUnresolvedCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [showResolved, setShowResolved] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [orderNumbers, setOrderNumbers] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await storefrontService.listPaymentEvents({
        unresolvedOnly: !showResolved,
      });
      setEvents(data.items);
      setUnresolvedCount(data.unresolvedCount);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to load payments'));
    } finally {
      setLoading(false);
    }
  }, [showResolved]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleApply = async (event: StorePaymentEvent) => {
    // A typed order number only matters when the matcher found nothing; when
    // it did, sending undefined keeps the order it already identified.
    const typed = orderNumbers[event.id]?.trim() || undefined;
    if (!event.matchedOrderId && !typed) {
      toast.error('Enter the order ID this payment belongs to');
      return;
    }
    setBusyId(event.id);
    try {
      await storefrontService.applyPaymentEvent(event.id, typed);
      toast.success('Payment applied');
      onChanged();
      await load();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to apply payment'));
    } finally {
      setBusyId(null);
    }
  };

  const handleIgnore = async (event: StorePaymentEvent) => {
    setBusyId(event.id);
    try {
      await storefrontService.ignorePaymentEvent(event.id);
      toast.success('Payment dismissed');
      await load();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to dismiss payment'));
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12" role="status" aria-live="polite">
        <Loader2 className="text-theme-text-muted h-6 w-6 animate-spin" />
        <span className="sr-only">Loading payments</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-theme-text-primary text-lg font-semibold">Inbound payments</h2>
          <p className="text-theme-text-muted text-sm">
            {unresolvedCount === 0
              ? 'Nothing is waiting on you.'
              : `${unresolvedCount} payment${unresolvedCount === 1 ? ' needs' : 's need'} review.`}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="text-theme-text-secondary flex items-center gap-2 text-sm">
            <input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} />
            Show resolved
          </label>
          <button type="button" className="btn-secondary btn-sm flex items-center gap-2" onClick={() => void load()}>
            <RefreshCw className="h-4 w-4" />
            Refresh
          </button>
        </div>
      </div>

      {events.length === 0 ? (
        <EmptyState
          icon={Wallet}
          title="No payments to review"
          description="Payments reported by a connected provider show up here. Connect PayPal under Settings → Integrations to start matching them to orders automatically."
        />
      ) : (
        <div className="space-y-3">
          {events.map((event) => (
            <div key={event.id} className="card space-y-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-theme-text-primary text-lg font-semibold">
                    {formatCurrency(Number(event.amount))}{' '}
                    <span className="text-theme-text-muted text-sm font-normal">{event.currency}</span>
                  </p>
                  <p className="text-theme-text-secondary text-sm">
                    {event.payerName || event.payerEmail || 'Unknown payer'} &middot; {event.provider}
                  </p>
                  <p className="text-theme-text-muted text-xs">{formatDateTime(event.receivedAt, tz)}</p>
                </div>
                <span className={`badge border ${STATUS_STYLES[event.status] ?? STATUS_STYLES['ignored']}`}>
                  {STATUS_LABELS[event.status] ?? event.status}
                </span>
              </div>

              {event.reference && (
                <p className="text-theme-text-secondary text-sm">
                  Reference: <span className="font-mono">{event.reference}</span>
                </p>
              )}
              {event.matchedOrderNumber && (
                <p className="text-theme-text-secondary text-sm">
                  Order {event.matchedOrderNumber}
                  {event.matchedOrderMember ? ` — ${event.matchedOrderMember}` : ''}
                  {event.matchedOrderBalance != null
                    ? ` (${formatCurrency(Number(event.matchedOrderBalance))} due)`
                    : ''}
                </p>
              )}
              {event.note && <p className="text-theme-text-muted text-sm">{event.note}</p>}

              {!isResolved(event) && (
                <div className="flex flex-wrap items-center gap-2">
                  {!event.matchedOrderId && (
                    <input
                      type="text"
                      className="form-input max-w-xs"
                      placeholder="Order ID to credit"
                      value={orderNumbers[event.id] ?? ''}
                      onChange={(e) => setOrderNumbers((prev) => ({ ...prev, [event.id]: e.target.value }))}
                      aria-label={`Order to credit for the ${event.amount} payment from ${
                        event.payerName || 'unknown payer'
                      }`}
                    />
                  )}
                  <button
                    type="button"
                    className="btn-primary btn-sm flex items-center gap-2"
                    disabled={busyId === event.id}
                    onClick={() => void handleApply(event)}
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    Apply to order
                  </button>
                  <button
                    type="button"
                    className="btn-secondary btn-sm flex items-center gap-2"
                    disabled={busyId === event.id}
                    onClick={() => void handleIgnore(event)}
                  >
                    <X className="h-4 w-4" />
                    Dismiss
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default StorePaymentsTab;
