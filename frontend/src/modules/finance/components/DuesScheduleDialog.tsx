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

import React, { useEffect, useRef, useState } from 'react';
import toast from 'react-hot-toast';
import { Modal } from '../../../components/Modal';
import { FormField } from '../../../components/ux/FormField';
import { useDiscardGuard } from '../../../hooks/useDiscardGuard';
import { getErrorMessage } from '../../../utils/errorHandling';
import { mapServerFieldErrors, type ServerFieldSpec } from '../../../utils/serverFieldErrors';
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

/** `DuesScheduleCreate.name`'s max_length, and the two QuickBooks account names'. */
const MAX_NAME = 200;
/** The backend's own default for a new schedule's grace period. */
const DEFAULT_GRACE_DAYS = 30;
const MAX_GRACE_DAYS = 3650;

type DuesField =
  | 'name'
  | 'amount'
  | 'frequency'
  | 'dueDate'
  | 'graceDays'
  | 'lateFee'
  | 'fiscalYearId'
  | 'membershipTypes'
  | 'isActive'
  | 'notes'
  | 'incomeAccount'
  | 'depositAccount';

/** The fields as a 422 names them (snake_case locs: `loc_by_alias=False`). */
const SERVER_FIELDS: Record<DuesField, ServerFieldSpec> = {
  name: { label: 'Name', maxLength: MAX_NAME },
  amount: { label: 'Amount per member' },
  frequency: { label: 'Frequency' },
  dueDate: { label: 'Due date', api: ['due_date', 'dueDate'] },
  graceDays: { label: 'Grace period', api: ['grace_period_days', 'gracePeriodDays'] },
  lateFee: { label: 'Late fee', api: ['late_fee_amount', 'lateFeeAmount'] },
  fiscalYearId: { label: 'Fiscal year' },
  membershipTypes: { label: 'Applies to', api: ['applies_to_membership_types', 'appliesToMembershipTypes'] },
  isActive: { label: 'Active' },
  notes: { label: 'Notes' },
  incomeAccount: { label: 'Income account', maxLength: MAX_NAME, api: ['qb_income_account', 'qbIncomeAccount'] },
  depositAccount: { label: 'Deposited to', maxLength: MAX_NAME, api: ['qb_deposit_account', 'qbDepositAccount'] },
};

/** The update payload's key for each field. */
const UPDATE_KEYS: Record<DuesField, keyof DuesScheduleUpdatePayload> = {
  name: 'name',
  amount: 'amount',
  frequency: 'frequency',
  dueDate: 'dueDate',
  graceDays: 'gracePeriodDays',
  lateFee: 'lateFeeAmount',
  fiscalYearId: 'fiscalYearId',
  membershipTypes: 'appliesToMembershipTypes',
  isActive: 'isActive',
  notes: 'notes',
  incomeAccount: 'qbIncomeAccount',
  depositAccount: 'qbDepositAccount',
};

const FIELD_IDS: Partial<Record<DuesField, string>> = {
  name: 'dues-schedule-name',
  amount: 'dues-schedule-amount',
  frequency: 'dues-schedule-frequency',
  dueDate: 'dues-schedule-due-date',
  graceDays: 'dues-schedule-grace',
  lateFee: 'dues-schedule-late-fee',
  fiscalYearId: 'dues-schedule-fiscal-year',
  notes: 'dues-schedule-notes',
  incomeAccount: 'dues-schedule-income-account',
  depositAccount: 'dues-schedule-deposit-account',
};

