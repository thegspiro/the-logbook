/**
 * Purchase Request Form Page
 *
 * Form for creating and editing purchase requests.
 * Uses react-hook-form + zod for validation.
 */

import React, { useEffect, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Save } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { useFinanceStore } from '../store/financeStore';
import { purchaseRequestService } from '../services/api';
import { Skeleton } from '@/components/ux/Skeleton';
import { Breadcrumbs } from '@/components/ux/Breadcrumbs';
import { PurchaseRequestPriority } from '../types';
import type { PurchaseRequest } from '../types';
import { formatCurrencyWhole } from '@/utils/currencyFormatting';

// =============================================================================
// Validation Schema
// =============================================================================

const purchaseRequestSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200),
  description: z.string().max(2000).optional(),
  vendor: z.string().max(200).optional(),
  estimatedAmount: z
    .number({ message: 'Amount is required' })
    .positive('Amount must be positive'),
  priority: z.string().min(1, 'Priority is required'),
  budgetId: z.string().optional(),
  fiscalYearId: z.string().min(1, 'Fiscal year is required'),
});

type PurchaseRequestFormData = z.infer<typeof purchaseRequestSchema>;

// =============================================================================
// Shared Styles
// =============================================================================

const inputClass = 'form-input';
const selectClass = inputClass;
const labelClass = 'form-label';
const errorClass = 'mt-1 text-xs text-red-600';

// =============================================================================
// Priority Options
// =============================================================================

const PRIORITY_OPTIONS = [
  { value: PurchaseRequestPriority.LOW, label: 'Low' },
  { value: PurchaseRequestPriority.MEDIUM, label: 'Medium' },
  { value: PurchaseRequestPriority.HIGH, label: 'High' },
  { value: PurchaseRequestPriority.URGENT, label: 'Urgent' },
];

// =============================================================================
// Loading Skeleton
// =============================================================================

