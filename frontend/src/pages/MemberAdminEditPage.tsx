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
import { ADMINISTRATIVE_RANK_HINT, canonicalMemberStatus, effectiveMemberClass } from '../utils/membership';
import { blankToNull } from '../utils/formValues';
import { formatMemberName } from '../utils/memberName';
import { getErrorMessage } from '../utils/errorHandling';
import { Breadcrumbs } from '../components/ux';
import { MemberClassificationFields } from '../components/members/MemberClassificationFields';
import { useMembershipTierOptions } from '../hooks/useMembershipTierOptions';
import { MemberClass, MemberStatus } from '../constants/enums';
import { FormField } from '../components/ux/FormField';
import { useDiscardGuard } from '../hooks/useDiscardGuard';
import { mapServerFieldErrors, type ServerFieldSpec } from '../utils/serverFieldErrors';

interface FormData {
  first_name: string;
  middle_name: string;
  last_name: string;
  preferred_name: string;
  date_of_birth: string;
  personal_email: string;
  membership_number: string;
  rank: string;
  station: string;
  platoon: string;
  hire_date: string;
  member_class: string;
  member_status: string;
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
    preferred_name: user.preferred_name || '',
    date_of_birth: user.date_of_birth || '',
    personal_email: user.personal_email || '',
    membership_number: user.membership_number || '',
    rank: user.rank || '',
    station: user.station || '',
    platoon: user.platoon || '',
    hire_date: user.hire_date || '',
    // The pair, derived from the legacy value for a row written before it
    // existed. A member on a department tier whose class was never recorded
    // reads as operational here and is written as such on save -- an officer
    // opening this page to set the class is the intended way out.
    member_class: effectiveMemberClass(user.member_class, user.membership_type) ?? MemberClass.OPERATIONAL,
    member_status:
      canonicalMemberStatus(user.member_status) ?? canonicalMemberStatus(user.membership_type) ?? MemberStatus.REGULAR,
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

type TextField =
  | 'first_name'
  | 'middle_name'
  | 'last_name'
  | 'preferred_name'
  | 'date_of_birth'
  | 'personal_email'
  | 'membership_number'
  | 'rank'
  | 'station'
  | 'platoon'
  | 'hire_date'
  | 'phone'
  | 'mobile'
  | 'address_street'
  | 'address_city'
  | 'address_state'
  | 'address_zip'
  | 'address_country';

// Labels and limits from UserUpdate and EmergencyContact
// (backend/app/schemas/user.py), which PATCH /users/{id}/profile validates.
const PROFILE_FIELDS: Record<TextField, ServerFieldSpec & { id: string }> = {
  first_name: { label: 'First name', maxLength: 100, id: 'member-first-name' },
  middle_name: { label: 'Middle name', maxLength: 100, id: 'member-middle-name' },
  last_name: { label: 'Last name', maxLength: 100, id: 'member-last-name' },
  preferred_name: { label: 'Preferred name', maxLength: 100, id: 'member-preferred-name' },
  date_of_birth: { label: 'Date of birth', id: 'member-date-of-birth' },
  personal_email: { label: 'Personal email', maxLength: 255, id: 'member-personal-email' },
  membership_number: { label: 'Membership number', maxLength: 50, id: 'member-membership-number' },
  rank: { label: 'Rank', maxLength: 100, id: 'member-rank' },
  station: { label: 'Station', maxLength: 100, id: 'member-station' },
  platoon: { label: 'Platoon', maxLength: 20, id: 'member-platoon' },
  hire_date: { label: 'Hire date', id: 'member-hire-date' },
  phone: { label: 'Phone', maxLength: 20, id: 'member-phone' },
  mobile: { label: 'Mobile', maxLength: 20, id: 'member-mobile' },
  address_street: { label: 'Street address', maxLength: 255, id: 'member-address-street' },
  address_city: { label: 'City', maxLength: 100, id: 'member-address-city' },
  address_state: { label: 'State', maxLength: 50, id: 'member-address-state' },
  address_zip: { label: 'ZIP code', maxLength: 20, id: 'member-address-zip' },
  address_country: { label: 'Country', maxLength: 100, id: 'member-address-country' },
};
const TEXT_FIELDS = Object.keys(PROFILE_FIELDS) as TextField[];

type ContactField = 'name' | 'relationship' | 'phone' | 'email';
const CONTACT_FIELDS: Record<ContactField, ServerFieldSpec> = {
  name: { label: 'Name', maxLength: 100 },
  relationship: { label: 'Relationship', maxLength: 50 },
  phone: { label: 'Phone', maxLength: 20 },
  email: { label: 'Email' },
};
const contactKey = (index: number, field: ContactField) => `contact-${index}-${field}`;

const LABEL_CLASS = 'text-theme-text-muted mb-1 block text-xs font-medium uppercase';
const INPUT_CLASS = 'form-input bg-theme-surface-secondary px-3 text-sm';

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
  // Keyed by profile field name, or by `contact-<index>-<field>` for a contact.
  const [fieldErrors, setFieldErrors] = useState<Record<string, string | undefined>>({});
  const clearFieldError = (key: string) => setFieldErrors((prev) => (prev[key] ? { ...prev, [key]: undefined } : prev));

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
      setError(getErrorMessage(err, 'Unable to load member data. Try again.'));
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

