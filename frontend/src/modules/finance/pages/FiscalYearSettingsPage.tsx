/**
 * Fiscal Year Settings Page
 *
 * Settings page for managing fiscal years (create, activate, lock)
 * and budget categories (CRUD, including each category's owner position).
 *
 * A draft year also carries next-year planning: "Start from last year" (copy
 * another year's lines in as a starting point) and the request deadline line
 * owners' budget requests close on. Whether requests are open is the
 * backend's answer (`requestsOpen`), not worked out here.
 */

import React, { useEffect, useState } from 'react';
import { Plus, AlertTriangle, Calendar, Lock, CheckCircle, Trash2, Tag, Pencil, Copy } from 'lucide-react';
import toast from 'react-hot-toast';
import { useFinanceStore } from '../store/financeStore';
import { budgetCategoryService, fiscalYearService } from '../services/api';
import { useBudgetFormOptions, withCurrent } from '../hooks/useBudgetFormOptions';
import type { BudgetCategory, FiscalYear } from '../types';
import { blankToNull } from '@/utils/formValues';
import { getErrorMessage } from '@/utils/errorHandling';
import { SkeletonPage } from '@/components/ux/Skeleton';
import { EmptyState } from '@/components/ux/EmptyState';
import { ConfirmDialog } from '@/components/ux/ConfirmDialog';
import { formatCalendarDate, formatDate } from '@/utils/dateFormatting';
import { useConfirm } from '@/contexts/ConfirmContext';
import { useTimezone } from '@/hooks/useTimezone';
import { useOverlaySurface } from '../../../hooks/useOverlaySurface';
import { Breadcrumbs } from '@/components/ux/Breadcrumbs';

// =============================================================================
// Status Badge
// =============================================================================

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-800 dark:bg-gray-500/20 dark:text-gray-400',
  active: 'bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-400',
  closed: 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-400',
};

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  active: 'Active',
  closed: 'Closed',
};

// =============================================================================
// Shared Styles
// =============================================================================

const inputClass = 'form-input';
const labelClass = 'form-label';

// =============================================================================
// Create Fiscal Year Modal
// =============================================================================

interface CreateFYModalProps {
  open: boolean;
  onClose: () => void;
}

