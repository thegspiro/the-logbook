/**
 * Check Request Form Page
 *
 * Form for creating new check requests, including a cash advance to the
 * requester (app/services/cash_advances.py): a check to the member before an
 * expense, which charges no budget line or fund until the member's expense
 * report accounts for it.
 *
 * The finance office (`finance.manage`) may raise an advance for another
 * member (owner decision 2026-11-01): the member holds it and is the payee,
 * and the officer, recorded as having raised it, may not approve or issue it.
 * The members offered are the server's (`GET /finance/advances/holders`).
 */

import React, { useState } from 'react';
import { useNavigate } from 'react-router';
import { ArrowLeft, Save } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { useFinanceStore } from '../store/financeStore';
import { MAX_MONEY_AMOUNT, MAX_MONEY_MESSAGE, MIN_MONEY_AMOUNT, MIN_MONEY_MESSAGE } from '../utils/moneyLimits';
import { Skeleton } from '@/components/ux/Skeleton';
import { Breadcrumbs } from '@/components/ux/Breadcrumbs';
import { FormField } from '@/components/ux/FormField';
import { mapServerFieldErrors, type ServerFieldSpec } from '@/utils/serverFieldErrors';
import { getSaveFailureMessage } from '@/utils/errorHandling';
import { budgetOptionLabel, selectableBudgetOptions, useRequestFormOptions } from '../hooks/useRequestFormOptions';
import { useFundOptions } from '../hooks/useFundOptions';
import { FundSelect } from '../components/FundSelect';
import { ApprovalRoutePreview } from '../components/ApprovalRoutePreview';
import { useMyOpenAdvances } from '../hooks/useMyOpenAdvances';
import { advanceDeadlineHint, useAdvanceReturnMethod } from '../hooks/useAdvanceReturnMethod';
import { useAdvanceHolders } from '../hooks/useAdvanceHolders';
import { ADVANCE_RETURN_DAYS, ApprovalEntityType, type CheckRequest } from '../types';
import { useAuthStore } from '@/stores/authStore';
import { formatCurrency } from '@/utils/currencyFormatting';

/** `CheckRequestCreate.payee_name`'s max_length; the other text fields have none in the schema. */
const PAYEE_NAME_MAX_LENGTH = 300;

const checkRequestSchema = z.object({
  payeeName: z
    .string()
    .min(1, 'Payee name is required')
    .max(PAYEE_NAME_MAX_LENGTH, `Keep the payee name to ${PAYEE_NAME_MAX_LENGTH} characters`),
  payeeAddress: z.string().max(500).optional(),
  amount: z
    .number({ message: 'Amount is required' })
    .positive('Amount must be greater than zero')
    .min(MIN_MONEY_AMOUNT, MIN_MONEY_MESSAGE)
    .max(MAX_MONEY_AMOUNT, MAX_MONEY_MESSAGE),
  memo: z.string().max(500).optional(),
  purpose: z.string().max(2000).optional(),
  fiscalYearId: z.string().min(1, 'Fiscal year is required'),
  budgetId: z.string().optional(),
  fundCampaignId: z.string().optional(),
  isAdvance: z.boolean().optional(),
});

type CheckRequestFormData = z.infer<typeof checkRequestSchema>;

const inputClass = 'form-input';
const selectClass = inputClass;

/**
 * The form's fields as a 422 names them. Finance request schemas report
 * snake_case locs (`loc_by_alias=False`); the mapper reads both spellings.
 * The advance holder is chosen in the "Advance for" select.
 */
const SERVER_FIELDS: Record<keyof CheckRequestFormData | 'advanceHolderId', ServerFieldSpec> = {
  payeeName: { label: 'Payee Name', maxLength: PAYEE_NAME_MAX_LENGTH },
  payeeAddress: { label: 'Payee Address' },
  amount: { label: 'Amount' },
  memo: { label: 'Memo' },
  purpose: { label: 'Purpose' },
  fiscalYearId: { label: 'Fiscal Year' },
  budgetId: { label: 'Budget' },
  fundCampaignId: { label: 'Restricted fund' },
  isAdvance: { label: 'Cash advance' },
  advanceHolderId: { label: 'Advance for' },
};

