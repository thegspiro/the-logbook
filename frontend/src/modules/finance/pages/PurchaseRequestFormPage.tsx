/**
 * Purchase Request Form Page
 *
 * Form for creating and editing purchase requests.
 * Uses react-hook-form + zod for validation.
 */

import React, { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router';
import { ArrowLeft, Save } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { useFinanceStore } from '../store/financeStore';
import { purchaseRequestService } from '../services/api';
import { budgetOptionLabel, useRequestFormOptions } from '../hooks/useRequestFormOptions';
import { Skeleton } from '@/components/ux/Skeleton';
import { Breadcrumbs } from '@/components/ux/Breadcrumbs';
import { PurchaseRequestPriority } from '../types';
import type { PurchaseRequest } from '../types';
import { getErrorMessage } from '@/utils/errorHandling';
import { blankToNull } from '@/utils/formValues';

// =============================================================================
// Validation Schema
// =============================================================================

const purchaseRequestSchema = z.object({
  title: z.string().min(1, 'Title is required').max(200),
  description: z.string().max(2000).optional(),
  vendor: z.string().max(200).optional(),
  estimatedAmount: z.number({ message: 'Amount is required' }).positive('Amount must be greater than zero'),
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
  <div className="space-y-6" aria-label="Loading purchase request form" role="status" aria-live="polite">
    <span className="sr-only">Loading...</span>
    <div className="card p-6">
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

  const { selectedPurchaseRequest, isLoading, fetchPurchaseRequest, createPurchaseRequest } = useFinanceStore();

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

  // Fiscal years and the chosen year's budget lines come from the narrow
  // options endpoints, which a member holding only finance.request can read.
  const fiscalYearId = watch('fiscalYearId');
  const { fiscalYears, budgetOptions } = useRequestFormOptions(fiscalYearId);

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
        estimatedAmount: Number(pr.estimatedAmount),
        priority: pr.priority,
        budgetId: pr.budgetId ?? '',
        fiscalYearId: pr.fiscalYearId,
      });
    }
  }, [isEdit, selectedPurchaseRequest, reset]);

  const onSubmit = async (data: PurchaseRequestFormData) => {
    try {
      const payload: Partial<PurchaseRequest> = {
        title: data.title,
        estimatedAmount: data.estimatedAmount.toFixed(2),
        priority: data.priority as PurchaseRequestPriority,
        fiscalYearId: data.fiscalYearId,
      };

      if (isEdit && id) {
        // Edit sends every optional field, blank ones as an explicit null, so
        // removing a vendor or clearing a description actually takes. Omitting
        // them here would read as "leave alone" once the backend applies the
        // exclude_unset dump, and the removal would silently not happen.
        payload.description = blankToNull(data.description);
        payload.vendor = blankToNull(data.vendor);
        payload.budgetId = data.budgetId || null;

        await purchaseRequestService.update(id, payload);
        toast.success('Purchase request updated');
        void navigate(`/finance/purchase-requests/${id}`);
      } else {
        // Create omits blanks so they never reach a validator as "".
        const desc = data.description?.trim();
        if (desc) payload.description = desc;
        const vendor = data.vendor?.trim();
        if (vendor) payload.vendor = vendor;
        if (data.budgetId) payload.budgetId = data.budgetId;

        const created = await createPurchaseRequest(payload);
        toast.success('Purchase request created');
        void navigate(`/finance/purchase-requests/${created.id}`);
      }
    } catch (err: unknown) {
      // The edit path calls the service directly rather than going through the
      // store, so nothing else surfaces its failure.
      toast.error(getErrorMessage(err, 'Could not save the purchase request'));
    }
  };

  if (isLoading && isEdit && !selectedPurchaseRequest) {
    return (
      <div className="space-y-6">
        <Breadcrumbs />
        <button
          type="button"
          onClick={() => void navigate('/finance/purchase-requests')}
          className="text-theme-text-secondary hover:text-theme-text-primary inline-flex items-center gap-2 text-sm"
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
        onClick={() => void navigate('/finance/purchase-requests')}
        className="text-theme-text-secondary hover:text-theme-text-primary inline-flex items-center gap-2 text-sm"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Purchase Requests
      </button>

      {/* Header */}
      <div>
        <h1 className="text-theme-text-primary text-2xl font-bold">
          {isEdit ? 'Edit Purchase Request' : 'New Purchase Request'}
        </h1>
        <p className="text-theme-text-secondary mt-1 text-sm">
          {isEdit
            ? 'You can edit a request until you submit it.'
            : 'Saved as a draft. Submit it for approval from the next page.'}
        </p>
      </div>

      {/* Form */}
      <form onSubmit={(e) => void handleSubmit(onSubmit)(e)} className="card p-6">
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
            {errors.title && <p className={errorClass}>{errors.title.message}</p>}
          </div>

          {/* Description */}
          <div className="sm:col-span-2">
            <label className={labelClass}>Description</label>
            <textarea
              className={inputClass}
              rows={3}
              placeholder="What you're buying and why"
              {...register('description')}
            />
            {errors.description && <p className={errorClass}>{errors.description.message}</p>}
          </div>

          {/* Vendor */}
          <div>
            <label className={labelClass}>Vendor</label>
            <input type="text" className={inputClass} placeholder="Vendor or supplier name" {...register('vendor')} />
            {errors.vendor && <p className={errorClass}>{errors.vendor.message}</p>}
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
            {errors.estimatedAmount && <p className={errorClass}>{errors.estimatedAmount.message}</p>}
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
            {errors.priority && <p className={errorClass}>{errors.priority.message}</p>}
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
            {errors.fiscalYearId && <p className={errorClass}>{errors.fiscalYearId.message}</p>}
          </div>

          {/* Budget Category */}
          <div className="sm:col-span-2">
            <label className={labelClass}>Budget</label>
            <select className={selectClass} {...register('budgetId')}>
              <option value="">No budget linked</option>
              {budgetOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {budgetOptionLabel(option)}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Actions */}
        <div className="border-theme-surface-border mt-6 flex items-center justify-end gap-3 border-t pt-6">
          <button
            type="button"
            onClick={() => void navigate('/finance/purchase-requests')}
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
            {isSubmitting ? 'Saving...' : isEdit ? 'Save Changes' : 'Create Request'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default PurchaseRequestFormPage;