const CreateFYModal: React.FC<CreateFYModalProps> = ({ open, onClose }) => {
  // Before the `if (!open) return null` below — hooks may not sit after it.
  useOverlaySurface(open);

  const { createFiscalYear } = useFinanceStore();
  const [name, setName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !startDate || !endDate) {
      toast.error('Enter a name, start date, and end date');
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
    <div className="modal-overlay z-50 flex items-center justify-center">
      <div className="card modal-panel-scroll mx-4 w-full max-w-md p-6 shadow-xl">
        <h3 className="text-theme-text-primary mb-4 text-lg font-semibold">Create Fiscal Year</h3>
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
            <input type="date" className={inputClass} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </div>
          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-hover rounded-lg border px-4 py-2 text-sm font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg bg-red-800 px-4 py-2 text-sm font-medium text-white hover:bg-red-900 disabled:opacity-50"
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
// Category Modal (create and edit)
// =============================================================================

interface CategoryModalProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
  /** The category being edited; absent to create one. */
  category?: BudgetCategory | undefined;
}

const CategoryModal: React.FC<CategoryModalProps> = ({ open, onClose, onSaved, category }) => {
  // Before the `if (!open) return null` below — hooks may not sit after it.
  useOverlaySurface(open);
  const { positions } = useBudgetFormOptions(open);

  const [name, setName] = useState(category?.name ?? '');
  const [description, setDescription] = useState(category?.description ?? '');
  const [ownerPositionId, setOwnerPositionId] = useState(category?.ownerPositionId ?? '');
  const [submitting, setSubmitting] = useState(false);
  const isEdit = Boolean(category);
  const positionOptions = withCurrent(positions, category?.ownerPositionId, category?.ownerPositionName);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      toast.error('Name is required');
      return;
    }
    setSubmitting(true);
    try {
      if (category) {
        // Blanks go as null so a cleared description or owner is cleared
        // rather than left behind (CLAUDE.md pitfall #1).
        await budgetCategoryService.update(category.id, {
          name: name.trim(),
          description: blankToNull(description),
          ownerPositionId: blankToNull(ownerPositionId),
        });
        toast.success('Category saved');
      } else {
        const createData: Parameters<typeof budgetCategoryService.create>[0] = {
          name: name.trim(),
        };
        if (description.trim()) {
          createData.description = description.trim();
        }
        if (ownerPositionId) {
          createData.ownerPositionId = ownerPositionId;
        }
        await budgetCategoryService.create(createData);
        toast.success('Category created');
        setName('');
        setDescription('');
        setOwnerPositionId('');
      }
      onSaved();
      onClose();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, isEdit ? 'Failed to save category' : 'Failed to create category'));
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  return (
    <div className="modal-overlay z-50 flex items-center justify-center">
      <div className="card modal-panel-scroll mx-4 w-full max-w-md p-6 shadow-xl">
        <h3 className="text-theme-text-primary mb-4 text-lg font-semibold">
          {isEdit ? 'Edit Budget Category' : 'Create Budget Category'}
        </h3>
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          <div>
            <label htmlFor="category-name" className={labelClass}>
              Name
            </label>
            <input
              id="category-name"
              type="text"
              className={inputClass}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Equipment"
            />
          </div>
          <div>
            <label htmlFor="category-description" className={labelClass}>
              Description (optional)
            </label>
            <textarea
              id="category-description"
              className={inputClass}
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What this category covers"
            />
          </div>
          <div>
            <label htmlFor="category-owner" className={labelClass}>
              Owner position (optional)
            </label>
            <select
              id="category-owner"
              className={inputClass}
              value={ownerPositionId}
              onChange={(e) => setOwnerPositionId(e.target.value)}
              aria-describedby="category-owner-hint"
            >
              <option value="">No owner</option>
              {positionOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            <p id="category-owner-hint" className="text-theme-text-secondary mt-1 text-xs">
              Budget lines in this category without an owner of their own belong to this position.
            </p>
          </div>
          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-hover rounded-lg border px-4 py-2 text-sm font-medium"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded-lg bg-red-800 px-4 py-2 text-sm font-medium text-white hover:bg-red-900 disabled:opacity-50"
            >
              {isEdit ? (submitting ? 'Saving...' : 'Save') : submitting ? 'Creating...' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

// =============================================================================
// Next-year planning (draft years only)
// =============================================================================

interface NextYearPlanningProps {
  fy: FiscalYear;
  /** The other fiscal years, any of which can be copied from. */
  sources: FiscalYear[];
  onChanged: () => void;
}

const NextYearPlanning: React.FC<NextYearPlanningProps> = ({ fy, sources, onChanged }) => {
  const { confirm } = useConfirm();
  const defaultSource = sources.find((s) => s.status === 'active') ?? sources[0];
  const [sourceId, setSourceId] = useState(defaultSource?.id ?? '');
  const [deadline, setDeadline] = useState(fy.requestDeadline ?? '');
  const [copying, setCopying] = useState(false);
  const [savingDeadline, setSavingDeadline] = useState(false);
  const sourceSelectId = `start-from-${fy.id}`;
  const deadlineInputId = `request-deadline-${fy.id}`;

  const handleStartFrom = async () => {
    const source = sources.find((s) => s.id === sourceId);
    if (!source) return;
    const confirmed = await confirm({
      title: 'Start from last year',
      message: `Copy every budget line from ${source.name} into ${fy.name}? Each copy starts at that line's current budget, with nothing spent, and you can change it afterwards. Lines ${fy.name} already has are left as they are.`,
      confirmLabel: 'Copy lines',
      cancelLabel: 'Not now',
      variant: 'info',
    });
    if (!confirmed) return;
    setCopying(true);
    try {
      const result = await fiscalYearService.startFrom(fy.id, source.id);
      toast.success(
        `${result.created} ${result.created === 1 ? 'line' : 'lines'} copied, ${result.skipped} already there`
      );
      onChanged();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to copy budget lines'));
    } finally {
      setCopying(false);
    }
  };

  const saveDeadline = async (value: string) => {
    setSavingDeadline(true);
    try {
      // An emptied field goes as null so the deadline is actually cleared
      // (CLAUDE.md pitfall #1).
      const requestDeadline = blankToNull(value);
      await fiscalYearService.update(fy.id, { requestDeadline });
      setDeadline(value);
      toast.success(requestDeadline ? 'Request deadline saved' : 'Request deadline cleared');
      onChanged();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to save the request deadline'));
    } finally {
      setSavingDeadline(false);
    }
  };

  return (
    <div className="bg-theme-surface-secondary mt-3 grid gap-4 rounded-lg p-3 sm:grid-cols-2">
      <div>
        <label htmlFor={sourceSelectId} className={labelClass}>
          Start from last year
        </label>
        {sources.length === 0 ? (
          <p className="text-theme-text-secondary text-xs">There is no other fiscal year to copy from.</p>
        ) : (
          <div className="flex flex-col gap-2 sm:flex-row">
            <select
              id={sourceSelectId}
              className={inputClass}
              value={sourceId}
              onChange={(e) => setSourceId(e.target.value)}
              aria-describedby={`${sourceSelectId}-hint`}
            >
              {sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => void handleStartFrom()}
              disabled={copying || !sourceId}
              className="border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-hover inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium disabled:opacity-50"
            >
              <Copy className="h-3.5 w-3.5" />
              {copying ? 'Copying...' : 'Copy lines'}
            </button>
          </div>
        )}
        <p id={`${sourceSelectId}-hint`} className="text-theme-text-secondary mt-1 text-xs">
          Copies each line's category, station, owner and notes, starting at its current budget.
        </p>
      </div>
      <div>
        <label htmlFor={deadlineInputId} className={labelClass}>
          Request deadline
        </label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            id={deadlineInputId}
            type="date"
            className={inputClass}
            value={deadline}
            onChange={(e) => setDeadline(e.target.value)}
            aria-describedby={`${deadlineInputId}-hint`}
          />
          <button
            type="button"
            onClick={() => void saveDeadline(deadline)}
            disabled={savingDeadline || deadline === (fy.requestDeadline ?? '')}
            className="border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-hover shrink-0 rounded-lg border px-3 py-1.5 text-xs font-medium disabled:opacity-50"
          >
            Save deadline
          </button>
          {fy.requestDeadline && (
            <button
              type="button"
              onClick={() => void saveDeadline('')}
              disabled={savingDeadline}
              className="border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-hover shrink-0 rounded-lg border px-3 py-1.5 text-xs font-medium disabled:opacity-50"
            >
              Clear deadline
            </button>
          )}
        </div>
        <p id={`${deadlineInputId}-hint`} className="text-theme-text-secondary mt-1 text-xs">
          Line owners can make and change budget requests through the end of this day.
        </p>
      </div>
    </div>
  );
};

/** The draft year's deadline and whether requests are open, as the row shows it. */
const RequestWindow: React.FC<{ fy: FiscalYear }> = ({ fy }) => (
  <p className="text-theme-text-secondary mt-0.5 flex flex-wrap items-center gap-2 text-xs">
    <span>
      {fy.requestDeadline ? `Requests close ${formatCalendarDate(fy.requestDeadline)}` : 'No request deadline'}
    </span>
    <span
      className={`inline-flex rounded-full px-2 py-0.5 font-medium ${
        fy.requestsOpen
          ? 'bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-400'
          : 'bg-gray-100 text-gray-800 dark:bg-gray-500/20 dark:text-gray-400'
      }`}
    >
      {fy.requestsOpen ? 'Requests open' : 'Requests closed'}
    </span>
  </p>
);

// =============================================================================
// Main Page Component
// =============================================================================

const FiscalYearSettingsPage: React.FC = () => {
  const tz = useTimezone();
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
  const [editingCategory, setEditingCategory] = useState<BudgetCategory | null>(null);
  const [lockingId, setLockingId] = useState<string | null>(null);
  const [deletingCategoryId, setDeletingCategoryId] = useState<string | null>(null);

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
        <Breadcrumbs />
        <div>
          <h1 className="text-theme-text-primary text-2xl font-bold">Finance Settings</h1>
          <p className="text-theme-text-secondary mt-1 text-sm">Manage fiscal years and budget categories</p>
        </div>
        <SkeletonPage rows={4} showStats={false} />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <Breadcrumbs />

      {/* Header */}
      <div>
        <h1 className="text-theme-text-primary text-2xl font-bold">Finance Settings</h1>
        <p className="text-theme-text-secondary mt-1 text-sm">Manage fiscal years and budget categories</p>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-400">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <p>{error}</p>
        </div>
      )}

      {/* ================================================================== */}
      {/* Fiscal Years Section                                               */}
      {/* ================================================================== */}
      <div className="card p-6">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <Calendar className="text-theme-text-secondary h-5 w-5 shrink-0" />
            <h2 className="text-theme-text-primary text-lg font-semibold">Fiscal Years</h2>
          </div>
          <button
            type="button"
            onClick={() => setShowCreateFY(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-red-800 px-3 py-2 text-sm font-medium text-white hover:bg-red-900"
          >
            <Plus className="h-4 w-4" />
            New Fiscal Year
          </button>
        </div>

        {fiscalYears.length === 0 ? (
          <EmptyState
            headingLevel={3}
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
          <div className="divide-theme-surface-border divide-y">
            {fiscalYears.map((fy) => (
              <div key={fy.id} className="py-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-theme-text-primary text-sm font-medium">{fy.name}</span>
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[fy.status] ?? 'bg-gray-100 text-gray-800 dark:bg-gray-500/20 dark:text-gray-400'}`}
                      >
                        {STATUS_LABELS[fy.status] ?? fy.status}
                      </span>
                      {fy.isLocked && <Lock className="text-theme-text-secondary h-3.5 w-3.5" />}
                    </div>
                    <p className="text-theme-text-secondary mt-0.5 text-xs">
                      {formatDate(fy.startDate, tz)} - {formatDate(fy.endDate, tz)}
                    </p>
                    {fy.status === 'draft' && <RequestWindow fy={fy} />}
                  </div>
                  <div className="flex items-center gap-2">
                    {fy.status === 'draft' && (
                      <button
                        type="button"
                        onClick={() => void handleActivate(fy.id)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-green-200 bg-green-50 px-3 py-1.5 text-xs font-medium text-green-700 hover:bg-green-100 dark:border-green-500/30 dark:bg-green-500/10 dark:text-green-400 dark:hover:bg-green-500/20"
                      >
                        <CheckCircle className="h-3.5 w-3.5" />
                        Activate
                      </button>
                    )}
                    {!fy.isLocked && fy.status !== 'draft' && (
                      <button
                        type="button"
                        onClick={() => setLockingId(fy.id)}
                        className="border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-hover inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium"
                      >
                        <Lock className="h-3.5 w-3.5" />
                        Lock
                      </button>
                    )}
                  </div>
                </div>
                {fy.status === 'draft' && !fy.isLocked && (
                  <NextYearPlanning
                    key={fy.requestDeadline ?? ''}
                    fy={fy}
                    sources={fiscalYears.filter((other) => other.id !== fy.id)}
                    onChanged={() => void fetchFiscalYears()}
                  />
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ================================================================== */}
      {/* Budget Categories Section                                          */}
      {/* ================================================================== */}
      <div className="card p-6">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <Tag className="text-theme-text-secondary h-5 w-5 shrink-0" />
            <h2 className="text-theme-text-primary text-lg font-semibold">Budget Categories</h2>
          </div>
          <button
            type="button"
            onClick={() => setShowCreateCategory(true)}
            className="inline-flex items-center gap-2 rounded-lg bg-red-800 px-3 py-2 text-sm font-medium text-white hover:bg-red-900"
          >
            <Plus className="h-4 w-4" />
            New Category
          </button>
        </div>

        {budgetCategories.length === 0 ? (
          <EmptyState
            headingLevel={3}
            icon={Tag}
            title="No budget categories"
            description="Categories group your budgets, such as Equipment or Training."
            actions={[
              {
                label: 'Create Category',
                onClick: () => setShowCreateCategory(true),
                icon: Plus,
              },
            ]}
          />
        ) : (
          <div className="divide-theme-surface-border divide-y">
            {budgetCategories.map((cat) => (
              <div key={cat.id} className="flex items-center justify-between py-3">
                <div>
                  <p className="text-theme-text-primary text-sm font-medium">{cat.name}</p>
                  {cat.description && <p className="text-theme-text-secondary text-xs">{cat.description}</p>}
                  <p className="text-theme-text-secondary text-xs">Owner: {cat.ownerPositionName || 'No owner'}</p>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setEditingCategory(cat)}
                    aria-label={`Edit ${cat.name}`}
                    className="text-theme-text-secondary hover:bg-theme-surface-hover hover:text-theme-text-primary rounded-lg p-1.5"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeletingCategoryId(cat.id)}
                    aria-label={`Delete ${cat.name}`}
                    className="text-theme-text-secondary rounded-lg p-1.5 hover:bg-red-50 hover:text-red-600"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modals */}
      <CreateFYModal open={showCreateFY} onClose={() => setShowCreateFY(false)} />
      <CategoryModal
        open={showCreateCategory}
        onClose={() => setShowCreateCategory(false)}
        onSaved={() => void fetchBudgetCategories()}
      />
      {editingCategory && (
        <CategoryModal
          key={editingCategory.id}
          open
          category={editingCategory}
          onClose={() => setEditingCategory(null)}
          onSaved={() => void fetchBudgetCategories()}
        />
      )}

      {/* Lock Confirm */}
      <ConfirmDialog
        isOpen={!!lockingId}
        onClose={() => setLockingId(null)}
        onConfirm={() => {
          if (lockingId) void handleLock(lockingId);
        }}
        title="Lock Fiscal Year"
        message="Locking closes this fiscal year and stops its name and dates from being edited. You can't unlock it."
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
        message="Its budgets in every fiscal year are deleted too, and requests charged to them are left without a budget. This can't be undone."
        confirmLabel="Delete"
        variant="danger"
      />
    </div>
  );
};

export default FiscalYearSettingsPage;
