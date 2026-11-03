/**
 * Pledges
 *
 * Promised gifts not yet (fully) received. `fundraising.view` reads the list;
 * `fundraising.manage` records and edits pledges. The dashboard's
 * Outstanding Pledges figure links here.
 *
 * Status and the fulfilled amount are what the officer recorded; the page
 * shows them as stored and computes nothing but each row's remaining balance.
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { HandCoins, Pencil, Plus } from 'lucide-react';
import { fundraisingService } from '../services/api';
import { PledgeStatus } from '../types';
import type { Donor, FundraisingCampaign, Pledge } from '../types';
import { formatCalendarDate } from '@/utils/dateFormatting';
import { formatCurrency } from '@/utils/currencyFormatting';
import { getErrorMessage } from '@/utils/errorHandling';
import { useAuthStore } from '@/stores/authStore';
import { EmptyState } from '@/components/ux/EmptyState';
import { SkeletonPage } from '@/components/ux/Skeleton';
import { PledgeDialog } from '../components/PledgeDialog';
import { PLEDGE_STATUS_COLORS, PLEDGE_STATUS_LABELS, donorDisplayName } from '../utils/labels';

/** The API's page ceiling; used for the pickers and this list alike. */
const LIST_LIMIT = 1000;

const STATUS_TABS: { value: string; label: string }[] = [
  { value: '', label: 'All' },
  ...Object.values(PledgeStatus).map((value) => ({ value, label: PLEDGE_STATUS_LABELS[value] })),
];

const HEADER_CELL = 'text-theme-text-secondary px-4 py-3 text-left text-xs font-medium tracking-wider uppercase';
const CELL = 'text-theme-text-primary px-4 py-3 text-sm';

type DialogState = { pledge?: Pledge | undefined } | null;

const PledgesPage: React.FC = () => {
  const canManage = useAuthStore((s) => s.checkPermission('fundraising.manage'));
  const [pledges, setPledges] = useState<Pledge[]>([]);
  const [donors, setDonors] = useState<Donor[]>([]);
  const [campaigns, setCampaigns] = useState<FundraisingCampaign[]>([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<DialogState>(null);

  const loadPledges = useCallback(async () => {
    try {
      const rows = await fundraisingService.listPledges({
        ...(statusFilter ? { status: statusFilter } : {}),
        limit: LIST_LIMIT,
      });
      setPledges(rows);
      setError(null);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Could not load pledges.'));
    } finally {
      setIsLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    void loadPledges();
  }, [loadPledges]);

  useEffect(() => {
    let cancelled = false;
    void Promise.allSettled([
      fundraisingService.listDonors({ limit: LIST_LIMIT }),
      fundraisingService.listCampaigns({ limit: LIST_LIMIT }),
    ]).then(([donorResult, campaignResult]) => {
      if (cancelled) return;
      if (donorResult.status === 'fulfilled') setDonors(donorResult.value);
      if (campaignResult.status === 'fulfilled') setCampaigns(campaignResult.value);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const donorNames = useMemo(() => new Map(donors.map((d) => [d.id, donorDisplayName(d)])), [donors]);
  const campaignNames = useMemo(() => new Map(campaigns.map((c) => [c.id, c.name])), [campaigns]);

  const header = (
    <div className="page-header gap-4 sm:items-center">
      <div className="page-header-title">
        <h1 className="text-theme-text-primary text-2xl font-bold">Pledges</h1>
        <p className="text-theme-text-secondary mt-1 text-sm">Gifts promised and what has come in against them</p>
      </div>
      {canManage && (
        <button type="button" onClick={() => setDialog({})} className="btn-primary inline-flex items-center gap-2">
          <Plus className="h-4 w-4" />
          Record Pledge
        </button>
      )}
    </div>
  );

  if (isLoading) {
    return (
      <div className="space-y-6">
        {header}
        <SkeletonPage rows={5} showStats={false} />
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

      {pledges.length === 0 ? (
        <EmptyState
          icon={HandCoins}
          title="No pledges found"
          description={
            statusFilter
              ? 'No pledges have this status.'
              : canManage
                ? 'Record a pledge when a donor promises a gift.'
                : 'No pledges have been recorded.'
          }
        />
      ) : (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="rwd-table w-full">
              <thead>
                <tr className="border-theme-surface-border border-b">
                  <th scope="col" className={HEADER_CELL}>
                    Donor
                  </th>
                  <th scope="col" className={HEADER_CELL}>
                    Campaign
                  </th>
                  <th scope="col" className={HEADER_CELL}>
                    Pledged
                  </th>
                  <th scope="col" className={HEADER_CELL}>
                    Received
                  </th>
                  <th scope="col" className={HEADER_CELL}>
                    Remaining
                  </th>
                  <th scope="col" className={HEADER_CELL}>
                    Due
                  </th>
                  <th scope="col" className={HEADER_CELL}>
                    Status
                  </th>
                  {canManage && (
                    <th scope="col" className={HEADER_CELL}>
                      <span className="sr-only">Actions</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {pledges.map((pledge) => {
                  const donor = (pledge.donorId && donorNames.get(pledge.donorId)) || 'No donor on file';
                  const remaining = Math.max(Number(pledge.pledgedAmount) - Number(pledge.fulfilledAmount), 0);
                  return (
                    <tr key={pledge.id} className="border-theme-surface-border border-b last:border-b-0">
                      <td data-label="Donor" className={`rwd-table-lead ${CELL} font-medium`}>
                        {donor}
                        <span className="text-theme-text-secondary block text-xs font-normal">
                          Pledged {formatCalendarDate(pledge.pledgeDate)}
                        </span>
                      </td>
                      <td data-label="Campaign" className={CELL}>
                        {(pledge.campaignId && campaignNames.get(pledge.campaignId)) || (
                          <span className="text-theme-text-secondary">None</span>
                        )}
                      </td>
                      <td data-label="Pledged" className={CELL}>
                        {formatCurrency(pledge.pledgedAmount)}
                      </td>
                      <td data-label="Received" className={CELL}>
                        {formatCurrency(pledge.fulfilledAmount)}
                      </td>
                      <td data-label="Remaining" className={`${CELL} font-semibold`}>
                        {formatCurrency(remaining)}
                      </td>
                      <td data-label="Due" className={CELL}>
                        {pledge.dueDate ? (
                          formatCalendarDate(pledge.dueDate)
                        ) : (
                          <span className="text-theme-text-secondary">No date</span>
                        )}
                      </td>
                      <td data-label="Status" className={CELL}>
                        <span className={`badge ${PLEDGE_STATUS_COLORS[pledge.status] ?? ''}`}>
                          {PLEDGE_STATUS_LABELS[pledge.status] ?? pledge.status}
                        </span>
                      </td>
                      {canManage && (
                        <td data-label="Actions" className={`${CELL} text-right`}>
                          <button
                            type="button"
                            onClick={() => setDialog({ pledge })}
                            className="btn-icon"
                            aria-label={`Edit the pledge from ${donor}`}
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {dialog && (
        <PledgeDialog
          pledge={dialog.pledge}
          donors={donors}
          campaigns={campaigns}
          onClose={() => setDialog(null)}
          onSaved={() => {
            setDialog(null);
            void loadPledges();
          }}
        />
      )}
    </div>
  );
};

export default PledgesPage;
