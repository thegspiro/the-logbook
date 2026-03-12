/**
 * Expense Report Form Page
 *
 * Form for creating expense reports with line items.
 * Uses react-hook-form + zod for validation.
 */

import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Save, Plus, Trash2 } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { useFinanceStore } from '../store/financeStore';
import { Skeleton } from '@/components/ux/Skeleton';
import { ExpenseType } from '../types';
import type { ExpenseReport } from '../types';

// =============================================================================
// Validation Schema
// =============================================================================

const lineItemSchema = z.object({
  description: z.string().min(1, 'Description is required'),
  amount: z.number({ message: 'Amount is required' }).positive('Amount must be positive'),
  dateIncurred: z.string().min(1, 'Date is required'),
  expenseType: z.string().min(1, 'Expense type is required'),
  merchant: z.string().optional(),
});

const expenseReportSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200),
  description: z.string().max(2000).optional(),
  fiscalYearId: z.string().min(1, 'Fiscal year is required'),
});

type ExpenseReportFormData = z.infer<typeof expenseReportSchema>;

interface LineItemEntry {
  description: string;
  amount: number;
  dateIncurred: string;
  expenseType: string;
  merchant: string;
}

// =============================================================================
// Shared Styles
// =============================================================================

const inputClass =
  'w-full rounded-lg border border-theme-surface-border bg-theme-surface px-3 py-2 text-sm text-theme-text-primary placeholder:text-theme-text-secondary focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500';
const selectClass = inputClass;
const labelClass = 'block text-sm font-medium text-theme-text-secondary mb-1';
const errorClass = 'mt-1 text-xs text-red-600';

// =============================================================================
// Expense Type Options
// =============================================================================

const EXPENSE_TYPE_OPTIONS = [
  { value: ExpenseType.GENERAL, label: 'General' },
  { value: ExpenseType.UNIFORM_REIMBURSEMENT, label: 'Uniform Reimbursement' },
  { value: ExpenseType.PPE_REPLACEMENT, label: 'PPE Replacement' },
  { value: ExpenseType.BOOT_ALLOWANCE, label: 'Boot Allowance' },
  { value: ExpenseType.TRAINING_REIMBURSEMENT, label: 'Training Reimbursement' },
  { value: ExpenseType.CERTIFICATION_FEE, label: 'Certification Fee' },
  { value: ExpenseType.CONFERENCE, label: 'Conference' },
  { value: ExpenseType.TRAVEL, label: 'Travel' },
  { value: ExpenseType.MEALS, label: 'Meals' },
  { value: ExpenseType.MILEAGE, label: 'Mileage' },
  { value: ExpenseType.EQUIPMENT_PURCHASE, label: 'Equipment Purchase' },
  { value: ExpenseType.OTHER, label: 'Other' },
];

const formatCurrency = (amount: number): string =>
  new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);

// =============================================================================
// Loading Skeleton
// =============================================================================

