import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { DollarSign, Search, Filter, Receipt, Heart, Plus } from 'lucide-react';
import { fundraisingService } from '../services/api';
import type { Donation, Donor } from '../types';
import { formatDate } from '../../../utils/dateFormatting';
import { formatCurrency } from '@/utils/currencyFormatting';
import { useTimezone } from '../../../hooks/useTimezone';
import { useAuthStore } from '../../../stores/authStore';
import { PAYMENT_METHOD_LABELS, PAYMENT_STATUS_LABELS, donorDisplayName } from '../utils/labels';
import { getErrorMessage } from '@/utils/errorHandling';

// The API's own ceiling; the page totals what it loaded, so it loads as much as
// it may (the same bound the pledges page uses).
const LIST_LIMIT = 1000;

const PAYMENT_STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-500/20 dark:text-yellow-400',
  completed: 'bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-400',
  failed: 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-400',
  refunded: 'bg-theme-surface-secondary text-theme-text-secondary',
  cancelled: 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-400',
};

const DonationsPage: React.FC = () => {
  const tz = useTimezone();
  const canManage = useAuthStore((st) => st.checkPermission('fundraising.manage'));
  const [donations, setDonations] = useState<Donation[]>([]);
  const [donors, setDonors] = useState<Donor[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [methodFilter, setMethodFilter] = useState('');

  useEffect(() => {
    const loadDonations = async () => {
      try {
        const data = await fundraisingService.listDonations({ limit: LIST_LIMIT });
        setDonations(data);
      } catch (err: unknown) {
        // W69: a failed load used to read "No donations recorded yet."
        setLoadError(getErrorMessage(err, 'Could not load donations. Refresh the page to try again.'));
      } finally {
        setIsLoading(false);
      }
    };
    void loadDonations();
  }, []);

  // A gift from a directory donor stores only donor_id; donor_name is for a
  // walk-in. The donor list is already masked for a view-only caller (GF-8),
  // so naming from it cannot reveal an anonymous donor (W69).
  useEffect(() => {
    let cancelled = false;
    fundraisingService
      .listDonors({ limit: LIST_LIMIT })
      .then((list) => {
        if (!cancelled) setDonors(list);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const donorNames = useMemo(() => new Map(donors.map((d) => [d.id, donorDisplayName(d)])), [donors]);
  const nameOf = (d: Donation): string =>
    d.isAnonymous ? 'Anonymous' : (d.donorName ?? (d.donorId ? donorNames.get(d.donorId) : undefined) ?? 'Unknown');

  const filtered = donations.filter((d: Donation) => {
    const matchesSearch =
      !search ||
      nameOf(d).toLowerCase().includes(search.toLowerCase()) ||
      (d.donorEmail ?? '').toLowerCase().includes(search.toLowerCase());
    const matchesMethod = !methodFilter || d.paymentMethod === methodFilter;
    return matchesSearch && matchesMethod;
  });

  const totalAmount = filtered.reduce((sum: number, d: Donation) => sum + Number(d.amount), 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="page-header gap-4 sm:items-center">
        <div className="page-header-title">
          <h1 className="text-theme-text-primary text-2xl font-bold">Donations</h1>
          <p className="text-theme-text-secondary mt-1 text-sm">View donation records and totals</p>
        </div>
        {/* The create route and POST /grants/donations both need fundraising.manage. */}
        {canManage && (
          <Link to="/grants/donations/new" className="btn-primary inline-flex items-center gap-2">
            <Plus className="h-4 w-4" />
            Record Donation
          </Link>
        )}
      </div>

      {/* Summary Card */}
      <div className="card p-4">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-green-100 p-2 dark:bg-green-500/20">
            <DollarSign className="h-5 w-5 text-green-700 dark:text-green-600" />
          </div>
          <div>
            <p className="text-theme-text-secondary text-sm">
              Total ({filtered.length} {filtered.length === 1 ? 'donation' : 'donations'})
            </p>
            <p className="text-theme-text-primary text-xl font-bold">{formatCurrency(totalAmount)}</p>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1">
          <Search className="text-theme-text-secondary absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
          <input
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            type="text"
            aria-label="Search donations by donor name or email"
            placeholder="Search by donor name or email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="form-input placeholder:text-theme-text-secondary pr-4 pl-10 text-sm focus:border-red-500 focus:ring-1 focus:ring-red-500"
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter className="text-theme-text-secondary h-4 w-4" />
          <select
            aria-label="Filter by payment method"
            value={methodFilter}
            onChange={(e) => setMethodFilter(e.target.value)}
            className="form-input"
          >
            <option value="">All Methods</option>
            {Object.entries(PAYMENT_METHOD_LABELS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {loadError && (
        <div role="alert" className="alert-danger text-sm">
          {loadError}
        </div>
      )}

      {/* Donations Table */}
      <div className="card overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-12" role="status" aria-live="polite">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-red-500 border-t-transparent" />
          </div>
        ) : loadError ? null : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12">
            <Heart className="text-theme-text-secondary mb-3 h-12 w-12 opacity-40" />
            <p className="text-theme-text-secondary">
              {search || methodFilter ? 'No donations match your search or filter.' : 'No donations recorded yet.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Donations">
            <table className="w-full">
              <thead>
                <tr className="border-theme-surface-border bg-theme-surface border-b">
                  <th
                    scope="col"
                    className="text-theme-text-secondary px-4 py-3 text-left text-xs font-medium tracking-wider uppercase"
                  >
                    Date
                  </th>
                  <th
                    scope="col"
                    className="text-theme-text-secondary px-4 py-3 text-left text-xs font-medium tracking-wider uppercase"
                  >
                    Donor
                  </th>
                  <th
                    scope="col"
                    className="text-theme-text-secondary px-4 py-3 text-left text-xs font-medium tracking-wider uppercase"
                  >
                    Amount
                  </th>
                  <th
                    scope="col"
                    className="text-theme-text-secondary px-4 py-3 text-left text-xs font-medium tracking-wider uppercase"
                  >
                    Method
                  </th>
                  <th
                    scope="col"
                    className="text-theme-text-secondary px-4 py-3 text-left text-xs font-medium tracking-wider uppercase"
                  >
                    Status
                  </th>
                  <th
                    scope="col"
                    className="text-theme-text-secondary px-4 py-3 text-left text-xs font-medium tracking-wider uppercase"
                  >
                    Receipt
                  </th>
                  <th
                    scope="col"
                    className="text-theme-text-secondary px-4 py-3 text-left text-xs font-medium tracking-wider uppercase"
                  >
                    Dedication
                  </th>
                </tr>
              </thead>
              <tbody className="divide-theme-surface-border divide-y">
                {filtered.map((donation) => (
                  <tr key={donation.id} className="hover:bg-theme-surface-hover transition-colors">
                    <td className="text-theme-text-primary px-4 py-3 text-sm whitespace-nowrap">
                      {formatDate(donation.donationDate, tz)}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <div>
                        <span className="text-theme-text-primary font-medium">{nameOf(donation)}</span>
                        {donation.donorEmail && (
                          <p className="text-theme-text-secondary text-xs">{donation.donorEmail}</p>
                        )}
                      </div>
                    </td>
                    <td className="text-theme-text-primary px-4 py-3 text-sm font-semibold whitespace-nowrap">
                      {formatCurrency(Number(donation.amount))}
                      {donation.isRecurring && <span className="ml-1 text-xs text-blue-600">(Recurring)</span>}
                    </td>
                    <td className="text-theme-text-secondary px-4 py-3 text-sm whitespace-nowrap">
                      {PAYMENT_METHOD_LABELS[donation.paymentMethod] ?? donation.paymentMethod}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${PAYMENT_STATUS_COLORS[donation.paymentStatus] ?? 'bg-theme-surface-secondary text-theme-text-secondary'}`}
                      >
                        {PAYMENT_STATUS_LABELS[donation.paymentStatus] ?? donation.paymentStatus}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      {donation.receiptSent ? (
                        <span className="flex items-center gap-1 text-xs text-green-700 dark:text-green-600">
                          <Receipt className="h-3 w-3" /> Sent
                        </span>
                      ) : (
                        <span className="text-theme-text-secondary text-xs">—</span>
                      )}
                    </td>
                    <td className="text-theme-text-secondary px-4 py-3 text-sm">
                      {donation.dedicationType
                        ? `${donation.dedicationType === 'in_honor' ? 'In honor of' : 'In memory of'} ${donation.dedicationName ?? ''}`
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};

export default DonationsPage;
