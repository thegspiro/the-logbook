/**
 * Approval Chains Settings Page
 *
 * Create approval chains, edit a chain's name, description and active flag,
 * and add, edit, reorder and delete its steps.
 * Protected by finance.configure_approvals permission.
 */

import React, { useEffect, useState } from 'react';
import { Link } from 'react-router';
import {
  ArrowLeft,
  Plus,
  Trash2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  AlertTriangle,
  GitBranch,
  Pencil,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useSubmitGuard } from '@/hooks/useSubmitGuard';
import { formatCurrencyWhole } from '@/utils/currencyFormatting';
import { getErrorMessage } from '@/utils/errorHandling';
import { useFinanceStore } from '../store/financeStore';
import { SkeletonPage } from '@/components/ux/Skeleton';
import { Breadcrumbs } from '@/components/ux/Breadcrumbs';
import { EmptyState } from '@/components/ux/EmptyState';
import { ApprovalEntityType, ApprovalStepType, ApproverType } from '../types';
import type { ApprovalChain, ApprovalChainStep, ApprovalChainUpdatePayload } from '../types';
import { ApprovalStepDialog } from '../components/ApprovalStepDialog';
import { ApprovalChainEditDialog } from '../components/ApprovalChainEditDialog';
import { useApproverOptions } from '../hooks/useApproverOptions';
import type { ApproverOptions } from '../hooks/useApproverOptions';
import { buildStepCreatePayload, buildStepUpdatePayload, stepToFormValues } from '../utils/approvalStepForm';
import type { StepFormValues } from '../utils/approvalStepForm';

import { useConfirm } from '../../../contexts/ConfirmContext';
// =============================================================================
// Constants
// =============================================================================

const ENTITY_TYPE_LABELS: Record<string, string> = {
  [ApprovalEntityType.PURCHASE_REQUEST]: 'Purchase Requests',
  [ApprovalEntityType.EXPENSE_REPORT]: 'Expense Reports',
  [ApprovalEntityType.CHECK_REQUEST]: 'Check Requests',
};

const STEP_TYPE_LABELS: Record<string, string> = {
  [ApprovalStepType.APPROVAL]: 'Approval',
  [ApprovalStepType.NOTIFICATION]: 'Notification',
};

const APPROVER_TYPE_LABELS: Record<string, string> = {
  [ApproverType.POSITION]: 'Position',
  [ApproverType.PERMISSION]: 'Permission',
  [ApproverType.SPECIFIC_USER]: 'Member',
  [ApproverType.EMAIL]: 'Email',
};

const inputClass = 'form-input';
const selectClass = inputClass;
const labelClass = 'form-label';

const iconButtonClass =
  'text-theme-text-secondary hover:bg-theme-surface-hover hover:text-theme-text-primary inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded disabled:cursor-not-allowed disabled:opacity-40';

/** The approver as a person would name it: a position's name rather than its slug, a member's name rather than their id. */
function approverLabel(step: ApprovalChainStep, options: ApproverOptions): string {
  const value = step.approverValue || '';
  const list =
    step.approverType === ApproverType.POSITION
      ? options.positions
      : step.approverType === ApproverType.SPECIFIC_USER
        ? options.users
        : null;
  return list?.find((o) => o.value === value)?.label || value;
}

// =============================================================================
// Chain Card Component
// =============================================================================

interface ChainCardProps {
  chain: ApprovalChain;
  busy: boolean;
  approverOptions: ApproverOptions;
  onDelete: (id: string) => void;
  onEdit: (chain: ApprovalChain) => void;
  onAddStep: (chain: ApprovalChain) => void;
  onEditStep: (chain: ApprovalChain, step: ApprovalChainStep) => void;
  onDeleteStep: (chain: ApprovalChain, step: ApprovalChainStep) => void;
  onMoveStep: (chain: ApprovalChain, step: ApprovalChainStep, direction: 'up' | 'down') => void;
}