const FormSkeleton: React.FC = () => (
  <div
    className="space-y-6"
    aria-label="Loading expense report form"
    role="status"
  >
    <span className="sr-only">Loading...</span>
    <div className="rounded-lg border border-theme-surface-border bg-theme-surface p-6">
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

  const {
    fiscalYears,
    isLoading,
    fetchFiscalYears,
    createExpenseReport,
  } = useFinanceStore();

  const [lineItems, setLineItems] = useState<LineItemEntry[]>([]);
  const [lineItemErrors, setLineItemErrors] = useState<Record<number, string>>({});

  const {
    register,
    handleSubmit,
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

  // Load reference data
  useEffect(() => {
    void fetchFiscalYears();
  }, [fetchFiscalYears]);

  // Auto-select active fiscal year
  useEffect(() => {
    if (fiscalYears.length > 0) {
      const active = fiscalYears.find((fy) => fy.status === 'active');
      if (active) {
        reset((prev) => ({ ...prev, fiscalYearId: active.id }));
      }
    }
  }, [fiscalYears, reset]);

  const totalAmount = useMemo(() => {
    return lineItems.reduce((sum, item) => sum + (item.amount || 0), 0);
  }, [lineItems]);

  const addLineItem = () => {
    setLineItems((prev) => [
      ...prev,
      {
        description: '',
        amount: 0,
        dateIncurred: '',
        expenseType: ExpenseType.GENERAL,
        merchant: '',
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

  const updateLineItem = (index: number, field: keyof LineItemEntry, value: string | number) => {
    setLineItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, [field]: value } : item)),
    );
  };

  const validateLineItems = (): boolean => {
    const newErrors: Record<number, string> = {};
    for (let i = 0; i < lineItems.length; i++) {
      const item = lineItems[i];
      if (!item) continue;
      const result = lineItemSchema.safeParse({
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
      toast.error('Fix line item errors before submitting');
      return;
    }

    try {
      const payload: Record<string, unknown> = {
        title: data.title,
        fiscalYearId: data.fiscalYearId,
        totalAmount,
        lineItems: lineItems.map((item) => {
          const li: Record<string, unknown> = {
            description: item.description,
            amount: Number(item.amount),
            dateIncurred: item.dateIncurred,
            expenseType: item.expenseType,
          };
          const merchant = item.merchant?.trim();
          if (merchant) li.merchant = merchant;
          return li;
        }),
      };
      const desc = data.description?.trim();
      if (desc) payload.description = desc;

      const created = await createExpenseReport(payload as Partial<ExpenseReport>);
      toast.success('Expense report created');
      navigate(`/finance/expenses/${created.id}`);
    } catch {
      // Error handled by store
    }
  };

  if (isLoading && fiscalYears.length === 0) {
    return (
      <div className="space-y-6">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="inline-flex items-center gap-2 text-sm text-theme-text-secondary hover:text-theme-text-primary"
        >
          <ArrowLeft className="h-4 w-4" />
          Back
        </button>
        <FormSkeleton />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Back link */}
      <button
        type="button"
        onClick={() => navigate(-1)}
        className="inline-flex items-center gap-2 text-sm text-theme-text-secondary hover:text-theme-text-primary"
      >
        <ArrowLeft className="h-4 w-4" />
        Back
      </button>

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-theme-text-primary">
          New Expense Report
        </h1>
        <p className="mt-1 text-sm text-theme-text-secondary">
          Submit expenses for reimbursement.
        </p>
      </div>

      {/* Form */}
      <form
        onSubmit={(e) => void handleSubmit(onSubmit)(e)}
        className="space-y-6"
      >
        {/* Report Details */}
        <div className="rounded-lg border border-theme-surface-border bg-theme-surface p-6">
          <h2 className="mb-4 text-lg font-semibold text-theme-text-primary">
            Report Details
          </h2>
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className={labelClass}>Title *</label>
              <input
                type="text"
                className={inputClass}
                placeholder="Brief title for this expense report"
                {...register('title')}
              />
              {errors.title && (
                <p className={errorClass}>{errors.title.message}</p>
              )}
            </div>

            <div className="sm:col-span-2">
              <label className={labelClass}>Description</label>
              <textarea
                className={inputClass}
                rows={3}
                placeholder="Additional context for this expense report"
                {...register('description')}
              />
              {errors.description && (
                <p className={errorClass}>{errors.description.message}</p>
              )}
            </div>

            <div>
              <label className={labelClass}>Fiscal Year *</label>
              <select className={selectClass} {...register('fiscalYearId')}>
                <option value="">Select fiscal year</option>
                {fiscalYears.map((fy) => (
                  <option key={fy.id} value={fy.id}>
                    {fy.name} {fy.status === 'active' ? '(Active)' : ''}
                  </option>
                ))}
              </select>
              {errors.fiscalYearId && (
                <p className={errorClass}>{errors.fiscalYearId.message}</p>
              )}
            </div>

            <div className="flex items-end">
              <div className="rounded-lg bg-gray-50 px-4 py-2 dark:bg-gray-800">
                <span className="text-sm text-theme-text-secondary">Total: </span>
                <span className="text-lg font-bold text-theme-text-primary">
                  {formatCurrency(totalAmount)}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Line Items */}
        <div className="rounded-lg border border-theme-surface-border bg-theme-surface p-6">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-theme-text-primary">
              Line Items
            </h2>
            <button
              type="button"
              onClick={addLineItem}
              className="inline-flex items-center gap-1 rounded-md bg-red-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-red-700"
            >
              <Plus className="h-3 w-3" />
              Add Item
            </button>
          </div>

          {lineItems.length === 0 ? (
            <p className="py-8 text-center text-sm text-theme-text-secondary">
              No line items yet. Click &quot;Add Item&quot; to begin.
            </p>
          ) : (
            <div className="space-y-4">
              {lineItems.map((item, index) => (
                <div
                  key={`line-item-${String(index)}`}
                  className="rounded-lg border border-theme-surface-border p-4"
                >
                  <div className="mb-3 flex items-center justify-between">
                    <span className="text-sm font-medium text-theme-text-secondary">
                      Item {index + 1}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeLineItem(index)}
                      className="text-red-500 hover:text-red-700"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div className="sm:col-span-2">
                      <label className={labelClass}>Description *</label>
                      <input
                        type="text"
                        className={inputClass}
                        placeholder="What was purchased"
                        value={item.description}
                        onChange={(e) => updateLineItem(index, 'description', e.target.value)}
                      />
                    </div>
                    <div>
                      <label className={labelClass}>Amount *</label>
                      <input
                        type="number"
                        step="0.01"
                        min="0"
                        className={inputClass}
                        placeholder="0.00"
                        value={item.amount || ''}
                        onChange={(e) => updateLineItem(index, 'amount', parseFloat(e.target.value) || 0)}
                      />
                    </div>
                    <div>
                      <label className={labelClass}>Date *</label>
                      <input
                        type="date"
                        className={inputClass}
                        value={item.dateIncurred}
                        onChange={(e) => updateLineItem(index, 'dateIncurred', e.target.value)}
                      />
                    </div>
                    <div>
                      <label className={labelClass}>Type *</label>
                      <select
                        className={selectClass}
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
                      <label className={labelClass}>Merchant</label>
                      <input
                        type="text"
                        className={inputClass}
                        placeholder="Store or vendor"
                        value={item.merchant}
                        onChange={(e) => updateLineItem(index, 'merchant', e.target.value)}
                      />
                    </div>
                  </div>
                  {lineItemErrors[index] && (
                    <p className="mt-2 text-xs text-red-600">{lineItemErrors[index]}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={() => navigate(-1)}
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
            {isSubmitting ? 'Saving...' : 'Create Report'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default ExpenseReportFormPage;
