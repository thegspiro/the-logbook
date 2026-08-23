/**
 * Order Window Card
 *
 * One card answering "is the store open, and how long have I got" — replacing
 * the green "Ordering is open" banner and the separate window card, which said
 * the same thing twice and still left the deadline as a date the member had to
 * subtract today from.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Check } from 'lucide-react';
import { useTimezone } from '../../../hooks/useTimezone';
import { formatDateTime } from '../../../utils/dateFormatting';
import { formatCountdown, formatCountdownShort, formatDateOnly, windowElapsedFraction } from '../utils/formatting';
import type { Storefront } from '../types';

/** Nothing in this card changes faster than a minute. */
const TICK_MS = 60_000;

interface StoreWindowCardProps {
  storefront: Storefront;
  onSelectWindow: (windowId: string) => void;
}

export const StoreWindowCard: React.FC<StoreWindowCardProps> = ({ storefront, onSelectWindow }) => {
  const tz = useTimezone();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), TICK_MS);
    return () => clearInterval(id);
  }, []);

  const openWindow = storefront.window;
  const closesAt = openWindow?.closesAt ?? null;
  const msRemaining = closesAt ? new Date(closesAt).getTime() - now : Number.NaN;

  const countdown = formatCountdown(msRemaining);
  const countdownShort = formatCountdownShort(msRemaining);
  const elapsed = windowElapsedFraction(openWindow?.opensAt, closesAt, now);

  /* A countdown that speaks every minute is unusable with a screen reader on.
     The hour bucket is what a member can act on, so only that is announced. */
  const hoursLeft = Number.isFinite(msRemaining) ? Math.ceil(msRemaining / 3_600_000) : null;
  const announcement = useMemo(() => {
    if (hoursLeft == null || hoursLeft <= 0) return '';
    if (hoursLeft > 48) return `Ordering closes in ${Math.ceil(hoursLeft / 24)} days`;
    return `Ordering closes in about ${hoursLeft} ${hoursLeft === 1 ? 'hour' : 'hours'}`;
  }, [hoursLeft]);

  if (!openWindow) return null;

  const isOpen = storefront.showOpenOrderBanner;
  const deliveryDate = formatDateOnly(openWindow.expectedDeliveryDate);
  const subtitleParts = [
    deliveryDate ? `Delivery expected ${deliveryDate}` : null,
    storefront.pickupLocation ? `pickup at ${storefront.pickupLocation}` : null,
  ].filter(Boolean);

  return (
    <div className="card mb-5 p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-4 sm:gap-6">
        <div className="flex min-w-0 flex-1 items-center gap-3">
          {isOpen && (
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-white sm:h-9 sm:w-9">
              <Check className="h-4 w-4 sm:h-[18px] sm:w-[18px]" aria-hidden="true" />
            </span>
          )}
          <div className="min-w-0">
            {storefront.otherOpenWindows.length > 0 ? (
              <>
                <label htmlFor="active-window" className="sr-only">
                  Choose an order window
                </label>
                <select
                  id="active-window"
                  value={openWindow.id}
                  onChange={(e) => onSelectWindow(e.target.value)}
                  className="form-input-sm font-semibold"
                >
                  {[openWindow, ...storefront.otherOpenWindows].map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.name}
                    </option>
                  ))}
                </select>
              </>
            ) : (
              <p className="text-theme-text-primary text-base font-bold">
                {openWindow.name}
                {isOpen ? ' is open' : ''}
              </p>
            )}
            {subtitleParts.length > 0 && (
              <p className="text-theme-text-secondary mt-0.5 text-sm">{subtitleParts.join(' · ')}</p>
            )}
          </div>
          {countdownShort && (
            <span className="shrink-0 rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 font-mono text-xs font-bold text-amber-900 sm:hidden dark:border-amber-500/40 dark:bg-amber-500/15 dark:text-amber-200">
              {countdownShort}
            </span>
          )}
        </div>

        {closesAt && (
          <div className="hidden items-start gap-5 sm:flex">
            {countdown && (
              <div>
                <p className="text-theme-text-secondary text-[10px] font-bold tracking-[.1em] uppercase">Closes in</p>
                <p className="mt-0.5 font-mono text-xl font-bold text-amber-900 dark:text-amber-200">{countdown}</p>
              </div>
            )}
            <div className={countdown ? 'border-theme-surface-border border-l pl-5' : undefined}>
              <p className="text-theme-text-secondary text-[10px] font-bold tracking-[.1em] uppercase">
                Last day to order
              </p>
              <p className="text-theme-text-primary mt-0.5 text-sm">{formatDateTime(closesAt, tz)}</p>
            </div>
          </div>
        )}
      </div>

      {elapsed != null && (
        <div className="bg-theme-surface-hover mt-3 h-1.5 overflow-hidden rounded-full sm:mt-4">
          <div
            className="h-full bg-gradient-to-r from-red-600 to-amber-500"
            style={{ width: `${Math.round(elapsed * 100)}%` }}
          />
        </div>
      )}

      {openWindow.description && (
        <p className="text-theme-text-secondary mt-3 text-sm whitespace-pre-line">{openWindow.description}</p>
      )}

      <p className="sr-only" role="status" aria-live="polite">
        {announcement}
      </p>
    </div>
  );
};

export default StoreWindowCard;