const LATE_HINT =
  "Added once to a member's dues still unpaid this many days after the due date. Leave the fee blank to charge none. Members are emailed a week before the due date and once when their dues become overdue.";

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
  const [errors, setErrors] = useState<Partial<Record<DuesField, string>>>({});
  const [saving, setSaving] = useState(false);
  // An edit that saved everything but a refused field stays open on that
  // field; closing then still reports the saved schedule to the caller.
  const partlySaved = useRef<DuesSchedule | null>(null);

  const snapshot = JSON.stringify([
    name,
    amount,
    frequency,
    dueDate,
    isActive,
    notes,
    incomeAccount,
    depositAccount,
    graceDays,
    lateFee,
    fiscalYearId,
    membershipTypes,
  ]);
  const initialSnapshot = useRef(snapshot);
  const isDirty = snapshot !== initialSnapshot.current;
  const close = () => {
    if (partlySaved.current) onSaved(partlySaved.current);
    else onClose();
  };
  // Escape, the X and Cancel all ask before throwing away a changed form.
  const requestClose = useDiscardGuard({ isDirty, onClose: close });
  const clearError = (field: DuesField) =>
    setErrors((prev) => {
      if (!prev[field]) return prev;
      const next = { ...prev };
      delete next[field];
      return next;
    });

  const validate = (): boolean => {
    const next: Partial<Record<DuesField, string>> = {};
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
        let refused: Partial<Record<DuesField, string>> = {};
        try {
          saved = await duesService.updateSchedule(schedule.id, payload);
        } catch (err: unknown) {
          // Owner rule (2026-11-05) for a single-save form: a value the
          // schedule cannot hold is not written, the rest saves, and the field
          // keeps what was typed, flagged, until it is fixed. Anything the form
          // has no field for is a real failure and is reported as one.
          const mapped = mapServerFieldErrors(err, SERVER_FIELDS);
          const keys = Object.keys(mapped?.fieldErrors ?? {}) as DuesField[];
          if (!mapped || keys.length === 0 || mapped.unmatched.length > 0) throw err;
          refused = mapped.fieldErrors;
          const rest: DuesScheduleUpdatePayload = { ...payload };
          for (const key of keys) delete rest[UPDATE_KEYS[key]];
          saved = await duesService.updateSchedule(schedule.id, rest);
        }
        const firstRefused = (Object.keys(refused) as DuesField[])[0];
        if (firstRefused) {
          partlySaved.current = saved;
          setErrors(refused);
          toast.error(
            `Dues schedule saved, except ${SERVER_FIELDS[firstRefused].label.toLowerCase()}: ${refused[firstRefused] ?? ''} Fix it and save again.`
          );
          const id = FIELD_IDS[firstRefused];
          if (id) document.getElementById(id)?.focus();
          return;
        }
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
      // A new schedule is created only once nothing is refused, so each
      // refusal goes on its field (forms review F-2).
      const mapped = schedule ? null : mapServerFieldErrors(err, SERVER_FIELDS);
      const keys = Object.keys(mapped?.fieldErrors ?? {}) as DuesField[];
      if (mapped && keys[0]) {
        setErrors(mapped.fieldErrors);
        const id = FIELD_IDS[keys[0]];
        if (id) document.getElementById(id)?.focus();
        if (mapped.unmatched.length > 0) toast.error(mapped.unmatched.join(' '));
        return;
      }
      toast.error(getErrorMessage(err, 'Could not save the dues schedule'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={requestClose}
      title={isEdit ? 'Edit dues schedule' : 'New dues schedule'}
      titleId="dues-schedule-form-title"
      aria-describedby="dues-schedule-form-description"
      onSubmit={handleSubmit}
      noValidate
      footer={
        <>
          <button type="submit" disabled={saving} className="btn-primary">
            {isEdit ? 'Save schedule' : 'Create schedule'}
          </button>
          <button type="button" onClick={requestClose} className="btn-secondary">
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

        <FormField
          id={FIELD_IDS.name}
          label="Name"
          required
          error={errors.name}
          maxLength={MAX_NAME}
          count={name.length}
        >
          {(field) => (
            <input
              {...field}
              type="text"
              autoComplete="off"
              className="form-input"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                clearError('name');
              }}
            />
          )}
        </FormField>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <FormField id={FIELD_IDS.amount} label="Amount per member" required error={errors.amount}>
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
          <FormField id={FIELD_IDS.frequency} label="Frequency" required error={errors.frequency}>
            {(field) => (
              <select
                {...field}
                className="form-input"
                value={frequency}
                onChange={(e) => {
                  setFrequency(e.target.value as DuesFrequency);
                  clearError('frequency');
                }}
              >
                {Object.values(DuesFrequency).map((value) => (
                  <option key={value} value={value}>
                    {DUES_FREQUENCY_LABELS[value]}
                  </option>
                ))}
              </select>
            )}
          </FormField>
        </div>

        <FormField id={FIELD_IDS.dueDate} label="Due date" required error={errors.dueDate}>
          {(field) => (
            <input
              {...field}
              type="date"
              className="form-input"
              value={dueDate}
              onChange={(e) => {
                setDueDate(e.target.value);
                clearError('dueDate');
              }}
            />
          )}
        </FormField>

        <fieldset className="space-y-3">
          <legend className="form-label">Late payment</legend>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField
              id={FIELD_IDS.graceDays}
              label="Grace period (days)"
              required
              error={errors.graceDays}
              hint={LATE_HINT}
            >
              {(field) => (
                <input
                  {...field}
                  type="number"
                  inputMode="numeric"
                  min="0"
                  step="1"
                  className="form-input"
                  value={graceDays}
                  onChange={(e) => {
                    setGraceDays(e.target.value);
                    clearError('graceDays');
                  }}
                />
              )}
            </FormField>
            <FormField
              id={FIELD_IDS.lateFee}
              label={
                <>
                  Late fee <span className="text-theme-text-secondary font-normal">(optional)</span>
                </>
              }
              error={errors.lateFee}
            >
              {(field) => (
                <input
                  {...field}
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  className="form-input"
                  value={lateFee}
                  onChange={(e) => {
                    setLateFee(e.target.value);
                    clearError('lateFee');
                  }}
                />
              )}
            </FormField>
          </div>
        </fieldset>

        <FormField
          id={FIELD_IDS.fiscalYearId}
          label={
            <>
              Fiscal year <span className="text-theme-text-secondary font-normal">(optional)</span>
            </>
          }
          error={errors.fiscalYearId}
          hint="The due date must fall within it, and dues cannot be generated once the year is closing or locked."
        >
          {(field) => (
            <select
              {...field}
              className="form-input"
              value={fiscalYearId}
              onChange={(e) => {
                setFiscalYearId(e.target.value);
                clearError('fiscalYearId');
              }}
            >
              <option value="">None</option>
              {yearChoices.map((year) => (
                <option key={year.id} value={year.id}>
                  {year.name}
                </option>
              ))}
            </select>
          )}
        </FormField>

        <fieldset>
          <legend className="form-label">Applies to</legend>
          <p id="dues-schedule-types-hint" className="text-theme-text-secondary mb-2 text-xs">
            Choose none to bill every active member.
          </p>
          {errors.membershipTypes && (
            <p role="alert" className="mb-2 text-sm text-red-800 dark:text-red-300">
              {errors.membershipTypes}
            </p>
          )}
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
                    onChange={() => {
                      toggleType(option.id);
                      clearError('membershipTypes');
                    }}
                  />
                  <span className="text-theme-text-primary">{option.name}</span>
                </label>
              ))}
            </div>
          )}
        </fieldset>

        <FormField
          id={FIELD_IDS.notes}
          label={
            <>
              Notes <span className="text-theme-text-secondary font-normal">(optional)</span>
            </>
          }
          error={errors.notes}
        >
          {(field) => (
            <textarea
              {...field}
              rows={2}
              className="form-input"
              value={notes}
              onChange={(e) => {
                setNotes(e.target.value);
                clearError('notes');
              }}
            />
          )}
        </FormField>

        <fieldset className="space-y-3">
          <legend className="form-label">QuickBooks</legend>
          <p id="dues-schedule-qb-hint" className="text-theme-text-secondary text-xs">
            Where this schedule&apos;s payments go when exported. Leave blank to use the department&apos;s defaults on
            Finance › QuickBooks Export.
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField
              id={FIELD_IDS.incomeAccount}
              label={
                <>
                  Income account <span className="text-theme-text-secondary font-normal">(optional)</span>
                </>
              }
              error={errors.incomeAccount}
              maxLength={MAX_NAME}
              count={incomeAccount.length}
            >
              {(field) => (
                <input
                  {...field}
                  type="text"
                  autoComplete="off"
                  className="form-input"
                  placeholder="Dues Income"
                  value={incomeAccount}
                  onChange={(e) => {
                    setIncomeAccount(e.target.value);
                    clearError('incomeAccount');
                  }}
                  aria-describedby={[field['aria-describedby'], 'dues-schedule-qb-hint'].filter(Boolean).join(' ')}
                />
              )}
            </FormField>
            <FormField
              id={FIELD_IDS.depositAccount}
              label={
                <>
                  Deposited to <span className="text-theme-text-secondary font-normal">(optional)</span>
                </>
              }
              error={errors.depositAccount}
              maxLength={MAX_NAME}
              count={depositAccount.length}
            >
              {(field) => (
                <input
                  {...field}
                  type="text"
                  autoComplete="off"
                  className="form-input"
                  placeholder="Operating Checking"
                  value={depositAccount}
                  onChange={(e) => {
                    setDepositAccount(e.target.value);
                    clearError('depositAccount');
                  }}
                  aria-describedby={[field['aria-describedby'], 'dues-schedule-qb-hint'].filter(Boolean).join(' ')}
                />
              )}
            </FormField>
          </div>
        </fieldset>

        {isEdit && (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="form-checkbox"
              checked={isActive}
              onChange={(e) => {
                setIsActive(e.target.checked);
                clearError('isActive');
              }}
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