  // An administrative member holds no operational rank — the server refuses the
  // pair, and a rank carries its own default permissions besides.
  //
  // The control is disabled and nothing more. Clearing `form.rank` here as well
  // looked tidier and loses data: this page saves in two requests, and the
  // cleared rank would go out in the profile PATCH *before* the membership-type
  // PATCH that justifies it. That second request can legitimately fail — it
  // rejects a tier the organization has not configured, and the default tier
  // list has no `administrative` entry — leaving the member operational and
  // permanently stripped of the rank nobody agreed to remove.
  //
  // Untouched, `form.rank` still equals `initialForm.rank`, so `handleSave`
  // omits it entirely and the rank survives a failed class change. On success
  // the membership-type endpoint clears it in the same transaction, and the
  // re-fetch below brings the cleared value back.
  const isAdministrative = form?.member_class === MemberClass.ADMINISTRATIVE;
  const { tiers } = useMembershipTierOptions();

  const handleFieldChange = (field: keyof Omit<FormData, 'emergency_contacts'>, value: string) => {
    if (!form) return;
    setSuccessMessage(null);
    clearFieldError(field);
    setForm((prev) => (prev ? { ...prev, [field]: value } : prev));
  };

  const handleEmergencyContactChange = (index: number, field: keyof EmergencyContact, value: string | boolean) => {
    if (!form) return;
    setSuccessMessage(null);
    clearFieldError(contactKey(index, field as ContactField));
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
    // The indexes shift, so a flag would land on the wrong contact.
    setFieldErrors((prev) => Object.fromEntries(Object.entries(prev).filter(([key]) => !key.startsWith('contact-'))));
  };

