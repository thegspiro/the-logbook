/**
 * Expense Report Form Page
 *
 * Form for creating expense reports with line items.
 * Uses react-hook-form + zod for validation.
 *
 * A mileage line may record its trips instead of an amount (owner decision
 * 2026-11-01); the server prices it at the department's rate, and the total
 * shown here previews that figure.
 */

import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { ArrowLeft, Save, Plus, Trash2 } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { useFinanceStore } from '../store/financeStore';
import { MAX_MONEY_AMOUNT, MIN_MONEY_AMOUNT } from '../utils/moneyLimits';
import { EXPENSE_TYPE_OPTIONS, expenseLineSchema } from '../utils/expenseLines';
import { useLateLineWarning } from '../hooks/useLateLineWarning';
import { budgetOptionLabel, selectableBudgetOptions, useRequestFormOptions } from '../hooks/useRequestFormOptions';
import { formatCurrency } from '@/utils/currencyFormatting';
import { Skeleton } from '@/components/ux/Skeleton';
import { Breadcrumbs } from '@/components/ux/Breadcrumbs';
import { ApprovalEntityType, ExpenseType } from '../types';
import { useMyOpenAdvances } from '../hooks/useMyOpenAdvances';
import { useFundOptions } from '../hooks/useFundOptions';
import { FundSelect } from '../components/FundSelect';
import { ApprovalRoutePreview } from '../components/ApprovalRoutePreview';
import { MileageTripLog } from '../components/MileageTripLog';
import { useMileageRate } from '../hooks/useMileageRate';
import { useTimezone } from '@/hooks/useTimezone';
import { getTodayLocalDate } from '@/utils/dateFormatting';
import { priceTrips, toTripPayload, tripLogError, type TripEntry } from '../utils/mileage';

// =============================================================================
// Validation Schema
// =============================================================================

const expenseReportSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200),
  description: z.string().max(2000).optional(),
  fiscalYearId: z.string().min(1, 'Fiscal year is required'),
  advanceId: z.string().optional(),
});

type ExpenseReportFormData = z.infer<typeof expenseReportSchema>;

interface LineItemEntry {
  description: string;
  amount: number;
  dateIncurred: string;
  expenseType: string;
  merchant: string;
  fundCampaignId: string;
  /** The budget line the member charges; approval commits the amount there. */
  budgetId: string;
  /** A mileage line's trips; with any, the server prices the line. */
  trips: TripEntry[];
}

// =============================================================================
// Shared Styles
// =============================================================================

const inputClass = 'form-input';
const selectClass = inputClass;
const labelClass = 'form-label';
const errorClass = 'mt-1 text-xs text-red-600';

// =============================================================================
// Loading Skeleton
// =============================================================================

const FormSkeleton: React.FC = () => (
  <div className="space-y-6" aria-label="Loading expense report form" role="status" aria-live="polite">
    <span className="sr-only">Loading...</span>
    <div className="card p-6">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={`field-${String(i)}`} className="mb-4 space-y-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-10 w-full" />
        </div>
      ))}
    </div>
  </div>
);

// =============================================================================
// Main Page Component
// =============================================================================

