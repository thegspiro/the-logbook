/**
 * Fiscal Year Settings Page
 *
 * Settings page for managing fiscal years and budget categories (CRUD,
 * including each category's owner position).
 *
 * A fiscal year's life: drafted, taken through the planning stages, adopted
 * by the board, started on or after its start date, put into its year-end
 * close, and locked with the Treasurer's reconciliation sign-off once nothing
 * is open. Each step is the backend's to allow; this screen offers the next
 * one and shows the refusal in the API's own words.
 *
 * A draft year also carries next-year planning: "Start from last year" (copy
 * another year's lines in as a starting point) and the request deadline line
 * owners' budget requests close on. Whether requests are open is the
 * backend's answer (`requestsOpen`), not worked out here.
 */

import React, { useEffect, useState } from 'react';
import { Link } from 'react-router';
import {
  Plus,
  AlertTriangle,
  Calendar,
  Lock,
  CheckCircle,
  Trash2,
  Tag,
  Pencil,
  Copy,
  ArrowLeft,
  ArrowRight,
  Play,
  RotateCcw,
  Archive,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { useFinanceStore } from '../store/financeStore';
import { budgetCategoryService, fiscalYearService } from '../services/api';
import { useBudgetFormOptions, withCurrent } from '../hooks/useBudgetFormOptions';
import {
  ChargeAccess,
  FUNCTIONAL_CLASS_LABELS,
  FunctionalClass,
  isFunctionalClass,
  type BudgetCategory,
  type BudgetPlanningStage,
  type FiscalYear,
} from '../types';
import { BudgetAdoptionDialog } from '../components/BudgetAdoptionDialog';
import { ChargeAccessFields } from '../components/ChargeAccessFields';
import {
  chargeAccessPayloadOf,
  chargeAccessValueOf,
  inheritedChargeHint,
  type ChargeAccessValue,
} from '../utils/chargeAccess';
import { descendantIds, orderCategoryTree } from '../utils/budgetCategoryTree';
import { FiscalYearLockDialog } from '../components/FiscalYearLockDialog';
import { PLANNING_STAGE_LABELS } from '../utils/budgetRequests';
import { blankToNull } from '@/utils/formValues';
import { getErrorMessage } from '@/utils/errorHandling';
import { SkeletonPage } from '@/components/ux/Skeleton';
import { EmptyState } from '@/components/ux/EmptyState';
import { ConfirmDialog } from '@/components/ux/ConfirmDialog';
import { formatCalendarDate, formatDate } from '@/utils/dateFormatting';
import { useConfirm } from '@/contexts/ConfirmContext';
import { useTimezone } from '@/hooks/useTimezone';
import { DialogPanel } from '@/components/ux/DialogPanel';
import { Breadcrumbs } from '@/components/ux/Breadcrumbs';

// =============================================================================
// Status Badge
// =============================================================================

// A closed year that is not locked is in its year-end close: it is "Closing"
// here, and only a locked year is "Closed".
const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-800 dark:bg-gray-500/20 dark:text-gray-400',
  active: 'bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-400',
  closing: 'bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300',
  closed: 'bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-400',
};

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  active: 'Active',
  closing: 'Closing',
  closed: 'Closed',
};

// A fiscal year's start and end are calendar dates. They are stored at UTC
// midnight and the backend reads them as dates (`fy.start_date.date()`), so
// formatting them as instants showed FY2026 as "12/31/2025 - 12/30/2026" to
// anyone west of UTC. The numeric style matches the rest of this screen.
const FY_DATE: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'numeric', day: 'numeric' };

const displayStatus = (fy: FiscalYear): string => (fy.status === 'closed' && !fy.isLocked ? 'closing' : fy.status);

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
      <DialogPanel
        onClose={onClose}
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-fy-title"
        className="modal-panel-scroll mx-4 w-full max-w-md p-6"
      >
        <h3 id="create-fy-title" className="text-theme-text-primary mb-4 text-lg font-semibold">
          Create Fiscal Year
        </h3>
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          <div>
            <label htmlFor="create-fy-name" className={labelClass}>
              Name
            </label>
            <input
              id="create-fy-name"
              type="text"
              className={inputClass}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="FY 2026"
            />
          </div>
          <div>
            <label htmlFor="create-fy-start" className={labelClass}>
              Start Date
            </label>
            <input
              id="create-fy-start"
              type="date"
              className={inputClass}
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="create-fy-end" className={labelClass}>
              End Date
            </label>
            <input
              id="create-fy-end"
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
      </DialogPanel>
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
  /** Every category, for the parent picker. */
  categories: BudgetCategory[];
}

