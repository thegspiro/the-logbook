/**
 * Store Settings Tab
 *
 * Store identity, which payment methods are accepted and where the money goes,
 * pricing rules, and which notices go out.
 */

import React, { useCallback, useEffect, useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { Eye, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { getErrorMessage } from '../../../utils/errorHandling';
import { blankToNull, numberOrNull } from '../../../utils/formValues';
import { FormField } from '../../../components/ux/FormField';
import { ErrorSummary } from '../../../components/ux/ErrorSummary';
import { useFieldErrors, type FieldErrors, type FieldSpecs } from '../../../hooks/useFieldErrors';
import { useUnsavedChanges } from '../../../hooks/useUnsavedChanges';
import { organizationEmailError } from '../../../utils/organizationProfile';
import { storefrontService } from '../services/api';
import { NotificationPreviewModal } from './NotificationPreviewModal';
import {
  PAYMENT_METHOD_LABELS,
  PAYMENT_POLICY_OPTIONS,
  StorePaymentMethod,
  type ConnectedPayPalAccount,
  type StorePaymentPolicy,
  type StoreSettings,
  type StoreSettingsUpdate,
} from '../types';

interface StoreSettingsTabProps {
  onChanged: () => void;
}

interface FormState {
  isEnabled: boolean;
  storeName: string;
  tagline: string;
  description: string;
  showOpenOrderBanner: boolean;
  acceptedPaymentMethods: string[];
  paymentPolicy: string;
  venmoHandle: string;
  paypalMeUrl: string;
  paypalEmail: string;
  paypalUseConnected: boolean;
  cashAppCashtag: string;
  zelleHandle: string;
  zelleInstructions: string;
  checkPayableTo: string;
  checkMailingAddress: string;
  cashInstructions: string;
  payrollDeductionInstructions: string;
  otherPaymentInstructions: string;
  paymentInstructions: string;
  taxRatePercent: string;
  shippingFlatRate: string;
  allowPickup: boolean;
  allowShipping: boolean;
  pickupLocation: string;
  notifyEmails: string;
  notifyAdminsOnOrder: boolean;
  sendOrderConfirmation: boolean;
  sendStatusUpdates: boolean;
  sendPaymentReminders: boolean;
  sendPaymentReceipts: boolean;
  sendWindowOpened: boolean;
  sendWindowClosingReminder: boolean;
  sendWindowClosed: boolean;
  sendVendorOrderUpdates: boolean;
  paymentReminderDays: string;
  windowReminderHours: string;
  termsText: string;
  receiptFooter: string;
}

const toForm = (settings: StoreSettings): FormState => ({
  isEnabled: settings.isEnabled,
  storeName: settings.storeName,
  tagline: settings.tagline ?? '',
  description: settings.description ?? '',
  showOpenOrderBanner: settings.showOpenOrderBanner,
  acceptedPaymentMethods: settings.acceptedPaymentMethods,
  paymentPolicy: settings.paymentPolicy ?? 'none',
  venmoHandle: settings.venmoHandle ?? '',
  paypalMeUrl: settings.paypalMeUrl ?? '',
  paypalEmail: settings.paypalEmail ?? '',
  paypalUseConnected: settings.paypalUseConnected,
  cashAppCashtag: settings.cashAppCashtag ?? '',
  zelleHandle: settings.zelleHandle ?? '',
  zelleInstructions: settings.zelleInstructions ?? '',
  checkPayableTo: settings.checkPayableTo ?? '',
  checkMailingAddress: settings.checkMailingAddress ?? '',
  cashInstructions: settings.cashInstructions ?? '',
  payrollDeductionInstructions: settings.payrollDeductionInstructions ?? '',
  otherPaymentInstructions: settings.otherPaymentInstructions ?? '',
  paymentInstructions: settings.paymentInstructions ?? '',
  // Stored as a fraction; shown as a percentage because that's how a treasurer
  // reads a tax rate.
  taxRatePercent: String(Number(settings.taxRate) * 100),
  shippingFlatRate: settings.shippingFlatRate != null ? String(settings.shippingFlatRate) : '',
  allowPickup: settings.allowPickup,
  allowShipping: settings.allowShipping,
  pickupLocation: settings.pickupLocation ?? '',
  notifyEmails: settings.notifyEmails.join(', '),
  notifyAdminsOnOrder: settings.notifyAdminsOnOrder,
  sendOrderConfirmation: settings.sendOrderConfirmation,
  sendStatusUpdates: settings.sendStatusUpdates,
  sendPaymentReminders: settings.sendPaymentReminders,
  sendPaymentReceipts: settings.sendPaymentReceipts,
  sendWindowOpened: settings.sendWindowOpened,
  sendWindowClosingReminder: settings.sendWindowClosingReminder,
  sendWindowClosed: settings.sendWindowClosed,
  sendVendorOrderUpdates: settings.sendVendorOrderUpdates,
  paymentReminderDays: String(settings.paymentReminderDays),
  windowReminderHours: String(settings.windowReminderHours),
  termsText: settings.termsText ?? '',
  receiptFooter: settings.receiptFooter ?? '',
});

/** The FormState keys that are notification switches. */
type NoticeKey =
  | 'sendOrderConfirmation'
  | 'sendStatusUpdates'
  | 'sendPaymentReceipts'
  | 'sendPaymentReminders'
  | 'notifyAdminsOnOrder'
  | 'sendWindowOpened'
  | 'sendWindowClosingReminder'
  | 'sendWindowClosed'
  | 'sendVendorOrderUpdates';

interface NoticeGroup {
  title: string;
  /** `notice` is the backend preview key for this switch. */
  notices: {
    key: NoticeKey;
    notice: string;
    label: string;
    detail: string;
    /** Other emails the same switch governs, each previewable on its own row. */
    alsoPreview?: { notice: string; label: string; buttonText: string }[];
  }[];
}

/**
 * Each switch names the notice it controls and says who receives it, because
 * "status updates" on its own does not tell a quartermaster whether unticking
 * it also stops the cancellation email. (It does.)
 */
const NOTICE_GROUPS: NoticeGroup[] = [
  {
    title: 'Order notices',
    notices: [
      {
        key: 'sendOrderConfirmation',
        notice: 'order_confirmation',
        label: 'Order confirmation',
        detail: 'To the member the moment they order — their receipt and how to pay.',
      },
      {
        key: 'sendStatusUpdates',
        notice: 'status_change',
        label: 'Status changes',
        detail: 'To the member when their order becomes ordered, ready for pickup, picked up, or cancelled.',
        alsoPreview: [{ notice: 'order_cancelled', label: 'Order cancelled', buttonText: 'Cancellation' }],
      },
      {
        key: 'sendPaymentReceipts',
        notice: 'payment_receipt',
        label: 'Payment receipts',
        detail: 'To the member when you record a payment, waive one, or record a refund.',
      },
      {
        key: 'sendPaymentReminders',
        notice: 'payment_reminder',
        label: 'Payment reminders',
        detail: 'To members still carrying a balance, on the schedule below.',
      },
      {
        key: 'notifyAdminsOnOrder',
        notice: 'admin_new_order',
        label: 'New order alert',
        detail: 'To store managers and the extra addresses below, each time a member places an order.',
      },
    ],
  },
  {
    title: 'Order window notices',
    notices: [
      {
        key: 'sendWindowOpened',
        notice: 'window_opened',
        label: 'Ordering is open',
        detail: 'To every active member when a window opens. Each window can also turn off its own announcement.',
      },
      {
        key: 'sendWindowClosingReminder',
        notice: 'window_closing',
        label: 'Last call',
        detail: 'To every active member before a window closes, on the schedule below.',
      },
      {
        key: 'sendWindowClosed',
        notice: 'window_closed',
        label: 'Ordering has closed',
        detail: 'To everyone who ordered in that window.',
      },
      {
        key: 'sendVendorOrderUpdates',
        notice: 'vendor_order_placed',
        label: 'Order placed with the vendor',
        detail: 'To everyone who ordered, when you record the vendor order.',
      },
    ],
  },
];

/** The settings a field of this form can refuse: each has a limit or a rule. */
type SettingsField =
  | 'storeName'
  | 'tagline'
  | 'venmoHandle'
  | 'paypalMeUrl'
  | 'paypalEmail'
  | 'cashAppCashtag'
  | 'zelleHandle'
  | 'checkPayableTo'
  | 'taxRatePercent'
  | 'shippingFlatRate'
  | 'pickupLocation'
  | 'paymentReminderDays'
  | 'windowReminderHours'
  | 'notifyEmails';

// Ordered as on screen, so the summary and the first focused field follow the
// page. The ids are the ones this form has always used; the store API is
// camelCase, and the snake_case names are listed in case a refusal reports the
// attribute rather than the alias.
const SETTINGS_FIELDS: FieldSpecs<SettingsField> = {
  storeName: { id: 'settings-name', label: 'Store name', apiKeys: ['store_name'] },
  tagline: { id: 'settings-tagline', label: 'Tagline' },
  venmoHandle: { id: 'settings-venmo', label: 'Venmo handle', apiKeys: ['venmo_handle'] },
  paypalMeUrl: { id: 'settings-paypal-url', label: 'PayPal.Me link', apiKeys: ['paypal_me_url'] },
  paypalEmail: { id: 'settings-paypal-email', label: 'PayPal email', apiKeys: ['paypal_email'] },
  cashAppCashtag: { id: 'settings-cashapp', label: 'Cash App $cashtag', apiKeys: ['cash_app_cashtag'] },
  zelleHandle: { id: 'settings-zelle', label: 'Zelle email or phone', apiKeys: ['zelle_handle'] },
  checkPayableTo: { id: 'settings-check-payee', label: 'Checks payable to', apiKeys: ['check_payable_to'] },
  taxRatePercent: { id: 'settings-tax', label: 'Sales tax (%)', apiKeys: ['taxRate', 'tax_rate'] },
  shippingFlatRate: { id: 'settings-shipping', label: 'Flat shipping rate', apiKeys: ['shipping_flat_rate'] },
  pickupLocation: { id: 'settings-pickup', label: 'Pickup location', apiKeys: ['pickup_location'] },
  paymentReminderDays: {
    id: 'settings-reminder-days',
    label: 'Payment reminder after (days)',
    apiKeys: ['payment_reminder_days'],
  },
  windowReminderHours: {
    id: 'settings-reminder-hours',
    label: 'Last call reminder (hours before close)',
    apiKeys: ['window_reminder_hours'],
  },
  notifyEmails: {
    id: 'settings-notify-emails',
    label: 'Extra recipients for new order alerts (comma-separated)',
    apiKeys: ['notify_emails'],
  },
};

// Mirrors StoreSettingsUpdate (forms review F-2).
const SETTINGS_LIMITS: Partial<Record<SettingsField, number>> = {
  storeName: 200,
  tagline: 300,
  venmoHandle: 100,
  paypalMeUrl: 300,
  paypalEmail: 255,
  cashAppCashtag: 100,
  zelleHandle: 255,
  checkPayableTo: 200,
  pickupLocation: 300,
};

/**
 * What the form can tell before anything is sent: each check mirrors a bound
 * StoreSettingsUpdate enforces, so it is said on the field rather than coming
 * back as a refusal that used to be a toast.
 */
function checkSettings(form: FormState): FieldErrors<SettingsField> {
  const problems: FieldErrors<SettingsField> = {};
  const tax = form.taxRatePercent.trim();
  if (tax && !(Number(tax) >= 0 && Number(tax) <= 100))
    problems.taxRatePercent = 'Enter a percentage from 0 to 100, or leave it empty for no tax.';
  const shipping = form.shippingFlatRate.trim();
  if (shipping && !(Number(shipping) >= 0)) problems.shippingFlatRate = 'Enter an amount, 0 or more.';
  const days = form.paymentReminderDays.trim();
  if (days && !(Number.isInteger(Number(days)) && Number(days) >= 1 && Number(days) <= 90))
    problems.paymentReminderDays = 'Enter a whole number of days from 1 to 90.';
  const hours = form.windowReminderHours.trim();
  if (hours && !(Number.isInteger(Number(hours)) && Number(hours) >= 1 && Number(hours) <= 720))
    problems.windowReminderHours = 'Enter a whole number of hours from 1 to 720.';
  const bad = form.notifyEmails
    .split(',')
    .map((email) => email.trim())
    .filter((email) => email && organizationEmailError(email));
  if (bad.length > 0) problems.notifyEmails = `Check ${bad.join(', ')}: each recipient must be an email address.`;
  return problems;
}

export const StoreSettingsTab: React.FC<StoreSettingsTabProps> = ({ onChanged }) => {
  const [form, setForm] = useState<FormState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [previewNotice, setPreviewNotice] = useState<string | null>(null);
  // The connected PayPal integration's link and email, as the backend reports
  // them. Read-only here: they are edited on the integration's Settings.
  const [connectedPaypal, setConnectedPaypal] = useState<ConnectedPayPalAccount | null>(null);
  // The settings as loaded (or last saved), so leaving with unsaved changes
  // asks first (forms review F-6).
  const [baseline, setBaseline] = useState<FormState | null>(null);
  const settingsErrors = useFieldErrors(SETTINGS_FIELDS);
  const [summaryFocus, setSummaryFocus] = useState(0);
  useUnsavedChanges({ hasChanges: !saving && JSON.stringify(form) !== JSON.stringify(baseline) });

  const applySettings = useCallback((settings: StoreSettings) => {
    const next = toForm(settings);
    setForm(next);
    setBaseline(next);
    setConnectedPaypal(settings.connectedPaypal ?? null);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      applySettings(await storefrontService.getSettings());
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not load store settings'));
    } finally {
      setLoading(false);
    }
  }, [applySettings]);

  useEffect(() => {
    void load();
  }, [load]);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
    if (key in SETTINGS_FIELDS) settingsErrors.setError(key as SettingsField, null);
  };

  const toggleMethod = (method: string) =>
    setForm((prev) =>
      prev
        ? {
            ...prev,
            acceptedPaymentMethods: prev.acceptedPaymentMethods.includes(method)
              ? prev.acceptedPaymentMethods.filter((m) => m !== method)
              : [...prev.acceptedPaymentMethods, method],
          }
        : prev
    );

  const handleSave = useCallback(async () => {
    if (!form) return;
    // These settings are replaced together, and a payment link saved without
    // the handle beside it would send members to half an account, so a refused
    // field holds the whole save back rather than saving the rest.
    const problems = checkSettings(form);
    settingsErrors.setFormError(null);
    settingsErrors.setErrors(problems);
    if (Object.keys(problems).length > 0) {
      setSummaryFocus((n) => n + 1);
      return;
    }
    const payload: StoreSettingsUpdate = {
      isEnabled: form.isEnabled,
      storeName: form.storeName.trim() || 'Department Store',
      tagline: blankToNull(form.tagline),
      description: blankToNull(form.description),
      showOpenOrderBanner: form.showOpenOrderBanner,
      acceptedPaymentMethods: form.acceptedPaymentMethods,
      paymentPolicy: form.paymentPolicy as StorePaymentPolicy,
      venmoHandle: blankToNull(form.venmoHandle),
      paypalMeUrl: blankToNull(form.paypalMeUrl),
      paypalEmail: blankToNull(form.paypalEmail),
      paypalUseConnected: form.paypalUseConnected,
      cashAppCashtag: blankToNull(form.cashAppCashtag),
      zelleHandle: blankToNull(form.zelleHandle),
      zelleInstructions: blankToNull(form.zelleInstructions),
      checkPayableTo: blankToNull(form.checkPayableTo),
      checkMailingAddress: blankToNull(form.checkMailingAddress),
      cashInstructions: blankToNull(form.cashInstructions),
      payrollDeductionInstructions: blankToNull(form.payrollDeductionInstructions),
      otherPaymentInstructions: blankToNull(form.otherPaymentInstructions),
      paymentInstructions: blankToNull(form.paymentInstructions),
      taxRate: Number(form.taxRatePercent || 0) / 100,
      shippingFlatRate: numberOrNull(form.shippingFlatRate),
      allowPickup: form.allowPickup,
      allowShipping: form.allowShipping,
      pickupLocation: blankToNull(form.pickupLocation),
      notifyEmails: form.notifyEmails
        .split(',')
        .map((email) => email.trim())
        .filter(Boolean),
      notifyAdminsOnOrder: form.notifyAdminsOnOrder,
      sendOrderConfirmation: form.sendOrderConfirmation,
      sendStatusUpdates: form.sendStatusUpdates,
      sendPaymentReminders: form.sendPaymentReminders,
      sendPaymentReceipts: form.sendPaymentReceipts,
      sendWindowOpened: form.sendWindowOpened,
      sendWindowClosingReminder: form.sendWindowClosingReminder,
      sendWindowClosed: form.sendWindowClosed,
      sendVendorOrderUpdates: form.sendVendorOrderUpdates,
      paymentReminderDays: Number(form.paymentReminderDays || 3),
      windowReminderHours: Number(form.windowReminderHours || 48),
      termsText: blankToNull(form.termsText),
      receiptFooter: blankToNull(form.receiptFooter),
    };

    setSaving(true);
    try {
      applySettings(await storefrontService.updateSettings(payload));
      settingsErrors.clear();
      toast.success('Store settings saved');
      onChanged();
    } catch (err: unknown) {
      // A refused field is flagged on that field (forms review F-2); anything
      // no field answers for is said at the top of the form. Nothing was saved.
      settingsErrors.setFromApiError(err, 'Could not save the settings');
      setSummaryFocus((n) => n + 1);
    } finally {
      setSaving(false);
    }
  }, [form, onChanged, applySettings, settingsErrors]);

  /** A setting with a limit or a rule, through the shared field. */
  const settingsField = (
    field: SettingsField,
    value: string,
    onValue: (value: string) => void,
    extra: Partial<InputHTMLAttributes<HTMLInputElement>> = {},
    label: string = SETTINGS_FIELDS[field].label
  ): ReactNode => {
    const limit = SETTINGS_LIMITS[field];
    return (
      <FormField
        id={SETTINGS_FIELDS[field].id}
        label={label}
        error={settingsErrors.errors[field]}
        {...(limit !== undefined ? { maxLength: limit, count: value.length } : {})}
      >
        {(props) => (
          <input
            {...props}
            type="text"
            value={value}
            onChange={(e) => onValue(e.target.value)}
            className="form-input w-full min-w-0"
            {...extra}
          />
        )}
      </FormField>
    );
  };

  if (loading || !form) {
    return (
      <div className="flex justify-center py-12" role="status" aria-live="polite">
        <Loader2 className="text-theme-text-muted h-6 w-6 animate-spin" />
      </div>
    );
  }

  const accepts = (method: string) => form.acceptedPaymentMethods.includes(method);
  const connectedHas = !!(connectedPaypal?.paypalMeUrl || connectedPaypal?.accountEmail);
  // What the PayPal button will actually do, stated beside the choice. The
  // fallback rule is the backend's store_paypal_account; this only words it.
  const paypalAccountNote: { tone: string; text: string } | null = form.paypalUseConnected
    ? connectedPaypal === null
      ? {
          tone: 'alert-warning',
          text: 'PayPal is not connected on the Integrations page. Until it is, members are sent to the fallback link and email below.',
        }
      : !connectedHas
        ? {
            tone: 'alert-warning',
            text: 'The connected PayPal account has no PayPal.Me link or email yet. Add them under Integrations → PayPal → Settings. Until then, members are sent to the fallback link and email below.',
          }
        : {
            tone: 'alert-info',
            text: `Members are sent to ${[connectedPaypal.paypalMeUrl, connectedPaypal.accountEmail].filter(Boolean).join(' · ')}. Payments to it are matched to orders automatically.`,
          }
    : connectedPaypal !== null
      ? {
          tone: 'alert-info',
          text: 'Payments to an account other than the connected one are not matched to orders automatically; mark them paid by hand.',
        }
      : null;

  return (
    <>
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void handleSave();
        }}
        className="space-y-6"
      >
        <ErrorSummary
          items={settingsErrors.summary}
          formError={settingsErrors.formError}
          focusKey={summaryFocus}
          title="Fix these before saving the settings"
        />
        <section className="card space-y-4 p-4">
          <h2 className="text-theme-text-primary text-sm font-semibold">Storefront</h2>
          <label className="text-theme-text-secondary flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="form-checkbox"
              checked={form.isEnabled}
              onChange={(e) => update('isEnabled', e.target.checked)}
            />
            Store is live for members
          </label>
          <label className="text-theme-text-secondary flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="form-checkbox mt-0.5"
              checked={form.showOpenOrderBanner}
              onChange={(e) => update('showOpenOrderBanner', e.target.checked)}
            />
            <span>
              <span className="text-theme-text-primary block font-medium">Show the “Ordering is open” banner</span>
              <span className="text-theme-text-muted block text-xs">Turn this off if your store is always open.</span>
            </span>
          </label>
          <div className="form-grid-2">
            <div>{settingsField('storeName', form.storeName, (v) => update('storeName', v))}</div>
            <div>{settingsField('tagline', form.tagline, (v) => update('tagline', v))}</div>
          </div>
          <div>
            <label htmlFor="settings-description" className="form-label">
              Description
            </label>
            <textarea
              id="settings-description"
              rows={2}
              value={form.description}
              onChange={(e) => update('description', e.target.value)}
              className="form-input"
            />
          </div>
        </section>

        <section className="card space-y-4 p-4">
          <div>
            <h2 className="text-theme-text-primary text-sm font-semibold">Payments</h2>
            <p className="text-theme-text-muted mt-1 text-xs">
              Members pay the department directly — the store hands them a prefilled link and a reference, and a
              quartermaster confirms each payment against the department account.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            {Object.values(StorePaymentMethod).map((method) => (
              <label key={method} className="text-theme-text-secondary flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="form-checkbox"
                  checked={accepts(method)}
                  onChange={() => toggleMethod(method)}
                />
                {PAYMENT_METHOD_LABELS[method] ?? method}
              </label>
            ))}
          </div>

          {/* Rendered as a comparison rather than a dropdown: this is chosen
            before a catalog exists, so the consequences of each rule have to
            be readable without going to the manual. */}
          <fieldset>
            <legend className="form-label">What happens to an unpaid order?</legend>
            <p className="text-theme-text-muted mb-2 text-xs">
              All three are common. You can change this at any time — it applies from then on and never undoes a step
              already taken.
            </p>
            <div className="space-y-2">
              {PAYMENT_POLICY_OPTIONS.map((option) => {
                const selected = form.paymentPolicy === option.value;
                return (
                  <label
                    key={option.value}
                    className={`flex cursor-pointer gap-3 rounded-lg border p-3 transition-colors ${
                      selected
                        ? 'border-blue-600 bg-blue-500/5'
                        : 'border-theme-surface-border hover:bg-theme-surface-hover'
                    }`}
                  >
                    <input
                      type="radio"
                      name="payment-policy"
                      value={option.value}
                      checked={selected}
                      onChange={() => update('paymentPolicy', option.value)}
                      className="mt-1"
                    />
                    <span className="min-w-0">
                      <span className="text-theme-text-primary block text-sm font-medium">{option.label}</span>
                      <span className="text-theme-text-secondary block text-xs">{option.summary}</span>
                      <span className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                        <span className="text-theme-text-muted">
                          Vendor order: <strong className="text-theme-text-secondary">{option.vendorOrder}</strong>
                        </span>
                        <span className="text-theme-text-muted">
                          Pickup: <strong className="text-theme-text-secondary">{option.pickup}</strong>
                        </span>
                      </span>
                      <span className="text-theme-text-muted mt-1 block text-xs italic">{option.suits}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          {accepts(StorePaymentMethod.VENMO) && (
            <div>
              {settingsField('venmoHandle', form.venmoHandle, (v) => update('venmoHandle', v), {
                placeholder: '@FallsChurchFire',
              })}
            </div>
          )}

          {accepts(StorePaymentMethod.PAYPAL) && (
            <fieldset className="space-y-2">
              <legend className="form-label">PayPal account members pay into</legend>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="radio"
                  name="settings-paypal-account"
                  checked={!form.paypalUseConnected}
                  onChange={() => update('paypalUseConnected', false)}
                  className="mt-0.5"
                />
                <span className="text-theme-text-primary">The account entered below</span>
              </label>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="radio"
                  name="settings-paypal-account"
                  checked={form.paypalUseConnected}
                  onChange={() => update('paypalUseConnected', true)}
                  className="mt-0.5"
                />
                <span className="text-theme-text-primary">The connected PayPal account</span>
              </label>
              {paypalAccountNote && (
                <p className={`rounded-lg p-3 text-sm ${paypalAccountNote.tone}`} data-testid="paypal-account-note">
                  {paypalAccountNote.text}
                </p>
              )}
            </fieldset>
          )}

          {accepts(StorePaymentMethod.PAYPAL) && (
            <div className="form-grid-2">
              <div>
                {settingsField(
                  'paypalMeUrl',
                  form.paypalMeUrl,
                  (v) => update('paypalMeUrl', v),
                  { placeholder: 'https://paypal.me/yourdept' },
                  form.paypalUseConnected ? 'Fallback PayPal.Me link' : 'PayPal.Me link'
                )}
              </div>
              <div>
                {settingsField(
                  'paypalEmail',
                  form.paypalEmail,
                  (v) => update('paypalEmail', v),
                  { type: 'email' },
                  form.paypalUseConnected ? 'Fallback PayPal email' : 'PayPal email'
                )}
              </div>
            </div>
          )}

          {accepts(StorePaymentMethod.CASH_APP) && (
            <div>
              {settingsField('cashAppCashtag', form.cashAppCashtag, (v) => update('cashAppCashtag', v), {
                placeholder: '$FallsChurchFire',
              })}
              <p className="text-theme-text-muted mt-1 text-xs">
                Cash App has no note field, so members are shown the order number to type in themselves.
              </p>
            </div>
          )}

          {accepts(StorePaymentMethod.ZELLE) && (
            <div className="form-grid-2">
              <div>
                {settingsField('zelleHandle', form.zelleHandle, (v) => update('zelleHandle', v), {
                  placeholder: 'treasurer@yourdept.org',
                })}
                <p className="text-theme-text-muted mt-1 text-xs">
                  Zelle runs inside each member&apos;s own banking app, so there is no link to open — they are shown
                  this handle to enter.
                </p>
              </div>
              <div>
                <label htmlFor="settings-zelle-notes" className="form-label">
                  Zelle instructions
                </label>
                <textarea
                  id="settings-zelle-notes"
                  rows={2}
                  value={form.zelleInstructions}
                  onChange={(e) => update('zelleInstructions', e.target.value)}
                  className="form-input"
                  placeholder='Look for "Falls Church Fire Dept" when confirming the recipient.'
                />
              </div>
            </div>
          )}

          {accepts(StorePaymentMethod.CHECK) && (
            <div className="form-grid-2">
              <div>{settingsField('checkPayableTo', form.checkPayableTo, (v) => update('checkPayableTo', v))}</div>
              <div>
                <label htmlFor="settings-check-address" className="form-label">
                  Mailing address
                </label>
                <textarea
                  id="settings-check-address"
                  rows={2}
                  value={form.checkMailingAddress}
                  onChange={(e) => update('checkMailingAddress', e.target.value)}
                  className="form-input"
                />
              </div>
            </div>
          )}

          {accepts(StorePaymentMethod.CASH) && (
            <div>
              <label htmlFor="settings-cash" className="form-label">
                Cash instructions
              </label>
              <textarea
                id="settings-cash"
                rows={2}
                value={form.cashInstructions}
                onChange={(e) => update('cashInstructions', e.target.value)}
                className="form-input"
                placeholder="Drop cash with the treasurer at the Tuesday drill"
              />
            </div>
          )}

          {accepts(StorePaymentMethod.PAYROLL_DEDUCTION) && (
            <div>
              <label htmlFor="settings-payroll" className="form-label">
                Payroll deduction instructions
              </label>
              <textarea
                id="settings-payroll"
                rows={2}
                value={form.payrollDeductionInstructions}
                onChange={(e) => update('payrollDeductionInstructions', e.target.value)}
                className="form-input"
              />
            </div>
          )}

          {accepts(StorePaymentMethod.OTHER) && (
            <div>
              <label htmlFor="settings-other-payment" className="form-label">
                Other payment instructions
              </label>
              <textarea
                id="settings-other-payment"
                rows={2}
                value={form.otherPaymentInstructions}
                onChange={(e) => update('otherPaymentInstructions', e.target.value)}
                className="form-input"
              />
            </div>
          )}

          <div>
            <label htmlFor="settings-payment-instructions" className="form-label">
              General payment note (shown with every order)
            </label>
            <textarea
              id="settings-payment-instructions"
              rows={2}
              value={form.paymentInstructions}
              onChange={(e) => update('paymentInstructions', e.target.value)}
              className="form-input"
            />
          </div>
        </section>

        <section className="card space-y-4 p-4">
          <h2 className="text-theme-text-primary text-sm font-semibold">Pricing and delivery</h2>
          <div className="form-grid-2">
            <div>
              {settingsField('taxRatePercent', form.taxRatePercent, (v) => update('taxRatePercent', v), {
                type: 'number',
                inputMode: 'decimal',
                min: '0',
                max: '100',
                step: '0.01',
              })}
            </div>
            <div>
              {settingsField('shippingFlatRate', form.shippingFlatRate, (v) => update('shippingFlatRate', v), {
                type: 'number',
                inputMode: 'decimal',
                min: '0',
                step: '0.01',
                disabled: !form.allowShipping,
              })}
            </div>
          </div>
          <div className="flex flex-wrap gap-4">
            <label className="text-theme-text-secondary flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="form-checkbox"
                checked={form.allowPickup}
                onChange={(e) => update('allowPickup', e.target.checked)}
              />
              Allow pickup
            </label>
            <label className="text-theme-text-secondary flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="form-checkbox"
                checked={form.allowShipping}
                onChange={(e) => update('allowShipping', e.target.checked)}
              />
              Allow shipping
            </label>
          </div>
          <div>{settingsField('pickupLocation', form.pickupLocation, (v) => update('pickupLocation', v))}</div>
        </section>

        <section className="card space-y-4 p-4">
          <div>
            <h2 className="text-theme-text-primary text-sm font-semibold">Notifications</h2>
            <p className="text-theme-text-secondary mt-1 text-xs">
              Every email the store can send is listed here. Turning one off stops it for the whole department. To skip
              a single send, untick the email box on that action instead.
            </p>
          </div>

          <div className="space-y-4">
            {NOTICE_GROUPS.map((group) => (
              <fieldset key={group.title} className="space-y-2">
                <legend className="text-theme-text-primary text-xs font-semibold tracking-wide uppercase">
                  {group.title}
                </legend>
                {group.notices.map((notice) => (
                  <div
                    key={notice.key}
                    className="border-theme-surface-border flex items-start gap-3 rounded-md border p-3"
                  >
                    <label
                      htmlFor={`settings-notice-${notice.key}`}
                      className="flex flex-1 cursor-pointer items-start gap-3"
                    >
                      <input
                        id={`settings-notice-${notice.key}`}
                        type="checkbox"
                        className="form-checkbox mt-0.5"
                        checked={form[notice.key]}
                        onChange={(e) => update(notice.key, e.target.checked)}
                      />
                      <span>
                        <span className="text-theme-text-primary block text-sm font-medium">{notice.label}</span>
                        <span className="text-theme-text-secondary block text-xs">{notice.detail}</span>
                      </span>
                    </label>
                    <div className="flex shrink-0 flex-col items-end">
                      <button
                        type="button"
                        onClick={() => setPreviewNotice(notice.notice)}
                        /* Every row's visible label is just "Preview", so the notice
                         has to be named for screen readers. It must be aria-label,
                         not an sr-only span: accessible-name computation trims each
                         child's text before concatenating, so a span opening with a
                         space announces as "Previewthe Order placed with…". */
                        aria-label={`Preview the ${notice.label} email`}
                        className="text-theme-text-secondary hover:text-theme-text-primary mobile-touch-target flex items-center gap-1 text-xs"
                      >
                        <Eye className="h-4 w-4" aria-hidden="true" />
                        Preview
                      </button>
                      {notice.alsoPreview?.map((extra) => (
                        <button
                          key={extra.notice}
                          type="button"
                          onClick={() => setPreviewNotice(extra.notice)}
                          aria-label={`Preview the ${extra.label} email`}
                          className="text-theme-text-secondary hover:text-theme-text-primary mobile-touch-target flex items-center gap-1 text-xs"
                        >
                          <Eye className="h-4 w-4" aria-hidden="true" />
                          {extra.buttonText}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </fieldset>
            ))}
          </div>

          <div className="form-grid-2">
            <div>
              {settingsField('paymentReminderDays', form.paymentReminderDays, (v) => update('paymentReminderDays', v), {
                type: 'number',
                inputMode: 'numeric',
                min: '1',
                max: '90',
              })}
            </div>
            <div>
              {settingsField('windowReminderHours', form.windowReminderHours, (v) => update('windowReminderHours', v), {
                type: 'number',
                inputMode: 'numeric',
                min: '1',
                max: '720',
              })}
            </div>
          </div>
          <div>{settingsField('notifyEmails', form.notifyEmails, (v) => update('notifyEmails', v))}</div>
        </section>

        <section className="card space-y-4 p-4">
          <h2 className="text-theme-text-primary text-sm font-semibold">Order text</h2>
          <div>
            <label htmlFor="settings-terms" className="form-label">
              Terms shown at checkout
            </label>
            <textarea
              id="settings-terms"
              rows={3}
              value={form.termsText}
              onChange={(e) => update('termsText', e.target.value)}
              className="form-input"
            />
          </div>
          <div>
            <label htmlFor="settings-receipt" className="form-label">
              Receipt footer
            </label>
            <textarea
              id="settings-receipt"
              rows={2}
              value={form.receiptFooter}
              onChange={(e) => update('receiptFooter', e.target.value)}
              className="form-input"
            />
          </div>
        </section>

        <div className="flex justify-end">
          <button type="submit" className="btn-primary btn-md" disabled={saving}>
            {saving ? 'Saving…' : 'Save settings'}
          </button>
        </div>
      </form>
      {/* Outside the form: the preview's own buttons must never submit the settings. */}
      {previewNotice && <NotificationPreviewModal notice={previewNotice} onClose={() => setPreviewNotice(null)} />}
    </>
  );
};
