/**
 * Record Donation
 *
 * Records one gift (`POST /grants/donations`, `fundraising.manage`). A
 * completed donation linked to a campaign or a donor moves that campaign's
 * raised total and that donor's giving history — the backend recomputes both
 * from its donations, so this form only names the links (pitfall #29), and
 * the backend refuses a campaign or donor outside the department.
 *
 * `?donorId=` and `?campaignId=` preselect the links, so a donor's or a
 * campaign's own screen can send the user here already filled in.
 *
 * Once a donor is chosen, the gift can pay toward one of that donor's open
 * pledges (owner decision, 2026-11-01). The backend adds a completed gift to
 * the pledge's received amount and settles its status, and refuses a pledge
 * of another donor or one already fulfilled or cancelled; the form offers
 * only the donor's open ones, plus, when editing, the pledge the gift already
 * pays toward (which that gift may itself have fulfilled).
 *
 * Blank optional fields are omitted (pitfall #1).
 *
 * At `/grants/donations/:donationId/edit` the same form edits one gift
 * (`PUT /grants/donations/{id}`, W69). An update leaves an omitted key alone,
 * so every field the form owns is sent there, with an emptied one as null.
 */

import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { ArrowLeft } from 'lucide-react';
import toast from 'react-hot-toast';
import { fundraisingService } from '../services/api';
import { PaymentMethod, PledgeStatus } from '../types';
import type { Donation, DonationCreatePayload, Donor, FundraisingCampaign, Pledge } from '../types';
import { getErrorMessage } from '@/utils/errorHandling';
import { FormField } from '@/components/ux/FormField';
import { mapServerFieldErrors, type ServerFieldSpec } from '@/utils/serverFieldErrors';
import { formatCalendarDate, getTodayLocalDate, localToUTC, toLocalISODate } from '@/utils/dateFormatting';
import { blankToNull } from '@/utils/formValues';
import { useTimezone } from '@/hooks/useTimezone';
import { formatCurrency } from '@/utils/currencyFormatting';
import { PAYMENT_METHOD_LABELS, PAYMENT_STATUS_LABELS, donorDisplayName } from '../utils/labels';

/** The API's page ceiling; a department's donor list is well inside it. */
const PICKER_LIMIT = 1000;
const MAX_AMOUNT = 9_999_999_999.99;

/** `DonationCreate`'s max_length on the donor's name and email and the dedication. */
const MAX_TEXT = 255;

type DonationField =
  | 'amount'
  | 'donationDate'
  | 'paymentMethod'
  | 'paymentStatus'
  | 'campaignId'
  | 'donorId'
  | 'pledgeId'
  | 'donorName'
  | 'donorEmail'
  | 'isAnonymous'
  | 'dedicationType'
  | 'dedicationName'
  | 'taxDeductible'
  | 'notes';

/**
 * The fields as a 422 names them; each is also its key in the create and
 * update payloads. Grant request schemas report the camelCase alias, and the
 * mapper reads both spellings.
 */
const SERVER_FIELDS: Record<DonationField, ServerFieldSpec> = {
  amount: { label: 'Amount' },
  donationDate: { label: 'Date received' },
  paymentMethod: { label: 'Payment method' },
  paymentStatus: { label: 'Payment status' },
  campaignId: { label: 'Campaign' },
  donorId: { label: 'Donor' },
  pledgeId: { label: 'Pays toward a pledge' },
  donorName: { label: 'Donor name', maxLength: MAX_TEXT },
  donorEmail: { label: 'Donor email', maxLength: MAX_TEXT },
  isAnonymous: { label: 'Anonymous' },
  dedicationType: { label: 'Dedication' },
  dedicationName: { label: 'Honoring', maxLength: MAX_TEXT },
  taxDeductible: { label: 'Tax deductible' },
  notes: { label: 'Notes' },
};

