/**
 * Zeffy
 *
 * Where a department decides what each Zeffy campaign feeds — a fundraising
 * campaign, a fundraising event or a dues schedule — and sees every payment
 * Zeffy reported and what became of it. Zeffy itself is connected on the
 * Integrations page; nothing here writes to Zeffy.
 *
 * `fundraising.view` reads the links and the payments. `fundraising.manage`
 * lists Zeffy's campaigns (a live call to Zeffy), links them and runs a sync;
 * linking to member dues also needs `finance.manage`.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import toast from 'react-hot-toast';
import { ExternalLink, HandCoins, Link2, RefreshCw, Unlink } from 'lucide-react';
import { fundraisingService, zeffyService } from '../services/api';
import { ZeffyPaymentState } from '../types';
import type {
  FundraisingCampaign,
  FundraisingEvent,
  ZeffyCampaign,
  ZeffyDuesScheduleOption,
  ZeffyLink,
  ZeffyPayment,
  ZeffyStatus,
} from '../types';
import { ZeffyLinkDialog } from '../components/ZeffyLinkDialog';
import { ZEFFY_STATE_COLORS, ZEFFY_STATE_LABELS, ZEFFY_TARGET_LABELS } from '../utils/labels';
import { formatDate, formatDateTime } from '@/utils/dateFormatting';
import { formatCurrency } from '@/utils/currencyFormatting';
import { getErrorMessage } from '@/utils/errorHandling';
import { useTimezone } from '@/hooks/useTimezone';
import { useAuthStore } from '@/stores/authStore';
import { useConfirm } from '@/contexts/ConfirmContext';
import { EmptyState } from '@/components/ux/EmptyState';
import { Pagination } from '@/components/ux/Pagination';
import { SkeletonPage } from '@/components/ux/Skeleton';

const PAGE_SIZE = 50;
const LIST_LIMIT = 1000;

const STATE_FILTERS: { value: ZeffyPaymentState | ''; label: string }[] = [
  { value: '', label: 'All' },
  ...Object.values(ZeffyPaymentState).map((value) => ({ value, label: ZEFFY_STATE_LABELS[value] ?? value })),
];

const amountLabel = (payment: ZeffyPayment): string => {
  const refunded = Number(payment.refundedAmount);
  const gross = formatCurrency(Number(payment.amount));
  return refunded > 0 ? `${gross} (${formatCurrency(refunded)} refunded)` : gross;
};

const ZeffyPage: React.FC = () => {
  const tz = useTimezone();
  const { confirm } = useConfirm();
  const canManage = useAuthStore((s) => s.checkPermission('fundraising.manage'));
  const canLinkDues = useAuthStore((s) => s.checkPermission('finance.manage'));

  const [status, setStatus] = useState<ZeffyStatus | null>(null);
  const [zeffyCampaigns, setZeffyCampaigns] = useState<ZeffyCampaign[]>([]);
  const [links, setLinks] = useState<ZeffyLink[]>([]);
  const [payments, setPayments] = useState<ZeffyPayment[]>([]);
  const [totalPayments, setTotalPayments] = useState(0);
  const [page, setPage] = useState(1);
  const [stateFilter, setStateFilter] = useState<ZeffyPaymentState | ''>('');
  const [campaigns, setCampaigns] = useState<FundraisingCampaign[]>([]);
  const [events, setEvents] = useState<FundraisingEvent[]>([]);
  const [duesSchedules, setDuesSchedules] = useState<ZeffyDuesScheduleOption[]>([]);
  const [campaignError, setCampaignError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [editing, setEditing] = useState<ZeffyCampaign | null>(null);

  const loadPayments = useCallback(async () => {
    try {
      const result = await zeffyService.listPayments({
        state: stateFilter || undefined,
        limit: PAGE_SIZE,
        offset: (page - 1) * PAGE_SIZE,
      });
      setPayments(result.items);
      setTotalPayments(result.total);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Could not load Zeffy payments.'));
    }
  }, [stateFilter, page]);

  const loadOverview = useCallback(async () => {
    try {
      const [nextStatus, nextLinks] = await Promise.all([zeffyService.getStatus(), zeffyService.listLinks()]);
      setStatus(nextStatus);
      setLinks(nextLinks);
      setError(null);
      if (canManage && nextStatus.connected) {
        try {
          setZeffyCampaigns(await zeffyService.listCampaigns());
          setCampaignError(null);
        } catch (err: unknown) {
          setCampaignError(getErrorMessage(err, 'Could not read campaigns from Zeffy.'));
        }
      }
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Could not load the Zeffy connection.'));
    } finally {
      setIsLoading(false);
    }
  }, [canManage]);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  useEffect(() => {
    void loadPayments();
  }, [loadPayments]);

  useEffect(() => {
    if (!canManage) return;
    let cancelled = false;
    void Promise.all([
      fundraisingService.listCampaigns({ limit: LIST_LIMIT }).catch(() => []),
      fundraisingService.listFundraisingEvents({ limit: LIST_LIMIT }).catch(() => []),
      canLinkDues ? zeffyService.listDuesSchedules().catch(() => []) : Promise.resolve([]),
    ]).then(([nextCampaigns, nextEvents, nextSchedules]) => {
      if (cancelled) return;
      setCampaigns(nextCampaigns);
      setEvents(nextEvents);
      setDuesSchedules(nextSchedules);
    });
    return () => {
      cancelled = true;
    };
  }, [canManage, canLinkDues]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const result = await zeffyService.syncNow();
      if (result.rateLimited) {
        toast.success(`Read ${result.paymentsRead} payments; Zeffy's rate limit was reached and the rest will follow.`);
      } else {
        toast.success(`Read ${result.paymentsRead} payments from Zeffy`);
      }
      await Promise.all([loadOverview(), loadPayments()]);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'The sync did not complete.'));
    } finally {
      setSyncing(false);
    }
  };

  const handleUnlink = async (campaign: ZeffyCampaign) => {
    const ok = await confirm({
      title: 'Unlink campaign',
      message:
        'New payments to this Zeffy campaign will be recorded but not applied anywhere. Payments already applied stay where they are.',
      confirmLabel: 'Unlink',
      cancelLabel: 'Keep the link',
      variant: 'warning',
    });
    if (!ok) return;
    try {
      await zeffyService.deleteLink(campaign.id);
      toast.success('Campaign unlinked');
      await loadOverview();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not unlink the campaign.'));
    }
  };

  const header = (
    <div className="page-header gap-4 sm:items-center">
      <div className="page-header-title">
        <h1 className="text-theme-text-primary text-2xl font-bold">Zeffy</h1>
        <p className="text-theme-text-secondary mt-1 text-sm">
          Donations, tickets and memberships sold through Zeffy, and where each was recorded
        </p>
      </div>
      {canManage && status?.connected && (
        <button
          type="button"
          onClick={() => void handleSync()}
          disabled={syncing}
          className="btn-secondary inline-flex items-center gap-2"
        >
          <RefreshCw className={`h-4 w-4 ${syncing ? 'animate-spin' : ''}`} />
          {syncing ? 'Syncing…' : 'Sync now'}
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

  const needsAttention =
    (status?.stateCounts[ZeffyPaymentState.NEEDS_REVIEW] ?? 0) +
    (status?.stateCounts[ZeffyPaymentState.UNMATCHED] ?? 0);

  return (
    <div className="space-y-6">
      {header}

      {error && (
        <p role="alert" className="alert-danger rounded-lg p-4 text-sm">
          {error}
        </p>
      )}

      {status && !status.connected && (
        <div className="alert-info rounded-lg p-4 text-sm">
          Zeffy is not connected.{' '}
          {canManage ? (
            <>
              An administrator connects it on the{' '}
              <Link to="/integrations" className="font-medium underline">
                Integrations page
              </Link>
              , then campaigns can be linked here.
            </>
          ) : (
            'Ask a fundraising manager to connect it.'
          )}
        </div>
      )}

      {status?.connected && (
        <section className="card p-4" aria-labelledby="zeffy-connection">
          <h2 id="zeffy-connection" className="text-theme-text-primary font-semibold">
            Connection
          </h2>
          <dl className="mt-2 grid grid-cols-1 gap-2 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-theme-text-secondary text-xs">Instant updates</dt>
              <dd className="text-theme-text-primary">
                {status.webhookConfigured ? 'On — payments arrive within seconds' : 'Off — payments arrive hourly'}
              </dd>
            </div>
            <div>
              <dt className="text-theme-text-secondary text-xs">Last sync</dt>
              <dd className="text-theme-text-primary">
                {status.lastSyncAt ? formatDateTime(status.lastSyncAt, tz) : 'Not yet'}
              </dd>
            </div>
            <div>
              <dt className="text-theme-text-secondary text-xs">Needs attention</dt>
              <dd className="text-theme-text-primary">
                {needsAttention === 0 ? 'Nothing' : `${needsAttention} payment${needsAttention === 1 ? '' : 's'}`}
              </dd>
            </div>
          </dl>
        </section>
      )}

      {status?.connected && canManage && (
        <section className="space-y-3" aria-labelledby="zeffy-campaigns">
          <h2 id="zeffy-campaigns" className="text-theme-text-primary text-lg font-semibold">
            Campaigns
          </h2>
          {campaignError && (
            <p role="alert" className="alert-danger rounded-lg p-3 text-sm">
              {campaignError}
            </p>
          )}
          {zeffyCampaigns.length === 0 && !campaignError ? (
            <EmptyState
              icon={HandCoins}
              title="No Zeffy campaigns"
              description="Campaigns created in Zeffy appear here to be linked."
            />
          ) : (
            <ul className="card-grid">
              {zeffyCampaigns.map((campaign) => (
                <li key={campaign.id} className="card flex flex-col gap-3 p-4">
                  <div className="min-w-0">
                    <h3 className="text-theme-text-primary font-semibold">{campaign.title || campaign.id}</h3>
                    <p className="text-theme-text-secondary text-sm">
                      {[campaign.category, campaign.isArchived ? 'archived' : null].filter(Boolean).join(' · ')} ·
                      Raised {formatCurrency(Number(campaign.raised))}
                    </p>
                  </div>
                  {campaign.link ? (
                    <p className="text-theme-text-secondary text-sm">
                      {ZEFFY_TARGET_LABELS[campaign.link.targetType]}:{' '}
                      <span className="text-theme-text-primary font-medium">
                        {campaign.link.targetName ?? 'deleted record'}
                      </span>
                      <br />
                      From {formatDate(campaign.link.applyFrom, tz)}
                    </p>
                  ) : (
                    <p className="text-theme-text-secondary text-sm">Not linked — payments are recorded only.</p>
                  )}
                  <div className="mt-auto flex flex-wrap justify-end gap-2">
                    {campaign.url && (
                      <a
                        href={campaign.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="btn-secondary inline-flex items-center gap-2"
                      >
                        <ExternalLink className="h-4 w-4" />
                        Open in Zeffy
                      </a>
                    )}
                    {campaign.link && (
                      <button
                        type="button"
                        onClick={() => void handleUnlink(campaign)}
                        className="btn-secondary inline-flex items-center gap-2"
                        aria-label={`Unlink ${campaign.title || campaign.id}`}
                      >
                        <Unlink className="h-4 w-4" />
                        Unlink
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => setEditing(campaign)}
                      className="btn-primary inline-flex items-center gap-2"
                      aria-label={`${campaign.link ? 'Change link for' : 'Link'} ${campaign.title || campaign.id}`}
                    >
                      <Link2 className="h-4 w-4" />
                      {campaign.link ? 'Change' : 'Link'}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {!canManage && links.length > 0 && (
        <section className="space-y-3" aria-labelledby="zeffy-links">
          <h2 id="zeffy-links" className="text-theme-text-primary text-lg font-semibold">
            Linked campaigns
          </h2>
          <ul className="card-grid">
            {links.map((link) => (
              <li key={link.id} className="card p-4 text-sm">
                <p className="text-theme-text-primary font-semibold">
                  {link.zeffyCampaignTitle || link.zeffyCampaignId}
                </p>
                <p className="text-theme-text-secondary">
                  {ZEFFY_TARGET_LABELS[link.targetType]}: {link.targetName ?? 'deleted record'} · from{' '}
                  {formatDate(link.applyFrom, tz)}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-3" aria-labelledby="zeffy-payments">
        <h2 id="zeffy-payments" className="text-theme-text-primary text-lg font-semibold">
          Payments
        </h2>
        <div className="segmented-group hscroll flex gap-1" role="group" aria-label="Filter by status">
          {STATE_FILTERS.map((filter) => (
            <button
              key={filter.value}
              type="button"
              onClick={() => {
                setStateFilter(filter.value);
                setPage(1);
              }}
              aria-pressed={stateFilter === filter.value}
              className={`touch-target-phone shrink-0 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                stateFilter === filter.value
                  ? 'bg-red-800 text-white'
                  : 'text-theme-text-secondary hover:text-theme-text-primary hover:bg-theme-surface-hover'
              }`}
            >
              {filter.label}
            </button>
          ))}
        </div>

        {payments.length === 0 ? (
          <EmptyState
            icon={HandCoins}
            title="No Zeffy payments"
            description={stateFilter ? 'No payments have this status.' : 'Payments appear here as Zeffy reports them.'}
          />
        ) : (
          <div className="card overflow-hidden">
            <table className="rwd-table w-full text-sm">
              <thead>
                <tr className="text-theme-text-secondary text-left text-xs">
                  <th className="px-4 py-2">Date</th>
                  <th className="px-4 py-2">Payer</th>
                  <th className="px-4 py-2">Zeffy campaign</th>
                  <th className="px-4 py-2">Amount</th>
                  <th className="px-4 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((payment) => (
                  <tr key={payment.id} className="border-theme-surface-border border-t">
                    <td data-label="Date" className="px-4 py-2">
                      {payment.paidAt ? formatDateTime(payment.paidAt, tz) : '—'}
                    </td>
                    <td data-label="Payer" className="px-4 py-2">
                      {payment.payerName ?? '—'}
                    </td>
                    <td data-label="Zeffy campaign" className="px-4 py-2">
                      {payment.campaignTitle ?? payment.zeffyCampaignId ?? '—'}
                      {payment.ticketCount > 0 && (
                        <span className="text-theme-text-secondary">
                          {' '}
                          · {payment.ticketCount} ticket{payment.ticketCount === 1 ? '' : 's'}
                        </span>
                      )}
                    </td>
                    <td data-label="Amount" className="px-4 py-2">
                      {amountLabel(payment)}
                    </td>
                    <td data-label="Status" className="px-4 py-2">
                      <span className={`badge ${ZEFFY_STATE_COLORS[payment.state] ?? ''}`}>
                        {ZEFFY_STATE_LABELS[payment.state] ?? payment.state}
                      </span>
                      {payment.appliedTargetType && payment.state === ZeffyPaymentState.APPLIED && (
                        <span className="text-theme-text-secondary block text-xs">
                          {ZEFFY_TARGET_LABELS[payment.appliedTargetType]}
                        </span>
                      )}
                      {payment.stateDetail && (
                        <span className="text-theme-text-secondary block text-xs">{payment.stateDetail}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {totalPayments > PAGE_SIZE && (
          <Pagination currentPage={page} totalItems={totalPayments} pageSize={PAGE_SIZE} onPageChange={setPage} />
        )}
      </section>

      {editing && (
        <ZeffyLinkDialog
          campaign={editing}
          campaigns={campaigns}
          events={events}
          duesSchedules={duesSchedules}
          canLinkDues={canLinkDues}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void loadOverview();
            void loadPayments();
          }}
        />
      )}
    </div>
  );
};

export default ZeffyPage;
