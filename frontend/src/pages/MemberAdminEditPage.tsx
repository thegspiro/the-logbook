/**
 * Member Admin Edit Page
 *
 * Comprehensive admin edit page for member management.
 * Accessible from the Members Admin Hub, allows admins to edit ALL member fields.
 *
 * Sections:
 * - Personal Information (name, DOB, personal email)
 * - Department Information (membership number, rank, station, hire date, membership type)
 * - Contact Information (email readonly, phone, mobile)
 * - Address
 * - Emergency Contacts (dynamic list)
 * - Actions (view history, save, cancel)
 */

import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router';
import { userService, locationsService } from '../services/api';
import type { Location } from '../services/api';
import type { UserWithRoles } from '../types/role';
import type { UserProfileUpdate, EmergencyContact } from '../types/user';
import { useRanks } from '../hooks/useRanks';

const MEMBERSHIP_TYPE_OPTIONS = [
  { value: 'prospective', label: 'Prospective' },
  { value: 'probationary', label: 'Probationary' },
  { value: 'active', label: 'Active' },
  { value: 'life', label: 'Life' },
  { value: 'retired', label: 'Retired' },
  { value: 'honorary', label: 'Honorary' },
  { value: 'administrative', label: 'Administrative' },
];

interface FormData {
  first_name: string;
  middle_name: string;
  last_name: string;
  date_of_birth: string;
  personal_email: string;
  membership_number: string;
  rank: string;
  station: string;
  platoon: string;
  hire_date: string;
  membership_type: string;
  compliance_exempt: boolean;
  email: string;
  phone: string;
  mobile: string;
  address_street: string;
  address_city: string;
  address_state: string;
  address_zip: string;
  address_country: string;
  emergency_contacts: EmergencyContact[];
}

function buildInitialForm(
  user: UserWithRoles & { personal_email?: string; membership_type?: string; compliance_exempt?: boolean }
): FormData {
  return {
    first_name: user.first_name || '',
    middle_name: user.middle_name || '',
    last_name: user.last_name || '',
    date_of_birth: user.date_of_birth || '',
    personal_email: user.personal_email || '',
    membership_number: user.membership_number || '',
    rank: user.rank || '',
    station: user.station || '',
    platoon: user.platoon || '',
    hire_date: user.hire_date || '',
    membership_type: user.membership_type || '',
    compliance_exempt: user.compliance_exempt || false,
    email: user.email || '',
    phone: user.phone || '',
    mobile: user.mobile || '',
    address_street: user.address_street || '',
    address_city: user.address_city || '',
    address_state: user.address_state || '',
    address_zip: user.address_zip || '',
    address_country: user.address_country || '',
    emergency_contacts: user.emergency_contacts ? user.emergency_contacts.map((ec) => ({ ...ec })) : [],
  };
}

function createEmptyContact(): EmergencyContact {
  return {
    name: '',
    relationship: '',
    phone: '',
    email: '',
    is_primary: false,
  };
}