const FIELD_IDS: Record<DonationField, string> = {
  amount: 'donation-amount',
  donationDate: 'donation-date',
  paymentMethod: 'donation-method',
  paymentStatus: 'donation-status',
  campaignId: 'donation-campaign',
  donorId: 'donation-donor',
  pledgeId: 'donation-pledge',
  donorName: 'donation-donor-name',
  donorEmail: 'donation-donor-email',
  isAnonymous: 'donation-anonymous',
  dedicationType: 'donation-dedication',
  dedicationName: 'donation-dedication-name',
  taxDeductible: 'donation-tax-deductible',
  notes: 'donation-notes',
};

/** The statuses a gift may still be recorded against. */
const OPEN_PLEDGE_STATUSES: ReadonlySet<string> = new Set([
  PledgeStatus.PENDING,
  PledgeStatus.PARTIAL,
  PledgeStatus.OVERDUE,
]);

const DonationFormPage: React.FC = () => {
  const navigate = useNavigate();
  const tz = useTimezone();
  const [searchParams] = useSearchParams();
  const { donationId } = useParams<{ donationId: string }>();
  const isEdit = Boolean(donationId);
  // Edit mode loads the gift before the form can be trusted; a failed load
  // shows a message rather than an empty form that would save blanks over it.
  const [loadState, setLoadState] = useState<'loading' | 'ready' | 'failed'>(isEdit ? 'loading' : 'ready');
  const [donors, setDonors] = useState<Donor[]>([]);
  const [campaigns, setCampaigns] = useState<FundraisingCampaign[]>([]);
  const [pledges, setPledges] = useState<Pledge[]>([]);
  const [pledgeId, setPledgeId] = useState('');
  // The donor and pledge the edited gift was saved with, so the pledge
  // picker can keep that link while the donor is unchanged.
  const [savedLink, setSavedLink] = useState<{ donorId: string; pledgeId: string } | null>(null);

  const [donorId, setDonorId] = useState(searchParams.get('donorId') ?? '');
  const [campaignId, setCampaignId] = useState(searchParams.get('campaignId') ?? '');
  const [amount, setAmount] = useState('');
  const [donationDate, setDonationDate] = useState(() => getTodayLocalDate(tz));
  const [paymentMethod, setPaymentMethod] = useState<string>(PaymentMethod.CHECK);
  const [paymentStatus, setPaymentStatus] = useState('completed');
  const [donorName, setDonorName] = useState('');
  const [donorEmail, setDonorEmail] = useState('');
  const [isAnonymous, setIsAnonymous] = useState(false);
  const [dedicationType, setDedicationType] = useState('');
  const [dedicationName, setDedicationName] = useState('');
  const [taxDeductible, setTaxDeductible] = useState(true);
  const [notes, setNotes] = useState('');
  const [errors, setErrors] = useState<Partial<Record<DonationField, string>>>({});
  const [saving, setSaving] = useState(false);
  const clearError = (field: DonationField) =>
    setErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });
  const focusField = (field: DonationField | undefined) => {
    if (field) document.getElementById(FIELD_IDS[field])?.focus();
  };

  useEffect(() => {
    let cancelled = false;
    // Each list fails on its own: without donors the gift can still be
    // recorded by name, and without campaigns it can still be recorded.
    void Promise.allSettled([
      fundraisingService.listDonors({ active: true, limit: PICKER_LIMIT }),
      fundraisingService.listCampaigns({ limit: PICKER_LIMIT }),
    ]).then(([donorResult, campaignResult]) => {
      if (cancelled) return;
      if (donorResult.status === 'fulfilled') setDonors(donorResult.value);
      if (campaignResult.status === 'fulfilled') setCampaigns(campaignResult.value);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!donationId) return;
    let cancelled = false;
    const fill = (d: Donation) => {
      setDonorId(d.donorId ?? '');
      setCampaignId(d.campaignId ?? '');
      setAmount(String(Number(d.amount)));
      setDonationDate(toLocalISODate(d.donationDate, tz));
      setPaymentMethod(d.paymentMethod);
      setPaymentStatus(d.paymentStatus);
      setDonorName(d.donorName ?? '');
      setDonorEmail(d.donorEmail ?? '');
      setIsAnonymous(d.isAnonymous);
      setDedicationType(d.dedicationType ?? '');
      setDedicationName(d.dedicationName ?? '');
      setTaxDeductible(d.taxDeductible);
      setNotes(d.notes ?? '');
      setSavedLink({ donorId: d.donorId ?? '', pledgeId: d.pledgeId ?? '' });
    };
    fundraisingService
      .getDonation(donationId)
      .then((d) => {
        if (cancelled) return;
        fill(d);
        setLoadState('ready');
      })
      .catch(() => {
        if (!cancelled) setLoadState('failed');
      });
    return () => {
      cancelled = true;
    };
  }, [donationId, tz]);

  useEffect(() => {
    let cancelled = false;
    // A different donor's pledges are not this gift's to pay; only the
    // edited gift's own donor keeps the pledge it was saved against.
    const keptPledgeId = donorId && savedLink?.donorId === donorId ? savedLink.pledgeId : '';
    setPledgeId(keptPledgeId);
    setPledges([]);
    if (!donorId) return undefined;
    // Without the list the gift is still recorded; it just names no new pledge.
    fundraisingService
      .listPledges({ donorId, limit: PICKER_LIMIT })
      .then((rows) => {
        if (cancelled) return;
        setPledges(
          rows.filter(
            (p) =>
              p.donorId === donorId && (OPEN_PLEDGE_STATUSES.has(p.status) || (keptPledgeId && p.id === keptPledgeId))
          )
        );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [donorId, savedLink]);

  const validate = (): boolean => {
    const next: Partial<Record<DonationField, string>> = {};
    const parsed = Number(amount);
    if (amount.trim() === '' || !Number.isFinite(parsed) || parsed <= 0) {
      next.amount = 'Enter an amount greater than zero.';
    } else if (parsed > MAX_AMOUNT) {
      next.amount = 'That amount is too large.';
    }
    if (!donationDate) next.donationDate = 'Enter the date the gift was received.';
    if (dedicationType && !dedicationName.trim()) next.dedicationName = 'Name the person the gift honours.';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) {
      toast.error('Fix the fields marked below.');
      return;
    }
    if (donationId) {
      void saveEdit(donationId);
      return;
    }
    const payload: DonationCreatePayload = {
      amount: Number(amount).toFixed(2),
      // Midnight in the department's time zone, so the date reads back unchanged.
      donationDate: localToUTC(`${donationDate}T00:00`, tz),
      paymentMethod: paymentMethod as DonationCreatePayload['paymentMethod'],
      paymentStatus: paymentStatus as DonationCreatePayload['paymentStatus'],
      donorId: donorId || undefined,
      campaignId: campaignId || undefined,
      pledgeId: (donorId && pledgeId) || undefined,
      // A linked donor already carries the name and email.
      donorName: (!donorId && donorName.trim()) || undefined,
      donorEmail: (!donorId && donorEmail.trim()) || undefined,
      isAnonymous,
      dedicationType: (dedicationType || undefined) as DonationCreatePayload['dedicationType'],
      dedicationName: (dedicationType && dedicationName.trim()) || undefined,
      taxDeductible,
      notes: notes.trim() || undefined,
    };
    void save(payload);
  };

  const save = async (payload: DonationCreatePayload) => {
    setSaving(true);
    try {
      await fundraisingService.createDonation(payload);
      toast.success('Donation recorded');
      void navigate('/grants/donations');
    } catch (err: unknown) {
      // A gift is recorded only once nothing is refused, so each refusal goes
      // on its field (forms review F-2).
      const mapped = mapServerFieldErrors(err, SERVER_FIELDS);
      const keys = Object.keys(mapped?.fieldErrors ?? {}) as DonationField[];
      if (mapped && keys[0]) {
        setErrors(mapped.fieldErrors);
        focusField(keys[0]);
        if (mapped.unmatched.length > 0) toast.error(mapped.unmatched.join(' '));
        return;
      }
      toast.error(mapped?.unmatched.join(' ') || getErrorMessage(err, 'Could not record the donation'));
    } finally {
      setSaving(false);
    }
  };

  const saveEdit = async (id: string) => {
    setSaving(true);
    try {
      const payload: Parameters<typeof fundraisingService.updateDonation>[1] = {
        amount: Number(Number(amount).toFixed(2)),
        donationDate: localToUTC(`${donationDate}T00:00`, tz),
        paymentMethod: paymentMethod as Donation['paymentMethod'],
        paymentStatus,
        donorId: blankToNull(donorId),
        campaignId: blankToNull(campaignId),
        // null unlinks the gift from its pledge, which gives the amount back.
        pledgeId: donorId ? blankToNull(pledgeId) : null,
        // A linked donor carries the name and email, as on create.
        donorName: donorId ? null : blankToNull(donorName),
        donorEmail: donorId ? null : blankToNull(donorEmail),
        isAnonymous,
        dedicationType: blankToNull(dedicationType),
        dedicationName: dedicationType ? blankToNull(dedicationName) : null,
        taxDeductible,
        notes: blankToNull(notes),
      };
      let refused: Partial<Record<DonationField, string>> = {};
      try {
        await fundraisingService.updateDonation(id, payload);
      } catch (err: unknown) {
        // Owner rule (2026-11-05) for a single-save form: a value the gift
        // cannot hold is not written, the rest saves, and the field keeps what
        // was typed, flagged, until it is fixed. Anything the form has no
        // field for is a real failure and is reported as one.
        const mapped = mapServerFieldErrors(err, SERVER_FIELDS);
        const keys = Object.keys(mapped?.fieldErrors ?? {}) as DonationField[];
        if (!mapped || keys.length === 0 || mapped.unmatched.length > 0) throw err;
        refused = mapped.fieldErrors;
        const rest: typeof payload = { ...payload };
        for (const key of keys) delete rest[key];
        await fundraisingService.updateDonation(id, rest);
      }
      const firstRefused = (Object.keys(refused) as DonationField[])[0];
      if (firstRefused) {
        // Stays on the page, so the refused field can be fixed and saved again.
        setErrors(refused);
        toast.error(
          `Donation saved, except ${SERVER_FIELDS[firstRefused].label.toLowerCase()}: ${refused[firstRefused] ?? ''} Fix it and save again.`
        );
        focusField(firstRefused);
        return;
      }
      toast.success('Donation updated');
      void navigate('/grants/donations');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not update the donation'));
    } finally {
      setSaving(false);
    }
  };

  const optional = <span className="text-theme-text-secondary font-normal">(optional)</span>;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link
        to="/grants/donations"
        className="text-theme-text-secondary hover:text-theme-text-primary touch:min-h-11 inline-flex items-center gap-2 text-sm"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Donations
      </Link>
      <div>
        <h1 className="text-theme-text-primary text-2xl font-bold">{isEdit ? 'Edit Donation' : 'Record Donation'}</h1>
        <p className="text-theme-text-secondary mt-1 text-sm">
          A completed gift linked to a campaign or donor counts toward that campaign&apos;s total and the donor&apos;s
          giving history.
        </p>
      </div>

      {loadState === 'loading' && (
        <p className="text-theme-text-secondary" role="status">
          Loading the donation…
        </p>
      )}
      {loadState === 'failed' && (
        <p className="alert-danger" role="alert">
          This donation could not be loaded. It may have been removed, or you may not have access to it.
        </p>
      )}
      {loadState === 'ready' && (
        <form onSubmit={handleSubmit} noValidate className="space-y-6">
          <section className="card space-y-4 p-6" aria-labelledby="donation-gift-heading">
            <h2 id="donation-gift-heading" className="text-theme-text-primary font-semibold">
              Gift
            </h2>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <FormField id={FIELD_IDS.amount} label="Amount" required error={errors.amount}>
                {(field) => (
                  <input
                    {...field}
                    type="number"
                    inputMode="decimal"
                    min="0"
                    step="0.01"
                    className="form-input"
                    value={amount}
                    onChange={(e) => {
                      setAmount(e.target.value);
                      clearError('amount');
                    }}
                  />
                )}
              </FormField>
              <FormField id={FIELD_IDS.donationDate} label="Date received" required error={errors.donationDate}>
                {(field) => (
                  <input
                    {...field}
                    type="date"
                    className="form-input"
                    value={donationDate}
                    onChange={(e) => {
                      setDonationDate(e.target.value);
                      clearError('donationDate');
                    }}
                  />
                )}
              </FormField>
              <FormField id={FIELD_IDS.paymentMethod} label="Payment method" required error={errors.paymentMethod}>
                {(field) => (
                  <select
                    {...field}
                    className="form-input"
                    value={paymentMethod}
                    onChange={(e) => {
                      setPaymentMethod(e.target.value);
                      clearError('paymentMethod');
                    }}
                  >
                    {Object.entries(PAYMENT_METHOD_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                )}
              </FormField>
              <FormField
                id={FIELD_IDS.paymentStatus}
                label="Payment status"
                required
                error={errors.paymentStatus}
                hint="Only a completed gift counts toward campaign and donor totals."
              >
                {(field) => (
                  <select
                    {...field}
                    className="form-input"
                    value={paymentStatus}
                    onChange={(e) => {
                      setPaymentStatus(e.target.value);
                      clearError('paymentStatus');
                    }}
                  >
                    {Object.entries(PAYMENT_STATUS_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                )}
              </FormField>
              <FormField id={FIELD_IDS.campaignId} label={<>Campaign {optional}</>} error={errors.campaignId}>
                {(field) => (
                  <select
                    {...field}
                    className="form-input"
                    value={campaignId}
                    onChange={(e) => {
                      setCampaignId(e.target.value);
                      clearError('campaignId');
                    }}
                  >
                    <option value="">No campaign</option>
                    {/* Keeps a linked campaign the picker no longer lists, so
                      saving does not silently unlink the gift. */}
                    {campaignId && !campaigns.some((c) => c.id === campaignId) && (
                      <option value={campaignId}>Current campaign</option>
                    )}
                    {campaigns.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                  </select>
                )}
              </FormField>
            </div>
          </section>

          <section className="card space-y-4 p-6" aria-labelledby="donation-donor-heading">
            <h2 id="donation-donor-heading" className="text-theme-text-primary font-semibold">
              Donor
            </h2>
            <FormField id={FIELD_IDS.donorId} label={<>Donor {optional}</>} error={errors.donorId}>
              {(field) => (
                <select
                  {...field}
                  className="form-input"
                  value={donorId}
                  onChange={(e) => {
                    setDonorId(e.target.value);
                    clearError('donorId');
                  }}
                >
                  <option value="">Not in the donor directory</option>
                  {/* The picker lists active donors only; keep a linked one
                      that is no longer active selectable. */}
                  {donorId && !donors.some((d) => d.id === donorId) && <option value={donorId}>Current donor</option>}
                  {donors.map((d) => (
                    <option key={d.id} value={d.id}>
                      {donorDisplayName(d)}
                    </option>
                  ))}
                </select>
              )}
            </FormField>
            {donorId && (pledges.length > 0 || pledgeId) && (
              <FormField
                id={FIELD_IDS.pledgeId}
                label={<>Pays toward a pledge {optional}</>}
                error={errors.pledgeId}
                hint="A completed gift is added to the pledge's amount received, and the pledge is marked fulfilled once paid in full."
              >
                {(field) => (
                  <select
                    {...field}
                    className="form-input"
                    value={pledgeId}
                    onChange={(e) => {
                      setPledgeId(e.target.value);
                      clearError('pledgeId');
                    }}
                  >
                    <option value="">Not toward a pledge</option>
                    {/* Keeps the saved pledge selectable if the list could not
                      load, so saving does not silently unlink the gift. */}
                    {pledgeId && !pledges.some((p) => p.id === pledgeId) && (
                      <option value={pledgeId}>Current pledge</option>
                    )}
                    {pledges.map((p) => (
                      <option key={p.id} value={p.id}>
                        {`${formatCurrency(p.pledgedAmount)} pledged ${formatCalendarDate(p.pledgeDate)}, ${formatCurrency(p.fulfilledAmount)} received`}
                      </option>
                    ))}
                  </select>
                )}
              </FormField>
            )}
            {!donorId && (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <FormField
                  id={FIELD_IDS.donorName}
                  label={<>Donor name {optional}</>}
                  error={errors.donorName}
                  maxLength={MAX_TEXT}
                  count={donorName.length}
                >
                  {(field) => (
                    <input
                      {...field}
                      type="text"
                      autoComplete="off"
                      className="form-input"
                      value={donorName}
                      onChange={(e) => {
                        setDonorName(e.target.value);
                        clearError('donorName');
                      }}
                    />
                  )}
                </FormField>
                <FormField
                  id={FIELD_IDS.donorEmail}
                  label={<>Donor email {optional}</>}
                  error={errors.donorEmail}
                  maxLength={MAX_TEXT}
                  count={donorEmail.length}
                >
                  {(field) => (
                    <input
                      {...field}
                      type="email"
                      inputMode="email"
                      autoComplete="off"
                      className="form-input"
                      value={donorEmail}
                      onChange={(e) => {
                        setDonorEmail(e.target.value);
                        clearError('donorEmail');
                      }}
                    />
                  )}
                </FormField>
              </div>
            )}
            <label className="touch:min-h-11 flex items-center gap-2 text-sm">
              <input
                id={FIELD_IDS.isAnonymous}
                type="checkbox"
                className="form-checkbox"
                checked={isAnonymous}
                onChange={(e) => {
                  setIsAnonymous(e.target.checked);
                  clearError('isAnonymous');
                }}
                aria-invalid={errors.isAnonymous ? true : undefined}
              />
              <span className="text-theme-text-primary">
                Anonymous — keep the donor&apos;s name out of public views
              </span>
            </label>
            {errors.isAnonymous && (
              <p role="alert" className="text-sm text-red-800 dark:text-red-300">
                {errors.isAnonymous}
              </p>
            )}
          </section>

          <section className="card space-y-4 p-6" aria-labelledby="donation-details-heading">
            <h2 id="donation-details-heading" className="text-theme-text-primary font-semibold">
              Details
            </h2>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <FormField id={FIELD_IDS.dedicationType} label={<>Dedication {optional}</>} error={errors.dedicationType}>
                {(field) => (
                  <select
                    {...field}
                    className="form-input"
                    value={dedicationType}
                    onChange={(e) => {
                      setDedicationType(e.target.value);
                      clearError('dedicationType');
                    }}
                  >
                    <option value="">None</option>
                    <option value="in_honor">In honor of</option>
                    <option value="in_memory">In memory of</option>
                  </select>
                )}
              </FormField>
              {dedicationType && (
                <FormField
                  id={FIELD_IDS.dedicationName}
                  label="Honoring"
                  required
                  error={errors.dedicationName}
                  maxLength={MAX_TEXT}
                  count={dedicationName.length}
                >
                  {(field) => (
                    <input
                      {...field}
                      type="text"
                      autoComplete="off"
                      className="form-input"
                      value={dedicationName}
                      onChange={(e) => {
                        setDedicationName(e.target.value);
                        clearError('dedicationName');
                      }}
                    />
                  )}
                </FormField>
              )}
            </div>
            <label className="touch:min-h-11 flex items-center gap-2 text-sm">
              <input
                id={FIELD_IDS.taxDeductible}
                type="checkbox"
                className="form-checkbox"
                checked={taxDeductible}
                onChange={(e) => {
                  setTaxDeductible(e.target.checked);
                  clearError('taxDeductible');
                }}
                aria-invalid={errors.taxDeductible ? true : undefined}
              />
              <span className="text-theme-text-primary">Tax deductible</span>
            </label>
            {errors.taxDeductible && (
              <p role="alert" className="text-sm text-red-800 dark:text-red-300">
                {errors.taxDeductible}
              </p>
            )}
            <FormField id={FIELD_IDS.notes} label={<>Notes {optional}</>} error={errors.notes}>
              {(field) => (
                <textarea
                  {...field}
                  rows={3}
                  className="form-input"
                  value={notes}
                  onChange={(e) => {
                    setNotes(e.target.value);
                    clearError('notes');
                  }}
                />
              )}
            </FormField>
          </section>

          <div className="flex flex-wrap justify-end gap-3">
            <Link to="/grants/donations" className="btn-secondary">
              Cancel
            </Link>
            <button type="submit" disabled={saving} className="btn-primary">
              {isEdit ? 'Save changes' : 'Record donation'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
};

export default DonationFormPage;
