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
 * Blank optional fields are omitted (pitfall #1).
 */

import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { ArrowLeft } from 'lucide-react';
import toast from 'react-hot-toast';
import { fundraisingService } from '../services/api';
import { PaymentMethod } from '../types';
import type { DonationCreatePayload, Donor, FundraisingCampaign } from '../types';
import { getErrorMessage } from '@/utils/errorHandling';
import { getTodayLocalDate, localToUTC } from '@/utils/dateFormatting';
import { useTimezone } from '@/hooks/useTimezone';
import { PAYMENT_METHOD_LABELS, PAYMENT_STATUS_LABELS, donorDisplayName } from '../utils/labels';

/** The API's page ceiling; a department's donor list is well inside it. */
const PICKER_LIMIT = 1000;
const MAX_AMOUNT = 9_999_999_999.99;

const DonationFormPage: React.FC = () => {
  const navigate = useNavigate();
  const tz = useTimezone();
  const [searchParams] = useSearchParams();
  const [donors, setDonors] = useState<Donor[]>([]);
  const [campaigns, setCampaigns] = useState<FundraisingCampaign[]>([]);

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
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

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

  const validate = (): boolean => {
    const next: Record<string, string> = {};
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
    const payload: DonationCreatePayload = {
      amount: Number(amount).toFixed(2),
      // Midnight in the department's time zone, so the date reads back unchanged.
      donationDate: localToUTC(`${donationDate}T00:00`, tz),
      paymentMethod: paymentMethod as DonationCreatePayload['paymentMethod'],
      paymentStatus: paymentStatus as DonationCreatePayload['paymentStatus'],
      donorId: donorId || undefined,
      campaignId: campaignId || undefined,
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
      toast.error(getErrorMessage(err, 'Could not record the donation'));
    } finally {
      setSaving(false);
    }
  };

  const errorText = (field: string) =>
    errors[field] ? (
      <p id={`donation-${field}-error`} className="mt-1 text-xs text-red-700 dark:text-red-400">
        {errors[field]}
      </p>
    ) : null;
  const describedBy = (field: string) => (errors[field] ? `donation-${field}-error` : undefined);
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
        <h1 className="text-theme-text-primary text-2xl font-bold">Record Donation</h1>
        <p className="text-theme-text-secondary mt-1 text-sm">
          A completed gift linked to a campaign or donor counts toward that campaign&apos;s total and the donor&apos;s
          giving history.
        </p>
      </div>

      <form onSubmit={handleSubmit} noValidate className="space-y-6">
        <section className="card space-y-4 p-6" aria-labelledby="donation-gift-heading">
          <h2 id="donation-gift-heading" className="text-theme-text-primary font-semibold">
            Gift
          </h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label htmlFor="donation-amount" className="form-label">
                Amount
              </label>
              <input
                id="donation-amount"
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                className="form-input"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                aria-invalid={Boolean(errors.amount)}
                aria-describedby={describedBy('amount')}
              />
              {errorText('amount')}
            </div>
            <div>
              <label htmlFor="donation-date" className="form-label">
                Date received
              </label>
              <input
                id="donation-date"
                type="date"
                className="form-input"
                value={donationDate}
                onChange={(e) => setDonationDate(e.target.value)}
                aria-invalid={Boolean(errors.donationDate)}
                aria-describedby={describedBy('donationDate')}
              />
              {errorText('donationDate')}
            </div>
            <div>
              <label htmlFor="donation-method" className="form-label">
                Payment method
              </label>
              <select
                id="donation-method"
                className="form-input"
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
              >
                {Object.entries(PAYMENT_METHOD_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="donation-status" className="form-label">
                Payment status
              </label>
              <select
                id="donation-status"
                className="form-input"
                value={paymentStatus}
                onChange={(e) => setPaymentStatus(e.target.value)}
                aria-describedby="donation-status-hint"
              >
                {Object.entries(PAYMENT_STATUS_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <p id="donation-status-hint" className="text-theme-text-secondary mt-1 text-xs">
                Only a completed gift counts toward campaign and donor totals.
              </p>
            </div>
            <div>
              <label htmlFor="donation-campaign" className="form-label">
                Campaign {optional}
              </label>
              <select
                id="donation-campaign"
                className="form-input"
                value={campaignId}
                onChange={(e) => setCampaignId(e.target.value)}
              >
                <option value="">No campaign</option>
                {campaigns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </section>

        <section className="card space-y-4 p-6" aria-labelledby="donation-donor-heading">
          <h2 id="donation-donor-heading" className="text-theme-text-primary font-semibold">
            Donor
          </h2>
          <div>
            <label htmlFor="donation-donor" className="form-label">
              Donor {optional}
            </label>
            <select
              id="donation-donor"
              className="form-input"
              value={donorId}
              onChange={(e) => setDonorId(e.target.value)}
            >
              <option value="">Not in the donor directory</option>
              {donors.map((d) => (
                <option key={d.id} value={d.id}>
                  {donorDisplayName(d)}
                </option>
              ))}
            </select>
          </div>
          {!donorId && (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div>
                <label htmlFor="donation-donor-name" className="form-label">
                  Donor name {optional}
                </label>
                <input
                  id="donation-donor-name"
                  type="text"
                  maxLength={255}
                  className="form-input"
                  value={donorName}
                  onChange={(e) => setDonorName(e.target.value)}
                />
              </div>
              <div>
                <label htmlFor="donation-donor-email" className="form-label">
                  Donor email {optional}
                </label>
                <input
                  id="donation-donor-email"
                  type="email"
                  inputMode="email"
                  maxLength={255}
                  className="form-input"
                  value={donorEmail}
                  onChange={(e) => setDonorEmail(e.target.value)}
                />
              </div>
            </div>
          )}
          <label className="touch:min-h-11 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="form-checkbox"
              checked={isAnonymous}
              onChange={(e) => setIsAnonymous(e.target.checked)}
            />
            <span className="text-theme-text-primary">Anonymous — keep the donor&apos;s name out of public views</span>
          </label>
        </section>

        <section className="card space-y-4 p-6" aria-labelledby="donation-details-heading">
          <h2 id="donation-details-heading" className="text-theme-text-primary font-semibold">
            Details
          </h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label htmlFor="donation-dedication" className="form-label">
                Dedication {optional}
              </label>
              <select
                id="donation-dedication"
                className="form-input"
                value={dedicationType}
                onChange={(e) => setDedicationType(e.target.value)}
              >
                <option value="">None</option>
                <option value="in_honor">In honor of</option>
                <option value="in_memory">In memory of</option>
              </select>
            </div>
            {dedicationType && (
              <div>
                <label htmlFor="donation-dedication-name" className="form-label">
                  Honoring
                </label>
                <input
                  id="donation-dedication-name"
                  type="text"
                  maxLength={255}
                  className="form-input"
                  value={dedicationName}
                  onChange={(e) => setDedicationName(e.target.value)}
                  aria-invalid={Boolean(errors.dedicationName)}
                  aria-describedby={describedBy('dedicationName')}
                />
                {errorText('dedicationName')}
              </div>
            )}
          </div>
          <label className="touch:min-h-11 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="form-checkbox"
              checked={taxDeductible}
              onChange={(e) => setTaxDeductible(e.target.checked)}
            />
            <span className="text-theme-text-primary">Tax deductible</span>
          </label>
          <div>
            <label htmlFor="donation-notes" className="form-label">
              Notes {optional}
            </label>
            <textarea
              id="donation-notes"
              rows={3}
              className="form-input"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
        </section>

        <div className="flex flex-wrap justify-end gap-3">
          <Link to="/grants/donations" className="btn-secondary">
            Cancel
          </Link>
          <button type="submit" disabled={saving} className="btn-primary">
            Record donation
          </button>
        </div>
      </form>
    </div>
  );
};

export default DonationFormPage;
