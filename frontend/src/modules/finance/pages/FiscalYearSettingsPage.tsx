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
  type BudgetCategoryUpdatePayload,
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
import { BudgetRequestReminderSettingsCard } from '../components/BudgetRequestReminderSettingsCard';
import { PLANNING_STAGE_LABELS } from '../utils/budgetRequests';
import { blankToNull } from '@/utils/formValues';
import type { ServerFieldSpec } from '@/utils/serverFieldErrors';
import { firstErrorField, refusalsOnFields, updateExceptRefused, useDialogFieldErrors } from '../utils/fieldRefusals';
import { FIELD_ERROR_CLASS, FormField } from '@/components/ux/FormField';
import { useDiscardGuard } from '@/hooks/useDiscardGuard';
import { getErrorMessage } from '@/utils/errorHandling';
import { SkeletonPage } from '@/components/ux/Skeleton';
import { EmptyState } from '@/components/ux/EmptyState';
import { ConfirmDialog } from '@/components/ux/ConfirmDialog';
import { formatCalendarDate, formatDate } from '@/utils/dateFormatting';
import { useConfirm } from '@/contexts/ConfirmContext';
import { useTimezone } from '@/hooks/useTimezone';
import { DialogPanel } from '@/components/ux/DialogPanel';
import { AdminPageHeader } from '@/components/admin/AdminPageHeader';

// =============================================================================
// Status Badge
// =============================================================================

// A closed year that is not locked is in its year-end close: it is "Closing"
// here, and only a locked year is "Closed".
const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-900 dark:bg-gray-500/20 dark:text-gray-300',
  active: 'bg-green-100 text-green-900 dark:bg-green-500/20 dark:text-green-300',
  closing: 'bg-amber-100 text-amber-900 dark:bg-amber-500/20 dark:text-amber-300',
  closed: 'bg-red-100 text-red-900 dark:bg-red-500/20 dark:text-red-300',
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

// =============================================================================
// Create Fiscal Year Modal
// =============================================================================

/** `FiscalYearCreate.name`'s max_length (schemas/finance.py). */
const MAX_FY_NAME = 100;

type FyField = 'name' | 'startDate' | 'endDate';

/**
 * `FiscalYearCreate`. The finance request schemas take camelCase but report a
 * 422 in snake_case (`loc_by_alias=False`); the default lookup reads both.
 */
const FY_SERVER_FIELDS: Record<FyField, ServerFieldSpec> = {
  name: { label: 'Name', maxLength: MAX_FY_NAME },
  startDate: { label: 'Start date' },
  endDate: { label: 'End date' },
};
const FY_FIELD_ORDER = Object.keys(FY_SERVER_FIELDS) as FyField[];
const FY_FIELD_IDS: Record<FyField, string> = {
  name: 'create-fy-name',
  startDate: 'create-fy-start',
  endDate: 'create-fy-end',
};

interface CreateFYModalProps {
  onClose: () => void;
}

/**
 * Mounted only while open, so a cancelled or discarded form starts blank the
 * next time rather than showing what was thrown away.
 */