  const handleSave = async () => {
    if (!form || !initialForm || !userId || !user) return;

    try {
      setSaving(true);
      setError(null);
      setSuccessMessage(null);
      setFieldErrors({});
      // Single-save rule (owner, 2026-11-05): what the member record cannot
      // hold is left out, everything else saves, and each refused field keeps
      // the stored value on the server and its flag here until it is fixed.
      const refused: Record<string, string> = {};
      let contactMessage: string | undefined;

      // Build the profile update with only changed fields
      const profileUpdate: UserProfileUpdate = {};
      let hasProfileChanges = false;

      // A blank legal name is left out rather than sent: the server refuses
      // one, an omitted key keeps the stored name, and the rest still saves
      // (owner rule 2026-11-05: save with an error, flag it until resolved).
      const firstName = form.first_name.trim();
      const lastName = form.last_name.trim();
      const blankedNames: string[] = [];
      if (form.first_name !== initialForm.first_name) {
        if (firstName) profileUpdate.first_name = firstName;
        else blankedNames.push('first name');
        hasProfileChanges = true;
      }
      // Optional text goes through blankToNull, like the dates below: an
      // update is dumped with exclude_unset, so '' would be stored as an
      // empty string rather than cleared (workflow re-check MR-5).
      if (form.middle_name !== initialForm.middle_name) {
        profileUpdate.middle_name = blankToNull(form.middle_name);
        hasProfileChanges = true;
      }
      if (form.last_name !== initialForm.last_name) {
        if (lastName) profileUpdate.last_name = lastName;
        else blankedNames.push('last name');
        hasProfileChanges = true;
      }
      if (form.preferred_name !== initialForm.preferred_name) {
        profileUpdate.preferred_name = blankToNull(form.preferred_name);
        hasProfileChanges = true;
      }
      if (form.date_of_birth !== initialForm.date_of_birth) {
        // `null`, not `''`: the browser's clear affordance on a date input
        // yields an empty string, which `Optional[date]` rejects with a 422 —
        // so the field could never be cleared, and the 422's array-shaped
        // `detail` then took the page down (see the catch below).
        profileUpdate.date_of_birth = blankToNull(form.date_of_birth);
        hasProfileChanges = true;
      }
      if (form.personal_email !== initialForm.personal_email) {
        profileUpdate.personal_email = blankToNull(form.personal_email);
        hasProfileChanges = true;
      }
      if (form.membership_number !== initialForm.membership_number) {
        profileUpdate.membership_number = blankToNull(form.membership_number);
        hasProfileChanges = true;
      }
      if (form.rank !== initialForm.rank) {
        profileUpdate.rank = form.rank;
        hasProfileChanges = true;
      }
      if (form.station !== initialForm.station) {
        profileUpdate.station = blankToNull(form.station);
        hasProfileChanges = true;
      }
      if (form.platoon !== initialForm.platoon) {
        profileUpdate.platoon = blankToNull(form.platoon);
        hasProfileChanges = true;
      }
      if (form.hire_date !== initialForm.hire_date) {
        profileUpdate.hire_date = blankToNull(form.hire_date);
        hasProfileChanges = true;
      }
      if (form.phone !== initialForm.phone) {
        profileUpdate.phone = blankToNull(form.phone);
        hasProfileChanges = true;
      }
      if (form.mobile !== initialForm.mobile) {
        profileUpdate.mobile = blankToNull(form.mobile);
        hasProfileChanges = true;
      }
      if (form.address_street !== initialForm.address_street) {
        profileUpdate.address_street = blankToNull(form.address_street);
        hasProfileChanges = true;
      }
      if (form.address_city !== initialForm.address_city) {
        profileUpdate.address_city = blankToNull(form.address_city);
        hasProfileChanges = true;
      }
      if (form.address_state !== initialForm.address_state) {
        profileUpdate.address_state = blankToNull(form.address_state);
        hasProfileChanges = true;
      }
      if (form.address_zip !== initialForm.address_zip) {
        profileUpdate.address_zip = blankToNull(form.address_zip);
        hasProfileChanges = true;
      }
      if (form.address_country !== initialForm.address_country) {
        profileUpdate.address_country = blankToNull(form.address_country);
        hasProfileChanges = true;
      }

      // Check if emergency contacts changed
      const contactsChanged =
        JSON.stringify(form.emergency_contacts) !== JSON.stringify(initialForm.emergency_contacts);
      if (contactsChanged) {
        // `EmergencyContact` requires a name and relationship and types the
        // email as `EmailStr | None`, so an untouched Email box (`''`) was a
        // 422 that discarded the whole save. Blank emails are omitted, and
        // the two required fields are checked here, before anything is sent.
        const contacts = form.emergency_contacts.map((c) => ({
          name: c.name.trim(),
          relationship: c.relationship.trim(),
          phone: c.phone.trim(),
          email: c.email?.trim() || undefined,
          is_primary: c.is_primary,
        }));
        const incomplete = contacts.findIndex((c) => !c.name || !c.relationship);
        if (incomplete >= 0) {
          // The list is one value on the server, so it is left out whole and
          // the stored contacts are kept until this one is complete.
          contactMessage = `Emergency contact ${incomplete + 1} needs a name and a relationship.`;
          contacts.forEach((c, i) => {
            if (!c.name) refused[contactKey(i, 'name')] = 'Enter a name.';
            if (!c.relationship) refused[contactKey(i, 'relationship')] = 'Enter a relationship.';
          });
        } else {
          profileUpdate.emergency_contacts = contacts;
          hasProfileChanges = true;
        }
      }

      // Class and status travel together, always both: the backend reads a
      // write to either as a statement about the pair, and a status sent
      // alone against a member on a department tier would have it invent a
      // class. One request with the rest of the profile, so a refused pair
      // (an unknown tier) leaves the rank and everything else untouched too.
      const classificationChanged =
        form.member_class !== initialForm.member_class || form.member_status !== initialForm.member_status;
      if (classificationChanged) {
        profileUpdate.member_class = form.member_class as MemberClass;
        profileUpdate.member_status = form.member_status;
        hasProfileChanges = true;
      }

      // Check if compliance_exempt changed
      const complianceExemptChanged = form.compliance_exempt !== initialForm.compliance_exempt;

      if (!hasProfileChanges && !complianceExemptChanged) {
        if (Object.keys(refused).length > 0) {
          showRefused(refused, form.emergency_contacts.length, false, contactMessage);
        } else {
          setSuccessMessage('No changes to save.');
        }
        return;
      }

      // Save profile fields
      if (hasProfileChanges) {
        try {
          await userService.updateUserProfile(userId, profileUpdate);
        } catch (err: unknown) {
          const specs = profileFieldSpecs(form.emergency_contacts.length);
          const mapped = mapServerFieldErrors(err, specs);
          const keys = mapped ? Object.keys(mapped.fieldErrors) : [];
          // A refusal the page has no field for fails the save as before.
          if (!mapped || keys.length === 0 || mapped.unmatched.length > 0) throw err;
          Object.assign(refused, mapped.fieldErrors);
          const rest: Record<string, unknown> = { ...profileUpdate };
          for (const key of keys) delete rest[key.startsWith('contact-') ? 'emergency_contacts' : key];
          if (Object.keys(rest).length > 0) await userService.updateUserProfile(userId, rest);
        }
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
      // A refused field keeps what was typed, so it can be corrected, while
      // the baseline is what was stored; the page stays changed until it is.
      const shown: FormData = { ...newFormData };
      for (const key of TEXT_FIELDS) if (refused[key] !== undefined) shown[key] = form[key];
      if (Object.keys(refused).some((key) => key.startsWith('contact-'))) {
        shown.emergency_contacts = form.emergency_contacts;
      }
      setForm(shown);
      setInitialForm(newFormData);

      if (Object.keys(refused).length > 0) {
        showRefused(refused, form.emergency_contacts.length, true, contactMessage);
        return;
      }

      const missing = [
        ...(newFormData.first_name.trim() ? [] : ['first name']),
        ...(newFormData.last_name.trim() ? [] : ['last name']),
      ];
      const kept = blankedNames.filter((n) => !missing.includes(n));
      if (missing.length) {
        setSuccessMessage(
          `Member information saved. This member's ${missing.join(' and ')} ${missing.length > 1 ? 'are' : 'is'} still missing.`
        );
      } else if (kept.length) {
        setSuccessMessage(
          `Member information saved. A name can't be blank, so the saved ${kept.join(' and ')} ${kept.length > 1 ? 'were' : 'was'} kept.`
        );
      } else {
        setSuccessMessage('Member information saved.');
      }
    } catch (err: unknown) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      if (status === 403) {
        setError('You do not have permission to update this member. Contact an administrator.');
      } else {
        // Through `getErrorMessage`, which flattens a 422's array-shaped
        // `detail` into a sentence. Assigning it straight to state typed
        // `string | null` put an array in the JSX, and React threw "Objects
        // are not valid as a React child" — the ErrorBoundary replaced the
        // whole page with the error screen instead of showing the message.
        setError(getErrorMessage(err, 'Unable to save member information. Try again.'));
      }
    } finally {
      setSaving(false);
    }
  };

