/**
 * Create or edit a dues schedule — what each member owes, and when.
 *
 * The Treasurer's screen (`finance.manage`, the gate on both endpoints).
 * A schedule on its own bills nobody: member dues are created from it by
 * **Generate dues** on the dues page.
 *
 * The grace period, late fee, fiscal year and membership types are applied
 * (owner decision 2026-11-01): generation bills only the listed membership
 * types (none listed bills everyone) and refuses a due date outside the
 * fiscal year, and a daily task adds the late fee once to dues still unpaid
 * after the grace period. A schedule saved before then has them stored but
 * not applied (`termsEffectiveAt` is null); saving it here applies them, which
 * the form says before the Treasurer saves.
 */

import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { Modal } from '../../../components/Modal';
import { getErrorMessage } from '../../../utils/errorHandling';
import { localToUTC, toLocalISODate } from '../../../utils/dateFormatting';
import { blankToNull } from '../../../utils/formValues';
import { useTimezone } from '../../../hooks/useTimezone';
import { duesService, fiscalYearService } from '../services/api';
import { DuesFrequency } from '../types';
import type {
  DuesSchedule,
  DuesScheduleCreatePayload,
  DuesScheduleUpdatePayload,
  FinanceNamedOption,
  FiscalYearOption,
} from '../types';
import { DUES_FREQUENCY_LABELS } from '../utils/dues';
import { MAX_MONEY_AMOUNT } from '../utils/moneyLimits';

/** The largest amount the backend's Numeric(12, 2) column holds. */
const MAX_NAME = 200;
/** The backend's own default for a new schedule's grace period. */
const DEFAULT_GRACE_DAYS = 30;
const MAX_GRACE_DAYS = 3650;

interface DuesScheduleDialogProps {
  /** The schedule being edited; omitted to create one. */
  schedule?: DuesSchedule | undefined;
  onClose: () => void;
  /** Called after a save; the caller re-fetches what it shows. */
  onSaved: (schedule: DuesSchedule) => void;
}

