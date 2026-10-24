/**
 * Events hub → Card Check-ins: every member ID card tap against an event,
 * across all events, from check-in stations and room kiosks alike.
 *
 * A kiosk tap the room turned away before choosing an event (none open, or
 * two running at once) belongs to no event, so it is on the Card Readers page
 * rather than here.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Nfc } from 'lucide-react';
import { EmptyState } from '../components/ux/EmptyState';
import { Pagination } from '../components/ux/Pagination';
import { useConnectedIntegrations } from '../hooks/useConnectedIntegrations';
import { useTimezone } from '../hooks/useTimezone';
import { nfcActivityService, type ScopedTapFilters } from '../services/nfcActivityService';
import { addCalendarDays, localToUTC } from '../utils/dateFormatting';
import { getErrorMessage } from '../utils/errorHandling';
import { NfcCheckInStatus, NfcTapSource } from '../constants/enums';
import { CardTapTable } from '../modules/membership/components/CardTapTable';
import {
  NFC_ID_CARDS_INTEGRATION,
  NFC_TAP_OUTCOME_LABELS,
  NFC_TAP_SOURCE_LABELS,
} from '../modules/membership/constants/idCards';
import type { NfcCardTap } from '../modules/membership/types/idCard';

const PAGE_SIZE = 50;

const EventCardCheckinsTab: React.FC = () => {
  const tz = useTimezone();
  const { isConnected, loading: integrationsLoading } = useConnectedIntegrations();
  const [outcome, setOutcome] = useState<NfcCheckInStatus | ''>('');
  const [source, setSource] = useState<NfcTapSource | ''>('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [page, setPage] = useState(1);
  const [taps, setTaps] = useState<NfcCardTap[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // A filter change loads the old page and then page 1; only the latest
  // request's answer may reach the table.
  const requestSeq = useRef(0);

  const filters = useCallback(
    (): ScopedTapFilters => ({
      outcome: outcome || undefined,
      source: source || undefined,
      since: fromDate ? localToUTC(`${fromDate}T00:00`, tz) || undefined : undefined,
      until: toDate ? localToUTC(`${addCalendarDays(toDate, 1)}T00:00`, tz) || undefined : undefined,
    }),
    [outcome, source, fromDate, toDate, tz]
  );

  useEffect(() => {
    setPage(1);
  }, [outcome, source, fromDate, toDate]);

  const load = useCallback(async () => {
    const seq = ++requestSeq.current;
    try {
      setLoading(true);
      setError(null);
      const data = await nfcActivityService.listEventTaps(undefined, filters(), PAGE_SIZE, (page - 1) * PAGE_SIZE);
      if (seq !== requestSeq.current) return;
      setTaps(data.items);
      setTotal(data.total);
    } catch (err: unknown) {
      if (seq !== requestSeq.current) return;
      setError(getErrorMessage(err, 'Unable to load card check-ins'));
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, [filters, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const cardsOff = !integrationsLoading && !isConnected(NFC_ID_CARDS_INTEGRATION);

  return (
    <div className="space-y-4 py-6">
      {cardsOff && (
        <div className="alert-info flex items-start gap-2">
          <Nfc className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p className="text-sm">
            NFC ID cards are turned off under Settings → Integrations, so no new taps are being recorded. Taps from when
            they were on are still listed.
          </p>
        </div>
      )}

      <div className="card grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label htmlFor="event-tap-outcome" className="form-label">
            Outcome
          </label>
          <select
            id="event-tap-outcome"
            className="form-input"
            value={outcome}
            onChange={(e) => setOutcome(e.target.value as NfcCheckInStatus | '')}
          >
            <option value="">All outcomes</option>
            {Object.values(NfcCheckInStatus).map((value) => (
              <option key={value} value={value}>
                {NFC_TAP_OUTCOME_LABELS[value]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="event-tap-source" className="form-label">
            Reader
          </label>
          <select
            id="event-tap-source"
            className="form-input"
            value={source}
            onChange={(e) => setSource(e.target.value as NfcTapSource | '')}
          >
            <option value="">All readers</option>
            {Object.values(NfcTapSource).map((value) => (
              <option key={value} value={value}>
                {NFC_TAP_SOURCE_LABELS[value]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="event-tap-from" className="form-label">
            From
          </label>
          <input
            id="event-tap-from"
            type="date"
            className="form-input"
            value={fromDate}
            max={toDate || undefined}
            onChange={(e) => setFromDate(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="event-tap-to" className="form-label">
            To
          </label>
          <input
            id="event-tap-to"
            type="date"
            className="form-input"
            value={toDate}
            min={fromDate || undefined}
            onChange={(e) => setToDate(e.target.value)}
          />
        </div>
      </div>

      {error && (
        <div className="alert-danger flex items-start gap-2">
          <AlertTriangle className="text-theme-alert-danger-icon mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p className="text-theme-alert-danger-text text-sm">{error}</p>
        </div>
      )}

      {!loading && !error && taps.length === 0 && (
        <div className="card p-4">
          <EmptyState
            headingLevel={3}
            icon={Nfc}
            title="No card check-ins match"
            description="Taps at check-in stations and room kiosks appear here once members check in to events with their ID card."
          />
        </div>
      )}

      {taps.length > 0 && (
        <div className="card overflow-hidden">
          <CardTapTable taps={taps} tz={tz} targetLabel="Event" />
        </div>
      )}

      {total > PAGE_SIZE && (
        <Pagination currentPage={page} totalItems={total} pageSize={PAGE_SIZE} onPageChange={setPage} />
      )}
    </div>
  );
};

export default EventCardCheckinsTab;
