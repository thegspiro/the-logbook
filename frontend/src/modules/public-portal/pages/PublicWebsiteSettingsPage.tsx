/**
 * Public Website settings
 *
 * The website this installation publishes for the department's community:
 * whether it is on, which look it wears, its text, and a switch for each page
 * and each contact detail. The pages themselves are rendered by the backend
 * and served on the installation's public website port, never on the address
 * members sign in at.
 *
 * Everything is saved by the one Save button, and every field the form owns
 * is sent on each save, so a box that was emptied is cleared rather than left
 * as it was (CLAUDE.md pitfall #1, update half).
 */

import React, { useEffect, useState } from 'react';
import { Link } from 'react-router';
import toast from 'react-hot-toast';
import { AdminPageHeader } from '../../../components/admin/AdminPageHeader';
import { SettingsToggle } from '../../../components/settings/SettingsToggle';
import { ErrorSummary, FormField, SkeletonText } from '../../../components/ux';
import { useConfirm } from '../../../contexts/ConfirmContext';
import { useFieldErrors, type FieldSpecs } from '../../../hooks/useFieldErrors';
import { getErrorMessage } from '../../../utils/errorHandling';
import { blankToNull } from '../../../utils/formValues';
import { getPublicSiteSettings, updatePublicSiteSettings } from '../services/publicSiteApi';
import type { PublicSiteSettings, PublicSiteSwitches, PublicSiteText } from '../types/publicSite';

type TextField = keyof PublicSiteText;
type SwitchField = keyof PublicSiteSwitches;

interface FormState extends PublicSiteSwitches {
  theme: string;
  tagline: string;
  welcome_text: string;
  about_text: string;
  emergency_notice: string;
}

// Mirrors the limits in backend/app/schemas/public_site.py.
const MAX_LENGTH: Record<TextField, number> = {
  tagline: 200,
  welcome_text: 2000,
  about_text: 20000,
  emergency_notice: 200,
};

const FIELDS: FieldSpecs<TextField> = {
  emergency_notice: { id: 'public-site-emergency-notice', label: 'Emergency notice' },
  tagline: { id: 'public-site-tagline', label: 'Tagline' },
  welcome_text: { id: 'public-site-welcome-text', label: 'Welcome text' },
  about_text: { id: 'public-site-about-text', label: 'About text' },
};

const SWITCH_FIELDS: readonly SwitchField[] = [
  'enabled',
  'show_about',
  'show_contact',
  'show_phone',
  'show_email',
  'show_address',
  'show_member_login',
];

const TEXT_FIELDS: readonly TextField[] = ['tagline', 'welcome_text', 'about_text', 'emergency_notice'];

function toForm(settings: PublicSiteSettings): FormState {
  return {
    enabled: settings.enabled,
    show_about: settings.show_about,
    show_contact: settings.show_contact,
    show_phone: settings.show_phone,
    show_email: settings.show_email,
    show_address: settings.show_address,
    show_member_login: settings.show_member_login,
    theme: settings.theme,
    tagline: settings.tagline ?? '',
    welcome_text: settings.welcome_text ?? '',
    about_text: settings.about_text ?? '',
    emergency_notice: settings.emergency_notice ?? '',
  };
}

function isDirty(form: FormState, saved: FormState): boolean {
  return (
    form.theme !== saved.theme ||
    SWITCH_FIELDS.some((name) => form[name] !== saved[name]) ||
    TEXT_FIELDS.some((name) => form[name].trim() !== saved[name].trim())
  );
}