  const profileFieldSpecs = (contactCount: number): Record<string, ServerFieldSpec> => {
    const specs: Record<string, ServerFieldSpec> = {};
    for (const key of TEXT_FIELDS)
      specs[key] = { label: PROFILE_FIELDS[key].label, maxLength: PROFILE_FIELDS[key].maxLength, api: key };
    for (let i = 0; i < contactCount; i += 1) {
      for (const field of Object.keys(CONTACT_FIELDS) as ContactField[]) {
        specs[contactKey(i, field)] = { ...CONTACT_FIELDS[field], api: `emergency_contacts.${i}.${field}` };
      }
    }
    return specs;
  };

  const showRefused = (refused: Record<string, string>, contactCount: number, savedRest: boolean, message?: string) => {
    setFieldErrors(refused);
    const order = [
      ...TEXT_FIELDS,
      ...Array.from({ length: contactCount }, (_, i) =>
        (Object.keys(CONTACT_FIELDS) as ContactField[]).map((f) => contactKey(i, f))
      ).flat(),
    ];
    const first = order.find((key) => refused[key]);
    const contact = /^contact-(\d+)-/.exec(first ?? '');
    setError(
      message ??
        (contact
          ? `Emergency contact ${Number(contact[1]) + 1} was not saved. Fix the flagged field and save again.`
          : `${PROFILE_FIELDS[first as TextField]?.label ?? 'One field'} was not saved. Fix it and save again.`)
    );
    if (savedRest) setSuccessMessage('The rest of the member information was saved.');
    if (first) document.getElementById(PROFILE_FIELDS[first as TextField]?.id ?? first)?.focus();
  };

