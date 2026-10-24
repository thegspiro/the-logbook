/**
 * The member ID card taps that checked people in or out of one event, refused
 * taps included — from the staffed check-in station and from the room kiosk.
 *
 * For event managers (`events.manage`), who already see the event's roster by
 * name, so taps are named too. Renders nothing while the department has NFC ID
 * Cards turned off and the event has no taps, so a department that never used
 * cards is not shown an empty card section on every event.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Nfc } from 'lucide-react';
import { nfcActivityService } from '../../services/nfcActivityService';
import { formatNumber } from '../../utils/dateFormatting';
import { getErrorMessage } from '../../utils/errorHandling';
import { CardTapTable } from '../../modules/membership/components/CardTapTable';
import type { NfcCardTap } from '../../modules/membership/types/idCard';

const PAGE = 25;

interface EventCardTapsCardProps {
  eventId: string;
  tz: string;
  cardsEnabled: boolean;
}

export const EventCardTapsCard: React.FC<EventCardTapsCardProps> = ({ eventId, tz, cardsEnabled }) => {
  const [taps, setTaps] = useState<NfcCardTap[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (offset: number) => {
      setLoading(true);
      setError(null);
      try {
        const page = await nfcActivityService.listEventTaps(eventId, {}, PAGE, offset);
        setTaps((prev) => (offset === 0 ? page.items : [...prev, ...page.items]));
        setTotal(page.total);
      } catch (err: unknown) {
        setError(getErrorMessage(err, 'Unable to load card taps'));
      } finally {
        setLoading(false);
      }
    },
    [eventId]
  );

  useEffect(() => {
    void load(0);
  }, [load]);

  if (!loading && !error && total === 0 && !cardsEnabled) return null;

  return (
    <section className="card p-4" aria-labelledby="event-card-taps-heading">
      <h2
        id="event-card-taps-heading"
        className="text-theme-text-primary flex items-center gap-2 text-lg font-semibold"
      >
        <Nfc className="h-5 w-5" aria-hidden="true" />
        Card taps
        {total > 0 && <span className="text-theme-text-secondary text-sm font-normal">{formatNumber(total)}</span>}
      </h2>
      {error && <p className="text-theme-alert-danger-text mt-2 text-sm">{error}</p>}
      {!loading && !error && taps.length === 0 && (
        <p className="text-theme-text-secondary mt-2 text-sm">No ID card has been tapped for this event yet.</p>
      )}
      {taps.length > 0 && (
        <div className="mt-3 overflow-hidden">
          <CardTapTable taps={taps} tz={tz} columns={{ member: true, card: true, where: true, target: false }} />
        </div>
      )}
      {taps.length < total && (
        <button
          type="button"
          className="btn-secondary btn-auto mt-3"
          disabled={loading}
          onClick={() => void load(taps.length)}
        >
          {loading ? 'Loading…' : `Show more (${formatNumber(total - taps.length)} older)`}
        </button>
      )}
    </section>
  );
};
