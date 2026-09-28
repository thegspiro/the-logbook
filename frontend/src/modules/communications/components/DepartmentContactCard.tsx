/**
 * Department Contact Card
 *
 * The phone, email, website and mailing address that footers print, editable
 * where the footers are chosen. These are the organization's own values — the
 * same ones Organization settings > Contact and Addresses edit — not a copy
 * kept for email, so a change here reaches every footer, every template using
 * {{organization_phone}} and friends, and the settings page at once.
 *
 * Saved through `PATCH /organization/profile` with only these keys, so a stale
 * name or logo held by this screen can never be written back over a newer one.
 * That endpoint requires `settings.manage`; the footer screen also admits
 * `organization.update_settings`, so a user holding only that sees the values
 * read-only rather than a form whose save would be refused.
 */

import React, { useEffect, useState } from 'react';
import { Building2, Loader2, RotateCcw, Save } from 'lucide-react';
import toast from 'react-hot-toast';
import { organizationService } from '../../../services/api';
import type { OrganizationProfile } from '../../../services/api';
import { useAuthStore } from '../../../stores/authStore';
import { getErrorMessage } from '../../../utils/errorHandling';
import { blankToNull } from '../../../utils/formValues';

interface ContactForm {
  phone: string;
  email: string;
  website: string;
  line1: string;
  line2: string;
  city: string;
  state: string;
  zip: string;
}

const EMPTY_FORM: ContactForm = {
  phone: '',
  email: '',
  website: '',
  line1: '',
  line2: '',
  city: '',
  state: '',
  zip: '',
};

// Deliberately loose: the point is to catch a typo like a missing "@", not to
// out-guess what a mail server will accept.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function formFromProfile(profile: OrganizationProfile): ContactForm {
  return {
    phone: profile.phone,
    email: profile.email,
    website: profile.website,
    line1: profile.mailing_address.line1,
    line2: profile.mailing_address.line2,
    city: profile.mailing_address.city,
    state: profile.mailing_address.state,
    zip: profile.mailing_address.zip,
  };
}

interface FieldProps {
  id: string;
  label: string;
  value: string;
  maxLength: number;
  disabled: boolean;
  onChange: (value: string) => void;
  type?: 'text' | 'email' | 'tel' | 'url';
  error?: string | null;
  autoComplete?: string;
  className?: string;
}

const Field: React.FC<FieldProps> = ({
  id,
  label,
  value,
  maxLength,
  disabled,
  onChange,
  type = 'text',
  error = null,
  autoComplete,
  className = '',
}) => (
  <div className={className}>
    <label className="form-label" htmlFor={id}>
      {label}
    </label>
    <input
      id={id}
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`form-input ${error ? 'border-red-500' : ''}`}
      maxLength={maxLength}
      disabled={disabled}
      autoComplete={autoComplete}
      aria-invalid={!!error}
      aria-describedby={error ? `${id}-error` : undefined}
    />
    {error && (
      <p id={`${id}-error`} className="mt-1 text-xs text-red-500">
        {error}
      </p>
    )}
  </div>
);

interface DepartmentContactCardProps {
  /** Called after a successful save, so the footer previews can re-read. */
  onSaved: () => Promise<void> | void;
}