const CategoryModal: React.FC<CategoryModalProps> = ({ open, onClose, onSaved, category, categories }) => {
  const { positions } = useBudgetFormOptions(open);

  const [name, setName] = useState(category?.name ?? '');
  const [description, setDescription] = useState(category?.description ?? '');
  const [ownerPositionId, setOwnerPositionId] = useState(category?.ownerPositionId ?? '');
  const [qbAccountName, setQbAccountName] = useState(category?.qbAccountName ?? '');
  const [functionalClass, setFunctionalClass] = useState<string>(category?.functionalClass ?? '');
  const [parentCategoryId, setParentCategoryId] = useState(category?.parentCategoryId ?? '');
  const [charge, setCharge] = useState<ChargeAccessValue>(chargeAccessValueOf(category));
  const [submitting, setSubmitting] = useState(false);
  const isEdit = Boolean(category);
  const positionOptions = withCurrent(positions, category?.ownerPositionId, category?.ownerPositionName);
  // A category cannot sit beneath itself or one of its own sub-categories.
  const excluded = category ? descendantIds(categories, category.id).add(category.id) : new Set<string>();
  const parentOptions = orderCategoryTree(categories).filter(({ category: c }) => !excluded.has(c.id));
  const parent = categories.find((c) => c.id === parentCategoryId);

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
          qbAccountName: blankToNull(qbAccountName),
          functionalClass: isFunctionalClass(functionalClass) ? functionalClass : null,
          parentCategoryId: blankToNull(parentCategoryId),
          ...chargeAccessPayloadOf(charge),
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
        if (qbAccountName.trim()) {
          createData.qbAccountName = qbAccountName.trim();
        }
        if (isFunctionalClass(functionalClass)) {
          createData.functionalClass = functionalClass;
        }
        if (parentCategoryId) {
          createData.parentCategoryId = parentCategoryId;
        }
        if (charge.access) {
          const { chargeAccess, chargePositionIds } = chargeAccessPayloadOf(charge);
          if (chargeAccess) createData.chargeAccess = chargeAccess;
          createData.chargePositionIds = chargePositionIds;
        }
        await budgetCategoryService.create(createData);
        toast.success('Category created');
        setName('');
        setDescription('');
        setOwnerPositionId('');
        setQbAccountName('');
        setFunctionalClass('');
        setParentCategoryId('');
        setCharge(chargeAccessValueOf(undefined));
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
      <DialogPanel
        onClose={onClose}
        role="dialog"
        aria-modal="true"
        aria-labelledby="category-dialog-title"
        className="modal-panel-scroll mx-4 w-full max-w-md p-6"
      >
        <h3 id="category-dialog-title" className="text-theme-text-primary mb-4 text-lg font-semibold">
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
            <label htmlFor="category-parent" className={labelClass}>
              Parent category (optional)
            </label>
            <select
              id="category-parent"
              className={inputClass}
              value={parentCategoryId}
              onChange={(e) => {
                const next = e.target.value;
                setParentCategoryId(next);
                // A new sub-line starts with its parent's owner, so the
                // Quartermaster sees it under My Budgets without a second edit.
                const nextParent = categories.find((c) => c.id === next);
                if (!isEdit && !ownerPositionId && nextParent?.ownerPositionId) {
                  setOwnerPositionId(nextParent.ownerPositionId);
                }
              }}
              aria-describedby="category-parent-hint"
            >
              <option value="">None (a top-level category)</option>
              {parentOptions.map(({ category: c, depth }) => (
                <option key={c.id} value={c.id}>
                  {`${'\u00a0\u00a0'.repeat(depth)}${c.name}`}
                </option>
              ))}
            </select>
            <p id="category-parent-hint" className="text-theme-text-secondary mt-1 text-xs">
              Make this a sub-line of another category, such as Officer brass under Quartermaster. It uses the
              parent&apos;s QuickBooks account and expense classification unless it sets its own.
            </p>
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
          <div>
            <label htmlFor="category-functional-class" className={labelClass}>
              Expense classification
            </label>
            <select
              id="category-functional-class"
              className={inputClass}
              value={functionalClass}
              onChange={(e) => setFunctionalClass(e.target.value)}
              aria-describedby="category-functional-class-hint"
            >
              <option value="">Not set (use the parent category&apos;s)</option>
              {Object.values(FunctionalClass).map((value) => (
                <option key={value} value={value}>
                  {FUNCTIONAL_CLASS_LABELS[value]}
                </option>
              ))}
            </select>
            <p id="category-functional-class-hint" className="text-theme-text-secondary mt-1 text-xs">
              What spending here is for, as the IRS Form 990 reports it. Fundraising is the cost of raising money
              (raffle tickets, a dinner&apos;s hall) — gear bought with donations is still program services. The finance
              office can change it on a single payment.
            </p>
          </div>
          <ChargeAccessFields
            idPrefix="category-charge"
            value={charge}
            onChange={setCharge}
            positions={positions}
            isTopLevel={!parentCategoryId}
            inheritedHint={inheritedChargeHint(parent?.name, parent?.effectiveChargeAccess)}
          />
          <div>
            <label htmlFor="category-qb-account" className={labelClass}>
              QuickBooks account (optional)
            </label>
            <input
              id="category-qb-account"
              type="text"
              className={inputClass}
              value={qbAccountName}
              onChange={(e) => setQbAccountName(e.target.value)}
              maxLength={200}
              placeholder="Equipment Expense"
              aria-describedby="category-qb-account-hint"
            />
            <p id="category-qb-account-hint" className="text-theme-text-secondary mt-1 text-xs">
              The account spending in this category posts to, exactly as named in QuickBooks (a subaccount as
              Parent:Child). Takes precedence over the account on its{' '}
              <Link to="/finance/settings/quickbooks" className="underline">
                QuickBooks mapping
              </Link>
              , which still supplies the account it is paid from.
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
      </DialogPanel>
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
      message: `Copy every budget line from ${source.name} into ${fy.name}? Each copy starts at that line's current budget, with nothing spent, and you can change it afterwards. Lines ${fy.name} already has are left as they are, and lines in retired categories are not copied.`,
      confirmLabel: 'Copy lines',
      cancelLabel: 'Not now',
      variant: 'info',
    });
    if (!confirmed) return;
    setCopying(true);
    try {
      const result = await fiscalYearService.startFrom(fy.id, source.id);
      const retiredNote = result.retired > 0 ? `, ${result.retired} in retired categories left out` : '';
      toast.success(
        `${result.created} ${result.created === 1 ? 'line' : 'lines'} copied, ${result.skipped} already there${retiredNote}`
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
          Copies each line's category, station, owner and notes, starting at its current budget. Retired categories are
          left out.
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

/** The draft year's stage, deadline and whether requests are open, as the row shows it. */
const RequestWindow: React.FC<{ fy: FiscalYear }> = ({ fy }) => (
  <p className="text-theme-text-secondary mt-0.5 flex flex-wrap items-center gap-2 text-xs">
    {fy.planningStage && (
      <span className="badge bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-300">
        {PLANNING_STAGE_LABELS[fy.planningStage]}
      </span>
    )}
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
    <Link
      to="/finance/budget-requests/review"
      className="font-medium text-red-700 underline-offset-2 hover:underline dark:text-red-400"
    >
      Review requests
    </Link>
  </p>
);

// =============================================================================
// Planning stages: requests -> leadership review -> board review -> adopted
// =============================================================================

const STAGE_BUTTON =
  'border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-hover inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium disabled:opacity-50';

/** The stages a planning move reaches; `adopted` is reached only by recording the vote. */
type MovableStage = Exclude<BudgetPlanningStage, 'adopted'>;

/** What each move does, worded for the confirmation. */
const STAGE_MOVES: Record<MovableStage, { label: string; message: (name: string) => string }> = {
  requests: {
    label: 'Back to requests',
    message: (name) =>
      `Reopen ${name} to line owners? They can make and change requests again until the deadline, and you can change your decisions. Any leadership change to a request is replaced if you decide it again.`,
  },
  leadership_review: {
    label: 'Start leadership review',
    message: (name) =>
      `Close ${name} to line owners and open it for leadership review? Owners can no longer make or change requests, and only senior leadership can change the amounts you decided. You can move it back.`,
  },
  board_review: {
    label: 'Send to the board',
    message: (name) =>
      `Send ${name} to the board? Nothing in it can change while it is before the board. Once the board adopts it, record the adoption here, then start the year on or after its start date. You can move it back.`,
  },
};

/** The stages a draft year can move to from where it is. */
const NEXT_STAGES: Record<BudgetPlanningStage, { back?: MovableStage; forward?: MovableStage }> = {
  requests: { forward: 'leadership_review' },
  leadership_review: { back: 'requests', forward: 'board_review' },
  board_review: { back: 'leadership_review' },
  adopted: {},
};

const START_BUTTON =
  'inline-flex items-center gap-1.5 rounded-lg border border-green-200 bg-green-50 px-3 py-1.5 text-xs font-medium text-green-800 hover:bg-green-100 disabled:opacity-50 dark:border-green-500/30 dark:bg-green-500/10 dark:text-green-300 dark:hover:bg-green-500/20';

interface PlanningStageControlsProps {
  fy: FiscalYear;
  onChanged: () => void;
}

const PlanningStageControls: React.FC<PlanningStageControlsProps> = ({ fy, onChanged }) => {
  const { confirm } = useConfirm();
  const [moving, setMoving] = useState(false);
  const [adopting, setAdopting] = useState(false);
  // The backend reports every draft year's stage; a year that is not a draft
  // has none, and no controls.
  const stage = fy.planningStage;
  if (!stage) return null;
  const { back, forward } = NEXT_STAGES[stage];

  const start = async () => {
    const confirmed = await confirm({
      title: `Start ${fy.name}`,
      message: `Make ${fy.name} the active fiscal year? Its budget lines can be spent against from now on, and each line owner is emailed their adopted amounts.`,
      confirmLabel: 'Start the year',
      cancelLabel: 'Not now',
      variant: 'info',
    });
    if (!confirmed) return;
    setMoving(true);
    try {
      await fiscalYearService.activate(fy.id);
      toast.success(`${fy.name} started`);
      onChanged();
    } catch (err: unknown) {
      // The API's own words: before the start date, another year still active.
      toast.error(getErrorMessage(err, 'Could not start the year'));
    } finally {
      setMoving(false);
    }
  };

  const move = async (to: MovableStage) => {
    const confirmed = await confirm({
      title: STAGE_MOVES[to].label,
      message: STAGE_MOVES[to].message(fy.name),
      confirmLabel: STAGE_MOVES[to].label,
      cancelLabel: 'Not now',
      variant: 'info',
    });
    if (!confirmed) return;
    setMoving(true);
    try {
      await fiscalYearService.setPlanningStage(fy.id, to);
      toast.success(`${fy.name}: ${PLANNING_STAGE_LABELS[to].toLowerCase()}`);
      onChanged();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not change the planning stage'));
    } finally {
      setMoving(false);
    }
  };

  return (
    <>
      {back && (
        <button type="button" onClick={() => void move(back)} disabled={moving} className={STAGE_BUTTON}>
          <ArrowLeft className="h-3.5 w-3.5" />
          {STAGE_MOVES[back].label}
        </button>
      )}
      {forward && (
        <button type="button" onClick={() => void move(forward)} disabled={moving} className={STAGE_BUTTON}>
          {STAGE_MOVES[forward].label}
          <ArrowRight className="h-3.5 w-3.5" />
        </button>
      )}
      {stage === 'board_review' && (
        <button type="button" onClick={() => setAdopting(true)} className={START_BUTTON}>
          <CheckCircle className="h-3.5 w-3.5" />
          Record adoption
        </button>
      )}
      {stage === 'adopted' && (
        <button type="button" onClick={() => void start()} disabled={moving} className={START_BUTTON}>
          <Play className="h-3.5 w-3.5" />
          Start the year
        </button>
      )}
      {adopting && (
        <BudgetAdoptionDialog
          fiscalYear={fy}
          onClose={() => setAdopting(false)}
          onAdopted={() => {
            setAdopting(false);
            onChanged();
          }}
        />
      )}
    </>
  );
};

/** The board's adoption, for a year that was adopted. */
const AdoptionRecord: React.FC<{ fy: FiscalYear }> = ({ fy }) =>
  fy.adoptedOn ? (
    <p className="text-theme-text-secondary mt-0.5 text-xs">
      Adopted by the board {formatCalendarDate(fy.adoptedOn)}
      {fy.adoptionReference ? ` · ${fy.adoptionReference}` : ''}
    </p>
  ) : null;

/** When the close began, and the sign-off that locked the year. */
const CloseRecord: React.FC<{ fy: FiscalYear }> = ({ fy }) => {
  const tz = useTimezone();
  if (fy.isLocked && fy.lockedAt) {
    return (
      <p className="text-theme-text-secondary mt-0.5 text-xs break-words">
        Locked {formatDate(fy.lockedAt, tz)}
        {fy.lockNotes ? ` · ${fy.lockNotes}` : ''}
      </p>
    );
  }
  if (fy.status === 'closed' && !fy.isLocked) {
    return (
      <p className="text-theme-text-secondary mt-0.5 text-xs">
        {fy.closingStartedAt ? `Year-end close began ${formatDate(fy.closingStartedAt, tz)}. ` : ''}
        No new requests; what was submitted can still be approved and paid.
      </p>
    );
  }
  return null;
};

interface YearCloseControlsProps {
  fy: FiscalYear;
  onChanged: () => void;
}

/** Begin the active year's close; reopen or lock a closing year. */
const YearCloseControls: React.FC<YearCloseControlsProps> = ({ fy, onChanged }) => {
  const { confirm } = useConfirm();
  const [working, setWorking] = useState(false);
  const [locking, setLocking] = useState(false);

  const run = async (
    action: () => Promise<unknown>,
    prompt: { title: string; message: string; confirmLabel: string },
    done: string,
    fallback: string
  ) => {
    const confirmed = await confirm({ ...prompt, cancelLabel: 'Not now', variant: 'warning' });
    if (!confirmed) return;
    setWorking(true);
    try {
      await action();
      toast.success(done);
      onChanged();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, fallback));
    } finally {
      setWorking(false);
    }
  };

  if (fy.isLocked) return null;
  if (fy.status === 'active') {
    return (
      <button
        type="button"
        disabled={working}
        onClick={() =>
          void run(
            () => fiscalYearService.beginClose(fy.id),
            {
              title: 'Begin year-end close',
              message: `Begin ${fy.name}'s year-end close? No new purchase requests, expense reports or check requests can be raised or submitted against it. What was already submitted can still be approved, paid, issued or cancelled, and budget amendments are still allowed. You can lock it once nothing is open.`,
              confirmLabel: 'Begin close',
            },
            `${fy.name} is closing`,
            'Could not begin the year-end close'
          )
        }
        className={STAGE_BUTTON}
      >
        <Archive className="h-3.5 w-3.5" />
        Begin year-end close
      </button>
    );
  }
  if (fy.status !== 'closed') return null;
  return (
    <>
      <button
        type="button"
        disabled={working}
        onClick={() =>
          void run(
            () => fiscalYearService.activate(fy.id),
            {
              title: `Reopen ${fy.name}`,
              message: `Make ${fy.name} the active fiscal year again? New requests can be raised against it. Another year cannot be active at the same time.`,
              confirmLabel: 'Reopen',
            },
            `${fy.name} reopened`,
            'Could not reopen the year'
          )
        }
        className={STAGE_BUTTON}
      >
        <RotateCcw className="h-3.5 w-3.5" />
        Reopen
      </button>
      <button type="button" onClick={() => setLocking(true)} className={STAGE_BUTTON}>
        <Lock className="h-3.5 w-3.5" />
        Lock
      </button>
      {locking && (
        <FiscalYearLockDialog
          fiscalYear={fy}
          onClose={() => setLocking(false)}
          onLocked={() => {
            setLocking(false);
            onChanged();
          }}
        />
      )}
    </>
  );
};

