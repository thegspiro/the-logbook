/**
 * Donors Page
 *
 * Donor CRM with search, type filtering, tabular listing,
 * and inline "Add Donor" form for quick creation.
 */

import React, { useEffect, useState, useMemo, useCallback } from 'react';
import { Users, Plus, Search, X, Mail, Phone, Loader2, Pencil } from 'lucide-react';
import toast from 'react-hot-toast';
import { getErrorMessage } from '@/utils/errorHandling';
import { blankToNull } from '@/utils/formValues';
import { fundraisingService } from '../services/api';
import type { Donor, DonorType } from '../types';
import { formatDate } from '../../../utils/dateFormatting';
import { formatCurrency } from '@/utils/currencyFormatting';
import { useTimezone } from '../../../hooks/useTimezone';
import { useAuthStore } from '../../../stores/authStore';
import { FIELD_ERROR_CLASS, FormField } from '../../../components/ux/FormField';
import { useDiscardGuard } from '../../../hooks/useDiscardGuard';
import { mapServerFieldErrors, type ServerFieldSpec } from '../../../utils/serverFieldErrors';
import { firstRefused, saveExceptRefused } from '../../../utils/saveExceptRefused';

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

/** The person's name on a donor, or '' for an organization recorded by its name alone. */
const personName = (donor: Donor): string => `${donor.firstName ?? ''} ${donor.lastName ?? ''}`.trim();

/** The form as an existing donor fills it, for editing. */
const formFromDonor = (donor: Donor): NewDonorForm => ({
  firstName: donor.firstName ?? '',
  lastName: donor.lastName ?? '',
  email: donor.email ?? '',
  phone: donor.phone ?? '',
  donorType: donor.donorType,
  companyName: donor.companyName ?? '',
  addressLine1: donor.addressLine1 ?? '',
  city: donor.city ?? '',
  state: donor.state ?? '',
  postalCode: donor.postalCode ?? '',
});

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

type DonorField = keyof NewDonorForm;

/**
 * `DonorBase` / `DonorUpdate` in schemas/grant.py, which takes camelCase and
 * snake_case both (mapServerFieldErrors reads either). Ordered as on screen,
 * so the first refusal takes focus.
 */
const DONOR_FIELDS: Record<DonorField, ServerFieldSpec & { id: string }> = {
  firstName: { label: 'First name', maxLength: 100, id: 'donor-firstName' },
  lastName: { label: 'Last name', maxLength: 100, id: 'donor-lastName' },
  email: { label: 'Email', maxLength: 255, id: 'donor-email' },
  phone: { label: 'Phone', maxLength: 20, id: 'donor-phone' },
  donorType: { label: 'Donor type', id: 'donor-donorType' },
  companyName: { label: 'Organization name', maxLength: 255, id: 'donor-companyName' },
  addressLine1: { label: 'Address', maxLength: 255, id: 'donor-addressLine1' },
  city: { label: 'City', maxLength: 100, id: 'donor-city' },
  state: { label: 'State', maxLength: 50, id: 'donor-state' },
  postalCode: { label: 'Postal code', maxLength: 20, id: 'donor-postalCode' },
};
const DONOR_ORDER = Object.keys(DONOR_FIELDS) as DonorField[];

// ---------------------------------------------------------------------------
// Shared Tailwind class constants
// ---------------------------------------------------------------------------

const inputClass =
  'form-input px-3 text-sm placeholder:text-theme-text-secondary focus:border-red-500 focus:ring-red-500';

const selectClass = 'form-input px-3 text-sm focus:border-red-500 focus:ring-red-500';