  const isDirty = form !== null && initialForm !== null && JSON.stringify(form) !== JSON.stringify(initialForm);
  // Cancel leaves the page, which throws away what was typed into it.
  const handleCancel = useDiscardGuard({
    isDirty,
    onClose: () => {
      void navigate('/members/admin');
    },
  });

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
            <p className="text-sm text-red-800 dark:text-red-300">{error || 'Member not found.'}</p>
            <Link
              to="/members/admin"
              className="mt-2 inline-block text-sm text-blue-800 underline hover:text-blue-900 dark:text-blue-400 dark:hover:text-blue-300"
            >
              Back to Members Administration
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const memberDisplayName = formatMemberName(user) || user.username;

  // Every text, date, email and phone box on the page is the same shape.
  // Autofill is off: the person filling this in is an officer editing someone
  // else's record, and the browser would offer the officer's own details.
  const textField = (
    key: TextField,
    label: string,
    opts: {
      type?: 'text' | 'email' | 'tel' | 'date';
      required?: boolean;
      hint?: React.ReactNode;
      placeholder?: string;
      className?: string;
    } = {}
  ) => {
    const value = form[key];
    const blankRequired = opts.required && !value.trim() ? `Enter a ${label.toLowerCase()}.` : undefined;
    return (
      <FormField
        label={label}
        id={PROFILE_FIELDS[key].id}
        required={opts.required}
        error={fieldErrors[key] ?? blankRequired}
        hint={opts.hint}
        maxLength={opts.type === 'date' ? undefined : PROFILE_FIELDS[key].maxLength}
        count={value.length}
        labelClassName={LABEL_CLASS}
        className={opts.className}
      >
        {(field) => (
          <input
            {...field}
            type={opts.type ?? 'text'}
            autoComplete="off"
            value={value}
            onChange={(e) => handleFieldChange(key, e.target.value)}
            placeholder={opts.placeholder}
            className={INPUT_CLASS}
            disabled={saving}
          />
        )}
      </FormField>
    );
  };