// =============================================================================
// Main Page Component
// =============================================================================

const FiscalYearSettingsPage: React.FC = () => {
  const { fiscalYears, budgetCategories, isLoading, error, fetchFiscalYears, fetchBudgetCategories } =
    useFinanceStore();

  const [showCreateFY, setShowCreateFY] = useState(false);
  const [showCreateCategory, setShowCreateCategory] = useState(false);
  const [editingCategory, setEditingCategory] = useState<BudgetCategory | null>(null);
  const [deletingCategoryId, setDeletingCategoryId] = useState<string | null>(null);

  useEffect(() => {
    void fetchFiscalYears();
    void fetchBudgetCategories();
  }, [fetchFiscalYears, fetchBudgetCategories]);

  const deletingCategory = budgetCategories.find((c) => c.id === deletingCategoryId);
  const hasSubCategories = (id: string | null) => !!id && budgetCategories.some((c) => c.parentCategoryId === id);
  // A deactivated parent closes everything beneath it to new charges
  // (CategoryTree.inactive_source on the backend), so the officer is told.
  const subCategoryNote = hasSubCategories(deletingCategoryId)
    ? " Its sub-categories' budget lines also stop taking new charges while it is inactive."
    : '';

  const handleDeleteCategory = async (id: string) => {
    const name = budgetCategories.find((c) => c.id === id)?.name ?? 'The category';
    try {
      const outcome = await budgetCategoryService.delete(id);
      if (outcome === 'deactivated') {
        const subCategories = hasSubCategories(id)
          ? " Its sub-categories' budget lines also stop taking new charges."
          : '';
        toast.success(
          `${name} is still used by budget lines, budget requests or approval chains, so it was deactivated instead of deleted. Those keep it; new budget lines can't use it.${subCategories}`
        );
      } else {
        toast.success('Category deleted');
      }
      void fetchBudgetCategories();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to delete category'));
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
        <div className="split-row mb-4 gap-3 sm:items-center">
          <div className="split-row-main flex items-center gap-2">
            <Calendar className="text-theme-text-secondary h-5 w-5 shrink-0" />
            <h2 className="text-theme-text-primary text-lg font-semibold">Fiscal Years</h2>
          </div>
          <button
            type="button"
            onClick={() => setShowCreateFY(true)}
            className="split-row-aside inline-flex items-center gap-2 rounded-lg bg-red-800 px-3 py-2 text-sm font-medium text-white hover:bg-red-900"
          >
            <Plus className="h-4 w-4" />
            New Fiscal Year
          </button>
        </div>

        {fiscalYears
          .filter((fy) => fy.closeDue)
          .map((fy) => (
            <div key={`close-due-${fy.id}`} role="status" className="alert-warning mb-4 flex items-start gap-3 text-sm">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>
                {fy.name} ended {formatCalendarDate(fy.endDate, FY_DATE)}. Begin its year-end close to stop new requests
                and start reconciling.
              </p>
            </div>
          ))}

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
                <div className="split-row gap-3 sm:items-center">
                  <div className="split-row-main">
                    <div className="flex items-center gap-2">
                      <span className="text-theme-text-primary text-sm font-medium">{fy.name}</span>
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[displayStatus(fy)] ?? 'bg-gray-100 text-gray-800 dark:bg-gray-500/20 dark:text-gray-400'}`}
                      >
                        {STATUS_LABELS[displayStatus(fy)] ?? fy.status}
                      </span>
                      {fy.isLocked && <Lock className="text-theme-text-secondary h-3.5 w-3.5" />}
                    </div>
                    <p className="text-theme-text-secondary mt-0.5 text-xs">
                      {formatCalendarDate(fy.startDate, FY_DATE)} - {formatCalendarDate(fy.endDate, FY_DATE)}
                    </p>
                    {fy.status === 'draft' && <RequestWindow fy={fy} />}
                    <AdoptionRecord fy={fy} />
                    <CloseRecord fy={fy} />
                  </div>
                  <div className="split-row-aside flex flex-wrap items-center gap-2">
                    {fy.status === 'draft' && (
                      <PlanningStageControls fy={fy} onChanged={() => void fetchFiscalYears()} />
                    )}
                    {fy.status !== 'draft' && <YearCloseControls fy={fy} onChanged={() => void fetchFiscalYears()} />}
                  </div>
                </div>
                {fy.status === 'draft' && !fy.isLocked && fy.planningStage === 'requests' && (
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
        <div className="split-row mb-4 gap-3 sm:items-center">
          <div className="split-row-main flex items-center gap-2">
            <Tag className="text-theme-text-secondary h-5 w-5 shrink-0" />
            <h2 className="text-theme-text-primary text-lg font-semibold">Budget Categories</h2>
          </div>
          <button
            type="button"
            onClick={() => setShowCreateCategory(true)}
            className="split-row-aside inline-flex items-center gap-2 rounded-lg bg-red-800 px-3 py-2 text-sm font-medium text-white hover:bg-red-900"
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
            {orderCategoryTree(budgetCategories).map(({ category: cat, depth }) => (
              <div key={cat.id} className="flex items-center justify-between py-3">
                {/* Indented by depth, capped so a deep tree still fits a phone. */}
                <div style={{ paddingLeft: `${Math.min(depth, 4) * 1.25}rem` }} className="min-w-0">
                  <p className="text-theme-text-primary text-sm font-medium">
                    {cat.name}
                    {!cat.isActive && (
                      <span className="bg-theme-surface-secondary text-theme-text-secondary ml-2 rounded-sm px-1.5 py-0.5 text-xs font-medium">
                        Inactive
                      </span>
                    )}
                    {/* Active itself, but closed by an inactive parent: say so,
                        or an officer reads it as open to new charges. */}
                    {cat.isActive && cat.inactiveThrough && (
                      <span className="bg-theme-surface-secondary text-theme-text-secondary ml-2 rounded-sm px-1.5 py-0.5 text-xs font-medium">
                        Inactive through {cat.inactiveThrough}
                      </span>
                    )}
                  </p>
                  {cat.description && <p className="text-theme-text-secondary text-xs">{cat.description}</p>}
                  <p className="text-theme-text-secondary text-xs">Owner: {cat.ownerPositionName || 'No owner'}</p>
                  <p className="text-theme-text-secondary text-xs">
                    {cat.effectiveChargeAccess === ChargeAccess.RESTRICTED
                      ? 'Restricted to the owner and chosen positions'
                      : 'Anyone can charge'}
                    {cat.chargeAccessInheritedFrom ? ` (from ${cat.chargeAccessInheritedFrom})` : ''}
                  </p>
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
        categories={budgetCategories}
        open={showCreateCategory}
        onClose={() => setShowCreateCategory(false)}
        onSaved={() => void fetchBudgetCategories()}
      />
      {editingCategory && (
        <CategoryModal
          key={editingCategory.id}
          categories={budgetCategories}
          open
          category={editingCategory}
          onClose={() => setEditingCategory(null)}
          onSaved={() => void fetchBudgetCategories()}
        />
      )}

      {/* Delete Category Confirm */}
      <ConfirmDialog
        isOpen={!!deletingCategoryId}
        onClose={() => setDeletingCategoryId(null)}
        onConfirm={() => {
          if (deletingCategoryId) void handleDeleteCategory(deletingCategoryId);
        }}
        title="Delete Category"
        message={`Delete ${deletingCategory ? `"${deletingCategory.name}"` : 'this category'}? If budget lines in any fiscal year, budget requests or approval chains use it, it is deactivated instead of deleted: they keep it, and new budget lines can't choose it.${subCategoryNote} Otherwise it is deleted, which can't be undone.`}
        confirmLabel="Delete"
        variant="danger"
      />
    </div>
  );
};

export default FiscalYearSettingsPage;