const PublicWebsiteSettingsPage: React.FC = () => {
  const { confirm } = useConfirm();
  const [settings, setSettings] = useState<PublicSiteSettings | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [focusKey, setFocusKey] = useState(0);
  const { errors, formError, summary, clear, setError, setFromApiError } = useFieldErrors(FIELDS);

  useEffect(() => {
    let cancelled = false;
    getPublicSiteSettings()
      .then((data) => {
        if (cancelled) return;
        setSettings(data);
        setForm(toForm(data));
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(getErrorMessage(err, 'Unable to load the public website settings'));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const setSwitch = (name: SwitchField, value: boolean) => {
    setForm((prev) => (prev ? { ...prev, [name]: value } : prev));
  };

  const setText = (name: TextField, value: string) => {
    setForm((prev) => (prev ? { ...prev, [name]: value } : prev));
    setError(name, null);
  };

  const save = async () => {
    if (!form || !settings) return;
    if (form.enabled !== settings.enabled) {
      const ok = form.enabled
        ? await confirm({
            title: 'Publish the website?',
            message:
              'Anyone who can reach your public website address will see the pages and contact details switched on here. Members-only information is never shown.',
            confirmLabel: 'Publish',
            cancelLabel: 'Not yet',
            variant: 'warning',
          })
        : await confirm({
            title: 'Take the website down?',
            message:
              'Every page stops answering at once and visitors see "Not found" until it is published again. Your text and choices are kept.',
            confirmLabel: 'Take it down',
            cancelLabel: 'Keep it published',
            variant: 'danger',
          });
      if (!ok) return;
    }
    setSaving(true);
    clear();
    try {
      const updated = await updatePublicSiteSettings({
        enabled: form.enabled,
        show_about: form.show_about,
        show_contact: form.show_contact,
        show_phone: form.show_phone,
        show_email: form.show_email,
        show_address: form.show_address,
        show_member_login: form.show_member_login,
        theme: form.theme,
        tagline: blankToNull(form.tagline),
        welcome_text: blankToNull(form.welcome_text),
        about_text: blankToNull(form.about_text),
        emergency_notice: blankToNull(form.emergency_notice),
      });
      setSettings(updated);
      setForm(toForm(updated));
      toast.success(updated.enabled ? 'Saved. The website is published.' : 'Saved. The website is not published.');
    } catch (err: unknown) {
      setFromApiError(err, 'Could not save the public website settings');
      setFocusKey((key) => key + 1);
    } finally {
      setSaving(false);
    }
  };

  const header = (
    <div className="pb-6">
      <AdminPageHeader
        title="Public Website"
        description="The website this installation publishes for your community"
      />
    </div>
  );

  if (loadError) {
    return (
      <div className="mx-auto max-w-4xl">
        {header}
        <p className="alert-warning rounded-md p-3 text-sm" role="alert">
          {loadError}
        </p>
      </div>
    );
  }

  if (!settings || !form) {
    return (
      <div className="mx-auto max-w-4xl">
        {header}
        <div className="card space-y-3 p-4" aria-busy="true" aria-label="Loading the public website settings">
          <SkeletonText className="w-48" />
          <SkeletonText className="w-full" />
          <SkeletonText className="w-2/3" />
        </div>
      </div>
    );
  }

  const record = settings.contact_on_record;
  const address = record.address_lines.join(', ');
  const contactChoices: { name: SwitchField; label: string; value: string }[] = [
    { name: 'show_phone', label: 'Phone number', value: record.phone ?? '' },
    { name: 'show_email', label: 'Email address', value: record.email ?? '' },
    { name: 'show_address', label: 'Address', value: address },
  ];
  const dirty = isDirty(form, toForm(settings));

  return (
    <div className="mx-auto max-w-4xl">
      {header}

      <form
        className="space-y-6"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <ErrorSummary items={summary} formError={formError} focusKey={focusKey} title="These could not be saved" />

        {!settings.servable && (
          <p className="alert-warning rounded-md p-3 text-sm" role="note">
            This installation holds more than one department, so the public website is not served for any of them. A
            visitor carries no department, and the website answers only where there is exactly one.
          </p>
        )}

        <section aria-labelledby="public-site-status" className="card space-y-3 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 grow basis-64">
              <h2 id="public-site-status" className="text-theme-text-primary text-lg font-semibold">
                {form.enabled ? 'The website is set to published' : 'The website is set to not published'}
              </h2>
              <p className="text-theme-text-secondary mt-1 text-sm">
                Until it is published, every page answers &ldquo;Not found&rdquo; and names nobody.
              </p>
            </div>
            <SettingsToggle
              checked={form.enabled}
              onChange={(next) => setSwitch('enabled', next)}
              disabled={saving}
              label="Publish the website"
            />
          </div>
          <p className="text-theme-text-muted text-sm">
            The website is served on this installation&rsquo;s public website port, not at the address members sign in
            at. Whoever runs the server points your public address at that port.
          </p>
        </section>

        <section aria-labelledby="public-site-look" className="card space-y-3 p-4">
          <h2 id="public-site-look" className="text-theme-text-primary text-lg font-semibold">
            Look
          </h2>
          <div role="radiogroup" aria-labelledby="public-site-look" className="grid gap-2 sm:grid-cols-3">
            {settings.themes.map((theme) => (
              <label
                key={theme.value}
                htmlFor={`public-site-theme-${theme.value}`}
                className="card-secondary mobile-touch-row cursor-pointer items-start gap-3 rounded-md p-3"
              >
                <input
                  type="radio"
                  id={`public-site-theme-${theme.value}`}
                  name="public-site-theme"
                  value={theme.value}
                  checked={form.theme === theme.value}
                  disabled={saving}
                  onChange={() => setForm((prev) => (prev ? { ...prev, theme: theme.value } : prev))}
                  className="mt-1 shrink-0"
                />
                <span className="text-sm">
                  <span className="text-theme-text-primary block font-medium">{theme.label}</span>
                  <span className="text-theme-text-muted mt-0.5 block text-xs">{theme.description}</span>
                </span>
              </label>
            ))}
          </div>
        </section>

        <section aria-labelledby="public-site-home" className="card space-y-4 p-4">
          <h2 id="public-site-home" className="text-theme-text-primary text-lg font-semibold">
            Every page and the home page
          </h2>
          <FormField
            id={FIELDS.emergency_notice.id}
            label={FIELDS.emergency_notice.label}
            optional
            hint="Shown in a band at the top of every page, for example: In an emergency, call 911."
            error={errors.emergency_notice}
            maxLength={MAX_LENGTH.emergency_notice}
            count={form.emergency_notice.length}
          >
            {(field) => (
              <input
                {...field}
                type="text"
                className="form-input"
                value={form.emergency_notice}
                disabled={saving}
                onChange={(event) => setText('emergency_notice', event.target.value)}
              />
            )}
          </FormField>
          <FormField
            id={FIELDS.tagline.id}
            label={FIELDS.tagline.label}
            optional
            hint="One line under the department's name on the home page. Search engines show it too."
            error={errors.tagline}
            maxLength={MAX_LENGTH.tagline}
            count={form.tagline.length}
          >
            {(field) => (
              <input
                {...field}
                type="text"
                className="form-input"
                value={form.tagline}
                disabled={saving}
                onChange={(event) => setText('tagline', event.target.value)}
              />
            )}
          </FormField>
          <FormField
            id={FIELDS.welcome_text.id}
            label={FIELDS.welcome_text.label}
            optional
            hint="Plain text. Leave a blank line between paragraphs."
            error={errors.welcome_text}
            maxLength={MAX_LENGTH.welcome_text}
            count={form.welcome_text.length}
          >
            {(field) => (
              <textarea
                {...field}
                rows={5}
                className="form-input"
                value={form.welcome_text}
                disabled={saving}
                onChange={(event) => setText('welcome_text', event.target.value)}
              />
            )}
          </FormField>
        </section>

        <section aria-labelledby="public-site-about" className="card space-y-4 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="public-site-about" className="text-theme-text-primary text-lg font-semibold">
              About page
            </h2>
            <SettingsToggle
              checked={form.show_about}
              onChange={(next) => setSwitch('show_about', next)}
              disabled={saving}
              label="Show the About page"
            />
          </div>
          <FormField
            id={FIELDS.about_text.id}
            label={FIELDS.about_text.label}
            optional
            hint="Plain text. Leave a blank line between paragraphs. The founding year and county on the department's record are shown above it."
            error={errors.about_text}
            maxLength={MAX_LENGTH.about_text}
            count={form.about_text.length}
          >
            {(field) => (
              <textarea
                {...field}
                rows={10}
                className="form-input"
                value={form.about_text}
                disabled={saving}
                onChange={(event) => setText('about_text', event.target.value)}
              />
            )}
          </FormField>
        </section>

        <section aria-labelledby="public-site-contact" className="card space-y-4 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="public-site-contact" className="text-theme-text-primary text-lg font-semibold">
              Contact page
            </h2>
            <SettingsToggle
              checked={form.show_contact}
              onChange={(next) => setSwitch('show_contact', next)}
              disabled={saving}
              label="Show the Contact page"
            />
          </div>
          <p className="text-theme-text-secondary text-sm">
            The details come from the department&rsquo;s own record, so the website always matches it. Change them under{' '}
            <Link to="/settings" className="font-semibold underline">
              Organization Settings
            </Link>
            . Each is shown only while its box is ticked.
          </p>
          <fieldset className="space-y-2">
            <legend className="form-label">Show on the website</legend>
            {contactChoices.map(({ name, label, value }) => (
              <label
                key={name}
                htmlFor={`public-site-${name}`}
                className="card-secondary mobile-touch-row cursor-pointer gap-3 rounded-md p-3"
              >
                <input
                  type="checkbox"
                  id={`public-site-${name}`}
                  checked={form[name]}
                  disabled={saving}
                  onChange={(event) => setSwitch(name, event.target.checked)}
                  className="form-checkbox shrink-0"
                />
                <span className="min-w-0 text-sm">
                  <span className="text-theme-text-primary block font-medium">{label}</span>
                  <span className="text-theme-text-muted mt-0.5 block text-xs break-words">
                    {value || 'Nothing on record, so nothing is shown'}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
        </section>

        <section aria-labelledby="public-site-footer" className="card p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0 grow basis-64">
              <h2 id="public-site-footer" className="text-theme-text-primary text-lg font-semibold">
                Member sign-in link
              </h2>
              <p className="text-theme-text-secondary mt-1 text-sm">
                A link in the footer to the address members sign in at. Leave it off to keep that address off the public
                website.
              </p>
            </div>
            <SettingsToggle
              checked={form.show_member_login}
              onChange={(next) => setSwitch('show_member_login', next)}
              disabled={saving}
              label="Show the member sign-in link"
            />
          </div>
        </section>

        <div className="flex flex-wrap items-center justify-end gap-3">
          {dirty && <span className="text-theme-text-muted text-sm">You have changes that are not saved.</span>}
          <button type="submit" className="btn-primary" disabled={saving || !dirty}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default PublicWebsiteSettingsPage;