  return (
    <div className="min-h-screen">
      <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
        <Breadcrumbs />

        {/* Header */}
        <div className="mb-6">
          <Link
            to="/members/admin"
            className="text-theme-text-muted hover:text-theme-text-primary touch-target-phone mb-4 inline-flex items-center text-sm"
          >
            <svg className="mr-1 h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Back to Members Administration
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
            <p className="text-sm text-red-800 dark:text-red-300">{error}</p>
          </div>
        )}

        <form
          className="space-y-6"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void handleSave();
          }}
        >
          {/* Personal Information */}
          <div className="card p-6">
            <h2 className="text-theme-text-primary mb-4 text-lg font-semibold">Personal Information</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              {textField('first_name', 'First Name', { required: true })}
              {textField('middle_name', 'Middle Name')}
              {textField('last_name', 'Last Name', { required: true })}
            </div>

            {textField('preferred_name', 'Preferred Name', {
              className: 'mt-4 sm:max-w-sm',
              hint: 'Shown in place of the first name on shifts, events and rosters. Reports and official records keep the legal first name.',
            })}

            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              {textField('date_of_birth', 'Date of Birth', {
                type: 'date',
                hint: 'This field is typically set once. Changes are logged.',
              })}
              {textField('personal_email', 'Personal Email', { type: 'email' })}
            </div>
          </div>

          {/* Department Information */}
          <div className="card p-6">
            <h2 className="text-theme-text-primary mb-4 text-lg font-semibold">Department Information</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              {textField('membership_number', 'Membership Number')}
              <FormField
                label="Rank"
                id={PROFILE_FIELDS.rank.id}
                error={fieldErrors.rank}
                hint={isAdministrative ? ADMINISTRATIVE_RANK_HINT : undefined}
                labelClassName={LABEL_CLASS}
              >
                {(field) => (
                  <select
                    {...field}
                    value={form.rank}
                    onChange={(e) => handleFieldChange('rank', e.target.value)}
                    className={INPUT_CLASS}
                    disabled={saving || isAdministrative}
                  >
                    <option value="">Select Rank</option>
                    {rankOptions.map((r) => (
                      <option key={r.value} value={r.value}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                )}
              </FormField>
              <FormField
                label="Station"
                id={PROFILE_FIELDS.station.id}
                error={fieldErrors.station}
                labelClassName={LABEL_CLASS}
              >
                {(field) => (
                  <select
                    {...field}
                    value={form.station}
                    onChange={(e) => handleFieldChange('station', e.target.value)}
                    className={INPUT_CLASS}
                    disabled={saving}
                  >
                    <option value="">Select Station</option>
                    {availableStations.map((s) => (
                      <option key={s.id} value={s.name}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                )}
              </FormField>
              {textField('platoon', 'Platoon', {
                placeholder: 'e.g. A, B, C',
                hint: 'Duty platoon for shift rotations',
              })}
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              {textField('hire_date', 'Hire Date', {
                type: 'date',
                hint: 'This field is typically set once. Changes are logged.',
              })}
              <MemberClassificationFields
                idPrefix="edit"
                memberClass={form.member_class}
                memberStatus={form.member_status}
                onClassChange={(value) => {
                  handleFieldChange('member_class', value);
                  // The server clears a stranded rank on a move to
                  // administrative; mirror it so the form shows what will
                  // be saved rather than a disabled control holding a value.
                  if (value === MemberClass.ADMINISTRATIVE) handleFieldChange('rank', '');
                }}
                onStatusChange={(value) => handleFieldChange('member_status', value)}
                tiers={tiers}
                currentStatus={form.member_status}
                disabled={saving}
                labelClassName="text-theme-text-muted mb-1 block text-xs font-medium uppercase"
                selectClassName="form-input bg-theme-surface-secondary px-3 text-sm"
              />
            </div>

            {/* Compliance Exemption */}
            <div className="card-secondary mt-4 p-4">
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
                    This member is not checked against training requirements, shift minimums, admin-hour targets or
                    certificate maintenance, and does not appear as non-compliant in reports or dashboards. Use for
                    retired, honorary or other members who do not need to stay compliant.
                  </p>
                </div>
              </label>
            </div>
          </div>

          {/* Contact Information */}
          <div className="card p-6">
            <h2 className="text-theme-text-primary mb-4 text-lg font-semibold">Contact Information</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <FormField
                label="Email (Organization)"
                id="member-email"
                hint="Change this from Contact Information on the member's profile."
                labelClassName={LABEL_CLASS}
              >
                {(field) => (
                  <input
                    {...field}
                    type="email"
                    value={form.email}
                    readOnly
                    className="form-input text-theme-text-muted bg-theme-surface-secondary cursor-not-allowed px-3 text-sm"
                    title="Change this email from Contact Information on the member's profile."
                  />
                )}
              </FormField>
              {textField('phone', 'Phone', { type: 'tel' })}
              {textField('mobile', 'Mobile', { type: 'tel' })}
            </div>
          </div>

          {/* Address */}
          <div className="card p-6">
            <h2 className="text-theme-text-primary mb-4 text-lg font-semibold">Address</h2>
            <div className="space-y-4">
              {textField('address_street', 'Street Address')}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
                {textField('address_city', 'City')}
                {textField('address_state', 'State')}
                {textField('address_zip', 'ZIP Code')}
                {textField('address_country', 'Country')}
              </div>
            </div>
          </div>

          {/* Emergency Contacts */}
          <div className="card p-6">
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
                No emergency contacts yet. Select Add Contact to add one.
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
                      className="touch-target-phone text-xs font-medium text-red-800 hover:text-red-900 dark:text-red-300 dark:hover:text-red-200"
                      disabled={saving}
                    >
                      Remove
                    </button>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {(
                      [
                        ['name', 'Name', 'text'],
                        ['relationship', 'Relationship', 'text'],
                        ['phone', 'Phone', 'tel'],
                        ['email', 'Email', 'email'],
                      ] as const
                    ).map(([field, label, type]) => {
                      const value = (field === 'email' ? contact.email : contact[field]) || '';
                      return (
                        <FormField
                          key={field}
                          label={label}
                          id={contactKey(index, field)}
                          required={field === 'name' || field === 'relationship'}
                          error={fieldErrors[contactKey(index, field)]}
                          maxLength={CONTACT_FIELDS[field].maxLength}
                          count={value.length}
                          labelClassName={LABEL_CLASS}
                        >
                          {(control) => (
                            <input
                              {...control}
                              type={type}
                              autoComplete="off"
                              value={value}
                              onChange={(e) => handleEmergencyContactChange(index, field, e.target.value)}
                              className="form-input px-3 text-sm"
                              disabled={saving}
                            />
                          )}
                        </FormField>
                      );
                    })}
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
          <div className="card p-6">
            <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
              <div>
                <Link
                  to={`/members/admin/history/${userId}`}
                  className="touch-target-phone inline-flex items-center text-sm text-blue-800 underline hover:text-blue-900 dark:text-blue-400 dark:hover:text-blue-300"
                >
                  View History
                </Link>
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleCancel}
                  className="btn-secondary text-theme-text-secondary text-sm font-medium"
                  disabled={saving}
                >
                  Cancel
                </button>
                <button type="submit" className="btn-info rounded-md text-sm font-medium" disabled={saving}>
                  {saving ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};

export default MemberAdminEditPage;