export const DuesScheduleDialog: React.FC<DuesScheduleDialogProps> = ({ schedule, onClose, onSaved }) => {
  const tz = useTimezone();
  const isEdit = schedule !== undefined;
  const [name, setName] = useState(schedule?.name ?? '');
  const [amount, setAmount] = useState(schedule ? String(schedule.amount) : '');
  const [frequency, setFrequency] = useState<DuesFrequency>(schedule?.frequency ?? DuesFrequency.ANNUAL);
  const [dueDate, setDueDate] = useState(schedule ? toLocalISODate(schedule.dueDate, tz) : '');
  const [isActive, setIsActive] = useState(schedule?.isActive ?? true);
  const [notes, setNotes] = useState(schedule?.notes ?? '');
  const [incomeAccount, setIncomeAccount] = useState(schedule?.qbIncomeAccount ?? '');
  const [depositAccount, setDepositAccount] = useState(schedule?.qbDepositAccount ?? '');
  const [graceDays, setGraceDays] = useState(String(schedule?.gracePeriodDays ?? DEFAULT_GRACE_DAYS));
  const [lateFee, setLateFee] = useState(
    schedule?.lateFeeAmount !== undefined && schedule.lateFeeAmount !== null ? String(schedule.lateFeeAmount) : ''
  );
  const [fiscalYearId, setFiscalYearId] = useState(schedule?.fiscalYearId ?? '');
  const [membershipTypes, setMembershipTypes] = useState<string[]>(schedule?.appliesToMembershipTypes ?? []);
  const [yearOptions, setYearOptions] = useState<FiscalYearOption[]>([]);
  const [typeOptions, setTypeOptions] = useState<FinanceNamedOption[]>([]);
  // A schedule saved before 2026-11-01 stores these terms without applying them.
  const termsNotYetApplied = isEdit && !schedule.termsEffectiveAt;

  useEffect(() => {
    let cancelled = false;
    // Optional pickers: if either list fails, the form still saves the rest.
    fiscalYearService
      .options()
      .then((rows) => {
        if (!cancelled) setYearOptions(rows);
      })
      .catch(() => undefined);
    duesService
      .membershipTypeOptions()
      .then((rows) => {
        if (!cancelled) setTypeOptions(rows);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  // A stored year or type no longer offered (a closed year, a retired tier)
  // is still shown, so saving the form does not silently drop it.
  const yearChoices: FinanceNamedOption[] = [
    ...yearOptions.map((y) => ({ id: y.id, name: y.name })),
    ...(fiscalYearId && !yearOptions.some((y) => y.id === fiscalYearId)
      ? [{ id: fiscalYearId, name: 'Current fiscal year (no longer open)' }]
      : []),
  ];
  const typeChoices: FinanceNamedOption[] = [
    ...typeOptions,
    ...membershipTypes.filter((t) => !typeOptions.some((o) => o.id === t)).map((t) => ({ id: t, name: t })),
  ];

  const toggleType = (id: string) =>
    setMembershipTypes((current) => (current.includes(id) ? current.filter((t) => t !== id) : [...current, id]));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const validate = (): boolean => {
    const next: Record<string, string> = {};
    if (!name.trim()) next.name = 'Give the schedule a name, for example "2027 annual dues".';
    const parsed = Number(amount);
    if (amount.trim() === '' || !Number.isFinite(parsed) || parsed <= 0) {
      next.amount = 'Enter an amount greater than zero.';
    } else if (parsed > MAX_MONEY_AMOUNT) {
      next.amount = 'That amount is too large.';
    }
    if (!dueDate) next.dueDate = 'Enter the date dues are due.';
    const grace = Number(graceDays);
    if (graceDays.trim() === '' || !Number.isInteger(grace) || grace < 0 || grace > MAX_GRACE_DAYS) {
      next.graceDays = 'Enter a whole number of days, 0 or more.';
    }
    if (lateFee.trim() !== '') {
      const fee = Number(lateFee);
      if (!Number.isFinite(fee) || fee < 0) next.lateFee = 'Enter a late fee of 0 or more, or leave it blank.';
      else if (fee > MAX_MONEY_AMOUNT) next.lateFee = 'That amount is too large.';
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    void save();
  };

  const save = async () => {
    const amountText = Number(amount).toFixed(2);
    // Midnight in the department's time zone, so the date reads back unchanged.
    const dueInstant = localToUTC(`${dueDate}T00:00`, tz);
    const graceValue = Number(graceDays);
    // A blank or zero fee charges nothing.
    const feeText = lateFee.trim() !== '' && Number(lateFee) > 0 ? Number(lateFee).toFixed(2) : '';
    setSaving(true);
    try {
      let saved: DuesSchedule;
      if (schedule) {
        const payload: DuesScheduleUpdatePayload = {
          name: name.trim(),
          amount: amountText,
          frequency,
          dueDate: dueInstant,
          gracePeriodDays: graceValue,
          lateFeeAmount: blankToNull(feeText),
          fiscalYearId: blankToNull(fiscalYearId),
          appliesToMembershipTypes: membershipTypes.length > 0 ? membershipTypes : null,
          isActive,
          notes: blankToNull(notes),
          qbIncomeAccount: blankToNull(incomeAccount),
          qbDepositAccount: blankToNull(depositAccount),
        };
        saved = await duesService.updateSchedule(schedule.id, payload);
        toast.success('Dues schedule saved');
      } else {
        const payload: DuesScheduleCreatePayload = {
          name: name.trim(),
          amount: amountText,
          frequency,
          dueDate: dueInstant,
          gracePeriodDays: graceValue,
          lateFeeAmount: feeText || undefined,
          fiscalYearId: fiscalYearId || undefined,
          appliesToMembershipTypes: membershipTypes.length > 0 ? membershipTypes : undefined,
          notes: notes.trim() || undefined,
          qbIncomeAccount: incomeAccount.trim() || undefined,
          qbDepositAccount: depositAccount.trim() || undefined,
        };
        saved = await duesService.createSchedule(payload);
        toast.success('Dues schedule created — generate dues to bill members');
      }
      onSaved(saved);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not save the dues schedule'));
    } finally {
      setSaving(false);
    }
  };

  const errorText = (field: string) =>
    errors[field] ? (
      <p id={`dues-schedule-${field}-error`} className="mt-1 text-xs text-red-700 dark:text-red-400">
        {errors[field]}
      </p>
    ) : null;

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={isEdit ? 'Edit dues schedule' : 'New dues schedule'}
      titleId="dues-schedule-form-title"
      aria-describedby="dues-schedule-form-description"
      onSubmit={handleSubmit}
      footer={
        <>
          <button type="submit" disabled={saving} className="btn-primary">
            {isEdit ? 'Save schedule' : 'Create schedule'}
          </button>
          <button type="button" onClick={onClose} className="btn-secondary">
            Cancel
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <p id="dues-schedule-form-description" className="text-theme-text-secondary text-sm">
          {isEdit
            ? 'Changes apply to dues generated from now on. Dues already generated keep the amount and due date they were created with.'
            : 'What each member owes and when. Saving bills nobody yet: use Generate dues to create a dues record for every member it applies to.'}
        </p>
        {termsNotYetApplied && (
          <p role="note" className="alert-warning rounded-lg p-3 text-sm">
            This schedule was set up before grace periods, late fees, fiscal years and membership types were applied.
            Saving it applies the values below: generation bills only the membership types chosen, and a late fee is
            added to dues still unpaid after the grace period from now on (never for lateness before today).
          </p>
        )}

        <div>
          <label htmlFor="dues-schedule-name" className="form-label">
            Name
          </label>
          <input
            id="dues-schedule-name"
            type="text"
            maxLength={MAX_NAME}
            className="form-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-invalid={Boolean(errors.name)}
            aria-describedby={errors.name ? 'dues-schedule-name-error' : undefined}
          />
          {errorText('name')}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="dues-schedule-amount" className="form-label">
              Amount per member
            </label>
            <input
              id="dues-schedule-amount"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              className="form-input"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              aria-invalid={Boolean(errors.amount)}
              aria-describedby={errors.amount ? 'dues-schedule-amount-error' : undefined}
            />
            {errorText('amount')}
          </div>
          <div>
            <label htmlFor="dues-schedule-frequency" className="form-label">
              Frequency
            </label>
            <select
              id="dues-schedule-frequency"
              className="form-input"
              value={frequency}
              onChange={(e) => setFrequency(e.target.value as DuesFrequency)}
            >
              {Object.values(DuesFrequency).map((value) => (
                <option key={value} value={value}>
                  {DUES_FREQUENCY_LABELS[value]}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div>
          <label htmlFor="dues-schedule-due-date" className="form-label">
            Due date
          </label>
          <input
            id="dues-schedule-due-date"
            type="date"
            className="form-input"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            aria-invalid={Boolean(errors.dueDate)}
            aria-describedby={errors.dueDate ? 'dues-schedule-dueDate-error' : undefined}
          />
          {errorText('dueDate')}
        </div>

        <fieldset className="space-y-3">
          <legend className="form-label">Late payment</legend>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="dues-schedule-grace" className="form-label">
                Grace period (days)
              </label>
              <input
                id="dues-schedule-grace"
                type="number"
                inputMode="numeric"
                min="0"
                step="1"
                className="form-input"
                value={graceDays}
                onChange={(e) => setGraceDays(e.target.value)}
                aria-invalid={Boolean(errors.graceDays)}
                aria-describedby={errors.graceDays ? 'dues-schedule-graceDays-error' : 'dues-schedule-late-hint'}
              />
              {errorText('graceDays')}
            </div>
            <div>
              <label htmlFor="dues-schedule-late-fee" className="form-label">
                Late fee <span className="text-theme-text-secondary font-normal">(optional)</span>
              </label>
              <input
                id="dues-schedule-late-fee"
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                className="form-input"
                value={lateFee}
                onChange={(e) => setLateFee(e.target.value)}
                aria-invalid={Boolean(errors.lateFee)}
                aria-describedby={errors.lateFee ? 'dues-schedule-lateFee-error' : 'dues-schedule-late-hint'}
              />
              {errorText('lateFee')}
            </div>
          </div>
          <p id="dues-schedule-late-hint" className="text-theme-text-secondary text-xs">
            Added once to a member&apos;s dues still unpaid this many days after the due date. Leave the fee blank to
            charge none. Members are emailed a week before the due date and once when their dues become overdue.
          </p>
        </fieldset>

        <div>
          <label htmlFor="dues-schedule-fiscal-year" className="form-label">
            Fiscal year <span className="text-theme-text-secondary font-normal">(optional)</span>
          </label>
          <select
            id="dues-schedule-fiscal-year"
            className="form-input"
            value={fiscalYearId}
            onChange={(e) => setFiscalYearId(e.target.value)}
            aria-describedby="dues-schedule-fiscal-year-hint"
          >
            <option value="">None</option>
            {yearChoices.map((year) => (
              <option key={year.id} value={year.id}>
                {year.name}
              </option>
            ))}
          </select>
          <p id="dues-schedule-fiscal-year-hint" className="text-theme-text-secondary mt-1 text-xs">
            The due date must fall within it, and dues cannot be generated once the year is closing or locked.
          </p>
        </div>

        <fieldset>
          <legend className="form-label">Applies to</legend>
          <p id="dues-schedule-types-hint" className="text-theme-text-secondary mb-2 text-xs">
            Choose none to bill every active member.
          </p>
          {typeChoices.length === 0 ? (
            <p className="text-theme-text-secondary text-sm">Every active member.</p>
          ) : (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2" aria-describedby="dues-schedule-types-hint">
              {typeChoices.map((option) => (
                <label key={option.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="form-checkbox"
                    checked={membershipTypes.includes(option.id)}
                    onChange={() => toggleType(option.id)}
                  />
                  <span className="text-theme-text-primary">{option.name}</span>
                </label>
              ))}
            </div>
          )}
        </fieldset>

        <div>
          <label htmlFor="dues-schedule-notes" className="form-label">
            Notes <span className="text-theme-text-secondary font-normal">(optional)</span>
          </label>
          <textarea
            id="dues-schedule-notes"
            rows={2}
            className="form-input"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>

        <fieldset className="space-y-3">
          <legend className="form-label">QuickBooks</legend>
          <p id="dues-schedule-qb-hint" className="text-theme-text-secondary text-xs">
            Where this schedule&apos;s payments go when exported. Leave blank to use the department&apos;s defaults on
            Finance › QuickBooks Export.
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="dues-schedule-income-account" className="form-label">
                Income account <span className="text-theme-text-secondary font-normal">(optional)</span>
              </label>
              <input
                id="dues-schedule-income-account"
                type="text"
                maxLength={MAX_NAME}
                className="form-input"
                placeholder="Dues Income"
                value={incomeAccount}
                onChange={(e) => setIncomeAccount(e.target.value)}
                aria-describedby="dues-schedule-qb-hint"
              />
            </div>
            <div>
              <label htmlFor="dues-schedule-deposit-account" className="form-label">
                Deposited to <span className="text-theme-text-secondary font-normal">(optional)</span>
              </label>
              <input
                id="dues-schedule-deposit-account"
                type="text"
                maxLength={MAX_NAME}
                className="form-input"
                placeholder="Operating Checking"
                value={depositAccount}
                onChange={(e) => setDepositAccount(e.target.value)}
                aria-describedby="dues-schedule-qb-hint"
              />
            </div>
          </div>
        </fieldset>

        {isEdit && (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="form-checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
            />
            <span className="text-theme-text-primary">
              Active — inactive schedules are hidden from the schedule list; their dues records stay.
            </span>
          </label>
        )}
      </div>
    </Modal>
  );
};