export const MemberAdminEditPage: React.FC = () => {
  const { userId } = useParams<{ userId: string }>();
  const navigate = useNavigate();
  const { rankOptions } = useRanks();

  const [user, setUser] = useState<
    (UserWithRoles & { personal_email?: string; membership_type?: string; compliance_exempt?: boolean }) | null
  >(null);
  const [form, setForm] = useState<FormData | null>(null);
  const [initialForm, setInitialForm] = useState<FormData | null>(null);
  const [availableStations, setAvailableStations] = useState<Location[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const fetchUser = useCallback(async () => {
    if (!userId) return;

    try {
      setLoading(true);
      setError(null);
      const userData = await userService.getUserWithRoles(userId);
      // The API may return personal_email and membership_type even though UserWithRoles doesn't declare them
      const extendedUser = userData as UserWithRoles & {
        personal_email?: string;
        membership_type?: string;
        compliance_exempt?: boolean;
      };
      setUser(extendedUser);
      const formData = buildInitialForm(extendedUser);
      setForm(formData);
      setInitialForm(formData);
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(detail || 'Unable to load member data. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => {
    void fetchUser();
  }, [fetchUser]);

  useEffect(() => {
    locationsService
      .getLocations({ is_active: true, exclude_rooms: true })
      .then((locs) => {
        setAvailableStations(locs.filter((l: Location) => l.address));
      })
      .catch(() => {
        /* non-critical UI data */
      });
  }, []);

  const handleFieldChange = (field: keyof Omit<FormData, 'emergency_contacts'>, value: string) => {
    if (!form) return;
    setSuccessMessage(null);
    setForm((prev) => (prev ? { ...prev, [field]: value } : prev));
  };

  const handleEmergencyContactChange = (index: number, field: keyof EmergencyContact, value: string | boolean) => {
    if (!form) return;
    setSuccessMessage(null);
    setForm((prev) => {
      if (!prev) return prev;
      const updatedContacts = [...prev.emergency_contacts];
      updatedContacts[index] = { ...updatedContacts[index], [field]: value } as EmergencyContact;
      return { ...prev, emergency_contacts: updatedContacts };
    });
  };

  const handleAddEmergencyContact = () => {
    if (!form) return;
    setSuccessMessage(null);
    setForm((prev) => {
      if (!prev) return prev;
      return { ...prev, emergency_contacts: [...prev.emergency_contacts, createEmptyContact()] };
    });
  };

  const handleRemoveEmergencyContact = (index: number) => {
    if (!form) return;
    setSuccessMessage(null);
    setForm((prev) => {
      if (!prev) return prev;
      const updatedContacts = prev.emergency_contacts.filter((_, i) => i !== index);
      return { ...prev, emergency_contacts: updatedContacts };
    });
  };

  const handleSave = async () => {
    if (!form || !initialForm || !userId || !user) return;

    try {
      setSaving(true);
      setError(null);
      setSuccessMessage(null);

      // Build the profile update with only changed fields
      const profileUpdate: UserProfileUpdate = {};
      let hasProfileChanges = false;

      if (form.first_name !== initialForm.first_name) {
        profileUpdate.first_name = form.first_name;
        hasProfileChanges = true;
      }
      if (form.middle_name !== initialForm.middle_name) {
        profileUpdate.middle_name = form.middle_name;
        hasProfileChanges = true;
      }
      if (form.last_name !== initialForm.last_name) {
        profileUpdate.last_name = form.last_name;
        hasProfileChanges = true;
      }
      if (form.date_of_birth !== initialForm.date_of_birth) {
        profileUpdate.date_of_birth = form.date_of_birth;
        hasProfileChanges = true;
      }
      if (form.personal_email !== initialForm.personal_email) {
        profileUpdate.personal_email = form.personal_email;
        hasProfileChanges = true;
      }
      if (form.membership_number !== initialForm.membership_number) {
        profileUpdate.membership_number = form.membership_number;
        hasProfileChanges = true;
      }
      if (form.rank !== initialForm.rank) {
        profileUpdate.rank = form.rank;
        hasProfileChanges = true;
      }
      if (form.station !== initialForm.station) {
        profileUpdate.station = form.station;
        hasProfileChanges = true;
      }
      if (form.platoon !== initialForm.platoon) {
        profileUpdate.platoon = form.platoon;
        hasProfileChanges = true;
      }
      if (form.hire_date !== initialForm.hire_date) {
        profileUpdate.hire_date = form.hire_date;
        hasProfileChanges = true;
      }
      if (form.phone !== initialForm.phone) {
        profileUpdate.phone = form.phone;
        hasProfileChanges = true;
      }
      if (form.mobile !== initialForm.mobile) {
        profileUpdate.mobile = form.mobile;
        hasProfileChanges = true;
      }
      if (form.address_street !== initialForm.address_street) {
        profileUpdate.address_street = form.address_street;
        hasProfileChanges = true;
      }
      if (form.address_city !== initialForm.address_city) {
        profileUpdate.address_city = form.address_city;
        hasProfileChanges = true;
      }
      if (form.address_state !== initialForm.address_state) {
        profileUpdate.address_state = form.address_state;
        hasProfileChanges = true;
      }
      if (form.address_zip !== initialForm.address_zip) {
        profileUpdate.address_zip = form.address_zip;
        hasProfileChanges = true;
      }
      if (form.address_country !== initialForm.address_country) {
        profileUpdate.address_country = form.address_country;
        hasProfileChanges = true;
      }

      // Check if emergency contacts changed
      const contactsChanged =
        JSON.stringify(form.emergency_contacts) !== JSON.stringify(initialForm.emergency_contacts);
      if (contactsChanged) {
        profileUpdate.emergency_contacts = form.emergency_contacts;
        hasProfileChanges = true;
      }

      // Check if membership_type changed
      const membershipTypeChanged = form.membership_type !== initialForm.membership_type;

      // Check if compliance_exempt changed
      const complianceExemptChanged = form.compliance_exempt !== initialForm.compliance_exempt;

      if (!hasProfileChanges && !membershipTypeChanged && !complianceExemptChanged) {
        setSuccessMessage('No changes to save.');
        return;
      }

      // Save profile fields
      if (hasProfileChanges) {
        await userService.updateUserProfile(userId, profileUpdate);
      }

      // Save membership type separately if changed
      if (membershipTypeChanged && form.membership_type) {
        await userService.changeMembershipType(userId, form.membership_type);
      }

      // Save compliance exemption separately if changed
      if (complianceExemptChanged) {
        await userService.setComplianceExemption(userId, form.compliance_exempt);
      }

      // Re-fetch user to get updated data
      const updatedUser = await userService.getUserWithRoles(userId);
      const extendedUser = updatedUser as UserWithRoles & {
        personal_email?: string;
        membership_type?: string;
        compliance_exempt?: boolean;
      };
      setUser(extendedUser);
      const newFormData = buildInitialForm(extendedUser);
      setForm(newFormData);
      setInitialForm(newFormData);

      setSuccessMessage('Member information saved successfully.');
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { detail?: string }; status?: number } })?.response?.data?.detail;
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 403) {
        setError('You do not have permission to update this member. Contact an administrator.');
      } else {
        setError(detail || 'Unable to save member information. Please try again.');
      }
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    void navigate('/members/admin');
  };

  if (loading) {
    return (
      <div className="min-h-screen">
        <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
          <div className="flex h-64 items-center justify-center">
            <div className="text-theme-text-muted" role="status" aria-live="polite">
              Loading member data...
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!user || !form) {
    return (
      <div className="min-h-screen">
        <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
          <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-4" role="alert" aria-live="assertive">
            <p className="text-sm text-red-700 dark:text-red-400">{error || 'Member not found.'}</p>
            <Link
              to="/members/admin"
              className="mt-2 inline-block text-sm text-blue-700 underline hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
            >
              Back to Members Admin
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const memberDisplayName =
    user.full_name || `${user.first_name || ''} ${user.last_name || ''}`.trim() || user.username;

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-6">
          <Link
            to="/members/admin"
            className="text-theme-text-muted hover:text-theme-text-primary mb-4 inline-flex items-center text-sm"
          >
            <svg className="mr-1 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to Members Admin
          </Link>
          <h1 className="text-theme-text-primary text-2xl font-bold">Edit Member: {memberDisplayName}</h1>
          <p className="text-theme-text-muted mt-1 text-sm">
            @{user.username} &middot; Status: {user.status}
          </p>
        </div>

        {/* Success Message */}
        {successMessage && (
          <div
            className="mb-6 rounded-lg border border-green-500/30 bg-green-500/10 p-4"
            role="status"
            aria-live="polite"
          >
            <p className="text-sm text-green-700 dark:text-green-400">{successMessage}</p>
          </div>
        )}

        {/* Error Message */}
        {error && (
          <div
            className="mb-6 rounded-lg border border-red-500/30 bg-red-500/10 p-4"
            role="alert"
            aria-live="assertive"
          >
            <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
          </div>
        )}

        <div className="space-y-6">
          {/* Personal Information */}
          <div className="bg-theme-surface rounded-lg p-6 shadow-sm backdrop-blur-xs">
            <h2 className="text-theme-text-primary mb-4 text-lg font-semibold">Personal Information</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <label className="text-theme-text-muted mb-1 block text-xs font-medium uppercase">First Name</label>
                <input
                  type="text"
                  value={form.first_name}
                  onChange={(e) => handleFieldChange('first_name', e.target.value)}
                  className="border-theme-surface-border text-theme-text-primary bg-theme-surface-secondary focus:ring-theme-focus-ring w-full rounded-md border px-3 py-2 text-sm focus:ring-2 focus:outline-hidden"
                  disabled={saving}
                />
              </div>
              <div>
                <label className="text-theme-text-muted mb-1 block text-xs font-medium uppercase">Middle Name</label>
                <input
                  type="text"
                  value={form.middle_name}
                  onChange={(e) => handleFieldChange('middle_name', e.target.value)}
                  className="border-theme-surface-border text-theme-text-primary bg-theme-surface-secondary focus:ring-theme-focus-ring w-full rounded-md border px-3 py-2 text-sm focus:ring-2 focus:outline-hidden"
                  disabled={saving}
                />
              </div>
              <div>
                <label className="text-theme-text-muted mb-1 block text-xs font-medium uppercase">Last Name</label>
                <input
                  type="text"
                  value={form.last_name}
                  onChange={(e) => handleFieldChange('last_name', e.target.value)}
                  className="border-theme-surface-border text-theme-text-primary bg-theme-surface-secondary focus:ring-theme-focus-ring w-full rounded-md border px-3 py-2 text-sm focus:ring-2 focus:outline-hidden"
                  disabled={saving}
                />
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="text-theme-text-muted mb-1 block text-xs font-medium uppercase">Date of Birth</label>
                <input
                  type="date"
                  value={form.date_of_birth}
                  onChange={(e) => handleFieldChange('date_of_birth', e.target.value)}
                  className="border-theme-surface-border text-theme-text-primary bg-theme-surface-secondary focus:ring-theme-focus-ring w-full rounded-md border px-3 py-2 text-sm focus:ring-2 focus:outline-hidden"
                  disabled={saving}
                />
                <p className="text-theme-text-muted mt-1 text-xs">
                  This field is typically set once. Changes are logged.
                </p>
              </div>
              <div>
                <label className="text-theme-text-muted mb-1 block text-xs font-medium uppercase">Personal Email</label>
                <input
                  type="email"
                  value={form.personal_email}
                  onChange={(e) => handleFieldChange('personal_email', e.target.value)}
                  className="border-theme-surface-border text-theme-text-primary bg-theme-surface-secondary focus:ring-theme-focus-ring w-full rounded-md border px-3 py-2 text-sm focus:ring-2 focus:outline-hidden"
                  disabled={saving}
                />
              </div>
            </div>
          </div>

          {/* Department Information */}
          <div className="bg-theme-surface rounded-lg p-6 shadow-sm backdrop-blur-xs">
            <h2 className="text-theme-text-primary mb-4 text-lg font-semibold">Department Information</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <label className="text-theme-text-muted mb-1 block text-xs font-medium uppercase">
                  Membership Number
                </label>
                <input
                  type="text"
                  value={form.membership_number}
                  onChange={(e) => handleFieldChange('membership_number', e.target.value)}
                  className="border-theme-surface-border text-theme-text-primary bg-theme-surface-secondary focus:ring-theme-focus-ring w-full rounded-md border px-3 py-2 text-sm focus:ring-2 focus:outline-hidden"
                  disabled={saving}
                />
              </div>
              <div>
                <label className="text-theme-text-muted mb-1 block text-xs font-medium uppercase">Rank</label>
                <select
                  value={form.rank}
                  onChange={(e) => handleFieldChange('rank', e.target.value)}
                  className="border-theme-surface-border text-theme-text-primary bg-theme-surface-secondary focus:ring-theme-focus-ring w-full rounded-md border px-3 py-2 text-sm focus:ring-2 focus:outline-hidden"
                  disabled={saving}
                >
                  <option value="">Select Rank</option>
                  {rankOptions.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-theme-text-muted mb-1 block text-xs font-medium uppercase">Station</label>
                <select
                  value={form.station}
                  onChange={(e) => handleFieldChange('station', e.target.value)}
                  className="border-theme-surface-border text-theme-text-primary bg-theme-surface-secondary focus:ring-theme-focus-ring w-full rounded-md border px-3 py-2 text-sm focus:ring-2 focus:outline-hidden"
                  disabled={saving}
                >
                  <option value="">Select Station</option>
                  {availableStations.map((s) => (
                    <option key={s.id} value={s.name}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="text-theme-text-muted mb-1 block text-xs font-medium uppercase">Platoon</label>
                <input
                  type="text"
                  value={form.platoon}
                  onChange={(e) => handleFieldChange('platoon', e.target.value)}
                  placeholder="e.g. A, B, C"
                  maxLength={20}
                  className="border-theme-surface-border text-theme-text-primary bg-theme-surface-secondary focus:ring-theme-focus-ring w-full rounded-md border px-3 py-2 text-sm focus:ring-2 focus:outline-hidden"
                  disabled={saving}
                />
                <p className="text-theme-text-muted mt-1 text-[11px]">Duty platoon for shift rotations</p>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="text-theme-text-muted mb-1 block text-xs font-medium uppercase">Hire Date</label>
                <input
                  type="date"
                  value={form.hire_date}
                  onChange={(e) => handleFieldChange('hire_date', e.target.value)}
                  className="border-theme-surface-border text-theme-text-primary bg-theme-surface-secondary focus:ring-theme-focus-ring w-full rounded-md border px-3 py-2 text-sm focus:ring-2 focus:outline-hidden"
                  disabled={saving}
                />
                <p className="text-theme-text-muted mt-1 text-xs">
                  This field is typically set once. Changes are logged.
                </p>
              </div>
              <div>
                <label className="text-theme-text-muted mb-1 block text-xs font-medium uppercase">
                  Membership Type
                </label>
                <select
                  value={form.membership_type}
                  onChange={(e) => handleFieldChange('membership_type', e.target.value)}
                  className="border-theme-surface-border text-theme-text-primary bg-theme-surface-secondary focus:ring-theme-focus-ring w-full rounded-md border px-3 py-2 text-sm focus:ring-2 focus:outline-hidden"
                  disabled={saving}
                >
                  <option value="">Select Type</option>
                  {MEMBERSHIP_TYPE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Compliance Exemption */}
            <div className="border-theme-surface-border bg-theme-surface-secondary mt-4 rounded-lg border p-4">
              <label className="flex cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  checked={form.compliance_exempt}
                  onChange={(e) => {
                    if (!form) return;
                    setSuccessMessage(null);
                    setForm((prev) => (prev ? { ...prev, compliance_exempt: e.target.checked } : prev));
                  }}
                  className="form-checkbox border-theme-surface-border mt-0.5"
                  disabled={saving}
                />
                <div>
                  <span className="text-theme-text-primary text-sm font-medium">Exempt from Compliance</span>
                  <p className="text-theme-text-muted mt-1 text-xs">
                    When enabled, this member will not be evaluated against training requirements, shift minimums,
                    admin-hour targets, or certificate maintenance. They will not appear as non-compliant in reports or
                    dashboards. Use for retired, honorary, or other members not required to maintain compliance.
                  </p>
                </div>
              </label>
            </div>
          </div>

          {/* Contact Information */}
          <div className="bg-theme-surface rounded-lg p-6 shadow-sm backdrop-blur-xs">
            <h2 className="text-theme-text-primary mb-4 text-lg font-semibold">Contact Information</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <label className="text-theme-text-muted mb-1 block text-xs font-medium uppercase">
                  Email (Organization)
                </label>
                <input
                  type="email"
                  value={form.email}
                  readOnly
                  className="border-theme-surface-border text-theme-text-muted bg-theme-surface-secondary w-full cursor-not-allowed rounded-md border px-3 py-2 text-sm opacity-75"
                  title="Email is managed through the contact-info endpoint and cannot be changed here."
                />
                <p className="text-theme-text-muted mt-1 text-xs">Managed via organization contact settings.</p>
              </div>
              <div>
                <label className="text-theme-text-muted mb-1 block text-xs font-medium uppercase">Phone</label>
                <input
                  type="tel"
                  value={form.phone}
                  onChange={(e) => handleFieldChange('phone', e.target.value)}
                  className="border-theme-surface-border text-theme-text-primary bg-theme-surface-secondary focus:ring-theme-focus-ring w-full rounded-md border px-3 py-2 text-sm focus:ring-2 focus:outline-hidden"
                  disabled={saving}
                />
              </div>
              <div>
                <label className="text-theme-text-muted mb-1 block text-xs font-medium uppercase">Mobile</label>
                <input
                  type="tel"
                  value={form.mobile}
                  onChange={(e) => handleFieldChange('mobile', e.target.value)}
                  className="border-theme-surface-border text-theme-text-primary bg-theme-surface-secondary focus:ring-theme-focus-ring w-full rounded-md border px-3 py-2 text-sm focus:ring-2 focus:outline-hidden"
                  disabled={saving}
                />
              </div>
            </div>
          </div>

          {/* Address */}
          <div className="bg-theme-surface rounded-lg p-6 shadow-sm backdrop-blur-xs">
            <h2 className="text-theme-text-primary mb-4 text-lg font-semibold">Address</h2>
            <div className="space-y-4">
              <div>
                <label className="text-theme-text-muted mb-1 block text-xs font-medium uppercase">Street Address</label>
                <input
                  type="text"
                  value={form.address_street}
                  onChange={(e) => handleFieldChange('address_street', e.target.value)}
                  className="border-theme-surface-border text-theme-text-primary bg-theme-surface-secondary focus:ring-theme-focus-ring w-full rounded-md border px-3 py-2 text-sm focus:ring-2 focus:outline-hidden"
                  disabled={saving}
                />
              </div>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <div>
                  <label className="text-theme-text-muted mb-1 block text-xs font-medium uppercase">City</label>
                  <input
                    type="text"
                    value={form.address_city}
                    onChange={(e) => handleFieldChange('address_city', e.target.value)}
                    className="border-theme-surface-border text-theme-text-primary bg-theme-surface-secondary focus:ring-theme-focus-ring w-full rounded-md border px-3 py-2 text-sm focus:ring-2 focus:outline-hidden"
                    disabled={saving}
                  />
                </div>
                <div>
                  <label className="text-theme-text-muted mb-1 block text-xs font-medium uppercase">State</label>
                  <input
                    type="text"
                    value={form.address_state}
                    onChange={(e) => handleFieldChange('address_state', e.target.value)}
                    className="border-theme-surface-border text-theme-text-primary bg-theme-surface-secondary focus:ring-theme-focus-ring w-full rounded-md border px-3 py-2 text-sm focus:ring-2 focus:outline-hidden"
                    disabled={saving}
                  />
                </div>
                <div>
                  <label className="text-theme-text-muted mb-1 block text-xs font-medium uppercase">ZIP Code</label>
                  <input
                    type="text"
                    value={form.address_zip}
                    onChange={(e) => handleFieldChange('address_zip', e.target.value)}
                    className="border-theme-surface-border text-theme-text-primary bg-theme-surface-secondary focus:ring-theme-focus-ring w-full rounded-md border px-3 py-2 text-sm focus:ring-2 focus:outline-hidden"
                    disabled={saving}
                  />
                </div>
                <div>
                  <label className="text-theme-text-muted mb-1 block text-xs font-medium uppercase">Country</label>
                  <input
                    type="text"
                    value={form.address_country}
                    onChange={(e) => handleFieldChange('address_country', e.target.value)}
                    className="border-theme-surface-border text-theme-text-primary bg-theme-surface-secondary focus:ring-theme-focus-ring w-full rounded-md border px-3 py-2 text-sm focus:ring-2 focus:outline-hidden"
                    disabled={saving}
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Emergency Contacts */}
          <div className="bg-theme-surface rounded-lg p-6 shadow-sm backdrop-blur-xs">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-theme-text-primary text-lg font-semibold">Emergency Contacts</h2>
              <button
                type="button"
                onClick={handleAddEmergencyContact}
                className="btn-info rounded-md px-3 py-1.5 text-xs font-medium"
                disabled={saving}
              >
                Add Contact
              </button>
            </div>

            {form.emergency_contacts.length === 0 && (
              <p className="text-theme-text-muted text-sm italic">
                No emergency contacts. Click "Add Contact" to add one.
              </p>
            )}

            <div className="space-y-4">
              {form.emergency_contacts.map((contact, index) => (
                <div key={index} className="card-secondary p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <span className="text-theme-text-primary text-sm font-medium">Contact {index + 1}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveEmergencyContact(index)}
                      className="text-xs font-medium text-red-700 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300"
                      disabled={saving}
                    >
                      Remove
                    </button>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <label className="text-theme-text-muted mb-1 block text-xs font-medium uppercase">Name</label>
                      <input
                        type="text"
                        value={contact.name}
                        onChange={(e) => handleEmergencyContactChange(index, 'name', e.target.value)}
                        className="border-theme-surface-border text-theme-text-primary bg-theme-surface focus:ring-theme-focus-ring w-full rounded-md border px-3 py-2 text-sm focus:ring-2 focus:outline-hidden"
                        disabled={saving}
                      />
                    </div>
                    <div>
                      <label className="text-theme-text-muted mb-1 block text-xs font-medium uppercase">
                        Relationship
                      </label>
                      <input
                        type="text"
                        value={contact.relationship}
                        onChange={(e) => handleEmergencyContactChange(index, 'relationship', e.target.value)}
                        className="border-theme-surface-border text-theme-text-primary bg-theme-surface focus:ring-theme-focus-ring w-full rounded-md border px-3 py-2 text-sm focus:ring-2 focus:outline-hidden"
                        disabled={saving}
                      />
                    </div>
                    <div>
                      <label className="text-theme-text-muted mb-1 block text-xs font-medium uppercase">Phone</label>
                      <input
                        type="tel"
                        value={contact.phone}
                        onChange={(e) => handleEmergencyContactChange(index, 'phone', e.target.value)}
                        className="border-theme-surface-border text-theme-text-primary bg-theme-surface focus:ring-theme-focus-ring w-full rounded-md border px-3 py-2 text-sm focus:ring-2 focus:outline-hidden"
                        disabled={saving}
                      />
                    </div>
                    <div>
                      <label className="text-theme-text-muted mb-1 block text-xs font-medium uppercase">Email</label>
                      <input
                        type="email"
                        value={contact.email || ''}
                        onChange={(e) => handleEmergencyContactChange(index, 'email', e.target.value)}
                        className="border-theme-surface-border text-theme-text-primary bg-theme-surface focus:ring-theme-focus-ring w-full rounded-md border px-3 py-2 text-sm focus:ring-2 focus:outline-hidden"
                        disabled={saving}
                      />
                    </div>
                  </div>
                  <div className="mt-3">
                    <label className="flex cursor-pointer items-center gap-2">
                      <input
                        type="checkbox"
                        checked={contact.is_primary}
                        onChange={(e) => handleEmergencyContactChange(index, 'is_primary', e.target.checked)}
                        className="form-checkbox border-theme-surface-border"
                        disabled={saving}
                      />
                      <span className="text-theme-text-secondary text-sm">Primary contact</span>
                    </label>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div className="bg-theme-surface rounded-lg p-6 shadow-sm backdrop-blur-xs">
            <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
              <div>
                <Link
                  to={`/members/admin/history/${userId}`}
                  className="text-sm text-blue-700 underline hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300"
                >
                  View History
                </Link>
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleCancel}
                  className="bg-theme-surface text-theme-text-secondary border-theme-surface-border hover:bg-theme-surface-hover rounded-md border px-4 py-2 text-sm font-medium"
                  disabled={saving}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void handleSave();
                  }}
                  className="btn-info rounded-md text-sm font-medium"
                  disabled={saving}
                >
                  {saving ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default MemberAdminEditPage;
