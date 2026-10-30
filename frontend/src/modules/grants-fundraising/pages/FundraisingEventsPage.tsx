/**
 * Fundraising Events
 *
 * Dinners, raffles, golf outings and the like, newest first.
 * `fundraising.view` reads the list; `fundraising.manage` adds events and
 * records their results. Net is the one figure computed here — money raised
 * less expenses, both as the officer entered them.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarHeart, MapPin, Pencil, Plus } from 'lucide-react';
import { fundraisingService } from '../services/api';
import { FundraisingEventStatus } from '../types';
import type { FundraisingCampaign, FundraisingEvent } from '../types';
import { formatDateTime } from '@/utils/dateFormatting';
import { formatCurrency } from '@/utils/currencyFormatting';
import { getErrorMessage } from '@/utils/errorHandling';
import { useTimezone } from '@/hooks/useTimezone';
import { useAuthStore } from '@/stores/authStore';
import { EmptyState } from '@/components/ux/EmptyState';
import { SkeletonPage } from '@/components/ux/Skeleton';
import { FundraisingEventDialog } from '../components/FundraisingEventDialog';
import {
  FUNDRAISING_EVENT_STATUS_COLORS,
  FUNDRAISING_EVENT_STATUS_LABELS,
  FUNDRAISING_EVENT_TYPE_LABELS,
} from '../utils/labels';

const LIST_LIMIT = 1000;

const STATUS_TABS: { value: string; label: string }[] = [
  { value: '', label: 'All' },
  ...Object.values(FundraisingEventStatus).map((value) => ({
    value,
    label: FUNDRAISING_EVENT_STATUS_LABELS[value],
  })),
];

type DialogState = { event?: FundraisingEvent | undefined } | null;

const FundraisingEventsPage: React.FC = () => {
  const tz = useTimezone();
  const canManage = useAuthStore((s) => s.checkPermission('fundraising.manage'));
  const [events, setEvents] = useState<FundraisingEvent[]>([]);
  const [campaigns, setCampaigns] = useState<FundraisingCampaign[]>([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);

  const loadEvents = useCallback(async () => {
    try {
      const rows = await fundraisingService.listFundraisingEvents({
        ...(statusFilter ? { status: statusFilter } : {}),
        limit: LIST_LIMIT,
      });
      setEvents(rows);
      setError(null);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Could not load fundraising events.'));
    } finally {
      setIsLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  useEffect(() => {
    let cancelled = false;
    fundraisingService
      .listCampaigns({ limit: LIST_LIMIT })
      .then((rows) => {
        if (!cancelled) setCampaigns(rows);
      })
      .catch(() => {
        // The campaign names are a label only; the list still renders without them.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const campaignNames = useMemo(() => new Map(campaigns.map((c) => [c.id, c.name])), [campaigns]);

  const header = (
    <div className="page-header gap-4 sm:items-center">
      <div className="page-header-title">
        <h1 className="text-theme-text-primary text-2xl font-bold">Fundraising Events</h1>
        <p className="text-theme-text-secondary mt-1 text-sm">
          Dinners, raffles and other events, and what each raised
        </p>
      </div>
      {canManage && (
        <button type="button" onClick={() => setDialog({})} className="btn-primary inline-flex items-center gap-2">
          <Plus className="h-4 w-4" />
          Add Event
        </button>
      )}
    </div>
  );

  if (isLoading) {
    return (
      <div className="space-y-6">
        {header}
        <SkeletonPage rows={4} showStats={false} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {header}

      {error && (
        <p role="alert" className="alert-danger rounded-lg p-4 text-sm">
          {error}
        </p>
      )}

      <div className="segmented-group flex flex-wrap gap-1" role="group" aria-label="Filter by status">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab.value}
            type="button"
            onClick={() => setStatusFilter(tab.value)}
            aria-pressed={statusFilter === tab.value}
            className={`touch-target-phone rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              statusFilter === tab.value
                ? 'bg-red-800 text-white'
                : 'text-theme-text-secondary hover:text-theme-text-primary hover:bg-theme-surface-hover'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {events.length === 0 ? (
        <EmptyState
          icon={CalendarHeart}
          title="No fundraising events found"
          description={
            statusFilter
              ? 'No events have this status.'
              : canManage
                ? 'Add an event to plan it, then record what it raised afterwards.'
                : 'No fundraising events have been added.'
          }
        />
      ) : (
        <ul className="card-grid">
          {events.map((ev) => {
            const raised = Number(ev.actualRevenue);
            const spent = Number(ev.expenses);
            return (
              <li key={ev.id} className="card flex flex-col gap-3 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-theme-text-primary font-semibold">{ev.name}</h2>
                    <p className="text-theme-text-secondary text-sm">
                      {FUNDRAISING_EVENT_TYPE_LABELS[ev.eventType] ?? ev.eventType} · {formatDateTime(ev.eventDate, tz)}
                    </p>
                  </div>
                  <span className={`badge shrink-0 ${FUNDRAISING_EVENT_STATUS_COLORS[ev.status] ?? ''}`}>
                    {FUNDRAISING_EVENT_STATUS_LABELS[ev.status] ?? ev.status}
                  </span>
                </div>
                {ev.location && (
                  <p className="text-theme-text-secondary flex items-center gap-1 text-sm">
                    <MapPin className="h-4 w-4 shrink-0" />
                    {ev.location}
                  </p>
                )}
                {ev.campaignId && campaignNames.get(ev.campaignId) && (
                  <p className="text-theme-text-secondary text-sm">Campaign: {campaignNames.get(ev.campaignId)}</p>
                )}
                <dl className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <dt className="text-theme-text-secondary text-xs">Goal</dt>
                    <dd className="text-theme-text-primary">
                      {ev.revenueGoal !== null && ev.revenueGoal !== undefined ? formatCurrency(ev.revenueGoal) : '—'}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-theme-text-secondary text-xs">Raised</dt>
                    <dd className="text-theme-text-primary">{formatCurrency(raised)}</dd>
                  </div>
                  <div>
                    <dt className="text-theme-text-secondary text-xs">Expenses</dt>
                    <dd className="text-theme-text-primary">{formatCurrency(spent)}</dd>
                  </div>
                  <div>
                    <dt className="text-theme-text-secondary text-xs">Net</dt>
                    <dd className="text-theme-text-primary font-semibold">{formatCurrency(raised - spent)}</dd>
                  </div>
                  <div className="col-span-2">
                    <dt className="text-theme-text-secondary text-xs">Attendance</dt>
                    <dd className="text-theme-text-primary">
                      {ev.currentAttendees}
                      {ev.maxAttendees ? ` of ${String(ev.maxAttendees)}` : ''}
                    </dd>
                  </div>
                </dl>
                {canManage && (
                  <div className="mt-auto flex justify-end">
                    <button
                      type="button"
                      onClick={() => setDialog({ event: ev })}
                      className="btn-secondary inline-flex items-center gap-2"
                      aria-label={`Edit ${ev.name}`}
                    >
                      <Pencil className="h-4 w-4" />
                      Edit
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {dialog && (
        <FundraisingEventDialog
          event={dialog.event}
          campaigns={campaigns}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null);
            void loadEvents();
          }}
        />
      )}
    </div>
  );
};

export default FundraisingEventsPage;
