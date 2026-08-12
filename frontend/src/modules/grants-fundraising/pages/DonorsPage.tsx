/**
 * Donors Page
 *
 * Donor CRM with search, type filtering, tabular listing,
 * and inline "Add Donor" form for quick creation.
 */

import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { Users, Plus, Search, X, Mail, Phone, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { fundraisingService } from '../services/api';
import type { Donor, DonorType } from '../types';
import { formatDate } from '../../../utils/dateFormatting';
import { formatCurrency } from '@/utils/currencyFormatting';
import { useTimezone } from '../../../hooks/useTimezone';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DONOR_TYPE_LABELS: Record<string, string> = {
  individual: 'Individual',
  business: 'Business',
  foundation: 'Foundation',
  government: 'Government',
  other: 'Other',
};

const DONOR_TYPE_COLORS: Record<string, string> = {
  individual: 'bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-400',
  business: 'bg-purple-100 text-purple-800 dark:bg-purple-500/20 dark:text-purple-400',
  foundation: 'bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-400',
  government: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-500/20 dark:text-indigo-400',
  other: 'bg-theme-surface-secondary text-theme-text-secondary',
};

const DONOR_TYPE_OPTIONS: { value: DonorType; label: string }[] = [
  { value: 'individual', label: 'Individual' },
  { value: 'business', label: 'Business' },
  { value: 'foundation', label: 'Foundation' },
  { value: 'government', label: 'Government' },
  { value: 'other', label: 'Other' },
];

// ---------------------------------------------------------------------------
// Form state
// ---------------------------------------------------------------------------

interface NewDonorForm {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  donorType: DonorType;
  companyName: string;
  addressLine1: string;
  city: string;
  state: string;
  postalCode: string;
}

const EMPTY_FORM: NewDonorForm = {
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  donorType: 'individual',
  companyName: '',
  addressLine1: '',
  city: '',
  state: '',
  postalCode: '',
};

// ---------------------------------------------------------------------------
// Shared Tailwind class constants
// ---------------------------------------------------------------------------

const inputClass =
  'w-full rounded-lg border border-theme-input-border bg-theme-input-bg px-3 py-2 text-sm text-theme-text-primary placeholder:text-theme-text-secondary focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500';

const selectClass =
  'w-full rounded-lg border border-theme-input-border bg-theme-input-bg px-3 py-2 text-sm text-theme-text-primary focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500';

const labelClass = 'form-label';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const DonorsPage: React.FC = () => {
  const tz = useTimezone();
  const [donors, setDonors] = useState<Donor[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [form, setForm] = useState<NewDonorForm>({ ...EMPTY_FORM });

  // -----------------------------------------------------------------------
  // Data fetching
  // -----------------------------------------------------------------------

  const loadDonors = useCallback(async () => {
    try {
      setIsLoading(true);
      const params: { donorType?: string; search?: string } = {};
      if (typeFilter) params.donorType = typeFilter;
      if (search) params.search = search;
      const data = await fundraisingService.listDonors(params);
      setDonors(data);
    } catch {
      toast.error('Failed to load donors');
    } finally {
      setIsLoading(false);
    }
  }, [search, typeFilter]);

  useEffect(() => {
    void loadDonors();
  }, [loadDonors]);

  // -----------------------------------------------------------------------
  // Filtering (client-side supplement to server search)
  // -----------------------------------------------------------------------

  const filteredDonors = useMemo(() => {
    if (!search) return donors;
    const q = search.toLowerCase();
    return donors.filter(
      (d) =>
        d.firstName.toLowerCase().includes(q) ||
        d.lastName.toLowerCase().includes(q) ||
        (d.email ?? '').toLowerCase().includes(q)
    );
  }, [donors, search]);

  // -----------------------------------------------------------------------
  // Form helpers
  // -----------------------------------------------------------------------

  const updateField = <K extends keyof NewDonorForm>(field: K, value: NewDonorForm[K]) => {
    setForm((prev) => ({ ...prev, [field]: value }));
  };

  const resetForm = () => {
    setForm({ ...EMPTY_FORM });
    setShowForm(false);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!form.firstName.trim() || !form.lastName.trim()) {
      toast.error('First name and last name are required');
      return;
    }

    try {
      setIsSubmitting(true);
      await fundraisingService.createDonor({
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        donorType: form.donorType,
        companyName: form.companyName.trim() || null,
        addressLine1: form.addressLine1.trim() || null,
        city: form.city.trim() || null,
        state: form.state.trim() || null,
        postalCode: form.postalCode.trim() || null,
      });
      toast.success('Donor created successfully');
      resetForm();
      void loadDonors();
    } catch {
      toast.error('Failed to create donor');
    } finally {
      setIsSubmitting(false);
    }
  };

  const showCompanyField = form.donorType === 'business' || form.donorType === 'foundation';

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-theme-text-primary text-2xl font-bold">Donors</h1>
          <p className="text-theme-text-secondary mt-1 text-sm">Manage your donor directory and relationships</p>
        </div>
        <button
          onClick={() => setShowForm((prev) => !prev)}
          className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700"
        >
          {showForm ? (
            <>
              <X className="h-4 w-4" />
              Cancel
            </>
          ) : (
            <>
              <Plus className="h-4 w-4" />
              Add Donor
            </>
          )}
        </button>
      </div>

      {/* Inline Add Donor Form */}
      {showForm && (
        <form
          onSubmit={(e) => void handleSubmit(e)}
          className="border-theme-surface-border bg-theme-surface space-y-4 rounded-lg border p-6"
        >
          <h2 className="text-theme-text-primary text-lg font-semibold">New Donor</h2>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {/* First Name */}
            <div>
              <label className={labelClass}>
                First Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={form.firstName}
                onChange={(e) => updateField('firstName', e.target.value)}
                placeholder="First name"
                className={inputClass}
                required
              />
            </div>

            {/* Last Name */}
            <div>
              <label className={labelClass}>
                Last Name <span className="text-red-500">*</span>
              </label>
              <input
                type="text"
                value={form.lastName}
                onChange={(e) => updateField('lastName', e.target.value)}
                placeholder="Last name"
                className={inputClass}
                required
              />
            </div>

            {/* Email */}
            <div>
              <label className={labelClass}>Email</label>
              <div className="relative">
                <Mail className="text-theme-text-secondary absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => updateField('email', e.target.value)}
                  placeholder="email@example.com"
                  className={`${inputClass} pl-10`}
                />
              </div>
            </div>

            {/* Phone */}
            <div>
              <label className={labelClass}>Phone</label>
              <div className="relative">
                <Phone className="text-theme-text-secondary absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
                <input
                  type="tel"
                  value={form.phone}
                  onChange={(e) => updateField('phone', e.target.value)}
                  placeholder="(555) 123-4567"
                  className={`${inputClass} pl-10`}
                />
              </div>
            </div>

            {/* Donor Type */}
            <div>
              <label className={labelClass}>Donor Type</label>
              <select
                value={form.donorType}
                onChange={(e) => updateField('donorType', e.target.value as DonorType)}
                className={selectClass}
              >
                {DONOR_TYPE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Company Name (shown for business / foundation) */}
            {showCompanyField && (
              <div>
                <label className={labelClass}>Company Name</label>
                <input
                  type="text"
                  value={form.companyName}
                  onChange={(e) => updateField('companyName', e.target.value)}
                  placeholder="Company or foundation name"
                  className={inputClass}
                />
              </div>
            )}

            {/* Address Line 1 */}
            <div>
              <label className={labelClass}>Address</label>
              <input
                type="text"
                value={form.addressLine1}
                onChange={(e) => updateField('addressLine1', e.target.value)}
                placeholder="Street address"
                className={inputClass}
              />
            </div>

            {/* City */}
            <div>
              <label className={labelClass}>City</label>
              <input
                type="text"
                value={form.city}
                onChange={(e) => updateField('city', e.target.value)}
                placeholder="City"
                className={inputClass}
              />
            </div>

            {/* State */}
            <div>
              <label className={labelClass}>State</label>
              <input
                type="text"
                value={form.state}
                onChange={(e) => updateField('state', e.target.value)}
                placeholder="State"
                className={inputClass}
              />
            </div>

            {/* Postal Code */}
            <div>
              <label className={labelClass}>Postal Code</label>
              <input
                type="text"
                value={form.postalCode}
                onChange={(e) => updateField('postalCode', e.target.value)}
                placeholder="ZIP / Postal code"
                className={inputClass}
              />
            </div>
          </div>

          {/* Form Actions */}
          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={resetForm}
              className="border-theme-surface-border text-theme-text-primary hover:bg-theme-surface-hover rounded-lg border px-4 py-2 text-sm font-medium transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-700 disabled:opacity-50"
            >
              {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
              Save Donor
            </button>
          </div>
        </form>
      )}

      {/* Search and Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-[240px] flex-1">
          <Search className="text-theme-text-secondary absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
          <input
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            type="text"
            aria-label="Search by name or email..."
            placeholder="Search by name or email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={`${inputClass} pl-10`}
          />
        </div>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className={selectClass}
          style={{ width: 'auto' }}
        >
          <option value="">All Types</option>
          {DONOR_TYPE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* Donors Table */}
      <div className="border-theme-surface-border bg-theme-surface overflow-hidden rounded-lg border">
        {isLoading ? (
          <div className="flex items-center justify-center py-12" role="status" aria-live="polite">
            <Loader2 className="h-8 w-8 animate-spin text-red-500" />
          </div>
        ) : filteredDonors.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12">
            <Users className="text-theme-text-secondary mb-3 h-12 w-12 opacity-40" />
            <p className="text-theme-text-secondary">
              {search || typeFilter
                ? 'No donors match your search criteria'
                : 'No donors found. Add your first donor to get started.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-theme-surface-border bg-theme-surface border-b">
                  <th
                    scope="col"
                    className="text-theme-text-secondary px-4 py-3 text-left text-xs font-medium tracking-wider uppercase"
                  >
                    Name
                  </th>
                  <th
                    scope="col"
                    className="text-theme-text-secondary px-4 py-3 text-left text-xs font-medium tracking-wider uppercase"
                  >
                    Email
                  </th>
                  <th
                    scope="col"
                    className="text-theme-text-secondary px-4 py-3 text-left text-xs font-medium tracking-wider uppercase"
                  >
                    Type
                  </th>
                  <th
                    scope="col"
                    className="text-theme-text-secondary px-4 py-3 text-right text-xs font-medium tracking-wider uppercase"
                  >
                    Total Donated
                  </th>
                  <th
                    scope="col"
                    className="text-theme-text-secondary px-4 py-3 text-right text-xs font-medium tracking-wider uppercase"
                  >
                    # Donations
                  </th>
                  <th
                    scope="col"
                    className="text-theme-text-secondary px-4 py-3 text-left text-xs font-medium tracking-wider uppercase"
                  >
                    Last Donation
                  </th>
                  <th
                    scope="col"
                    className="text-theme-text-secondary px-4 py-3 text-left text-xs font-medium tracking-wider uppercase"
                  >
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-theme-surface-border divide-y">
                {filteredDonors.map((donor) => (
                  <tr key={donor.id} className="hover:bg-theme-surface-hover transition-colors">
                    {/* Name */}
                    <td className="px-4 py-3 text-sm">
                      <span className="text-theme-text-primary font-medium">
                        {donor.firstName} {donor.lastName}
                      </span>
                      {donor.companyName && <p className="text-theme-text-secondary text-xs">{donor.companyName}</p>}
                    </td>

                    {/* Email */}
                    <td className="text-theme-text-secondary px-4 py-3 text-sm">
                      {donor.email ? (
                        <span className="inline-flex items-center gap-1">
                          <Mail className="h-3.5 w-3.5 shrink-0" />
                          {donor.email}
                        </span>
                      ) : (
                        '--'
                      )}
                    </td>

                    {/* Type Badge */}
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${DONOR_TYPE_COLORS[donor.donorType] ?? 'bg-theme-surface-secondary text-theme-text-secondary'}`}
                      >
                        {DONOR_TYPE_LABELS[donor.donorType] ?? donor.donorType}
                      </span>
                    </td>

                    {/* Total Donated */}
                    <td className="text-theme-text-primary px-4 py-3 text-right text-sm font-semibold">
                      {formatCurrency(donor.totalDonated)}
                    </td>

                    {/* # Donations */}
                    <td className="text-theme-text-secondary px-4 py-3 text-right text-sm">{donor.donationCount}</td>

                    {/* Last Donation */}
                    <td className="text-theme-text-secondary px-4 py-3 text-sm">
                      {donor.lastDonationDate ? formatDate(donor.lastDonationDate, tz) : '--'}
                    </td>

                    {/* Actions */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {donor.email && (
                          <a
                            href={`mailto:${donor.email}`}
                            className="text-theme-text-secondary hover:bg-theme-surface-hover hover:text-theme-text-primary rounded p-1 transition-colors"
                            title="Send email"
                          >
                            <Mail className="h-4 w-4" />
                          </a>
                        )}
                        {donor.phone && (
                          <a
                            href={`tel:${donor.phone}`}
                            className="text-theme-text-secondary hover:bg-theme-surface-hover hover:text-theme-text-primary rounded p-1 transition-colors"
                            title="Call"
                          >
                            <Phone className="h-4 w-4" />
                          </a>
                        )}
                      </div>
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

export default DonorsPage;
