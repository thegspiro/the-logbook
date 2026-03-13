/**
 * Fiscal Year Settings Page
 *
 * Settings page for managing fiscal years (create, activate, lock)
 * and budget categories (CRUD).
 */

import React, { useEffect, useState } from 'react';
import {
  Plus,
  AlertTriangle,
  Calendar,
  Lock,
  CheckCircle,
  Trash2,
  Tag,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useFinanceStore } from '../store/financeStore';
import { budgetCategoryService, fiscalYearService } from '../services/api';
import { SkeletonPage } from '@/components/ux/Skeleton';
import { EmptyState } from '@/components/ux/EmptyState';
import { ConfirmDialog } from '@/components/ux/ConfirmDialog';
import { formatDate } from '@/utils/dateFormatting';

// =============================================================================
// Status Badge
// =============================================================================

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-800',
  active: 'bg-green-100 text-green-800',
  closed: 'bg-red-100 text-red-800',
};

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  active: 'Active',
  closed: 'Closed',
};

// =============================================================================
// Shared Styles
// =============================================================================

const inputClass =
  'w-full rounded-lg border border-theme-surface-border bg-theme-surface px-3 py-2 text-sm text-theme-text-primary placeholder:text-theme-text-secondary focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500';
const labelClass = 'block text-sm font-medium text-theme-text-secondary mb-1';

// =============================================================================
// Create Fiscal Year Modal
// =============================================================================

interface CreateFYModalProps {
  open: boolean;
  onClose: () => void;
}