const CheckRequestFormPage: React.FC = () => {
  const navigate = useNavigate();
  const { createCheckRequest } = useFinanceStore();

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    setError,
    setFocus,
    formState: { errors, isSubmitting },
  } = useForm<CheckRequestFormData>({
    resolver: zodResolver(checkRequestSchema),
  });

  // Fiscal years and the chosen year's budget lines come from the narrow
  // options endpoints, which a member holding only finance.request can read.
  const fiscalYearId = watch('fiscalYearId');
  const { fiscalYears, budgetOptions, fiscalYearsLoaded } = useRequestFormOptions(fiscalYearId);
  const { funds, mode: fundMode } = useFundOptions();

  const isAdvance = watch('isAdvance') ?? false;
  const user = useAuthStore((s) => s.user);
  const canRaiseForOthers = useAuthStore((s) => s.checkPermission('finance.manage'));
  // The check is made out to the member, so their legal name.
  const memberName = user?.full_name || user?.display_name || user?.username || '';
  // '' is the signed-in member; otherwise the member the office raises it for.
  const [holderId, setHolderId] = useState('');
  const [holderError, setHolderError] = useState<string | undefined>(undefined);
  const [formError, setFormError] = useState<string | null>(null);
  const holders = useAdvanceHolders(canRaiseForOthers && isAdvance, user?.id);
  const forSomeoneElse = isAdvance && holderId !== '';
  // Advice only: the server refuses the submission while one is overdue.
  const overdue = useMyOpenAdvances(isAdvance && !forSomeoneElse).filter((advance) => advance.overdue);
  const returnMethod = useAdvanceReturnMethod(isAdvance);

  const payeeFor = (id: string) => (id ? (holders.find((h) => h.id === id)?.legalName ?? '') : memberName);

  const toggleAdvance = (checked: boolean) => {
    setValue('isAdvance', checked, { shouldDirty: true });
    if (checked) {
      setValue('budgetId', '', { shouldDirty: true });
      setValue('fundCampaignId', '', { shouldDirty: true });
      if (!watch('payeeName')) setValue('payeeName', payeeFor(holderId), { shouldDirty: true });
    }
  };

  const chooseHolder = (id: string) => {
    // The check is made out to whoever holds the advance, so a payee filled
    // in for the previous choice follows the new one.
    const payee = watch('payeeName');
    if (!payee || payee === payeeFor(holderId)) setValue('payeeName', payeeFor(id), { shouldDirty: true });
    setHolderId(id);
    setHolderError(undefined);
  };

  const onSubmit = async (data: CheckRequestFormData) => {
    setFormError(null);
    try {
      const payload: Partial<CheckRequest> = {
        payeeName: data.payeeName,
        amount: data.amount.toFixed(2),
        fiscalYearId: data.fiscalYearId,
      };
      if (data.payeeAddress?.trim()) payload.payeeAddress = data.payeeAddress.trim();
      if (data.memo?.trim()) payload.memo = data.memo.trim();
      if (data.purpose?.trim()) payload.purpose = data.purpose.trim();
      if (data.isAdvance) {
        payload.isAdvance = true;
        if (holderId) payload.advanceHolderId = holderId;
      } else {
        if (data.budgetId) payload.budgetId = data.budgetId;
        if (data.fundCampaignId) payload.fundCampaignId = data.fundCampaignId;
      }
      const created = await createCheckRequest(payload);
      toast.success('Check request created');
      void navigate(`/finance/check-requests/${created.id}`);
    } catch (err: unknown) {
      // A create form creates nothing until each refusal is fixed, so each one
      // is put on the field it names (forms review F-2); the rest are shown
      // above the actions, since the store's own message is only on the list.
      const mapped = mapServerFieldErrors(err, SERVER_FIELDS);
      const keys = Object.keys(mapped?.fieldErrors ?? {}) as (keyof typeof SERVER_FIELDS)[];
      for (const key of keys) {
        const message = mapped?.fieldErrors[key] ?? '';
        if (key === 'advanceHolderId') setHolderError(message);
        else setError(key, { type: 'server', message });
      }
      const first = keys.find((key) => key !== 'advanceHolderId');
      if (first) setFocus(first);
      if (keys.length > 0 && !mapped?.unmatched.length) return;
      setFormError(mapped?.unmatched.join(' ') || getSaveFailureMessage(err, 'create the check request'));
    }
  };

  if (!fiscalYearsLoaded) {
    return (
      <div className="space-y-6">
        <Breadcrumbs />
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-96 w-full" rounded="lg" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Breadcrumbs />
      <button
        type="button"
        onClick={() => void navigate('/finance/check-requests')}
        className="touch:min-h-11 text-theme-text-secondary hover:text-theme-text-primary inline-flex items-center gap-2 text-sm"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Check Requests
      </button>

      <div className="card p-6">
        <h1 className="text-theme-text-primary mb-6 text-xl font-bold">New Check Request</h1>

        <form onSubmit={(e) => void handleSubmit(onSubmit)(e)} className="space-y-4">
          <div className="flex items-start gap-3">
            <input
              id="isAdvance"
              type="checkbox"
              className="form-checkbox mt-0.5"
              checked={isAdvance}
              onChange={(e) => toggleAdvance(e.target.checked)}
              aria-describedby="isAdvance-hint"
            />
            <div>
              <label
                htmlFor="isAdvance"
                className="text-theme-text-primary touch:flex touch:min-h-11 touch:items-center text-sm font-medium"
              >
                {canRaiseForOthers ? 'This is a cash advance' : 'This is a cash advance to me'}
              </label>
              <p id="isAdvance-hint" className="text-theme-text-secondary text-xs">
                Money paid to {canRaiseForOthers ? 'a member' : 'you'} before an expense, such as for travel.{' '}
                {advanceDeadlineHint(returnMethod, ADVANCE_RETURN_DAYS)}{' '}
                {canRaiseForOthers
                  ? 'Until the member does, it may count as their taxable pay and they cannot request another advance.'
                  : 'Until you do, it may count as taxable pay and you cannot request another advance.'}
              </p>
            </div>
          </div>

          {isAdvance && canRaiseForOthers && (
            <FormField
              id="advanceHolder"
              label="Advance for"
              error={holderError}
              hint="The member holds the advance: it is paid to them, its statements and deadline are theirs, and an overdue one stops them requesting another. As the one who raised it, you cannot approve it or issue its check."
            >
              {(field) => (
                <select
                  {...field}
                  className={selectClass}
                  value={holderId}
                  onChange={(e) => chooseHolder(e.target.value)}
                >
                  <option value="">Me</option>
                  {holders.map((holder) => (
                    <option key={holder.id} value={holder.id}>
                      {holder.name}
                    </option>
                  ))}
                </select>
              )}
            </FormField>
          )}

          {isAdvance && overdue.length > 0 && (
            <div role="alert" className="alert-warning text-sm">
              You have an advance more than {ADVANCE_RETURN_DAYS} days old that is not fully accounted for:{' '}
              {overdue
                .map((advance) => `${advance.requestNumber} (${formatCurrency(advance.outstanding)} outstanding)`)
                .join(', ')}
              . This request cannot be submitted until it is settled.
            </div>
          )}

          <FormField
            id="payeeName"
            label="Payee Name"
            required
            error={errors.payeeName?.message}
            maxLength={PAYEE_NAME_MAX_LENGTH}
            count={watch('payeeName')?.length ?? 0}
          >
            {(field) => (
              <input {...field} type="text" autoComplete="off" {...register('payeeName')} className={inputClass} />
            )}
          </FormField>

          <FormField id="payeeAddress" label="Payee Address" error={errors.payeeAddress?.message}>
            {(field) => (
              <input {...field} type="text" autoComplete="off" {...register('payeeAddress')} className={inputClass} />
            )}
          </FormField>

          <FormField id="amount" label="Amount" required error={errors.amount?.message}>
            {(field) => (
              <input
                {...field}
                type="number"
                inputMode="decimal"
                step="0.01"
                min={MIN_MONEY_AMOUNT}
                max={MAX_MONEY_AMOUNT}
                {...register('amount', { valueAsNumber: true })}
                className={inputClass}
              />
            )}
          </FormField>

          <FormField id="fiscalYearId" label="Fiscal Year" required error={errors.fiscalYearId?.message}>
            {(field) => (
              <select {...field} {...register('fiscalYearId')} className={selectClass}>
                <option value="">Select fiscal year</option>
                {fiscalYears.map((fy) => (
                  <option key={fy.id} value={fy.id}>
                    {fy.name}
                  </option>
                ))}
              </select>
            )}
          </FormField>

          {/* An advance charges no budget line or fund: the expense report
              that accounts for it does. */}
          {!isAdvance && (
            <>
              <FormField id="budgetId" label="Budget" error={errors.budgetId?.message}>
                {(field) => (
                  <select {...field} {...register('budgetId')} className={selectClass}>
                    <option value="">No budget linked</option>
                    {/* A new request: nothing on file, so no inactive line. */}
                    {selectableBudgetOptions(budgetOptions).map((option) => (
                      <option key={option.id} value={option.id}>
                        {budgetOptionLabel(option)}
                      </option>
                    ))}
                  </select>
                )}
              </FormField>

              <FundSelect
                id="fundCampaignId"
                value={watch('fundCampaignId') ?? ''}
                onChange={(fundId) => setValue('fundCampaignId', fundId, { shouldDirty: true })}
                amount={watch('amount') || 0}
                funds={funds}
                mode={fundMode}
                error={errors.fundCampaignId?.message}
              />
            </>
          )}

          <ApprovalRoutePreview
            entityType={ApprovalEntityType.CHECK_REQUEST}
            amount={watch('amount') || 0}
            // An advance charges no budget line, so none picks its chain.
            budgetId={isAdvance ? undefined : watch('budgetId') || undefined}
          />

          <FormField id="purpose" label="Purpose" error={errors.purpose?.message}>
            {(field) => <textarea {...field} rows={3} {...register('purpose')} className={inputClass} />}
          </FormField>

          <FormField id="memo" label="Memo" error={errors.memo?.message}>
            {(field) => (
              <input {...field} type="text" autoComplete="off" {...register('memo')} className={inputClass} />
            )}
          </FormField>

          {formError && (
            <p role="alert" className="text-sm text-red-800 dark:text-red-300">
              {formError}
            </p>
          )}

          <div className="border-theme-surface-border flex justify-end gap-3 border-t pt-4">
            <button
              type="button"
              onClick={() => void navigate('/finance/check-requests')}
              className="touch:min-h-11 border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-hover rounded-lg border px-4 py-2 text-sm font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="touch:min-h-11 inline-flex items-center gap-2 rounded-lg bg-red-800 px-4 py-2 text-sm font-medium text-white hover:bg-red-900 disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              {isSubmitting ? 'Creating...' : 'Create Check Request'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default CheckRequestFormPage;
