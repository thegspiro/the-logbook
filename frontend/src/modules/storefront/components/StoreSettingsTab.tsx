/**
 * Store Settings Tab
 *
 * Store identity, which payment methods are accepted and where the money goes,
 * pricing rules, and which notices go out.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Eye, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { getErrorMessage } from '../../../utils/errorHandling';
import { storefrontService } from '../services/api';
import { NotificationPreviewModal } from './NotificationPreviewModal';
import {
  PAYMENT_METHOD_LABELS,
  PAYMENT_POLICY_OPTIONS,
  StorePaymentMethod,
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
  acceptedPaymentMethods: string[];
  paymentPolicy: string;
  venmoHandle: string;
  paypalMeUrl: string;
  paypalEmail: string;
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
  acceptedPaymentMethods: settings.acceptedPaymentMethods,
  paymentPolicy: settings.paymentPolicy ?? 'none',
  venmoHandle: settings.venmoHandle ?? '',
  paypalMeUrl: settings.paypalMeUrl ?? '',
  paypalEmail: settings.paypalEmail ?? '',
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
  notices: { key: NoticeKey; notice: string; label: string; detail: string }[];
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
        detail:
          'To the member when their order becomes ordered, ready for pickup, picked up, or cancelled.',
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
        detail: 'To store managers and the extra addresses below, each time an order lands.',
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
        detail:
          'To every active member when a window opens. An individual window can still opt out of its own announcement.',
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
        detail:
          'To everyone who ordered, when you record the vendor order — the update members chase.',
      },
    ],
  },
];

export const StoreSettingsTab: React.FC<StoreSettingsTabProps> = ({ onChanged }) => {
  const [form, setForm] = useState<FormState | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [previewNotice, setPreviewNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setForm(toForm(await storefrontService.getSettings()));
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to load store settings'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));

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
    const payload: StoreSettingsUpdate = {
      isEnabled: form.isEnabled,
      storeName: form.storeName.trim() || 'Department Store',
      tagline: form.tagline.trim() || undefined,
      description: form.description.trim() || undefined,
      acceptedPaymentMethods: form.acceptedPaymentMethods,
      paymentPolicy: form.paymentPolicy as StorePaymentPolicy,
      venmoHandle: form.venmoHandle.trim() || undefined,
      paypalMeUrl: form.paypalMeUrl.trim() || undefined,
      paypalEmail: form.paypalEmail.trim() || undefined,
      cashAppCashtag: form.cashAppCashtag.trim() || undefined,
      zelleHandle: form.zelleHandle.trim() || undefined,
      zelleInstructions: form.zelleInstructions.trim() || undefined,
      checkPayableTo: form.checkPayableTo.trim() || undefined,
      checkMailingAddress: form.checkMailingAddress.trim() || undefined,
      cashInstructions: form.cashInstructions.trim() || undefined,
      payrollDeductionInstructions: form.payrollDeductionInstructions.trim() || undefined,
      otherPaymentInstructions: form.otherPaymentInstructions.trim() || undefined,
      paymentInstructions: form.paymentInstructions.trim() || undefined,
      taxRate: Number(form.taxRatePercent || 0) / 100,
      shippingFlatRate: form.shippingFlatRate ? Number(form.shippingFlatRate) : undefined,
      allowPickup: form.allowPickup,
      allowShipping: form.allowShipping,
      pickupLocation: form.pickupLocation.trim() || undefined,
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
      termsText: form.termsText.trim() || undefined,
      receiptFooter: form.receiptFooter.trim() || undefined,
    };

    setSaving(true);
    try {
      setForm(toForm(await storefrontService.updateSettings(payload)));
      toast.success('Store settings saved');
      onChanged();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not save the settings'));
    } finally {
      setSaving(false);
    }
  }, [form, onChanged]);

  if (loading || !form) {
    return (
      <div className="flex justify-center py-12" role="status" aria-live="polite">
        <Loader2 className="text-theme-text-muted h-6 w-6 animate-spin" />
      </div>
    );
  }

  const accepts = (method: string) => form.acceptedPaymentMethods.includes(method);

  return (
    <div className="space-y-6">
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
        <div className="form-grid-2">
          <div>
            <label htmlFor="settings-name" className="form-label">
              Store name
            </label>
            <input
              id="settings-name"
              type="text"
              value={form.storeName}
              onChange={(e) => update('storeName', e.target.value)}
              className="form-input"
            />
          </div>
          <div>
            <label htmlFor="settings-tagline" className="form-label">
              Tagline
            </label>
            <input
              id="settings-tagline"
              type="text"
              value={form.tagline}
              onChange={(e) => update('tagline', e.target.value)}
              className="form-input"
            />
          </div>
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
            Departments differ on this and all three are normal. You can change it whenever your practice changes — it
            applies to what happens next, and never undoes a step already taken.
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
            <label htmlFor="settings-venmo" className="form-label">
              Venmo handle
            </label>
            <input
              id="settings-venmo"
              type="text"
              value={form.venmoHandle}
              onChange={(e) => update('venmoHandle', e.target.value)}
              className="form-input"
              placeholder="@FallsChurchFire"
            />
          </div>
        )}

        {accepts(StorePaymentMethod.PAYPAL) && (
          <div className="form-grid-2">
            <div>
              <label htmlFor="settings-paypal-url" className="form-label">
                PayPal.Me link
              </label>
              <input
                id="settings-paypal-url"
                type="text"
                value={form.paypalMeUrl}
                onChange={(e) => update('paypalMeUrl', e.target.value)}
                className="form-input"
                placeholder="https://paypal.me/yourdept"
              />
            </div>
            <div>
              <label htmlFor="settings-paypal-email" className="form-label">
                PayPal email
              </label>
              <input
                id="settings-paypal-email"
                type="email"
                value={form.paypalEmail}
                onChange={(e) => update('paypalEmail', e.target.value)}
                className="form-input"
              />
            </div>
          </div>
        )}

        {accepts(StorePaymentMethod.CASH_APP) && (
          <div>
            <label htmlFor="settings-cashapp" className="form-label">
              Cash App $cashtag
            </label>
            <input
              id="settings-cashapp"
              type="text"
              value={form.cashAppCashtag}
              onChange={(e) => update('cashAppCashtag', e.target.value)}
              className="form-input"
              placeholder="$FallsChurchFire"
            />
            <p className="text-theme-text-muted mt-1 text-xs">
              Cash App has no note field, so members are shown the order number to type in themselves.
            </p>
          </div>
        )}

        {accepts(StorePaymentMethod.ZELLE) && (
          <div className="form-grid-2">
            <div>
              <label htmlFor="settings-zelle" className="form-label">
                Zelle email or phone
              </label>
              <input
                id="settings-zelle"
                type="text"
                value={form.zelleHandle}
                onChange={(e) => update('zelleHandle', e.target.value)}
                className="form-input"
                placeholder="treasurer@yourdept.org"
              />
              <p className="text-theme-text-muted mt-1 text-xs">
                Zelle runs inside each member&apos;s own banking app, so there is no link to open — they are shown this
                handle to enter.
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
            <div>
              <label htmlFor="settings-check-payee" className="form-label">
                Checks payable to
              </label>
              <input
                id="settings-check-payee"
                type="text"
                value={form.checkPayableTo}
                onChange={(e) => update('checkPayableTo', e.target.value)}
                className="form-input"
              />
            </div>
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
            <label htmlFor="settings-tax" className="form-label">
              Sales tax (%)
            </label>
            <input
              id="settings-tax"
              type="number"
              min="0"
              max="100"
              step="0.01"
              value={form.taxRatePercent}
              onChange={(e) => update('taxRatePercent', e.target.value)}
              className="form-input"
            />
          </div>
          <div>
            <label htmlFor="settings-shipping" className="form-label">
              Flat shipping rate
            </label>
            <input
              id="settings-shipping"
              type="number"
              min="0"
              step="0.01"
              value={form.shippingFlatRate}
              onChange={(e) => update('shippingFlatRate', e.target.value)}
              className="form-input"
              disabled={!form.allowShipping}
            />
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
        <div>
          <label htmlFor="settings-pickup" className="form-label">
            Pickup location
          </label>
          <input
            id="settings-pickup"
            type="text"
            value={form.pickupLocation}
            onChange={(e) => update('pickupLocation', e.target.value)}
            className="form-input"
          />
        </div>
      </section>

      <section className="card space-y-4 p-4">
        <div>
          <h2 className="text-theme-text-primary text-sm font-semibold">Notifications</h2>
          <p className="text-theme-text-secondary mt-1 text-xs">
            Every email the store can send is listed here. Unticking one stops it for the
            whole department; the &ldquo;email members&rdquo; box on an individual action can
            still skip a single send.
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
                      <span className="text-theme-text-primary block text-sm font-medium">
                        {notice.label}
                      </span>
                      <span className="text-theme-text-secondary block text-xs">
                        {notice.detail}
                      </span>
                    </span>
                  </label>
                  <button
                    type="button"
                    onClick={() => setPreviewNotice(notice.notice)}
                    /* Every row's visible label is just "Preview", so the notice
                       has to be named for screen readers. It must be aria-label,
                       not an sr-only span: accessible-name computation trims each
                       child's text before concatenating, so a span opening with a
                       space announces as "Previewthe Order placed with…". */
                    aria-label={`Preview the ${notice.label} email`}
                    className="text-theme-text-secondary hover:text-theme-text-primary mobile-touch-target flex shrink-0 items-center gap-1 text-xs"
                  >
                    <Eye className="h-4 w-4" aria-hidden="true" />
                    Preview
                  </button>
                </div>
              ))}
            </fieldset>
          ))}
        </div>

        <div className="form-grid-2">
          <div>
            <label htmlFor="settings-reminder-days" className="form-label">
              Payment reminder after (days)
            </label>
            <input
              id="settings-reminder-days"
              type="number"
              min="1"
              max="90"
              value={form.paymentReminderDays}
              onChange={(e) => update('paymentReminderDays', e.target.value)}
              className="form-input"
            />
          </div>
          <div>
            <label htmlFor="settings-reminder-hours" className="form-label">
              &ldquo;Closing soon&rdquo; reminder (hours before close)
            </label>
            <input
              id="settings-reminder-hours"
              type="number"
              min="1"
              max="720"
              value={form.windowReminderHours}
              onChange={(e) => update('windowReminderHours', e.target.value)}
              className="form-input"
            />
          </div>
        </div>
        <div>
          <label htmlFor="settings-notify-emails" className="form-label">
            Extra notification recipients (comma separated)
          </label>
          <input
            id="settings-notify-emails"
            type="text"
            value={form.notifyEmails}
            onChange={(e) => update('notifyEmails', e.target.value)}
            className="form-input"
          />
        </div>
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
        <button
          type="button"
          className="btn-primary btn-md"
          disabled={saving}
          onClick={() => {
            void handleSave();
          }}
        >
          {saving ? 'Saving…' : 'Save settings'}
        </button>
      </div>

      {previewNotice && (
        <NotificationPreviewModal
          notice={previewNotice}
          onClose={() => setPreviewNotice(null)}
        />
      )}
    </div>
  );
};