const CreateFYModal: React.FC<CreateFYModalProps> = ({ onClose }) => {
  const { createFiscalYear } = useFinanceStore();
  const [name, setName] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const { errors, setErrors, clearError } = useDialogFieldErrors<FyField>();
  const [formError, setFormError] = useState<string | null>(null);
  const isDirty = name !== '' || startDate !== '' || endDate !== '';
  // Escape, Cancel and the panel all ask before throwing typed values away
  // (forms review F-6); the panel is not given isDirty, or it would ask twice.
  const requestClose = useDiscardGuard({ isDirty, onClose });

  const flag = (next: Partial<Record<FyField, string>>) => {
    setErrors(next);
    const first = firstErrorField(next, FY_FIELD_ORDER);
    if (first) document.getElementById(FY_FIELD_IDS[first])?.focus();
    return first === undefined;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Each missing value is named under its own field (forms review F-3),
    // rather than one toast for all three.
    const next: Partial<Record<FyField, string>> = {};
    if (!name.trim()) next.name = 'Enter a name for the fiscal year, for example "FY 2027".';
    else if (name.trim().length > MAX_FY_NAME) next.name = `Keep the name to ${String(MAX_FY_NAME)} characters.`;
    if (!startDate) next.startDate = 'Enter the date the fiscal year starts.';
    if (!endDate) next.endDate = 'Enter the date the fiscal year ends.';
    // ISO dates compare as text. The backend does not check the order, so a
    // year ending before it starts would otherwise be stored as typed.
    else if (startDate && endDate < startDate) next.endDate = 'The end date cannot be before the start date.';
    if (!flag(next)) return;
    setFormError(null);
    setSubmitting(true);
    try {
      await createFiscalYear({ name: name.trim(), startDate, endDate });
      toast.success('Fiscal year created');
      onClose();
    } catch (err: unknown) {
      // The store also puts its message on the page, behind this dialog; the
      // dialog says it where the Treasurer is looking (forms review F-2).
      const mapped = refusalsOnFields(err, FY_SERVER_FIELDS);
      if (mapped) {
        flag(mapped.fieldErrors);
        setFormError(mapped.unmatched.length > 0 ? mapped.unmatched.join(' ') : null);
      } else {
        setFormError(getErrorMessage(err, 'Could not create the fiscal year'));
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay z-50 flex items-center justify-center">
      <DialogPanel
        onClose={requestClose}
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-fy-title"
        className="modal-panel-scroll mx-4 w-full max-w-md p-6"
      >
        <h3 id="create-fy-title" className="text-theme-text-primary mb-4 text-lg font-semibold">
          Create Fiscal Year
        </h3>
        <form onSubmit={(e) => void handleSubmit(e)} noValidate className="space-y-4">
          {formError && (
            <p role="alert" className={`text-sm ${FIELD_ERROR_CLASS}`}>
              {formError}
            </p>
          )}
          <FormField
            id={FY_FIELD_IDS.name}
            label="Name"
            required
            error={errors.name}
            maxLength={MAX_FY_NAME}
            count={name.length}
          >
            {(field) => (
              <input
                {...field}
                type="text"
                autoComplete="off"
                className={inputClass}
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  clearError('name');
                }}
                placeholder="FY 2026"
              />
            )}
          </FormField>
          <FormField id={FY_FIELD_IDS.startDate} label="Start Date" required error={errors.startDate}>
            {(field) => (
              <input
                {...field}
                type="date"
                className={inputClass}
                value={startDate}
                onChange={(e) => {
                  setStartDate(e.target.value);
                  clearError('startDate');
                }}
              />
            )}
          </FormField>
          <FormField id={FY_FIELD_IDS.endDate} label="End Date" required error={errors.endDate}>
            {(field) => (
              <input
                {...field}
                type="date"
                min={startDate || undefined}
                className={inputClass}
                value={endDate}
                onChange={(e) => {
                  setEndDate(e.target.value);
                  clearError('endDate');
                }}
              />
            )}
          </FormField>
          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={requestClose}
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

/** `BudgetCategoryCreate` / `BudgetCategoryUpdate` max_lengths (schemas/finance.py). */
const MAX_CATEGORY_NAME = 200;
const MAX_QB_ACCOUNT = 200;

type CategoryField =
  | 'name'
  | 'description'
  | 'parentCategoryId'
  | 'ownerPositionId'
  | 'functionalClass'
  | 'chargeAccess'
  | 'chargePositionIds'
  | 'qbAccountName';

/** The fields a 422 can name, in the order the form shows them. */
const CATEGORY_SERVER_FIELDS: Record<CategoryField, ServerFieldSpec> = {
  name: { label: 'Name', maxLength: MAX_CATEGORY_NAME },
  description: { label: 'Description' },
  parentCategoryId: { label: 'Parent category' },
  ownerPositionId: { label: 'Owner position' },
  functionalClass: { label: 'Expense classification' },
  chargeAccess: { label: 'Who can charge these lines' },
  chargePositionIds: { label: 'Also allow these positions' },
  qbAccountName: { label: 'QuickBooks account', maxLength: MAX_QB_ACCOUNT },
};
const CATEGORY_FIELD_ORDER = Object.keys(CATEGORY_SERVER_FIELDS) as CategoryField[];
const CATEGORY_FIELD_IDS: Record<CategoryField, string> = {
  name: 'category-name',
  description: 'category-description',
  parentCategoryId: 'category-parent',
  ownerPositionId: 'category-owner',
  functionalClass: 'category-functional-class',
  chargeAccess: 'category-charge-access',
  chargePositionIds: 'category-charge-positions',
  qbAccountName: 'category-qb-account',
};
/**
 * The update payload's keys for each field, so a refused one can be left out.
 * The charge rule and its position list are one decision: refusing either
 * leaves both stored as they were, never a new rule with the old list.
 */
const CATEGORY_UPDATE_KEYS: Record<CategoryField, readonly (keyof BudgetCategoryUpdatePayload)[]> = {
  name: ['name'],
  description: ['description'],
  parentCategoryId: ['parentCategoryId'],
  ownerPositionId: ['ownerPositionId'],
  functionalClass: ['functionalClass'],
  chargeAccess: ['chargeAccess', 'chargePositionIds'],
  chargePositionIds: ['chargeAccess', 'chargePositionIds'],
  qbAccountName: ['qbAccountName'],
};

interface CategoryModalProps {
  onClose: () => void;
  onSaved: () => void;
  /** The category being edited; absent to create one. */
  category?: BudgetCategory | undefined;
  /** Every category, for the parent picker. */
  categories: BudgetCategory[];
}

/** Mounted only while open, so a closed create form starts blank next time. */
const CategoryModal: React.FC<CategoryModalProps> = ({ onClose, onSaved, category, categories }) => {
  const { positions } = useBudgetFormOptions(true);

  const [name, setName] = useState(category?.name ?? '');
  const [description, setDescription] = useState(category?.description ?? '');
  const [ownerPositionId, setOwnerPositionId] = useState(category?.ownerPositionId ?? '');
  const [qbAccountName, setQbAccountName] = useState(category?.qbAccountName ?? '');
  const [functionalClass, setFunctionalClass] = useState<string>(category?.functionalClass ?? '');
  const [parentCategoryId, setParentCategoryId] = useState(category?.parentCategoryId ?? '');
  const [charge, setCharge] = useState<ChargeAccessValue>(chargeAccessValueOf(category));
  const [submitting, setSubmitting] = useState(false);
  const { errors, setErrors, clearError } = useDialogFieldErrors<CategoryField>();
  const [formError, setFormError] = useState<string | null>(null);
  const [savedExcept, setSavedExcept] = useState(false);
  const isEdit = Boolean(category);
  const positionOptions = withCurrent(positions, category?.ownerPositionId, category?.ownerPositionName);
  // A category cannot sit beneath itself or one of its own sub-categories.
  const excluded = category ? descendantIds(categories, category.id).add(category.id) : new Set<string>();
  const parentOptions = orderCategoryTree(categories).filter(({ category: c }) => !excluded.has(c.id));
  const parent = categories.find((c) => c.id === parentCategoryId);

  const snapshot = JSON.stringify([
    name,
    description,
    ownerPositionId,
    qbAccountName,
    functionalClass,
    parentCategoryId,
    charge,
  ]);
  const [initialSnapshot] = useState(snapshot);
  // Escape, Cancel and the panel all ask before throwing changes away (forms
  // review F-6); the panel is not given isDirty, or it would ask twice.
  const requestClose = useDiscardGuard({ isDirty: snapshot !== initialSnapshot, onClose });

  const flag = (next: Partial<Record<CategoryField, string>>) => {
    setErrors(next);
    const first = firstErrorField(next, CATEGORY_FIELD_ORDER);
    if (first) document.getElementById(CATEGORY_FIELD_IDS[first])?.focus();
    return first === undefined;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const refused: Partial<Record<CategoryField, string>> = {};
    if (!name.trim()) refused.name = 'Enter a name for the category, for example "Equipment".';
    else if (name.trim().length > MAX_CATEGORY_NAME) {
      refused.name = `Keep the name to ${String(MAX_CATEGORY_NAME)} characters.`;
    }
    if (qbAccountName.trim().length > MAX_QB_ACCOUNT) {
      refused.qbAccountName = `Keep the account name to ${String(MAX_QB_ACCOUNT)} characters.`;
    }
    // A new category is created only once nothing is refused.
    if (!category && !flag(refused)) return;
    setFormError(null);
    setSavedExcept(false);
    setSubmitting(true);
    try {
      if (category) {
        // Blanks go as null so a cleared description or owner is cleared
        // rather than left behind (CLAUDE.md pitfall #1).
        const payload: BudgetCategoryUpdatePayload = {
          name: name.trim(),
          description: blankToNull(description),
          ownerPositionId: blankToNull(ownerPositionId),
          qbAccountName: blankToNull(qbAccountName),
          functionalClass: isFunctionalClass(functionalClass) ? functionalClass : null,
          parentCategoryId: blankToNull(parentCategoryId),
          ...chargeAccessPayloadOf(charge),
        };
        // Owner rule of 2026-11-05 for a single save: a field refused here or
        // by the server is left out of the update, so it keeps its stored
        // value, the rest saves, and the dialog stays open with it flagged.
        for (const field of Object.keys(refused) as CategoryField[]) {
          for (const key of CATEGORY_UPDATE_KEYS[field]) delete payload[key];
        }
        const { refused: serverRefused } = await updateExceptRefused(
          (body: BudgetCategoryUpdatePayload) => budgetCategoryService.update(category.id, body),
          payload,
          CATEGORY_SERVER_FIELDS,
          CATEGORY_UPDATE_KEYS
        );
        const allRefused = { ...refused, ...serverRefused };
        if (Object.keys(allRefused).length > 0) {
          flag(allRefused);
          setSavedExcept(true);
          onSaved();
          return;
        }
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
      }
      onSaved();
      onClose();
    } catch (err: unknown) {
      // Nothing was saved. A 422's entries go on their fields; what no field
      // answers for is said in the dialog, not in a toast behind it (forms
      // review F-2).
      const mapped = refusalsOnFields(err, CATEGORY_SERVER_FIELDS);
      if (mapped) {
        flag({ ...refused, ...mapped.fieldErrors });
        setFormError(mapped.unmatched.length > 0 ? mapped.unmatched.join(' ') : null);
      } else {
        flag(refused);
        setFormError(getErrorMessage(err, isEdit ? 'Failed to save category' : 'Failed to create category'));
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay z-50 flex items-center justify-center">
      <DialogPanel
        onClose={requestClose}
        role="dialog"
        aria-modal="true"
        aria-labelledby="category-dialog-title"
        className="modal-panel-scroll mx-4 w-full max-w-md p-6"
      >
        <h3 id="category-dialog-title" className="text-theme-text-primary mb-4 text-lg font-semibold">
          {isEdit ? 'Edit Budget Category' : 'Create Budget Category'}
        </h3>
        <form onSubmit={(e) => void handleSubmit(e)} noValidate className="space-y-4">
          {savedExcept && (
            <p role="status" className="alert-warning text-theme-text-primary text-sm">
              Saved, except the field flagged below, which keeps its stored value. Fix it and save again.
            </p>
          )}
          {formError && (
            <p role="alert" className={`text-sm ${FIELD_ERROR_CLASS}`}>
              {formError}
            </p>
          )}
          <FormField
            id={CATEGORY_FIELD_IDS.name}
            label="Name"
            required
            error={errors.name}
            maxLength={MAX_CATEGORY_NAME}
            count={name.length}
          >
            {(field) => (
              <input
                {...field}
                type="text"
                autoComplete="off"
                className={inputClass}
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  clearError('name');
                }}
                placeholder="Equipment"
              />
            )}
          </FormField>
          <FormField id={CATEGORY_FIELD_IDS.description} label="Description" optional error={errors.description}>
            {(field) => (
              <textarea
                {...field}
                className={inputClass}
                rows={3}
                value={description}
                onChange={(e) => {
                  setDescription(e.target.value);
                  clearError('description');
                }}
                placeholder="What this category covers"
              />
            )}
          </FormField>
          <FormField
            id={CATEGORY_FIELD_IDS.parentCategoryId}
            label="Parent category"
            optional
            error={errors.parentCategoryId}
            hint={
              <>
                Make this a sub-line of another category, such as Officer brass under Quartermaster. It uses the
                parent&apos;s QuickBooks account and expense classification unless it sets its own.
              </>
            }
          >
            {(field) => (
              <select
                {...field}
                className={inputClass}
                value={parentCategoryId}
                onChange={(e) => {
                  const next = e.target.value;
                  setParentCategoryId(next);
                  clearError('parentCategoryId');
                  // A new sub-line starts with its parent's owner, so the
                  // Quartermaster sees it under My Budgets without a second edit.
                  const nextParent = categories.find((c) => c.id === next);
                  if (!isEdit && !ownerPositionId && nextParent?.ownerPositionId) {
                    setOwnerPositionId(nextParent.ownerPositionId);
                  }
                }}
              >
                <option value="">None (a top-level category)</option>
                {parentOptions.map(({ category: c, depth }) => (
                  <option key={c.id} value={c.id}>
                    {`${'\u00a0\u00a0'.repeat(depth)}${c.name}`}
                  </option>
                ))}
              </select>
            )}
          </FormField>
          <FormField
            id={CATEGORY_FIELD_IDS.ownerPositionId}
            label="Owner position"
            optional
            error={errors.ownerPositionId}
            hint="Budget lines in this category without an owner of their own belong to this position."
          >
            {(field) => (
              <select
                {...field}
                className={inputClass}
                value={ownerPositionId}
                onChange={(e) => {
                  setOwnerPositionId(e.target.value);
                  clearError('ownerPositionId');
                }}
              >
                <option value="">No owner</option>
                {positionOptions.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
          </FormField>
          <FormField
            id={CATEGORY_FIELD_IDS.functionalClass}
            label="Expense classification"
            error={errors.functionalClass}
            hint={
              <>
                What spending here is for, as the IRS Form 990 reports it. Fundraising is the cost of raising money
                (raffle tickets, a dinner&apos;s hall) — gear bought with donations is still program services. The
                finance office can change it on a single payment.
              </>
            }
          >
            {(field) => (
              <select
                {...field}
                className={inputClass}
                value={functionalClass}
                onChange={(e) => {
                  setFunctionalClass(e.target.value);
                  clearError('functionalClass');
                }}
              >
                <option value="">Not set (use the parent category&apos;s)</option>
                {Object.values(FunctionalClass).map((value) => (
                  <option key={value} value={value}>
                    {FUNCTIONAL_CLASS_LABELS[value]}
                  </option>
                ))}
              </select>
            )}
          </FormField>
          <ChargeAccessFields
            idPrefix="category-charge"
            value={charge}
            onChange={(next) => {
              setCharge(next);
              clearError('chargeAccess');
              clearError('chargePositionIds');
            }}
            positions={positions}
            isTopLevel={!parentCategoryId}
            inheritedHint={inheritedChargeHint(parent?.name, parent?.effectiveChargeAccess)}
            errors={{ chargeAccess: errors.chargeAccess, chargePositionIds: errors.chargePositionIds }}
          />
          <FormField
            id={CATEGORY_FIELD_IDS.qbAccountName}
            label="QuickBooks account"
            optional
            error={errors.qbAccountName}
            maxLength={MAX_QB_ACCOUNT}
            count={qbAccountName.length}
            hint={
              <>
                The account spending in this category posts to, exactly as named in QuickBooks (a subaccount as
                Parent:Child). Takes precedence over the account on its{' '}
                <Link to="/finance/settings/quickbooks" className="underline">
                  QuickBooks mapping
                </Link>
                , which still supplies the account it is paid from.
              </>
            }
          >
            {(field) => (
              <input
                {...field}
                type="text"
                autoComplete="off"
                className={inputClass}
                value={qbAccountName}
                onChange={(e) => {
                  setQbAccountName(e.target.value);
                  clearError('qbAccountName');
                }}
                placeholder="Equipment Expense"
              />
            )}
          </FormField>
          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={requestClose}
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

/** `FiscalYearUpdate.request_deadline`, the only field the deadline form sends. */
const DEADLINE_SERVER_FIELDS: Record<'requestDeadline', ServerFieldSpec> = {
  requestDeadline: { label: 'Request deadline' },
};

const NextYearPlanning: React.FC<NextYearPlanningProps> = ({ fy, sources, onChanged }) => {
  const { confirm } = useConfirm();
  const defaultSource = sources.find((s) => s.status === 'active') ?? sources[0];
  const [sourceId, setSourceId] = useState(defaultSource?.id ?? '');
  const [deadline, setDeadline] = useState(fy.requestDeadline ?? '');
  const [copying, setCopying] = useState(false);
  const [savingDeadline, setSavingDeadline] = useState(false);
  const [deadlineError, setDeadlineError] = useState<string | null>(null);
  const [deadlineFormError, setDeadlineFormError] = useState<string | null>(null);
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
      // An action, not a form: its refusal stays a toast.
      toast.error(getErrorMessage(err, 'Failed to copy budget lines'));
    } finally {
      setCopying(false);
    }
  };

  const saveDeadline = async (value: string) => {
    setDeadlineError(null);
    setDeadlineFormError(null);
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
      // A refused date is said under the field; anything else (a locked year,
      // one no longer a draft) in the card, not only a toast (forms review F-2).
      const mapped = refusalsOnFields(err, DEADLINE_SERVER_FIELDS);
      if (mapped?.fieldErrors.requestDeadline) {
        setDeadlineError(mapped.fieldErrors.requestDeadline);
        document.getElementById(deadlineInputId)?.focus();
      }
      if (mapped) setDeadlineFormError(mapped.unmatched.length > 0 ? mapped.unmatched.join(' ') : null);
      else setDeadlineFormError(getErrorMessage(err, 'Failed to save the request deadline'));
    } finally {
      setSavingDeadline(false);
    }
  };

  const handleDeadlineSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    // Saving an empty box over no deadline would only "clear" nothing, so it
    // is named on the field instead of greying the button out (forms review
    // F-3). An empty box over a stored deadline clears it, as Clear does.
    if (!deadline && !fy.requestDeadline) {
      setDeadlineFormError(null);
      setDeadlineError('Choose the last day line owners can make requests.');
      document.getElementById(deadlineInputId)?.focus();
      return;
    }
    void saveDeadline(deadline);
  };

  return (
    <div className="bg-theme-surface-secondary mt-3 grid gap-4 rounded-lg p-3 sm:grid-cols-2">
      {sources.length === 0 ? (
        <div>
          <p className="form-label">Start from last year</p>
          <p className="text-theme-text-secondary text-xs">There is no other fiscal year to copy from.</p>
        </div>
      ) : (
        <FormField
          id={sourceSelectId}
          label="Start from last year"
          hint="Copies each line's category, station, owner and notes, starting at its current budget. Retired categories are left out."
        >
          {(field) => (
            <div className="flex flex-col gap-2 sm:flex-row">
              <select {...field} className={inputClass} value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
                {sources.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => void handleStartFrom()}
                disabled={copying}
                className="border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-hover touch:min-h-11 inline-flex shrink-0 items-center justify-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium disabled:opacity-50"
              >
                <Copy className="h-3.5 w-3.5" />
                {copying ? 'Copying...' : 'Copy lines'}
              </button>
            </div>
          )}
        </FormField>
      )}
      <form onSubmit={handleDeadlineSubmit} noValidate>
        {deadlineFormError && (
          <p role="alert" className={`mb-2 text-sm ${FIELD_ERROR_CLASS}`}>
            {deadlineFormError}
          </p>
        )}
        <FormField
          id={deadlineInputId}
          label="Request deadline"
          error={deadlineError}
          hint="Line owners can make and change budget requests through the end of this day."
        >
          {(field) => (
            // Wraps rather than pushing "Clear deadline" off the screen: a date
            // input does not shrink below its own content width, and beside
            // the sidebar the row is narrower than the screen breakpoint assumed.
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <input
                {...field}
                type="date"
                className={`${inputClass} sm:w-auto sm:min-w-40 sm:flex-1`}
                value={deadline}
                onChange={(e) => {
                  setDeadline(e.target.value);
                  setDeadlineError(null);
                }}
              />
              <button
                type="submit"
                disabled={savingDeadline}
                className="border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-hover touch:min-h-11 shrink-0 rounded-lg border px-3 py-1.5 text-xs font-medium disabled:opacity-50"
              >
                Save deadline
              </button>
              {fy.requestDeadline && (
                <button
                  type="button"
                  onClick={() => void saveDeadline('')}
                  disabled={savingDeadline}
                  className="border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-hover touch:min-h-11 shrink-0 rounded-lg border px-3 py-1.5 text-xs font-medium disabled:opacity-50"
                >
                  Clear deadline
                </button>
              )}
            </div>
          )}
        </FormField>
      </form>
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
          ? 'bg-green-100 text-green-900 dark:bg-green-500/20 dark:text-green-300'
          : 'bg-gray-100 text-gray-900 dark:bg-gray-500/20 dark:text-gray-300'
      }`}
    >
      {fy.requestsOpen ? 'Requests open' : 'Requests closed'}
    </span>
    <Link
      to="/finance/budget-requests/review"
      className="touch:inline-flex touch:min-h-11 touch:items-center font-medium text-red-800 underline-offset-2 hover:underline dark:text-red-300"
    >
      Review requests
    </Link>
  </p>
);

// =============================================================================
// Planning stages: requests -> leadership review -> board review -> adopted
// =============================================================================

const STAGE_BUTTON =
  'border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-hover inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs touch:min-h-11 font-medium disabled:opacity-50';

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
  'inline-flex items-center gap-1.5 rounded-lg border border-green-200 bg-green-50 px-3 py-1.5 text-xs touch:min-h-11 font-medium text-green-800 hover:bg-green-100 disabled:opacity-50 dark:border-green-500/30 dark:bg-green-500/10 dark:text-green-300 dark:hover:bg-green-500/20';

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

  // The store's create sets isLoading, so the first year's create shows the
  // skeleton while it runs. The dialogs sit after it in the same tree, rather
  // than behind an early return, so a refused create comes back to the dialog
  // with what was typed and the refusal on its field.
  const firstLoad = isLoading && fiscalYears.length === 0;

  return (
    <div className={firstLoad ? 'space-y-6' : 'space-y-8'}>
      <AdminPageHeader title="Finance Settings" description="Manage fiscal years and budget categories" />
      {firstLoad ? (
        <SkeletonPage rows={4} showStats={false} />
      ) : (
        <>
          {/* Error */}
          {error && (
            <div className="flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300">
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
                className="split-row-aside touch:min-h-11 inline-flex items-center gap-2 rounded-lg bg-red-800 px-3 py-2 text-sm font-medium text-white hover:bg-red-900"
              >
                <Plus className="h-4 w-4" />
                New Fiscal Year
              </button>
            </div>

            {fiscalYears
              .filter((fy) => fy.closeDue)
              .map((fy) => (
                <div
                  key={`close-due-${fy.id}`}
                  role="status"
                  className="alert-warning mb-4 flex items-start gap-3 text-sm"
                >
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <p>
                    {fy.name} ended {formatCalendarDate(fy.endDate, FY_DATE)}. Begin its year-end close to stop new
                    requests and start reconciling.
                  </p>
                </div>
              ))}

            {fiscalYears.length === 0 && error ? null : fiscalYears.length === 0 ? (
              <EmptyState
                compact
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
                        {fy.status !== 'draft' && (
                          <YearCloseControls fy={fy} onChanged={() => void fetchFiscalYears()} />
                        )}
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
                className="split-row-aside touch:min-h-11 inline-flex items-center gap-2 rounded-lg bg-red-800 px-3 py-2 text-sm font-medium text-white hover:bg-red-900"
              >
                <Plus className="h-4 w-4" />
                New Category
              </button>
            </div>

            {budgetCategories.length === 0 ? (
              <EmptyState
                compact
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
                        className="text-theme-text-secondary hover:bg-theme-surface-hover hover:text-theme-text-primary touch-target-phone rounded-lg p-1.5"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeletingCategoryId(cat.id)}
                        aria-label={`Delete ${cat.name}`}
                        className="text-theme-text-secondary touch-target-phone rounded-lg p-1.5 hover:bg-red-50 hover:text-red-600"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <BudgetRequestReminderSettingsCard />
        </>
      )}

      {/* Modals */}
      {showCreateFY && <CreateFYModal onClose={() => setShowCreateFY(false)} />}
      {showCreateCategory && (
        <CategoryModal
          categories={budgetCategories}
          onClose={() => setShowCreateCategory(false)}
          onSaved={() => void fetchBudgetCategories()}
        />
      )}
      {editingCategory && (
        <CategoryModal
          key={editingCategory.id}
          categories={budgetCategories}
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
