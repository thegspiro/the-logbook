/**
 * Approval Chains Settings Page
 *
 * CRUD interface for managing approval chains and their steps.
 * Protected by finance.configure_approvals permission.
 */

import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft,
  Plus,
  Trash2,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  GitBranch,
  ArrowRight,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { formatCurrencyWhole } from '@/utils/currencyFormatting';
import { useFinanceStore } from '../store/financeStore';
import { SkeletonPage } from '@/components/ux/Skeleton';
import { EmptyState } from '@/components/ux/EmptyState';
import {
  ApprovalEntityType,
  ApprovalStepType,
  ApproverType,
} from '../types';
import type { ApprovalChain } from '../types';

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
  [ApproverType.SPECIFIC_USER]: 'Specific User',
  [ApproverType.EMAIL]: 'Email',
};

const inputClass = 'form-input';
const selectClass = inputClass;
const labelClass = 'form-label';

// =============================================================================
// Chain Card Component
// =============================================================================

interface ChainCardProps {
  chain: ApprovalChain;
  onDelete: (id: string) => void;
}

const ChainCard: React.FC<ChainCardProps> = ({ chain, onDelete }) => {
  const [expanded, setExpanded] = useState(false);

  const sortedSteps = [...chain.steps].sort((a, b) => a.stepOrder - b.stepOrder);

  return (
    <div className="rounded-lg border border-theme-surface-border bg-theme-surface">
      {/* Header */}
      <div className="flex items-center justify-between p-4">
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-3 text-left"
        >
          {expanded ? (
            <ChevronDown className="h-4 w-4 text-theme-text-secondary" />
          ) : (
            <ChevronRight className="h-4 w-4 text-theme-text-secondary" />
          )}
          <div>
            <h3 className="font-semibold text-theme-text-primary">
              {chain.name}
            </h3>
            <div className="mt-0.5 flex items-center gap-2 text-xs text-theme-text-secondary">
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
        <div className="flex items-center gap-2">
          <span className="text-xs text-theme-text-secondary">
            {chain.steps.length} step{chain.steps.length !== 1 ? 's' : ''}
          </span>
          <button
            type="button"
            onClick={() => onDelete(chain.id)}
            className="rounded p-1 text-red-500 hover:bg-red-50 hover:text-red-700"
            title="Delete chain"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Steps (expanded) */}
      {expanded && (
        <div className="border-t border-theme-surface-border p-4">
          {chain.description && (
            <p className="mb-3 text-sm text-theme-text-secondary">
              {chain.description}
            </p>
          )}

          {sortedSteps.length === 0 ? (
            <p className="text-sm text-theme-text-secondary">
              No steps configured.
            </p>
          ) : (
            <div className="space-y-2">
              {sortedSteps.map((step, index) => (
                <div key={step.id} className="flex items-center gap-2">
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-red-100 text-xs font-bold text-red-700">
                    {step.stepOrder}
                  </div>
                  <div className="flex-1 rounded border border-theme-surface-border p-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-theme-text-primary">
                        {step.name}
                      </span>
                      <span
                        className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                          step.stepType === ApprovalStepType.NOTIFICATION
                            ? 'bg-blue-100 text-blue-700'
                            : 'bg-green-100 text-green-700'
                        }`}
                      >
                        {STEP_TYPE_LABELS[step.stepType] ?? step.stepType}
                      </span>
                      {step.approverType && (
                        <span className="text-xs text-theme-text-secondary">
                          {APPROVER_TYPE_LABELS[step.approverType] ?? step.approverType}
                          {step.approverValue ? `: ${step.approverValue}` : ''}
                        </span>
                      )}
                    </div>
                    {step.autoApproveUnder != null && (
                      <p className="mt-0.5 text-xs text-theme-text-secondary">
                        Auto-approves under {formatCurrencyWhole(step.autoApproveUnder)}
                      </p>
                    )}
                  </div>
                  {index < sortedSteps.length - 1 && (
                    <ArrowRight className="h-3 w-3 shrink-0 text-theme-text-secondary/50" />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// =============================================================================
// Main Page Component
// =============================================================================

const ApprovalChainsSettingsPage: React.FC = () => {
  const {
    approvalChains,
    budgetCategories,
    isLoading,
    error,
    fetchApprovalChains,
    fetchBudgetCategories,
    createApprovalChain,
    deleteApprovalChain,
  } = useFinanceStore();

  const [showCreateForm, setShowCreateForm] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    appliesTo: ApprovalEntityType.PURCHASE_REQUEST as string,
    minAmount: '',
    maxAmount: '',
    budgetCategoryId: '',
    isDefault: false,
  });

  useEffect(() => {
    void fetchApprovalChains();
    void fetchBudgetCategories();
  }, [fetchApprovalChains, fetchBudgetCategories]);

  const handleCreate = async () => {
    if (!formData.name.trim()) {
      toast.error('Chain name is required');
      return;
    }

    try {
      await createApprovalChain({
        name: formData.name.trim(),
        description: formData.description.trim() || undefined,
        appliesTo: formData.appliesTo,
        minAmount: formData.minAmount ? parseFloat(formData.minAmount) : undefined,
        maxAmount: formData.maxAmount ? parseFloat(formData.maxAmount) : undefined,
        budgetCategoryId: formData.budgetCategoryId || undefined,
        isDefault: formData.isDefault,
        isActive: true,
        steps: [],
      } as Partial<ApprovalChain>);
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
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this approval chain?')) {
      return;
    }

    try {
      await deleteApprovalChain(id);
      toast.success('Approval chain deleted');
    } catch {
      // Error handled by store
    }
  };

  if (isLoading && approvalChains.length === 0) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Link
            to="/finance/settings"
            className="inline-flex items-center gap-2 text-sm text-theme-text-secondary hover:text-theme-text-primary"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Settings
          </Link>
        </div>
        <div>
          <h1 className="text-2xl font-bold text-theme-text-primary">
            Approval Chains
          </h1>
          <p className="mt-1 text-sm text-theme-text-secondary">
            Configure multi-step approval workflows for financial requests
          </p>
        </div>
        <SkeletonPage rows={4} showStats={false} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Back link */}
      <Link
        to="/finance/settings"
        className="inline-flex items-center gap-2 text-sm text-theme-text-secondary hover:text-theme-text-primary"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Settings
      </Link>

      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-theme-text-primary">
            Approval Chains
          </h1>
          <p className="mt-1 text-sm text-theme-text-secondary">
            Configure multi-step approval workflows for financial requests
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowCreateForm(!showCreateForm)}
          className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 transition-colors"
        >
          <Plus className="h-4 w-4" />
          New Chain
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:bg-red-500/10 dark:border-red-500/30 dark:text-red-400">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <p>{error}</p>
        </div>
      )}

      {/* Create Form */}
      {showCreateForm && (
        <div className="rounded-lg border border-theme-surface-border bg-theme-surface p-6">
          <h2 className="mb-4 text-lg font-semibold text-theme-text-primary">
            New Approval Chain
          </h2>
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
                onChange={(e) => setFormData({ ...formData, appliesTo: e.target.value })}
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
                  <option key={cat.id} value={cat.id}>{cat.name}</option>
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
                  className="rounded border-theme-surface-border"
                />
                <span className="text-sm text-theme-text-primary">
                  Set as default chain (used when no other chain matches)
                </span>
              </label>
            </div>
          </div>
          <div className="mt-4 flex items-center justify-end gap-3 border-t border-theme-surface-border pt-4">
            <button
              type="button"
              onClick={() => setShowCreateForm(false)}
              className="rounded-lg border border-theme-surface-border px-4 py-2 text-sm font-medium text-theme-text-secondary hover:bg-theme-surface-hover"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void handleCreate()}
              className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
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
          description="Create approval chains to define multi-step workflows for financial request approvals."
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
              onDelete={(id) => void handleDelete(id)}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default ApprovalChainsSettingsPage;