const FormSkeleton: React.FC = () => (
  <div
    className="space-y-6"
    aria-label="Loading purchase request form"
    role="status" aria-live="polite"
  >
    <span className="sr-only">Loading...</span>
    <div className="rounded-lg border border-theme-surface-border bg-theme-surface p-6">
      {Array.from({ length: 6 }).map((_, i) => (
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

const PurchaseRequestFormPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isEdit = !!id;

  const {
    fiscalYears,
    budgets,
    budgetCategories,
    selectedPurchaseRequest,
    isLoading,
    fetchFiscalYears,
    fetchBudgets,
    fetchBudgetCategories,
    fetchPurchaseRequest,
    createPurchaseRequest,
  } = useFinanceStore();

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
    watch,
  } = useForm<PurchaseRequestFormData>({
    resolver: zodResolver(purchaseRequestSchema),
    defaultValues: {
      title: '',
      description: '',
      vendor: '',
      estimatedAmount: 0,
      priority: PurchaseRequestPriority.MEDIUM,
      budgetId: '',
      fiscalYearId: '',
    },
  });

  // Load reference data
  useEffect(() => {
    void fetchFiscalYears();
    void fetchBudgetCategories();
  }, [fetchFiscalYears, fetchBudgetCategories]);

  // Load purchase request for edit mode
  useEffect(() => {
    if (isEdit && id) {
      void fetchPurchaseRequest(id);
    }
  }, [isEdit, id, fetchPurchaseRequest]);

  // Auto-select active fiscal year
  useEffect(() => {
    if (fiscalYears.length > 0 && !isEdit) {
      const active = fiscalYears.find((fy) => fy.status === 'active');
      if (active) {
        reset((prev) => ({ ...prev, fiscalYearId: active.id }));
      }
    }
  }, [fiscalYears, isEdit, reset]);

  // Populate form for edit
  useEffect(() => {
    if (isEdit && selectedPurchaseRequest) {
      const pr = selectedPurchaseRequest;
      reset({
        title: pr.title,
        description: pr.description ?? '',
        vendor: pr.vendor ?? '',
        estimatedAmount: pr.estimatedAmount,
        priority: pr.priority,
        budgetId: pr.budgetId ?? '',
        fiscalYearId: pr.fiscalYearId,
      });
    }
  }, [isEdit, selectedPurchaseRequest, reset]);

  // Fetch budgets when fiscal year changes
  const fiscalYearId = watch('fiscalYearId');
  useEffect(() => {
    if (fiscalYearId) {
      void fetchBudgets({ fiscalYearId });
    }
  }, [fiscalYearId, fetchBudgets]);

  // Build category lookup for budget labels
  const categoryMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const cat of budgetCategories) {
      map.set(cat.id, cat.name);
    }
    return map;
  }, [budgetCategories]);

  const onSubmit = async (data: PurchaseRequestFormData) => {
    try {
      const payload: Partial<PurchaseRequest> = {
        title: data.title,
        estimatedAmount: data.estimatedAmount,
        priority: data.priority as PurchaseRequestPriority,
        fiscalYearId: data.fiscalYearId,
      };
      const desc = data.description?.trim();
      if (desc) payload.description = desc;
      const vendor = data.vendor?.trim();
      if (vendor) payload.vendor = vendor;
      if (data.budgetId) payload.budgetId = data.budgetId;

      if (isEdit && id) {
        await purchaseRequestService.update(id, payload);
        toast.success('Purchase request updated');
        navigate(`/finance/purchase-requests/${id}`);
      } else {
        const created = await createPurchaseRequest(payload);
        toast.success('Purchase request created');
        navigate(`/finance/purchase-requests/${created.id}`);
      }
    } catch {
      // Error handled by store or caught above
    }
  };

  if (isLoading && isEdit && !selectedPurchaseRequest) {
    return (
      <div className="space-y-6">
        <button
          type="button"
          onClick={() => navigate('/finance/purchase-requests')}
          className="inline-flex items-center gap-2 text-sm text-theme-text-secondary hover:text-theme-text-primary"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Purchase Requests
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
        onClick={() => navigate('/finance/purchase-requests')}
        className="inline-flex items-center gap-2 text-sm text-theme-text-secondary hover:text-theme-text-primary"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Purchase Requests
      </button>

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-theme-text-primary">
          {isEdit ? 'Edit Purchase Request' : 'New Purchase Request'}
        </h1>
        <p className="mt-1 text-sm text-theme-text-secondary">
          {isEdit
            ? 'Update the details for this purchase request.'
            : 'Fill in the details to create a new purchase request.'}
        </p>
      </div>

      {/* Form */}
      <form
        onSubmit={(e) => void handleSubmit(onSubmit)(e)}
        className="rounded-lg border border-theme-surface-border bg-theme-surface p-6"
      >
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          {/* Title */}
          <div className="sm:col-span-2">
            <label className={labelClass}>Title *</label>
            <input
              type="text"
              className={inputClass}
              placeholder="Brief title for the purchase"
              {...register('title')}
            />
            {errors.title && (
              <p className={errorClass}>{errors.title.message}</p>
            )}
          </div>

          {/* Description */}
          <div className="sm:col-span-2">
            <label className={labelClass}>Description</label>
            <textarea
              className={inputClass}
              rows={3}
              placeholder="Detailed description of what is being purchased and why"
              {...register('description')}
            />
            {errors.description && (
              <p className={errorClass}>{errors.description.message}</p>
            )}
          </div>

          {/* Vendor */}
          <div>
            <label className={labelClass}>Vendor</label>
            <input
              type="text"
              className={inputClass}
              placeholder="Vendor or supplier name"
              {...register('vendor')}
            />
            {errors.vendor && (
              <p className={errorClass}>{errors.vendor.message}</p>
            )}
          </div>

          {/* Estimated Amount */}
          <div>
            <label className={labelClass}>Estimated Amount *</label>
            <input
              type="number"
              step="0.01"
              min="0"
              className={inputClass}
              placeholder="0.00"
              {...register('estimatedAmount', { valueAsNumber: true })}
            />
            {errors.estimatedAmount && (
              <p className={errorClass}>{errors.estimatedAmount.message}</p>
            )}
          </div>

          {/* Priority */}
          <div>
            <label className={labelClass}>Priority *</label>
            <select className={selectClass} {...register('priority')}>
              {PRIORITY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            {errors.priority && (
              <p className={errorClass}>{errors.priority.message}</p>
            )}
          </div>

          {/* Fiscal Year */}
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

          {/* Budget Category */}
          <div className="sm:col-span-2">
            <label className={labelClass}>Budget Category</label>
            <select className={selectClass} {...register('budgetId')}>
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
        </div>

        {/* Actions */}
        <div className="mt-6 flex items-center justify-end gap-3 border-t border-theme-surface-border pt-6">
          <button
            type="button"
            onClick={() => navigate('/finance/purchase-requests')}
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
            {isSubmitting
              ? 'Saving...'
              : isEdit
                ? 'Update Request'
                : 'Create Request'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default PurchaseRequestFormPage;