const ChainCard: React.FC<ChainCardProps> = ({
  chain,
  busy,
  approverOptions,
  onDelete,
  onEdit,
  onAddStep,
  onEditStep,
  onDeleteStep,
  onMoveStep,
}) => {
  const [expanded, setExpanded] = useState(false);

  const sortedSteps = [...chain.steps].sort(
    (a, b) => a.stepOrder - b.stepOrder || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)
  );

  return (
    <div className="card">
      {/* Header */}
      <div className="flex items-center justify-between p-4">
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-3 text-left"
          aria-expanded={expanded}
        >
          {expanded ? (
            <ChevronDown className="text-theme-text-secondary h-4 w-4" />
          ) : (
            <ChevronRight className="text-theme-text-secondary h-4 w-4" />
          )}
          <div>
            <h3 className="text-theme-text-primary font-semibold">{chain.name}</h3>
            <div className="text-theme-text-secondary mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
              <span>{ENTITY_TYPE_LABELS[chain.appliesTo] ?? chain.appliesTo}</span>
              {chain.minAmount != null && (
                <>
                  <span className="text-theme-text-secondary/50">|</span>
                  <span>Min: {formatCurrencyWhole(chain.minAmount)}</span>
                </>
              )}
              {chain.maxAmount != null && (
                <>
                  <span className="text-theme-text-secondary/50">|</span>
                  <span>Max: {formatCurrencyWhole(chain.maxAmount)}</span>
                </>
              )}
              {chain.isDefault && (
                <span className="rounded bg-blue-100 px-1.5 py-0.5 text-xs font-medium text-blue-700 dark:bg-blue-500/20 dark:text-blue-400">
                  Default
                </span>
              )}
              {!chain.isActive && (
                <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-500/20 dark:text-gray-400">
                  Inactive
                </span>
              )}
            </div>
          </div>
        </button>
        <div className="flex items-center gap-1">
          <span className="text-theme-text-secondary mr-1 text-xs">
            {chain.steps.length} step{chain.steps.length !== 1 ? 's' : ''}
          </span>
          <button
            type="button"
            onClick={() => onEdit(chain)}
            disabled={busy}
            className={iconButtonClass}
            aria-label={`Edit chain ${chain.name}`}
            title="Edit chain"
          >
            <Pencil className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => onDelete(chain.id)}
            disabled={busy}
            className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded text-red-700 hover:bg-red-50 hover:text-red-800 disabled:cursor-not-allowed disabled:opacity-40 dark:text-red-400 dark:hover:bg-red-500/10"
            aria-label={`Delete chain ${chain.name}`}
            title="Delete chain"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Steps (expanded) */}
      {expanded && (
        <div className="border-theme-surface-border border-t p-4">
          {chain.description && <p className="text-theme-text-secondary mb-3 text-sm">{chain.description}</p>}

          {sortedSteps.length === 0 ? (
            <p className="text-theme-text-secondary text-sm">
              No steps yet. Requests routed to this chain get no approval steps.
            </p>
          ) : (
            <ol className="space-y-2" aria-label={`Steps in ${chain.name}`}>
              {sortedSteps.map((step, index) => (
                <li key={step.id} className="flex items-center gap-2">
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-red-100 text-xs font-bold text-red-700 dark:bg-red-500/20 dark:text-red-400">
                    {index + 1}
                  </div>
                  <div className="border-theme-surface-border min-w-0 flex-1 rounded border p-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-theme-text-primary text-sm font-medium">{step.name}</span>
                      <span
                        className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                          step.stepType === ApprovalStepType.NOTIFICATION
                            ? 'bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400'
                            : 'bg-green-100 text-green-700 dark:bg-green-500/20 dark:text-green-400'
                        }`}
                      >
                        {STEP_TYPE_LABELS[step.stepType] ?? step.stepType}
                      </span>
                      {step.approverType && (
                        <span className="text-theme-text-secondary text-xs break-all">
                          {APPROVER_TYPE_LABELS[step.approverType] ?? step.approverType}
                          {step.approverValue ? `: ${approverLabel(step, approverOptions)}` : ''}
                        </span>
                      )}
                    </div>
                    {step.autoApproveUnder != null && (
                      <p className="text-theme-text-secondary mt-0.5 text-xs">
                        Auto-approves under {formatCurrencyWhole(step.autoApproveUnder)}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center justify-end">
                    <button
                      type="button"
                      onClick={() => onMoveStep(chain, step, 'up')}
                      disabled={busy || index === 0}
                      className={iconButtonClass}
                      aria-label={`Move ${step.name} up`}
                      title="Move up"
                    >
                      <ChevronUp className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onMoveStep(chain, step, 'down')}
                      disabled={busy || index === sortedSteps.length - 1}
                      className={iconButtonClass}
                      aria-label={`Move ${step.name} down`}
                      title="Move down"
                    >
                      <ChevronDown className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onEditStep(chain, step)}
                      disabled={busy}
                      className={iconButtonClass}
                      aria-label={`Edit ${step.name}`}
                      title="Edit step"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => onDeleteStep(chain, step)}
                      disabled={busy}
                      className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded text-red-700 hover:bg-red-50 hover:text-red-800 disabled:cursor-not-allowed disabled:opacity-40 dark:text-red-400 dark:hover:bg-red-500/10"
                      aria-label={`Delete ${step.name}`}
                      title="Delete step"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </li>
              ))}
            </ol>
          )}

          <p className="text-theme-text-secondary mt-3 text-xs">
            A request gets this chain&rsquo;s steps when it is submitted, so a step you add applies only to requests
            submitted after that. Editing, reordering, or deleting a step also affects requests already waiting on this
            chain.
          </p>

          <button
            type="button"
            onClick={() => onAddStep(chain)}
            disabled={busy}
            className="btn-secondary mt-3 inline-flex items-center gap-2"
          >
            <Plus className="h-4 w-4" />
            Add step
          </button>
        </div>
      )}
    </div>
  );
};

// =============================================================================
// Main Page Component
// =============================================================================

const ApprovalChainsSettingsPage: React.FC = () => {
  const { confirm } = useConfirm();
  const {
    approvalChains,
    budgetCategories,
    isLoading,
    error,
    fetchApprovalChains,
    fetchBudgetCategories,
    createApprovalChain,
    deleteApprovalChain,
    updateApprovalChain,
    addChainStep,
    updateChainStep,
    deleteChainStep,
    moveChainStep,
  } = useFinanceStore();

  const [showCreateForm, setShowCreateForm] = useState(false);
  const { busy, run } = useSubmitGuard();
  const approverOptions = useApproverOptions();
  const [stepDialog, setStepDialog] = useState<{ chain: ApprovalChain; step: ApprovalChainStep | null } | null>(null);
  const [editingChain, setEditingChain] = useState<ApprovalChain | null>(null);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    appliesTo: ApprovalEntityType.PURCHASE_REQUEST as ApprovalEntityType,
    minAmount: '',
    maxAmount: '',
    budgetCategoryId: '',
    isDefault: false,
  });

  useEffect(() => {
    void fetchApprovalChains();
    void fetchBudgetCategories();
  }, [fetchApprovalChains, fetchBudgetCategories]);

  const handleCreate = () =>
    run(async () => {
      if (!formData.name.trim()) {
        toast.error('Chain name is required');
        return;
      }

      try {
        await createApprovalChain({
          name: formData.name.trim(),
          description: formData.description.trim() || undefined,
          applies_to: formData.appliesTo,
          min_amount: formData.minAmount || undefined,
          max_amount: formData.maxAmount || undefined,
          budget_category_id: formData.budgetCategoryId || undefined,
          is_default: formData.isDefault,
        });
        toast.success('Approval chain created');
        setShowCreateForm(false);
        setFormData({
          name: '',
          description: '',
          appliesTo: ApprovalEntityType.PURCHASE_REQUEST,
          minAmount: '',
          maxAmount: '',
          budgetCategoryId: '',
          isDefault: false,
        });
      } catch {
        // Error handled by store
      }
    });

  const handleDelete = async (id: string) => {
    if (
      !(await confirm({
        title: 'Delete approval chain',
        message:
          'Requests that already went through this chain keep their approval history, but nothing new will be routed by it.',
        confirmLabel: 'Delete',
        cancelLabel: 'Keep it',
      }))
    ) {
      return;
    }

    try {
      await deleteApprovalChain(id);
      toast.success('Approval chain deleted');
    } catch {
      // Error handled by store
    }
  };

  const handleSaveChain = (data: ApprovalChainUpdatePayload) =>
    run(async () => {
      if (!editingChain) return;
      try {
        await updateApprovalChain(editingChain.id, data);
        toast.success('Chain saved');
        setEditingChain(null);
      } catch (err: unknown) {
        toast.error(getErrorMessage(err, 'Could not save the chain.'));
      }
    });

  const handleSaveStep = (values: StepFormValues) =>
    run(async () => {
      if (!stepDialog) return;
      const { chain, step } = stepDialog;
      try {
        if (step) {
          await updateChainStep(chain.id, step.id, buildStepUpdatePayload(values));
          toast.success('Step saved');
        } else {
          const nextOrder = chain.steps.reduce((max, s) => Math.max(max, s.stepOrder), 0) + 1;
          await addChainStep(chain.id, buildStepCreatePayload(values, nextOrder));
          toast.success('Step added');
        }
        setStepDialog(null);
      } catch (err: unknown) {
        toast.error(getErrorMessage(err, 'Could not save the step.'));
      }
    });

  const handleDeleteStep = async (chain: ApprovalChain, step: ApprovalChainStep) => {
    // What the cascade does, from finance_service.py: every request's record
    // for this step goes with it (ApprovalStepRecord.step_id is ON DELETE
    // CASCADE), and nothing re-evaluates the requests it leaves behind — the
    // next step becomes current without its email being sent, and a request
    // with no step left pending is never finalized.
    if (
      !(await confirm({
        title: 'Delete step',
        message: (
          <div className="space-y-2">
            <p>
              Deleting &ldquo;{step.name}&rdquo; also removes it from every request routed through this chain, including
              the record of who approved or denied it and their notes.
            </p>
            <p>
              A request waiting on this step moves on to the next one, and an Email approver on that next step is not
              sent a link. A request with no later step is left waiting with nothing to approve.
            </p>
            <p>This can&rsquo;t be undone.</p>
          </div>
        ),
        confirmLabel: 'Delete step',
        cancelLabel: 'Keep it',
      }))
    ) {
      return;
    }
    await run(async () => {
      try {
        await deleteChainStep(chain.id, step.id);
        toast.success('Step deleted');
      } catch (err: unknown) {
        toast.error(getErrorMessage(err, 'Could not delete the step.'));
      }
    });
  };

  const handleMoveStep = (chain: ApprovalChain, step: ApprovalChainStep, direction: 'up' | 'down') =>
    run(async () => {
      try {
        await moveChainStep(chain.id, step.id, direction);
      } catch (err: unknown) {
        toast.error(getErrorMessage(err, 'Could not reorder the steps.'));
      }
    });

  if (isLoading && approvalChains.length === 0) {
    return (
      <div className="space-y-6">
        <Breadcrumbs />
        <div className="flex items-center gap-4">
          <Link
            to="/finance/settings"
            className="text-theme-text-secondary hover:text-theme-text-primary inline-flex items-center gap-2 text-sm"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Settings
          </Link>
        </div>
        <div>
          <h1 className="text-theme-text-primary text-2xl font-bold">Approval Chains</h1>
          <p className="text-theme-text-secondary mt-1 text-sm">
            Set who approves purchase requests, expense reports, and check requests
          </p>
        </div>
        <SkeletonPage rows={4} showStats={false} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Breadcrumbs />
      {/* Back link */}
      <Link
        to="/finance/settings"
        className="text-theme-text-secondary hover:text-theme-text-primary inline-flex items-center gap-2 text-sm"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Settings
      </Link>

      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-theme-text-primary text-2xl font-bold">Approval Chains</h1>
          <p className="text-theme-text-secondary mt-1 text-sm">
            Set who approves purchase requests, expense reports, and check requests
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreateForm(!showCreateForm)}
          className="inline-flex items-center gap-2 rounded-lg bg-red-800 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-900"
        >
          <Plus className="h-4 w-4" />
          New Chain
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <p>{error}</p>
        </div>
      )}

      {/* Create Form */}
      {showCreateForm && (
        <div className="card p-6">
          <h2 className="text-theme-text-primary mb-4 text-lg font-semibold">New Approval Chain</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className={labelClass}>Name *</label>
              <input
                type="text"
                className={inputClass}
                placeholder="e.g., Large Purchase Approval"
                value={formData.name}
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              />
            </div>
            <div className="sm:col-span-2">
              <label className={labelClass}>Description</label>
              <textarea
                className={inputClass}
                rows={2}
                placeholder="When this chain should be used..."
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              />
            </div>
            <div>
              <label className={labelClass}>Applies To *</label>
              <select
                className={selectClass}
                value={formData.appliesTo}
                onChange={(e) => setFormData({ ...formData, appliesTo: e.target.value as ApprovalEntityType })}
              >
                <option value={ApprovalEntityType.PURCHASE_REQUEST}>Purchase Requests</option>
                <option value={ApprovalEntityType.EXPENSE_REPORT}>Expense Reports</option>
                <option value={ApprovalEntityType.CHECK_REQUEST}>Check Requests</option>
              </select>
            </div>
            <div>
              <label className={labelClass}>Budget Category (optional)</label>
              <select
                className={selectClass}
                value={formData.budgetCategoryId}
                onChange={(e) => setFormData({ ...formData, budgetCategoryId: e.target.value })}
              >
                <option value="">Any category</option>
                {budgetCategories.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>Min Amount ($)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                className={inputClass}
                placeholder="0.00"
                value={formData.minAmount}
                onChange={(e) => setFormData({ ...formData, minAmount: e.target.value })}
              />
            </div>
            <div>
              <label className={labelClass}>Max Amount ($)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                className={inputClass}
                placeholder="No limit"
                value={formData.maxAmount}
                onChange={(e) => setFormData({ ...formData, maxAmount: e.target.value })}
              />
            </div>
            <div className="sm:col-span-2">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={formData.isDefault}
                  onChange={(e) => setFormData({ ...formData, isDefault: e.target.checked })}
                  className="border-theme-surface-border rounded"
                />
                <span className="text-theme-text-primary text-sm">
                  Default chain (preferred when no more specific chain matches)
                </span>
              </label>
            </div>
          </div>
          <div className="border-theme-surface-border mt-4 flex items-center justify-end gap-3 border-t pt-4">
            <button
              type="button"
              onClick={() => setShowCreateForm(false)}
              className="border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-hover rounded-lg border px-4 py-2 text-sm font-medium"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleCreate()}
              className="inline-flex items-center gap-2 rounded-lg bg-red-800 px-4 py-2 text-sm font-medium text-white hover:bg-red-900 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Create Chain
            </button>
          </div>
        </div>
      )}

      {/* Chain List */}
      {approvalChains.length === 0 ? (
        <EmptyState
          icon={GitBranch}
          title="No approval chains configured"
          description="A chain sets the approval steps a request goes through, based on its type, amount, and budget category."
          actions={[
            {
              label: 'New Chain',
              onClick: () => setShowCreateForm(true),
              icon: Plus,
            },
          ]}
        />
      ) : (
        <div className="space-y-3">
          {approvalChains.map((chain) => (
            <ChainCard
              key={chain.id}
              chain={chain}
              busy={busy}
              approverOptions={approverOptions}
              onDelete={(id) => void handleDelete(id)}
              onEdit={setEditingChain}
              onAddStep={(c) => setStepDialog({ chain: c, step: null })}
              onEditStep={(c, s) => setStepDialog({ chain: c, step: s })}
              onDeleteStep={(c, s) => void handleDeleteStep(c, s)}
              onMoveStep={(c, s, direction) => void handleMoveStep(c, s, direction)}
            />
          ))}
        </div>
      )}

      {stepDialog && (
        <ApprovalStepDialog
          mode={stepDialog.step ? 'edit' : 'add'}
          {...(stepDialog.step ? { initialValues: stepToFormValues(stepDialog.step) } : {})}
          approverOptions={approverOptions}
          saving={busy}
          onClose={() => setStepDialog(null)}
          onSubmit={handleSaveStep}
        />
      )}

      {editingChain && (
        <ApprovalChainEditDialog
          chain={editingChain}
          saving={busy}
          onClose={() => setEditingChain(null)}
          onSubmit={handleSaveChain}
        />
      )}
    </div>
  );
};

export default ApprovalChainsSettingsPage;