const labelClass = 'form-label';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const DonorsPage: React.FC = () => {
  const tz = useTimezone();
  // Route is gated at fundraising.view; create_donor requires
  // fundraising.manage. Hide the create affordance for view-only viewers
  // rather than let the submit 403.
  const canManage = useAuthStore((s) => s.checkPermission)('fundraising.manage');
  const [donors, setDonors] = useState<Donor[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [form, setForm] = useState<NewDonorForm>({ ...EMPTY_FORM });
  // The donor being edited, or null when the form adds a new one.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [baseline, setBaseline] = useState<NewDonorForm>({ ...EMPTY_FORM });
  const [errors, setErrors] = useState<Partial<Record<DonorField, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);

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
        (d.firstName ?? '').toLowerCase().includes(q) ||
        (d.lastName ?? '').toLowerCase().includes(q) ||
        (d.companyName ?? '').toLowerCase().includes(q) ||
        (d.email ?? '').toLowerCase().includes(q)
    );
  }, [donors, search]);

  // -----------------------------------------------------------------------
  // Form helpers
  // -----------------------------------------------------------------------

  const updateField = <K extends keyof NewDonorForm>(field: K, value: NewDonorForm[K]) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => {
      if (!(field in prev)) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  const resetForm = () => {
    setForm({ ...EMPTY_FORM });
    setBaseline({ ...EMPTY_FORM });
    setErrors({});
    setFormError(null);
    setEditingId(null);
    setShowForm(false);
  };
  // Cancel asks before throwing typed changes away (forms review F-6). With the
  // form closed there is nothing to ask about, so the guard is not armed.
  const requestCancel = useDiscardGuard({
    isDirty: showForm ? JSON.stringify(form) !== JSON.stringify(baseline) : undefined,
    onClose: resetForm,
  });

  const showErrors = (next: Partial<Record<DonorField, string>>) => {
    setErrors(next);
    const first = firstRefused(DONOR_ORDER, next);
    if (first) window.setTimeout(() => document.getElementById(DONOR_FIELDS[first].id)?.focus(), 0);
  };

  const startEdit = (donor: Donor) => {
    const seeded = formFromDonor(donor);
    setForm(seeded);
    setBaseline(seeded);
    setErrors({});
    setFormError(null);
    setEditingId(donor.id);
    setShowForm(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // W69-6: an individual needs both names; a business, foundation,
    // government or other donor may be recorded by its organization name
    // alone. The server applies the same rule.
    const hasPerson = Boolean(form.firstName.trim() && form.lastName.trim());
    const problems: Partial<Record<DonorField, string>> = {};
    if (isIndividual && !hasPerson) {
      if (!form.firstName.trim()) problems.firstName = "Enter the donor's first name.";
      if (!form.lastName.trim()) problems.lastName = "Enter the donor's last name.";
    }
    if (!isIndividual && !hasPerson && !form.companyName.trim()) {
      problems.companyName = "Enter the organization's name, or a contact's first and last name.";
    }
    setFormError(null);
    // A new donor is not added until every field is fixed; an edit saves the
    // rest and keeps a refused field's stored value (owner rule, 2026-11-05).
    if (!editingId && Object.keys(problems).length > 0) {
      showErrors(problems);
      return;
    }

    try {
      setIsSubmitting(true);
      if (editingId) {
        // An update leaves an omitted key alone, so every field this form
        // owns is sent, and a box the manager emptied goes as null to clear
        // it rather than keep the old value behind a success toast.
        const { refused } = await saveExceptRefused<DonorField, unknown>({
          payload: {
            firstName: blankToNull(form.firstName),
            lastName: blankToNull(form.lastName),
            email: blankToNull(form.email),
            phone: blankToNull(form.phone),
            donorType: form.donorType,
            companyName: blankToNull(form.companyName),
            addressLine1: blankToNull(form.addressLine1),
            city: blankToNull(form.city),
            state: blankToNull(form.state),
            postalCode: blankToNull(form.postalCode),
          },
          refused: problems,
          send: (body) => fundraisingService.updateDonor(editingId, body),
          place: (err) => mapServerFieldErrors(err, DONOR_FIELDS),
        });
        const first = firstRefused(DONOR_ORDER, refused);
        if (first) {
          // The list refreshes below the form, which stays open with the
          // refused field flagged; only that field still counts as unsaved.
          void loadDonors();
          showErrors(refused);
          setFormError(`Donor saved, except ${DONOR_FIELDS[first].label.toLowerCase()}. Fix it and save again.`);
          const keep = Object.fromEntries(Object.keys(refused).map((k) => [k, baseline[k as DonorField]]));
          setBaseline({ ...form, ...keep });
          return;
        }
        toast.success('Donor updated');
        resetForm();
        void loadDonors();
        return;
      }
      await fundraisingService.createDonor({
        firstName: form.firstName.trim() || null,
        lastName: form.lastName.trim() || null,
        email: form.email.trim() || null,
        phone: form.phone.trim() || null,
        donorType: form.donorType,
        companyName: form.companyName.trim() || null,
        addressLine1: form.addressLine1.trim() || null,
        city: form.city.trim() || null,
        state: form.state.trim() || null,
        postalCode: form.postalCode.trim() || null,
      });
      toast.success('Donor added');
      resetForm();
      void loadDonors();
    } catch (err: unknown) {
      // A refusal lands on its field (forms review F-2); anything no field
      // answers for is said at the top of the form, which stays open.
      const mapped = mapServerFieldErrors(err, DONOR_FIELDS);
      if (mapped) showErrors(mapped.fieldErrors);
      const placed = mapped ? Object.keys(mapped.fieldErrors).length > 0 : false;
      setFormError(
        mapped?.unmatched.join(' ') ||
          (placed ? null : getErrorMessage(err, editingId ? 'Failed to update donor' : 'Failed to add donor'))
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const isIndividual = form.donorType === 'individual';

  /** One text control through FormField, wired to its error, limit and counter. */
  const textField = (
    key: Exclude<DonorField, 'donorType'>,
    label: string,
    options: {
      required?: boolean;
      type?: 'text' | 'email' | 'tel';
      placeholder?: string;
      autoComplete?: string;
      icon?: React.ReactNode;
    } = {}
  ) => {
    const spec = DONOR_FIELDS[key];
    const input = (field: React.InputHTMLAttributes<HTMLInputElement> & { id: string }) => (
      <input
        {...field}
        type={options.type ?? 'text'}
        value={form[key]}
        onChange={(e) => updateField(key, e.target.value)}
        placeholder={options.placeholder}
        autoComplete={options.autoComplete}
        className={options.icon ? `${inputClass} pl-10` : inputClass}
      />
    );
    return (
      <FormField
        id={spec.id}
        label={label}
        required={options.required}
        error={errors[key]}
        maxLength={spec.maxLength}
        count={form[key].length}
        labelClassName={labelClass}
      >
        {(field) =>
          options.icon ? (
            <div className="relative">
              {options.icon}
              {input(field)}
            </div>
          ) : (
            input(field)
          )
        }
      </FormField>
    );
  };

  // -----------------------------------------------------------------------
  // Render
  // -----------------------------------------------------------------------

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="page-header gap-4 sm:items-center">
        <div className="page-header-title">
          <h1 className="text-theme-text-primary text-2xl font-bold">Donors</h1>
          <p className="text-theme-text-secondary mt-1 text-sm">Look up donors and what each has given</p>
        </div>
        {canManage && (
          <button
            onClick={() => (showForm ? requestCancel() : setShowForm(true))}
            className="touch:min-h-11 inline-flex items-center gap-2 rounded-lg bg-red-800 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-900"
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
        )}
      </div>

      {/* Inline Add Donor Form */}
      {canManage && showForm && (
        <form onSubmit={(e) => void handleSubmit(e)} noValidate className="card space-y-4 p-6">
          <h2 className="text-theme-text-primary text-lg font-semibold">{editingId ? 'Edit Donor' : 'New Donor'}</h2>

          {formError && (
            <p role="alert" className={`text-sm ${FIELD_ERROR_CLASS}`}>
              {formError}
            </p>
          )}

          <div className="field-grid gap-4">
            {textField('firstName', isIndividual ? 'First Name' : 'Contact First Name', {
              required: isIndividual,
              placeholder: 'First name',
              autoComplete: 'off',
            })}
            {textField('lastName', isIndividual ? 'Last Name' : 'Contact Last Name', {
              required: isIndividual,
              placeholder: 'Last name',
              autoComplete: 'off',
            })}
            {textField('email', 'Email', {
              type: 'email',
              placeholder: 'email@example.com',
              icon: <Mail className="text-theme-text-secondary absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />,
            })}
            {textField('phone', 'Phone', {
              type: 'tel',
              placeholder: '(555) 123-4567',
              icon: <Phone className="text-theme-text-secondary absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />,
            })}

            <FormField
              id={DONOR_FIELDS.donorType.id}
              label="Donor Type"
              error={errors.donorType}
              labelClassName={labelClass}
            >
              {(field) => (
                <select
                  {...field}
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
              )}
            </FormField>

            {/* Organization name: every donor type but an individual */}
            {!isIndividual &&
              textField('companyName', 'Organization Name', { placeholder: 'Business, foundation or agency name' })}
            {textField('addressLine1', 'Address', { placeholder: 'Street address', autoComplete: 'off' })}
            {textField('city', 'City', { placeholder: 'City', autoComplete: 'off' })}
            {textField('state', 'State', { placeholder: 'State', autoComplete: 'off' })}
            {textField('postalCode', 'Postal Code', { placeholder: 'ZIP / Postal code', autoComplete: 'off' })}
          </div>

          {/* Form Actions */}
          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={requestCancel}
              className="border-theme-surface-border text-theme-text-primary hover:bg-theme-surface-hover rounded-lg border px-4 py-2 text-sm font-medium transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex items-center gap-2 rounded-lg bg-red-800 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-900 disabled:opacity-50"
            >
              {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {editingId ? 'Save Changes' : 'Save Donor'}
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
            aria-label="Search donors by name or email"
            placeholder="Search by name or email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={`${inputClass} pl-10`}
          />
        </div>
        <select
          aria-label="Filter by donor type"
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
      <div className="card overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-12" role="status" aria-live="polite">
            <Loader2 className="h-8 w-8 animate-spin text-red-500" />
          </div>
        ) : filteredDonors.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12">
            <Users className="text-theme-text-secondary mb-3 h-12 w-12 opacity-40" />
            <p className="text-theme-text-secondary">
              {search || typeFilter
                ? 'No donors match your search or filter.'
                : canManage
                  ? 'No donors yet. Select Add Donor to add one.'
                  : 'No donors yet.'}
            </p>
          </div>
        ) : (
          <div className="rwd-table-container overflow-x-auto">
            <table className="rwd-table rwd-table-xwide w-full">
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
                    <td data-label="Name" className="px-4 py-3 text-sm">
                      {/* An organization recorded without a contact leads with
                          its own name (W69-6). */}
                      <span className="text-theme-text-primary font-medium">
                        {personName(donor) || donor.companyName || 'Unnamed donor'}
                      </span>
                      {personName(donor) && donor.companyName && (
                        <p className="text-theme-text-secondary text-xs">{donor.companyName}</p>
                      )}
                    </td>

                    {/* Email */}
                    <td data-label="Email" className="text-theme-text-secondary px-4 py-3 text-sm">
                      {donor.email ? (
                        <span className="inline-flex min-w-0 items-center gap-1">
                          <Mail className="h-3.5 w-3.5 shrink-0" />
                          <span className="min-w-0 break-all">{donor.email}</span>
                        </span>
                      ) : donor.contactHidden ? (
                        <span className="text-theme-text-muted text-xs">Managers only</span>
                      ) : (
                        '--'
                      )}
                    </td>

                    {/* Type Badge */}
                    <td data-label="Type" className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${DONOR_TYPE_COLORS[donor.donorType] ?? 'bg-theme-surface-secondary text-theme-text-secondary'}`}
                      >
                        {DONOR_TYPE_LABELS[donor.donorType] ?? donor.donorType}
                      </span>
                    </td>

                    {/* Total Donated */}
                    <td
                      data-label="Total Donated"
                      className="text-theme-text-primary px-4 py-3 text-right text-sm font-semibold"
                    >
                      {formatCurrency(donor.totalDonated)}
                    </td>

                    {/* # Donations */}
                    <td data-label="# Donations" className="text-theme-text-secondary px-4 py-3 text-right text-sm">
                      {donor.donationCount}
                    </td>

                    {/* Last Donation */}
                    <td data-label="Last Donation" className="text-theme-text-secondary px-4 py-3 text-sm">
                      {donor.lastDonationDate ? formatDate(donor.lastDonationDate, tz) : '--'}
                    </td>

                    {/* Actions */}
                    <td data-label="Actions" className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        {donor.email && (
                          <a
                            href={`mailto:${donor.email}`}
                            className="text-theme-text-secondary hover:bg-theme-surface-hover hover:text-theme-text-primary touch-target-phone rounded p-1 transition-colors"
                            title="Send email"
                            aria-label={`Email ${personName(donor) || donor.companyName || 'donor'}`}
                          >
                            <Mail className="h-4 w-4" />
                          </a>
                        )}
                        {donor.phone && (
                          <a
                            href={`tel:${donor.phone}`}
                            className="text-theme-text-secondary hover:bg-theme-surface-hover hover:text-theme-text-primary touch-target-phone rounded p-1 transition-colors"
                            title="Call"
                            aria-label={`Call ${personName(donor) || donor.companyName || 'donor'}`}
                          >
                            <Phone className="h-4 w-4" />
                          </a>
                        )}
                        {canManage && (
                          <button
                            type="button"
                            onClick={() => startEdit(donor)}
                            className="text-theme-text-secondary hover:bg-theme-surface-hover hover:text-theme-text-primary touch-target-phone rounded p-1 transition-colors"
                            title="Edit donor"
                            aria-label={`Edit ${personName(donor) || donor.companyName || 'donor'}`}
                          >
                            <Pencil className="h-4 w-4" />
                          </button>
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
