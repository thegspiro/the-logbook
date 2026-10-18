/**
 * Purchase Request Form Page
 *
 * Form for creating and editing purchase requests.
 * Uses react-hook-form + zod for validation.
 */

import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { ArrowLeft, Save } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { useFinanceStore } from '../store/financeStore';
import { purchaseRequestService } from '../services/api';
import { budgetOptionLabel, useRequestFormOptions } from '../hooks/useRequestFormOptions';
import { useFundOptions } from '../hooks/useFundOptions';
import { FundSelect } from '../components/FundSelect';
import { Skeleton } from '@/components/ux/Skeleton';
import { Breadcrumbs } from '@/components/ux/Breadcrumbs';
import { PurchaseRequestPriority, PurchaseRequestStatus } from '../types';
import { getSaveFailureMessage } from '@/utils/errorHandling';
import { useConfirm } from '@/contexts/ConfirmContext';
import { useTimezone } from '@/hooks/useTimezone';
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges';
import { formatTime } from '@/utils/dateFormatting';
import { useDraftAutosave } from '../hooks/useDraftAutosave';
import {
  canSaveDraft,
  createPurchaseRequestPayload,
  updatePurchaseRequestPayload,
} from '../utils/purchaseRequestDraft';

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
  fundCampaignId: z.string().optional(),
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
  const { confirm } = useConfirm();
  const tz = useTimezone();
  const [baseline, setBaseline] = useState<PurchaseRequestFormData | null>(null);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting, isDirty },
    reset,
    watch,
    setValue,
  } = useForm<PurchaseRequestFormData>({
    resolver: zodResolver(purchaseRequestSchema),
    defaultValues: {
      title: '',
      description: '',
      vendor: '',
      estimatedAmount: 0,
      priority: PurchaseRequestPriority.MEDIUM,
      budgetId: '',
      fundCampaignId: '',
      fiscalYearId: '',
    },
  });

  // Fiscal years and the chosen year's budget lines come from the narrow
  // options endpoints, which a member holding only finance.request can read.
  const formValues = watch();
  const fiscalYearId = formValues.fiscalYearId;
  const { fiscalYears, budgetOptions } = useRequestFormOptions(fiscalYearId);

  // A new request, or a draft being edited, is saved to the server as the
  // member types. Once it has been submitted it is edited with an explicit
  // save again, so that a half-typed change is never sent for approval.
  const autosaving = isEdit ? selectedPurchaseRequest?.status === PurchaseRequestStatus.DRAFT : true;
  const autosave = useDraftAutosave<PurchaseRequestFormData>({
    values: formValues,
    enabled: autosaving,
    isSavable: canSaveDraft,
    create: (values) => createPurchaseRequest(createPurchaseRequestPayload(values)),
    update: (draftId, values) => purchaseRequestService.update(draftId, updatePurchaseRequestPayload(values)),
    initialId: id ?? null,
    baseline,
    dirty: isDirty,
  });
  useUnsavedChanges({
    hasChanges: autosave.hasUnsaved,
    message: 'Your request has not been saved yet. Are you sure you want to leave?',
  });
  const { funds, mode: fundMode } = useFundOptions();

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
      const loaded: PurchaseRequestFormData = {
        title: pr.title,
        description: pr.description ?? '',
        vendor: pr.vendor ?? '',
        estimatedAmount: Number(pr.estimatedAmount),
        priority: pr.priority,
        budgetId: pr.budgetId ?? '',
        fundCampaignId: pr.fundCampaignId ?? '',
        fiscalYearId: pr.fiscalYearId,
      };
      reset(loaded);
      setBaseline(loaded);
    }
  }, [isEdit, selectedPurchaseRequest, reset]);

  const onSubmit = async (data: PurchaseRequestFormData) => {
    try {
      if (!autosaving && id) {
        await purchaseRequestService.update(id, updatePurchaseRequestPayload(data));
        toast.success('Purchase request updated');
        void navigate(`/finance/purchase-requests/${id}`);
        return;
      }
      // Validation passed, so the server can hold these values: this creates
      // the draft if autosave has not yet, or brings it up to date.
      const savedId = await autosave.flush();
      if (!savedId) throw new Error('The request could not be saved');
      toast.success(isEdit ? 'Purchase request updated' : 'Purchase request saved as a draft');
      void navigate(`/finance/purchase-requests/${savedId}`);
    } catch (err: unknown) {
      // A fixed id so repeated taps replace the toast instead of stacking one
      // per attempt.
      toast.error(getSaveFailureMessage(err, 'save the purchase request'), { id: 'purchase-request-save-error' });
    }
  };

  // Leaving keeps whatever the server can hold. Only entries it cannot hold
  // yet (no title or amount) would be lost, so only those ask first.
  const leave = async () => {
    if (autosave.hasUnsaved) {
      if (!canSaveDraft(formValues)) {
        const discard = await confirm({
          title: 'Leave without saving?',
          message:
            'A draft is saved once the request has a title and an amount. What you have entered so far will be lost.',
          confirmLabel: 'Leave',
          cancelLabel: 'Keep editing',
          variant: 'warning',
        });
        if (!discard) return;
      } else {
        try {
          await autosave.flush();
          toast.success('Draft saved');
        } catch (err: unknown) {
          toast.error(getSaveFailureMessage(err, 'save the draft'));
          return;
        }
      }
    }
    void navigate('/finance/purchase-requests');
  };

  const discardDraft = async () => {
    const draftId = autosave.draftId;
    if (!draftId || isEdit) return;
    const discard = await confirm({
      title: 'Discard this draft?',
      message: 'The draft is withdrawn and cannot be brought back.',
      confirmLabel: 'Discard draft',
      cancelLabel: 'Keep draft',
      variant: 'danger',
    });
    if (!discard) return;
    try {
      await purchaseRequestService.cancel(draftId);
    } catch (err: unknown) {
      toast.error(getSaveFailureMessage(err, 'discard the draft'));
      return;
    }
    autosave.stop();
    toast.success('Draft discarded');
    void navigate('/finance/purchase-requests');
  };

  const saveStatus = (() => {
    if (!autosaving) return null;
    if (autosave.status === 'saving') return 'Saving draft…';
    if (autosave.status === 'error') return 'Could not save the draft. It will try again when you change something.';
    if (autosave.savedAt && !autosave.hasUnsaved) return `Draft saved at ${formatTime(autosave.savedAt, tz)}`;
    if (!canSaveDraft(formValues)) return 'Add a title and an amount to start saving a draft.';
    return 'Saving soon…';
  })();

  if (isLoading && isEdit && !selectedPurchaseRequest) {
    return (
      <div className="space-y-6">
        <Breadcrumbs />
        <button
          type="button"
          onClick={() => void leave()}
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
        onClick={() => void leave()}
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
            ? autosaving
              ? 'Changes to this draft are saved as you type. Submit it for approval from the request page.'
              : 'You can edit a request until you submit it.'
            : 'Your request is saved as a draft as you type. Submit it for approval from the next page.'}
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

          <div className="sm:col-span-2">
            <FundSelect
              id="fundCampaignId"
              value={watch('fundCampaignId') ?? ''}
              onChange={(fundId) => setValue('fundCampaignId', fundId, { shouldDirty: true })}
              amount={watch('estimatedAmount') || 0}
              funds={funds}
              mode={fundMode}
            />
          </div>
        </div>

        {/* Actions */}
        <div className="border-theme-surface-border mt-6 border-t pt-6">
          {saveStatus && (
            <p aria-live="polite" className="text-theme-text-secondary mb-4 text-sm">
              {saveStatus}
            </p>
          )}
          <div className="flex flex-wrap items-center justify-end gap-3">
            {autosave.draftId && !isEdit && (
              <button
                type="button"
                onClick={() => void discardDraft()}
                className="touch:min-h-11 mr-auto px-2 py-2 text-sm font-medium text-red-700 hover:underline dark:text-red-400"
              >
                Discard draft
              </button>
            )}
            <button
              type="button"
              onClick={() => void leave()}
              className="border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-hover touch:min-h-11 rounded-lg border px-4 py-2 text-sm font-medium"
            >
              {autosaving ? 'Close' : 'Cancel'}
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="touch:min-h-11 inline-flex items-center gap-2 rounded-lg bg-red-800 px-4 py-2 text-sm font-medium text-white hover:bg-red-900 disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              {isSubmitting ? 'Saving...' : isEdit ? 'Save Changes' : 'Save Draft'}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
};

export default PurchaseRequestFormPage;
