import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  DollarSign,
  Plus,
  Search,
  Filter,
  Receipt,
  Heart,
} from 'lucide-react';
import { fundraisingService } from '../services/api';
import type { Donation } from '../types';
import { formatDate } from '../../../utils/dateFormatting';
import { formatCurrency } from '@/utils/currencyFormatting';
import { useTimezone } from '../../../hooks/useTimezone';

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  cash: 'Cash',
  check: 'Check',
  credit_card: 'Credit Card',
  bank_transfer: 'Bank Transfer',
  paypal: 'PayPal',
  venmo: 'Venmo',
  other: 'Other',
};

const PAYMENT_STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-500/20 dark:text-yellow-400',
  completed: 'bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-400',
  failed: 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-400',
  refunded: 'bg-theme-surface-secondary text-theme-text-secondary',
  cancelled: 'bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-400',
};

const DonationsPage: React.FC = () => {
  const tz = useTimezone();
  const [donations, setDonations] = useState<Donation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [methodFilter, setMethodFilter] = useState('');

  useEffect(() => {
    const loadDonations = async () => {
      try {
        const data = await fundraisingService.listDonations({});
        setDonations(data);
      } catch {
        // Error handled silently
      } finally {
        setIsLoading(false);
      }
    };
    void loadDonations();
  }, []);

  const filtered = donations.filter((d: Donation) => {
    const matchesSearch =
      !search ||
      (d.donorName ?? '').toLowerCase().includes(search.toLowerCase()) ||
      (d.donorEmail ?? '').toLowerCase().includes(search.toLowerCase());
    const matchesMethod = !methodFilter || d.paymentMethod === methodFilter;
    return matchesSearch && matchesMethod;
  });

  const totalAmount = filtered.reduce(
    (sum: number, d: Donation) => sum + Number(d.amount),
    0,
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-theme-text-primary">
            Donations
          </h1>
          <p className="mt-1 text-sm text-theme-text-secondary">
            Track and manage all donation records
          </p>
        </div>
        <Link
          to="/grants/donations/new"
          className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
        >
          <Plus className="h-4 w-4" />
          Record Donation
        </Link>
      </div>

      {/* Summary Card */}
      <div className="rounded-lg border border-theme-surface-border bg-theme-surface p-4">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-green-100 p-2">
            <DollarSign className="h-5 w-5 text-green-600" />
          </div>
          <div>
            <p className="text-sm text-theme-text-secondary">
              Total ({filtered.length} donations)
            </p>
            <p className="text-xl font-bold text-theme-text-primary">
              {formatCurrency(totalAmount)}
            </p>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-theme-text-secondary" />
          <input
            type="text"
            placeholder="Search by donor name or email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full rounded-lg border border-theme-surface-border bg-theme-surface py-2 pl-10 pr-4 text-sm text-theme-text-primary placeholder:text-theme-text-secondary focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500"
          />
        </div>
        <div className="flex items-center gap-2">
          <Filter className="h-4 w-4 text-theme-text-secondary" />
          <select
            value={methodFilter}
            onChange={(e) => setMethodFilter(e.target.value)}
            className="rounded-lg border border-theme-input-border bg-theme-input-bg px-3 py-2 text-sm text-theme-text-primary focus:border-red-500 focus:outline-none"
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

      {/* Donations Table */}
      <div className="overflow-hidden rounded-lg border border-theme-surface-border bg-theme-surface">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-red-500 border-t-transparent" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12">
            <Heart className="mb-3 h-12 w-12 text-theme-text-secondary opacity-40" />
            <p className="text-theme-text-secondary">No donations found</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-theme-surface-border bg-theme-surface">
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-theme-text-secondary">
                    Date
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-theme-text-secondary">
                    Donor
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-theme-text-secondary">
                    Amount
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-theme-text-secondary">
                    Method
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-theme-text-secondary">
                    Status
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-theme-text-secondary">
                    Receipt
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-theme-text-secondary">
                    Dedication
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-theme-surface-border">
                {filtered.map((donation) => (
                  <tr
                    key={donation.id}
                    className="hover:bg-theme-surface-hover transition-colors"
                  >
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-theme-text-primary">
                      {formatDate(donation.donationDate, tz)}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <div>
                        <span className="font-medium text-theme-text-primary">
                          {donation.isAnonymous
                            ? 'Anonymous'
                            : donation.donorName ?? 'Unknown'}
                        </span>
                        {donation.donorEmail && (
                          <p className="text-xs text-theme-text-secondary">
                            {donation.donorEmail}
                          </p>
                        )}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm font-semibold text-theme-text-primary">
                      {formatCurrency(Number(donation.amount))}
                      {donation.isRecurring && (
                        <span className="ml-1 text-xs text-blue-600">
                          (Recurring)
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-sm text-theme-text-secondary">
                      {PAYMENT_METHOD_LABELS[donation.paymentMethod] ??
                        donation.paymentMethod}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${PAYMENT_STATUS_COLORS[donation.paymentStatus] ?? 'bg-theme-surface-secondary text-theme-text-secondary'}`}
                      >
                        {donation.paymentStatus}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">
                      {donation.receiptSent ? (
                        <span className="flex items-center gap-1 text-xs text-green-600">
                          <Receipt className="h-3 w-3" /> Sent
                        </span>
                      ) : (
                        <span className="text-xs text-theme-text-secondary">
                          —
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-theme-text-secondary">
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
