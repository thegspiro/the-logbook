/**
 * Check Request Form Page
 *
 * Form for creating new check requests.
 */

import React from 'react';
import { useNavigate } from 'react-router';
import { ArrowLeft, Save } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { useFinanceStore } from '../store/financeStore';
import { Skeleton } from '@/components/ux/Skeleton';
import { Breadcrumbs } from '@/components/ux/Breadcrumbs';
import { budgetOptionLabel, useRequestFormOptions } from '../hooks/useRequestFormOptions';
import type { CheckRequest } from '../types';

const checkRequestSchema = z.object({
  payeeName: z.string().min(1, 'Payee name is required').max(200),
  payeeAddress: z.string().max(500).optional(),
  amount: z.number({ message: 'Amount is required' }).positive('Amount must be greater than zero'),
  memo: z.string().max(500).optional(),
  purpose: z.string().max(2000).optional(),
  fiscalYearId: z.string().min(1, 'Fiscal year is required'),
  budgetId: z.string().optional(),
});

type CheckRequestFormData = z.infer<typeof checkRequestSchema>;

const inputClass = 'form-input';
const selectClass = inputClass;
const labelClass = 'form-label';
const errorClass = 'mt-1 text-xs text-red-600';

const CheckRequestFormPage: React.FC = () => {
  const navigate = useNavigate();
  const { createCheckRequest } = useFinanceStore();

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<CheckRequestFormData>({
    resolver: zodResolver(checkRequestSchema),
  });

  // Fiscal years and the chosen year's budget lines come from the narrow
  // options endpoints, which a member holding only finance.request can read.
  const fiscalYearId = watch('fiscalYearId');
  const { fiscalYears, budgetOptions, fiscalYearsLoaded } = useRequestFormOptions(fiscalYearId);

  const onSubmit = async (data: CheckRequestFormData) => {
    try {
      const payload: Partial<CheckRequest> = {
        payeeName: data.payeeName,
        amount: data.amount.toFixed(2),
        fiscalYearId: data.fiscalYearId,
      };
      if (data.payeeAddress?.trim()) payload.payeeAddress = data.payeeAddress.trim();
      if (data.memo?.trim()) payload.memo = data.memo.trim();
      if (data.purpose?.trim()) payload.purpose = data.purpose.trim();
      if (data.budgetId) payload.budgetId = data.budgetId;
      const created = await createCheckRequest(payload);
      toast.success('Check request created');
      void navigate(`/finance/check-requests/${created.id}`);
    } catch {
      // Error handled by store
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
        className="text-theme-text-secondary hover:text-theme-text-primary inline-flex items-center gap-2 text-sm"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Check Requests
      </button>

      <div className="card p-6">
        <h1 className="text-theme-text-primary mb-6 text-xl font-bold">New Check Request</h1>

        <form onSubmit={(e) => void handleSubmit(onSubmit)(e)} className="space-y-4">
          <div>
            <label htmlFor="payeeName" className={labelClass}>
              Payee Name *
            </label>
            <input id="payeeName" {...register('payeeName')} className={inputClass} />
            {errors.payeeName && <p className={errorClass}>{errors.payeeName.message}</p>}
          </div>

          <div>
            <label htmlFor="payeeAddress" className={labelClass}>
              Payee Address
            </label>
            <input id="payeeAddress" {...register('payeeAddress')} className={inputClass} />
          </div>

          <div>
            <label htmlFor="amount" className={labelClass}>
              Amount *
            </label>
            <input
              id="amount"
              type="number"
              step="0.01"
              {...register('amount', { valueAsNumber: true })}
              className={inputClass}
            />
            {errors.amount && <p className={errorClass}>{errors.amount.message}</p>}
          </div>

          <div>
            <label htmlFor="fiscalYearId" className={labelClass}>
              Fiscal Year *
            </label>
            <select id="fiscalYearId" {...register('fiscalYearId')} className={selectClass}>
              <option value="">Select fiscal year</option>
              {fiscalYears.map((fy) => (
                <option key={fy.id} value={fy.id}>
                  {fy.name}
                </option>
              ))}
            </select>
            {errors.fiscalYearId && <p className={errorClass}>{errors.fiscalYearId.message}</p>}
          </div>

          <div>
            <label htmlFor="budgetId" className={labelClass}>
              Budget
            </label>
            <select id="budgetId" {...register('budgetId')} className={selectClass}>
              <option value="">No budget linked</option>
              {budgetOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {budgetOptionLabel(option)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="purpose" className={labelClass}>
              Purpose
            </label>
            <textarea id="purpose" rows={3} {...register('purpose')} className={inputClass} />
          </div>

          <div>
            <label htmlFor="memo" className={labelClass}>
              Memo
            </label>
            <input id="memo" {...register('memo')} className={inputClass} />
          </div>

          <div className="border-theme-surface-border flex justify-end gap-3 border-t pt-4">
            <button
              type="button"
              onClick={() => void navigate('/finance/check-requests')}
              className="border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-hover rounded-lg border px-4 py-2 text-sm font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex items-center gap-2 rounded-lg bg-red-800 px-4 py-2 text-sm font-medium text-white hover:bg-red-900 disabled:opacity-50"
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
