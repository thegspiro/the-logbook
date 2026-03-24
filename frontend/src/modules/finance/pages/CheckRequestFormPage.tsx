/**
 * Check Request Form Page
 *
 * Form for creating new check requests.
 */

import React, { useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Save } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { useFinanceStore } from '../store/financeStore';
import { Skeleton } from '@/components/ux/Skeleton';
import { Breadcrumbs } from '@/components/ux/Breadcrumbs';
import { formatCurrencyWhole } from '@/utils/currencyFormatting';
import type { CheckRequest } from '../types';

const checkRequestSchema = z.object({
  payeeName: z.string().min(1, 'Payee name is required').max(200),
  payeeAddress: z.string().max(500).optional(),
  amount: z
    .number({ message: 'Amount is required' })
    .positive('Amount must be positive'),
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
  const {
    fiscalYears,
    budgets,
    budgetCategories,
    isLoading,
    fetchFiscalYears,
    fetchBudgets,
    createCheckRequest,
  } = useFinanceStore();

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm<CheckRequestFormData>({
    resolver: zodResolver(checkRequestSchema),
  });

  const fiscalYearId = watch('fiscalYearId');

  useEffect(() => {
    void fetchFiscalYears();
  }, [fetchFiscalYears]);

  useEffect(() => {
    if (fiscalYearId) {
      void fetchBudgets({ fiscalYearId });
    }
  }, [fiscalYearId, fetchBudgets]);

  const categoryMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const cat of budgetCategories) {
      map.set(cat.id, cat.name);
    }
    return map;
  }, [budgetCategories]);

  const onSubmit = async (data: CheckRequestFormData) => {
    try {
      const payload: Partial<CheckRequest> = {
        payeeName: data.payeeName,
        amount: data.amount,
        fiscalYearId: data.fiscalYearId,
      };
      if (data.payeeAddress?.trim()) payload.payeeAddress = data.payeeAddress.trim();
      if (data.memo?.trim()) payload.memo = data.memo.trim();
      if (data.purpose?.trim()) payload.purpose = data.purpose.trim();
      if (data.budgetId) payload.budgetId = data.budgetId;
      const created = await createCheckRequest(payload);
      toast.success('Check request created');
      navigate(`/finance/check-requests/${created.id}`);
    } catch {
      // Error handled by store
    }
  };

  if (isLoading && fiscalYears.length === 0) {
    return (
      <div className="space-y-6">
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
        onClick={() => navigate('/finance/check-requests')}
        className="inline-flex items-center gap-2 text-sm text-theme-text-secondary hover:text-theme-text-primary"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Check Requests
      </button>

      <div className="rounded-lg border border-theme-surface-border bg-theme-surface p-6">
        <h1 className="mb-6 text-xl font-bold text-theme-text-primary">
          New Check Request
        </h1>

        <form onSubmit={(e) => void handleSubmit(onSubmit)(e)} className="space-y-4">
          <div>
            <label htmlFor="payeeName" className={labelClass}>Payee Name *</label>
            <input id="payeeName" {...register('payeeName')} className={inputClass} />
            {errors.payeeName && <p className={errorClass}>{errors.payeeName.message}</p>}
          </div>

          <div>
            <label htmlFor="payeeAddress" className={labelClass}>Payee Address</label>
            <input id="payeeAddress" {...register('payeeAddress')} className={inputClass} />
          </div>

          <div>
            <label htmlFor="amount" className={labelClass}>Amount *</label>
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
            <label htmlFor="fiscalYearId" className={labelClass}>Fiscal Year *</label>
            <select id="fiscalYearId" {...register('fiscalYearId')} className={selectClass}>
              <option value="">Select fiscal year</option>
              {fiscalYears.map((fy) => (
                <option key={fy.id} value={fy.id}>{fy.name}</option>
              ))}
            </select>
            {errors.fiscalYearId && <p className={errorClass}>{errors.fiscalYearId.message}</p>}
          </div>

          <div>
            <label htmlFor="budgetId" className={labelClass}>Budget (Optional)</label>
            <select id="budgetId" {...register('budgetId')} className={selectClass}>
              <option value="">No budget linked</option>
              {budgets.map((b) => (
                <option key={b.id} value={b.id}>
                  {categoryMap.get(b.categoryId) ?? 'Unknown'} -{' '}
                  {formatCurrencyWhole(
                    b.amountBudgeted - b.amountSpent - b.amountEncumbered,
                  )}{' '}
                  remaining
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="purpose" className={labelClass}>Purpose</label>
            <textarea id="purpose" rows={3} {...register('purpose')} className={inputClass} />
          </div>

          <div>
            <label htmlFor="memo" className={labelClass}>Memo</label>
            <input id="memo" {...register('memo')} className={inputClass} />
          </div>

          <div className="flex justify-end gap-3 border-t border-theme-surface-border pt-4">
            <button
              type="button"
              onClick={() => navigate('/finance/check-requests')}
              className="rounded-lg border border-theme-surface-border px-4 py-2 text-sm font-medium text-theme-text-secondary hover:bg-theme-surface-hover"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
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