const DepartmentContactCard: React.FC<DepartmentContactCardProps> = ({ onSaved }) => {
  const canEdit = useAuthStore((s) => s.checkPermission)('settings.manage');
  const [saved, setSaved] = useState<ContactForm>(EMPTY_FORM);
  const [form, setForm] = useState<ContactForm>(EMPTY_FORM);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    organizationService
      .getProfile()
      .then((profile) => {
        if (cancelled) return;
        const loaded = formFromProfile(profile);
        setSaved(loaded);
        setForm(loaded);
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(getErrorMessage(err, 'Could not load the department contact details.'));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const set = (key: keyof ContactForm) => (value: string) => setForm((prev) => ({ ...prev, [key]: value }));

  const emailError =
    form.email.trim() && !EMAIL_PATTERN.test(form.email.trim())
      ? 'Enter an email address like office@example.org.'
      : null;
  const isDirty = JSON.stringify(form) !== JSON.stringify(saved);

  const handleSave = async () => {
    if (emailError) return;
    setIsSaving(true);
    try {
      // Every field is sent, cleared ones as null: an omitted key would leave
      // the old value in place behind a success toast (CLAUDE.md pitfall 1).
      const updated = await organizationService.updateContactDetails({
        phone: blankToNull(form.phone),
        email: blankToNull(form.email),
        website: blankToNull(form.website),
        mailing_address: {
          line1: blankToNull(form.line1),
          line2: blankToNull(form.line2),
          city: blankToNull(form.city),
          state: blankToNull(form.state),
          zip: blankToNull(form.zip),
        },
      });
      const next = formFromProfile(updated);
      setSaved(next);
      setForm(next);
      toast.success('Contact details saved');
      await onSaved();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to save the contact details'));
    } finally {
      setIsSaving(false);
    }
  };

  const disabled = !canEdit || isSaving;

  return (
    <section className="card space-y-4 p-4" aria-labelledby="department-contact-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl">
          <h3
            id="department-contact-heading"
            className="text-theme-text-primary flex items-center gap-2 text-base font-semibold"
          >
            <Building2 className="h-4 w-4" aria-hidden="true" />
            Department contact details
          </h3>
          <p className="text-theme-text-muted mt-1 text-sm">
            What the footers below print when their contact boxes are ticked. These are your department&apos;s own
            details, so changing them here also changes them in Organization settings and anywhere else they appear.
          </p>
        </div>
        {canEdit && !isLoading && !loadError && (
          <div className="flex items-center gap-2">
            {isDirty && (
              <button
                type="button"
                onClick={() => setForm(saved)}
                disabled={isSaving}
                className="border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-hover flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm transition-colors disabled:opacity-50"
              >
                <RotateCcw className="h-4 w-4" aria-hidden="true" />
                Discard
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                void handleSave();
              }}
              disabled={!isDirty || isSaving || !!emailError}
              className="btn-primary flex items-center gap-2 disabled:cursor-not-allowed"
            >
              {isSaving ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Save className="h-4 w-4" aria-hidden="true" />
              )}
              Save contact details
            </button>
          </div>
        )}
      </div>

      {isLoading ? (
        <p className="text-theme-text-muted flex items-center gap-2 text-sm" aria-live="polite">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Loading contact details…
        </p>
      ) : loadError ? (
        <p className="alert-error text-sm" role="alert">
          {loadError}
        </p>
      ) : (
        <>
          {!canEdit && (
            <p className="text-theme-text-muted text-xs" role="status">
              Changing these needs the Organization settings permission. Ask an administrator who has it.
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-3">
            <Field
              id="dept-phone"
              label="Phone"
              type="tel"
              value={form.phone}
              maxLength={20}
              disabled={disabled}
              onChange={set('phone')}
              autoComplete="tel"
            />
            <Field
              id="dept-email"
              label="Email"
              type="email"
              value={form.email}
              maxLength={255}
              disabled={disabled}
              onChange={set('email')}
              error={emailError}
              autoComplete="email"
            />
            <Field
              id="dept-website"
              label="Website"
              type="url"
              value={form.website}
              maxLength={255}
              disabled={disabled}
              onChange={set('website')}
              autoComplete="url"
            />
          </div>
          <fieldset className="space-y-3">
            <legend className="form-label">Mailing address</legend>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field
                id="dept-line1"
                label="Address line 1"
                value={form.line1}
                maxLength={255}
                disabled={disabled}
                onChange={set('line1')}
                autoComplete="address-line1"
              />
              <Field
                id="dept-line2"
                label="Address line 2"
                value={form.line2}
                maxLength={255}
                disabled={disabled}
                onChange={set('line2')}
                autoComplete="address-line2"
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field
                id="dept-city"
                label="City"
                value={form.city}
                maxLength={100}
                disabled={disabled}
                onChange={set('city')}
                autoComplete="address-level2"
              />
              <Field
                id="dept-state"
                label="State"
                value={form.state}
                maxLength={50}
                disabled={disabled}
                onChange={set('state')}
                autoComplete="address-level1"
              />
              <Field
                id="dept-zip"
                label="ZIP"
                value={form.zip}
                maxLength={20}
                disabled={disabled}
                onChange={set('zip')}
                autoComplete="postal-code"
              />
            </div>
          </fieldset>
        </>
      )}
    </section>
  );
};

export default DepartmentContactCard;