const CreateFYModal: React.FC<CreateFYModalProps> = ({ open, onClose }) => {
  const { createFiscalYear } = useFinanceStore();
  const [name, setName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !startDate || !endDate) {
      toast.error('Please fill in all fields');
      return;
    }
    setSubmitting(true);
    try {
      await createFiscalYear({ name: name.trim(), startDate, endDate });
      toast.success('Fiscal year created');
      setName('');
      setStartDate('');
      setEndDate('');
      onClose();
    } catch {
      // Error handled by store
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="mx-4 w-full max-w-md rounded-lg border border-theme-surface-border bg-theme-surface p-6 shadow-xl">
        <h3 className="mb-4 text-lg font-semibold text-theme-text-primary">
          Create Fiscal Year
        </h3>
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          <div>
            <label className={labelClass}>Name</label>
            <input
              type="text"
              className={inputClass}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="FY 2026"
            />
          </div>
          <div>
            <label className={labelClass}>Start Date</label>
            <input
              type="date"
              className={inputClass}
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>
          <div>
            <label className={labelClass}>End Date</label>
            <input
              type="date"
              className={inputClass}
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>
          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-theme-surface-border px-4 py-2 text-sm font-medium text-theme-text-secondary hover:bg-theme-surface-hover"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              {submitting ? 'Creating...' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// =============================================================================
// Create Category Modal
// =============================================================================

interface CreateCategoryModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}

const CreateCategoryModal: React.FC<CreateCategoryModalProps> = ({
  open,
  onClose,
  onCreated,
}) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error('Name is required');
      return;
    }
    setSubmitting(true);
    try {
      const createData: Parameters<typeof budgetCategoryService.create>[0] = {
        name: name.trim(),
      };
      if (description.trim()) {
        createData.description = description.trim();
      }
      await budgetCategoryService.create(createData);
      toast.success('Category created');
      setName('');
      setDescription('');
      onCreated();
      onClose();
    } catch {
      toast.error('Failed to create category');
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="mx-4 w-full max-w-md rounded-lg border border-theme-surface-border bg-theme-surface p-6 shadow-xl">
        <h3 className="mb-4 text-lg font-semibold text-theme-text-primary">
          Create Budget Category
        </h3>
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          <div>
            <label className={labelClass}>Name</label>
            <input
              type="text"
              className={inputClass}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Equipment"
            />
          </div>
          <div>
            <label className={labelClass}>Description (optional)</label>
            <textarea
              className={inputClass}
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Budget category description"
            />
          </div>
          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-theme-surface-border px-4 py-2 text-sm font-medium text-theme-text-secondary hover:bg-theme-surface-hover"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              {submitting ? 'Creating...' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// =============================================================================
// Main Page Component
// =============================================================================

const FiscalYearSettingsPage: React.FC = () => {
  const {
    fiscalYears,
    budgetCategories,
    isLoading,
    error,
    fetchFiscalYears,
    fetchBudgetCategories,
    activateFiscalYear,
  } = useFinanceStore();

  const [showCreateFY, setShowCreateFY] = useState(false);
  const [showCreateCategory, setShowCreateCategory] = useState(false);
  const [lockingId, setLockingId] = useState<string | null>(null);
  const [deletingCategoryId, setDeletingCategoryId] = useState<string | null>(
    null,
  );

  useEffect(() => {
    void fetchFiscalYears();
    void fetchBudgetCategories();
  }, [fetchFiscalYears, fetchBudgetCategories]);

  const handleActivate = async (id: string) => {
    try {
      await activateFiscalYear(id);
      toast.success('Fiscal year activated');
    } catch {
      // Error handled by store
    }
  };

  const handleLock = async (id: string) => {
    try {
      await fiscalYearService.lock(id);
      toast.success('Fiscal year locked');
      void fetchFiscalYears();
    } catch {
      toast.error('Failed to lock fiscal year');
    } finally {
      setLockingId(null);
    }
  };

  const handleDeleteCategory = async (id: string) => {
    try {
      await budgetCategoryService.delete(id);
      toast.success('Category deleted');
      void fetchBudgetCategories();
    } catch {
      toast.error('Failed to delete category');
    } finally {
      setDeletingCategoryId(null);
    }
  };

  if (isLoading && fiscalYears.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-theme-text-primary">
            Finance Settings
          </h1>
          <p className="mt-1 text-sm text-theme-text-secondary">
            Manage fiscal years and budget categories
          </p>
        </div>
        <SkeletonPage rows={4} showStats={false} />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-theme-text-primary">
          Finance Settings
        </h1>
        <p className="mt-1 text-sm text-theme-text-secondary">
          Manage fiscal years and budget categories
        </p>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <p>{error}</p>
        </div>
      )}

      {/* ================================================================== */}
      {/* Fiscal Years Section                                               */}
      {/* ================================================================== */}
      <div className="rounded-lg border border-theme-surface-border bg-theme-surface p-6">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Calendar className="h-5 w-5 text-theme-text-secondary" />
            <h2 className="text-lg font-semibold text-theme-text-primary">
              Fiscal Years
            </h2>
          </div>
          <button
            type="button"
            onClick={() => setShowCreateFY(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700"
          >
            <Plus className="h-4 w-4" />
            New Fiscal Year
          </button>
        </div>

        {fiscalYears.length === 0 ? (
          <EmptyState
            icon={Calendar}
            title="No fiscal years"
            description="Create your first fiscal year to start budgeting."
            actions={[
              {
                label: 'Create Fiscal Year',
                onClick: () => setShowCreateFY(true),
                icon: Plus,
              },
            ]}
          />
        ) : (
          <div className="divide-y divide-theme-surface-border">
            {fiscalYears.map((fy) => (
              <div
                key={fy.id}
                className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-theme-text-primary">
                      {fy.name}
                    </span>
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[fy.status] ?? 'bg-gray-100 text-gray-800'}`}
                    >
                      {STATUS_LABELS[fy.status] ?? fy.status}
                    </span>
                    {fy.isLocked && (
                      <Lock className="h-3.5 w-3.5 text-theme-text-secondary" />
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-theme-text-secondary">
                    {formatDate(fy.startDate)} - {formatDate(fy.endDate)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {fy.status === 'draft' && (
                    <button
                      type="button"
                      onClick={() => void handleActivate(fy.id)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-green-200 bg-green-50 px-3 py-1.5 text-xs font-medium text-green-700 hover:bg-green-100"
                    >
                      <CheckCircle className="h-3.5 w-3.5" />
                      Activate
                    </button>
                  )}
                  {!fy.isLocked && fy.status !== 'draft' && (
                    <button
                      type="button"
                      onClick={() => setLockingId(fy.id)}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-theme-surface-border px-3 py-1.5 text-xs font-medium text-theme-text-secondary hover:bg-theme-surface-hover"
                    >
                      <Lock className="h-3.5 w-3.5" />
                      Lock
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ================================================================== */}
      {/* Budget Categories Section                                          */}
      {/* ================================================================== */}
      <div className="rounded-lg border border-theme-surface-border bg-theme-surface p-6">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Tag className="h-5 w-5 text-theme-text-secondary" />
            <h2 className="text-lg font-semibold text-theme-text-primary">
              Budget Categories
            </h2>
          </div>
          <button
            type="button"
            onClick={() => setShowCreateCategory(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700"
          >
            <Plus className="h-4 w-4" />
            New Category
          </button>
        </div>

        {budgetCategories.length === 0 ? (
          <EmptyState
            icon={Tag}
            title="No budget categories"
            description="Create categories to organize your budget line items."
            actions={[
              {
                label: 'Create Category',
                onClick: () => setShowCreateCategory(true),
                icon: Plus,
              },
            ]}
          />
        ) : (
          <div className="divide-y divide-theme-surface-border">
            {budgetCategories.map((cat) => (
              <div
                key={cat.id}
                className="flex items-center justify-between py-3"
              >
                <div>
                  <p className="text-sm font-medium text-theme-text-primary">
                    {cat.name}
                  </p>
                  {cat.description && (
                    <p className="text-xs text-theme-text-secondary">
                      {cat.description}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setDeletingCategoryId(cat.id)}
                  className="rounded-lg p-1.5 text-theme-text-secondary hover:bg-red-50 hover:text-red-600"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modals */}
      <CreateFYModal
        open={showCreateFY}
        onClose={() => setShowCreateFY(false)}
      />
      <CreateCategoryModal
        open={showCreateCategory}
        onClose={() => setShowCreateCategory(false)}
        onCreated={() => void fetchBudgetCategories()}
      />

      {/* Lock Confirm */}
      <ConfirmDialog
        isOpen={!!lockingId}
        onClose={() => setLockingId(null)}
        onConfirm={() => {
          if (lockingId) void handleLock(lockingId);
        }}
        title="Lock Fiscal Year"
        message="Locking this fiscal year will prevent any further changes to budgets. This action cannot be undone."
        confirmLabel="Lock"
        variant="danger"
      />

      {/* Delete Category Confirm */}
      <ConfirmDialog
        isOpen={!!deletingCategoryId}
        onClose={() => setDeletingCategoryId(null)}
        onConfirm={() => {
          if (deletingCategoryId) void handleDeleteCategory(deletingCategoryId);
        }}
        title="Delete Category"
        message="Are you sure you want to delete this budget category? Any budgets using it will need to be reassigned."
        confirmLabel="Delete"
        variant="danger"
      />
    </div>
  );
};

export default FiscalYearSettingsPage;