const ExpenseReportFormPage: React.FC = () => {
  const navigate = useNavigate();

  const { createExpenseReport } = useFinanceStore();

  const [lineItems, setLineItems] = useState<LineItemEntry[]>([]);
  const [lineItemErrors, setLineItemErrors] = useState<Record<number, string>>({});
  const lateWarning = useLateLineWarning();
  const { funds, mode: fundMode } = useFundOptions();
  // The member's own advances with something left to account for; only they
  // can be chosen (the server checks the same).
  const advances = useMyOpenAdvances();
  const { rate: mileageRate } = useMileageRate();
  const tz = useTimezone();

  // A line's log counts only while it is mileage and the department has a rate.
  const isLogged = (item: LineItemEntry) =>
    item.expenseType === ExpenseType.MILEAGE && Boolean(mileageRate) && item.trips.length > 0;
  const lineAmount = (item: LineItemEntry) =>
    isLogged(item) ? Number(priceTrips(item.trips, mileageRate) ?? 0) : item.amount || 0;

  const {
    register,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
    reset,
  } = useForm<ExpenseReportFormData>({
    resolver: zodResolver(expenseReportSchema),
    defaultValues: {
      title: '',
      description: '',
      fiscalYearId: '',
    },
  });

  // The active and draft years, and the chosen year's budget lines the
  // member may charge, from the options endpoints a member holding only
  // finance.request can read (owner decision 2026-11-01: the member picks
  // each expense's line, and approval commits it there).
  const fiscalYearId = watch('fiscalYearId');
  const { fiscalYears, fiscalYearsLoaded, budgetOptions } = useRequestFormOptions(fiscalYearId || undefined);

  // A line belongs to one year's budget, so choosing another year clears the
  // lines picked from the last one.
  useEffect(() => {
    setLineItems((prev) =>
      prev.some((item) => item.budgetId) ? prev.map((item) => ({ ...item, budgetId: '' })) : prev
    );
  }, [fiscalYearId]);

  // Auto-select active fiscal year
  useEffect(() => {
    if (fiscalYears.length > 0) {
      const active = fiscalYears.find((fy) => fy.status === 'active');
      if (active) {
        reset((prev) => ({ ...prev, fiscalYearId: active.id }));
      }
    }
  }, [fiscalYears, reset]);

  const totalAmount = lineItems.reduce((sum, item) => sum + lineAmount(item), 0);

  // A fund's warning weighs every line charged to it, since together they
  // are what an approval would take out of it.
  const chargedToFund: Record<string, number> = {};
  for (const item of lineItems) {
    if (item.fundCampaignId) {
      chargedToFund[item.fundCampaignId] = (chargedToFund[item.fundCampaignId] ?? 0) + lineAmount(item);
    }
  }

  const addLineItem = () => {
    setLineItems((prev) => [
      ...prev,
      {
        description: '',
        amount: 0,
        dateIncurred: '',
        expenseType: ExpenseType.GENERAL,
        merchant: '',
        fundCampaignId: '',
        budgetId: '',
        trips: [],
      },
    ]);
  };

  const removeLineItem = (index: number) => {
    setLineItems((prev) => prev.filter((_, i) => i !== index));
    setLineItemErrors((prev) => {
      const next = { ...prev };
      delete next[index];
      return next;
    });
  };

  const updateLineItem = (index: number, field: keyof LineItemEntry, value: string | number | TripEntry[]) => {
    setLineItems((prev) => prev.map((item, i) => (i === index ? { ...item, [field]: value } : item)));
  };

  const validateLineItems = (): boolean => {
    const newErrors: Record<number, string> = {};
    for (let i = 0; i < lineItems.length; i++) {
      const item = lineItems[i];
      if (!item) continue;
      if (isLogged(item)) {
        const problem = item.description.trim() ? tripLogError(item.trips) : 'Description is required';
        if (problem) newErrors[i] = problem;
        continue;
      }
      const result = expenseLineSchema.safeParse({
        ...item,
        amount: Number(item.amount),
      });
      if (!result.success) {
        const firstError = result.error.issues[0];
        newErrors[i] = firstError?.message ?? 'Invalid line item';
      }
    }
    setLineItemErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const onSubmit = async (data: ExpenseReportFormData) => {
    if (lineItems.length === 0) {
      toast.error('Add at least one line item');
      return;
    }

    if (!validateLineItems()) {
      toast.error('Fix the line item errors, then save again');
      return;
    }

    try {
      const payload: Record<string, unknown> = {
        title: data.title,
        fiscalYearId: data.fiscalYearId,
        lineItems: lineItems.map((item) => {
          // With a log, the server works out the amount and the date.
          const li: Record<string, unknown> = isLogged(item)
            ? {
                description: item.description,
                expenseType: item.expenseType,
                mileageTrips: toTripPayload(item.trips),
              }
            : {
                description: item.description,
                // A DecimalString, matching PurchaseRequestFormPage/
                // CheckRequestFormPage -- never Number()/parseFloat() at the
                // wire boundary, which round-trips through a JS float.
                amount: item.amount.toFixed(2),
                dateIncurred: item.dateIncurred,
                expenseType: item.expenseType,
              };
          const merchant = item.merchant?.trim();
          if (merchant) li.merchant = merchant;
          if (item.fundCampaignId) li.fundCampaignId = item.fundCampaignId;
          if (item.budgetId) li.budgetId = item.budgetId;
          return li;
        }),
      };
      const desc = data.description?.trim();
      if (desc) payload.description = desc;
      if (data.advanceId) payload.advanceId = data.advanceId;

      const created = await createExpenseReport(payload);
      toast.success('Expense report created');
      void navigate(`/finance/expenses/${created.id}`);
    } catch {
      // Error handled by store
    }
  };

  if (!fiscalYearsLoaded) {
    return (
      <div className="space-y-6">
        <Breadcrumbs />
        <button
          type="button"
          onClick={() => void navigate('/finance/expenses')}
          className="touch:min-h-11 text-theme-text-secondary hover:text-theme-text-primary inline-flex items-center gap-2 text-sm"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Expense Reports
        </button>
        <FormSkeleton />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Breadcrumbs />
      {/* Back link */}
      <button
        type="button"
        onClick={() => void navigate('/finance/expenses')}
        className="touch:min-h-11 text-theme-text-secondary hover:text-theme-text-primary inline-flex items-center gap-2 text-sm"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Expense Reports
      </button>

      {/* Header */}
      <div>
        <h1 className="text-theme-text-primary text-2xl font-bold">New Expense Report</h1>
        <p className="text-theme-text-secondary mt-1 text-sm">
          Saved as a draft. Submit it for approval from the next page.
        </p>
      </div>

      {/* Form */}
      <form onSubmit={(e) => void handleSubmit(onSubmit)(e)} className="space-y-6">
        {/* Report Details */}
        <div className="card p-6">
          <h2 className="text-theme-text-primary mb-4 text-lg font-semibold">Report Details</h2>
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label htmlFor="er-title" className={labelClass}>
                Title *
              </label>
              <input
                type="text"
                className={inputClass}
                placeholder="Brief title for this expense report"
                id="er-title"
                {...register('title')}
              />
              {errors.title && <p className={errorClass}>{errors.title.message}</p>}
            </div>

            <div className="sm:col-span-2">
              <label htmlFor="er-description" className={labelClass}>
                Description
              </label>
              <textarea
                className={inputClass}
                rows={3}
                placeholder="Additional context for this expense report"
                id="er-description"
                {...register('description')}
              />
              {errors.description && <p className={errorClass}>{errors.description.message}</p>}
            </div>

            <div>
              <label htmlFor="er-fiscalYearId" className={labelClass}>
                Fiscal Year *
              </label>
              <select className={selectClass} id="er-fiscalYearId" {...register('fiscalYearId')}>
                <option value="">Select fiscal year</option>
                {fiscalYears.map((fy) => (
                  <option key={fy.id} value={fy.id}>
                    {fy.name} {fy.status === 'active' ? '(Active)' : ''}
                  </option>
                ))}
              </select>
              {errors.fiscalYearId && <p className={errorClass}>{errors.fiscalYearId.message}</p>}
            </div>

            {advances.length > 0 && (
              <div className="sm:col-span-2">
                <label htmlFor="advanceId" className={labelClass}>
                  Accounts for a cash advance
                </label>
                <select
                  id="advanceId"
                  className={selectClass}
                  aria-describedby="advanceId-hint"
                  {...register('advanceId')}
                >
                  <option value="">No, reimburse me for these expenses</option>
                  {advances.map((advance) => (
                    <option key={advance.id} value={advance.id}>
                      {advance.requestNumber}: {formatCurrency(advance.outstanding)} outstanding
                      {advance.purpose ? ` (${advance.purpose})` : ''}
                    </option>
                  ))}
                </select>
                <p id="advanceId-hint" className="text-theme-text-secondary mt-1 text-xs">
                  These expenses are taken off what you owe on the advance. Anything above it is reimbursed to you as
                  usual; anything below, return to the Treasurer.
                </p>
              </div>
            )}

            <div className="flex items-end">
              <div className="rounded-lg bg-gray-50 px-4 py-2 dark:bg-gray-800">
                <span className="text-theme-text-secondary text-sm">Total: </span>
                <span className="text-theme-text-primary text-lg font-bold">{formatCurrency(totalAmount)}</span>
              </div>
            </div>
          </div>

          {/* A report is routed on its total alone; its lines may charge several budget lines. */}
          <ApprovalRoutePreview entityType={ApprovalEntityType.EXPENSE_REPORT} amount={totalAmount} />
        </div>

        {/* Line Items */}
        <div className="card p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-theme-text-primary text-lg font-semibold">Line Items</h2>
            <button
              type="button"
              onClick={addLineItem}
              className="touch:min-h-11 inline-flex items-center gap-1 rounded-md bg-red-800 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-900"
            >
              <Plus className="h-3 w-3" />
              Add Item
            </button>
          </div>

          {lineItems.length === 0 ? (
            <p className="text-theme-text-secondary py-8 text-center text-sm">
              No line items yet. Use &quot;Add Item&quot; to add each expense. After saving, attach a receipt to each
              line — the report cannot be submitted without them. A mileage line can record its trips here instead.
            </p>
          ) : (
            <div className="space-y-4">
              {lineItems.map((item, index) => (
                <div key={`line-item-${String(index)}`} className="border-theme-surface-border rounded-lg border p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <span className="text-theme-text-secondary text-sm font-medium">Item {index + 1}</span>
                    <button
                      type="button"
                      onClick={() => removeLineItem(index)}
                      aria-label={`Remove item ${String(index + 1)}`}
                      className="touch-target-phone text-red-500 hover:text-red-700"
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div className="sm:col-span-2">
                      <label htmlFor={`line-${String(index)}-description`} className={labelClass}>
                        Description *
                      </label>
                      <input
                        type="text"
                        className={inputClass}
                        id={`line-${String(index)}-description`}
                        placeholder="What was purchased"
                        value={item.description}
                        onChange={(e) => updateLineItem(index, 'description', e.target.value)}
                      />
                    </div>
                    {!isLogged(item) && (
                      <div>
                        <label htmlFor={`line-${String(index)}-amount`} className={labelClass}>
                          Amount *
                        </label>
                        <input
                          type="number"
                          step="0.01"
                          min={MIN_MONEY_AMOUNT}
                          max={MAX_MONEY_AMOUNT}
                          className={inputClass}
                          id={`line-${String(index)}-amount`}
                          placeholder="0.00"
                          value={item.amount || ''}
                          onChange={(e) => updateLineItem(index, 'amount', parseFloat(e.target.value) || 0)}
                        />
                      </div>
                    )}
                    {!isLogged(item) && (
                      <div>
                        <label htmlFor={`line-${String(index)}-date`} className={labelClass}>
                          Date *
                        </label>
                        <input
                          id={`line-${String(index)}-date`}
                          type="date"
                          className={inputClass}
                          value={item.dateIncurred}
                          onChange={(e) => updateLineItem(index, 'dateIncurred', e.target.value)}
                          aria-describedby={lateWarning(item.dateIncurred) ? `line-${String(index)}-late` : undefined}
                        />
                        {lateWarning(item.dateIncurred) && (
                          <p
                            id={`line-${String(index)}-late`}
                            className="mt-1 text-xs text-amber-800 dark:text-amber-300"
                            role="status"
                          >
                            {lateWarning(item.dateIncurred)}
                          </p>
                        )}
                      </div>
                    )}
                    <div>
                      <label htmlFor={`line-${String(index)}-type`} className={labelClass}>
                        Type *
                      </label>
                      <select
                        className={selectClass}
                        id={`line-${String(index)}-type`}
                        value={item.expenseType}
                        onChange={(e) => updateLineItem(index, 'expenseType', e.target.value)}
                      >
                        {EXPENSE_TYPE_OPTIONS.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label htmlFor={`line-${String(index)}-merchant`} className={labelClass}>
                        Merchant
                      </label>
                      <input
                        type="text"
                        className={inputClass}
                        id={`line-${String(index)}-merchant`}
                        placeholder="Store or vendor"
                        value={item.merchant}
                        onChange={(e) => updateLineItem(index, 'merchant', e.target.value)}
                      />
                    </div>
                    {item.expenseType === ExpenseType.MILEAGE && (
                      <div className="sm:col-span-3">
                        <MileageTripLog
                          idPrefix={`line-${String(index)}`}
                          trips={item.trips}
                          onChange={(trips) => updateLineItem(index, 'trips', trips)}
                          rate={mileageRate}
                          today={getTodayLocalDate(tz)}
                        />
                      </div>
                    )}
                    <div className="sm:col-span-3">
                      <label htmlFor={`line-${String(index)}-budget`} className={labelClass}>
                        Budget line
                      </label>
                      <select
                        className={selectClass}
                        id={`line-${String(index)}-budget`}
                        value={item.budgetId}
                        onChange={(e) => updateLineItem(index, 'budgetId', e.target.value)}
                      >
                        <option value="">No budget line</option>
                        {selectableBudgetOptions(budgetOptions).map((option) => (
                          <option key={option.id} value={option.id}>
                            {budgetOptionLabel(option)}
                          </option>
                        ))}
                      </select>
                      <p className="text-theme-text-secondary mt-1 text-xs">
                        Approving the report commits this amount to the line you choose.
                      </p>
                    </div>
                    <div className="sm:col-span-3">
                      <FundSelect
                        id={`line-${String(index)}-fund`}
                        value={item.fundCampaignId}
                        onChange={(fundId) => updateLineItem(index, 'fundCampaignId', fundId)}
                        amount={item.fundCampaignId ? (chargedToFund[item.fundCampaignId] ?? 0) : 0}
                        funds={funds}
                        mode={fundMode}
                      />
                    </div>
                  </div>
                  {lineItemErrors[index] && <p className="mt-2 text-xs text-red-600">{lineItemErrors[index]}</p>}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={() => void navigate('/finance/expenses')}
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
            {isSubmitting ? 'Saving...' : 'Create Report'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default ExpenseReportFormPage;
