/**
 * Grant Detail Page
 *
 * Detailed view of a single grant application with tabbed sections:
 * Overview, Budget, Expenditures, Compliance & Follow-Up, and Activity Log.
 * Includes modals for adding budget items, recording expenditures, and
 * creating compliance tasks, and the Activity Log's note card.
 *
 * Each of those is a `<form noValidate>` (forms review F-7: Enter submits)
 * whose checks run on submit and name a missing value under its field
 * (F-3/F-4); a 422 lands on the field it names, and anything no field answers
 * for is said inside the dialog or card rather than only in a toast (F-2).
 * The dialogs ask before Escape, the X or Cancel throws typed values away
 * (F-6). Payloads, amounts and permissions are unchanged by any of this.
 */

import React, { useCallback, useEffect, useState, useMemo } from 'react';
import { isSafeExternalUrl } from '../../../utils/safeUrl';
import { useNavigate, useParams } from 'react-router';
import toast from 'react-hot-toast';
import { useSubmitGuard } from '@/hooks/useSubmitGuard';
import { DialogPanel } from '@/components/ux/DialogPanel';
import { FIELD_ERROR_CLASS, FormField } from '@/components/ux/FormField';
import { useDiscardGuard } from '@/hooks/useDiscardGuard';
import { mapServerFieldErrors, type ServerFieldSpec } from '@/utils/serverFieldErrors';
import {
  ArrowLeft,
  Edit,
  DollarSign,
  Calendar,
  Target,
  Clock,
  Info,
  Wallet,
  Receipt,
  ClipboardCheck,
  MessageSquare,
  Plus,
  CheckCircle2,
  AlertTriangle,
  FileText,
  Users,
  Send,
  Eye,
  BarChart3,
  Shield,
  Loader2,
  X,
  ChevronRight,
  Pencil,
  Trash2,
} from 'lucide-react';
import type { ComplianceTaskType, ComplianceTaskStatus, GrantNoteType, GrantPriority } from '../types';
import {
  APPLICATION_STATUS_COLORS,
  PRIORITY_COLORS,
  COMPLIANCE_STATUS_COLORS,
  ComplianceTaskType as ComplianceTaskTypeEnum,
  ComplianceTaskStatus as ComplianceTaskStatusEnum,
  GrantPriority as GrantPriorityEnum,
  GrantNoteType as GrantNoteTypeEnum,
  BUDGET_ITEM_CATEGORY_LABELS,
} from '../types';
import { BUDGET_CATEGORY_ORDER, readBudgetSummary, readKeyContacts } from '../utils/applicationStructuredFields';
import { useGrantsStore } from '../store/grantsStore';
import { memberLabel, useMemberNames } from '../hooks/useMemberNames';
import { getErrorMessage } from '@/utils/errorHandling';
import { blankToNull } from '@/utils/formValues';
import { useConfirm } from '@/contexts/ConfirmContext';
import { formatDate, getTodayLocalDate } from '../../../utils/dateFormatting';
import { formatCurrency, formatCurrencyWhole } from '@/utils/currencyFormatting';
import { Breadcrumbs } from '@/components/ux/Breadcrumbs';
import { useTimezone } from '../../../hooks/useTimezone';
import { useAuthStore } from '../../../stores/authStore';
import { StatGrid } from '@/components/ux/StatGrid';

// =============================================================================
// Constants
// =============================================================================

type TabType = 'overview' | 'budget' | 'expenditures' | 'compliance' | 'activity';

const APPLICATION_STATUS_LABELS: Record<string, string> = {
  researching: 'Researching',
  preparing: 'Preparing',
  internal_review: 'Internal Review',
  submitted: 'Submitted',
  under_review: 'Under Review',
  awarded: 'Awarded',
  denied: 'Denied',
  active: 'Active',
  reporting: 'Reporting',
  closed: 'Closed',
};

const PRIORITY_LABELS: Record<string, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  critical: 'Critical',
};

const COMPLIANCE_TASK_TYPE_LABELS: Record<string, string> = {
  performance_report: 'Performance Report',
  financial_report: 'Financial Report',
  progress_update: 'Progress Update',
  site_visit: 'Site Visit',
  audit: 'Audit',
  equipment_inventory: 'Equipment Inventory',
  nfirs_submission: 'NFIRS Submission',
  closeout_report: 'Closeout Report',
  other: 'Other',
};

const COMPLIANCE_STATUS_LABELS: Record<string, string> = {
  pending: 'Pending',
  in_progress: 'In Progress',
  completed: 'Completed',
  overdue: 'Overdue',
  waived: 'Waived',
};

const NOTE_TYPE_ICONS: Record<GrantNoteType, React.ReactNode> = {
  general: <MessageSquare className="text-theme-text-secondary h-4 w-4" />,
  status_change: <ChevronRight className="h-4 w-4 text-blue-500" />,
  document_added: <FileText className="h-4 w-4 text-indigo-500" />,
  contact_made: <Users className="h-4 w-4 text-green-500" />,
  milestone: <Target className="h-4 w-4 text-amber-500" />,
  financial: <DollarSign className="h-4 w-4 text-emerald-500" />,
  compliance: <ClipboardCheck className="h-4 w-4 text-purple-500" />,
};

const COMPLIANCE_TASK_TYPE_ICONS: Record<string, React.ReactNode> = {
  performance_report: <BarChart3 className="h-5 w-5 text-blue-500" />,
  financial_report: <DollarSign className="h-5 w-5 text-green-500" />,
  progress_update: <FileText className="h-5 w-5 text-indigo-500" />,
  site_visit: <Eye className="h-5 w-5 text-amber-500" />,
  audit: <Shield className="h-5 w-5 text-red-500" />,
  equipment_inventory: <ClipboardCheck className="h-5 w-5 text-purple-500" />,
  nfirs_submission: <Send className="h-5 w-5 text-cyan-500" />,
  closeout_report: <FileText className="text-theme-text-muted h-5 w-5" />,
  other: <Info className="text-theme-text-secondary h-5 w-5" />,
};

// =============================================================================
// Modal Overlay Component
// =============================================================================

interface ModalProps {
  open: boolean;
  /** The discard-guarded close: Escape and the X ask first on a changed form. */
  onClose: () => void;
  title: string;
  /** Every dialog here is a form, so Enter submits it (forms review F-7). */
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  children: React.ReactNode;
}

const Modal: React.FC<ModalProps> = ({ open, onClose, title, onSubmit, children }) => {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="modal-overlay" aria-hidden="true" />
      {/* DialogPanel rather than a bare div: this shell predated the shared one
          and so shipped without a focus trap, Escape handling, the body scroll
          lock, or the registration that lifts the mobile bottom bar off it. */}
      <DialogPanel onClose={onClose} className="modal-panel-scroll relative z-10 mx-4 w-full max-w-lg p-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-theme-text-primary text-lg font-semibold">{title}</h3>
          <button
            data-dialog-close
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-theme-text-secondary hover:bg-theme-surface-hover hover:text-theme-text-primary rounded-lg p-1"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        {/* noValidate: the checks are the form's own, named under each field;
            a browser bubble would refuse the submit before they could run. */}
        <form onSubmit={onSubmit} noValidate>
          {children}
        </form>
      </DialogPanel>
    </div>
  );
};

// =============================================================================
// Shared form class constants
// =============================================================================

const inputClass =
  'form-input px-3 text-sm placeholder:text-theme-text-secondary focus:border-red-500 focus:ring-red-500';

const selectClass = 'form-input px-3 text-sm focus:border-red-500 focus:ring-red-500';

// =============================================================================
// Due date urgency helper
// =============================================================================

const getDueDateClasses = (dueDate: string): string => {
  const now = new Date();
  const due = new Date(dueDate);
  const diffDays = Math.ceil((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays < 0) return 'text-red-800 dark:text-red-400 font-semibold';
  if (diffDays <= 7) return 'text-orange-800 dark:text-orange-600 font-semibold';
  if (diffDays <= 30) return 'text-amber-800 dark:text-yellow-600';
  return 'text-theme-text-secondary';
};

// =============================================================================
// Field checks and refusals
// =============================================================================

/**
 * `le=MAX_AMOUNT` on GrantBudgetItemCreate/Update and GrantExpenditureCreate/
 * Update (schemas/grant.py). Checked here only to name the limit under the
 * field; the backend refuses the same values.
 */
const MAX_GRANT_AMOUNT = 100_000_000;

/** `ge=0`: zero is a valid amount (a line kept for the record), a negative is not. */
const amountError = (value: string, blankMessage: string): string | null => {
  if (value.trim() === '') return blankMessage;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 'Enter an amount of zero or more.';
  if (parsed > MAX_GRANT_AMOUNT) return 'Keep the amount to $100,000,000 or less.';
  return null;
};

/**
 * The fields of each form, keyed by the payload key the request sends, so a
 * 422 entry (the grants schemas report the camelCase alias; the mapper reads
 * both spellings) finds its field. `maxLength` is the schema's `max_length`.
 */
type BudgetField = 'category' | 'description' | 'amountBudgeted';
const BUDGET_FIELDS: Record<BudgetField, ServerFieldSpec & { id: string }> = {
  category: { id: 'budget-category', label: 'Category' },
  description: { id: 'budget-description', label: 'Description', maxLength: 500 },
  amountBudgeted: { id: 'budget-amount', label: 'Amount' },
};
const BUDGET_ORDER: readonly BudgetField[] = ['category', 'description', 'amountBudgeted'];

type ExpenditureField = 'description' | 'amount' | 'expenditureDate' | 'vendor' | 'invoiceNumber' | 'budgetItemId';
const EXPENDITURE_FIELDS: Record<ExpenditureField, ServerFieldSpec & { id: string }> = {
  description: { id: 'exp-description', label: 'Description', maxLength: 500 },
  amount: { id: 'exp-amount', label: 'Amount' },
  expenditureDate: { id: 'exp-date', label: 'Date' },
  vendor: { id: 'exp-vendor', label: 'Vendor', maxLength: 255 },
  invoiceNumber: { id: 'exp-invoice', label: 'Invoice / PO number', maxLength: 100 },
  budgetItemId: { id: 'exp-budget-item', label: 'Budget item' },
};
const EXPENDITURE_ORDER: readonly ExpenditureField[] = [
  'description',
  'amount',
  'expenditureDate',
  'vendor',
  'invoiceNumber',
  'budgetItemId',
];

type ComplianceField = 'taskType' | 'title' | 'description' | 'dueDate' | 'priority' | 'reportTemplate' | 'assignedTo';
// description and report_template carry no max_length in the schema.
const COMPLIANCE_FIELDS: Record<ComplianceField, ServerFieldSpec & { id: string }> = {
  taskType: { id: 'comp-type', label: 'Task type' },
  title: { id: 'comp-title', label: 'Title', maxLength: 255 },
  description: { id: 'comp-description', label: 'Description' },
  dueDate: { id: 'comp-due-date', label: 'Due date' },
  priority: { id: 'comp-priority', label: 'Priority' },
  reportTemplate: { id: 'comp-template', label: 'Report template' },
  assignedTo: { id: 'comp-assignee', label: 'Assigned to' },
};
const COMPLIANCE_ORDER: readonly ComplianceField[] = [
  'taskType',
  'title',
  'description',
  'dueDate',
  'priority',
  'reportTemplate',
  'assignedTo',
];

type NoteField = 'content';
const NOTE_FIELDS: Record<NoteField, ServerFieldSpec & { id: string }> = {
  content: { id: 'new-note', label: 'Note' },
};
const NOTE_ORDER: readonly NoteField[] = ['content'];

/**
 * One form's field errors and its surface-level message. A page with four
 * forms would otherwise carry four copies of the same three steps: flag the
 * fields and focus the first, clear a field as it is edited, and report a
 * failed save on its fields or, when no field answers for it, in the surface.
 */
function useSurfaceErrors<K extends string>(fields: Record<K, ServerFieldSpec & { id: string }>, order: readonly K[]) {
  const [errors, setErrors] = useState<Partial<Record<K, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);

  /** Flags `next` and focuses its first field; true when there is nothing to flag. */
  const show = useCallback(
    (next: Partial<Record<K, string>>): boolean => {
      setErrors(next);
      const first = order.find((key) => next[key]);
      if (first) document.getElementById(fields[first].id)?.focus();
      return first === undefined;
    },
    [fields, order]
  );

  const clear = useCallback(
    (key: K) =>
      setErrors((prev) => {
        if (!prev[key]) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      }),
    []
  );

  const reset = useCallback(() => {
    setErrors({});
    setFormError(null);
  }, []);

  /** A 422 goes on its fields; anything else is said inside the form, which stays open. */
  const report = useCallback(
    (err: unknown, fallback: string) => {
      const mapped = mapServerFieldErrors(err, fields);
      const placed = mapped !== null && Object.keys(mapped.fieldErrors).length > 0;
      if (mapped && placed) show(mapped.fieldErrors);
      setFormError(mapped?.unmatched.join(' ') || (placed ? null : getErrorMessage(err, fallback)));
    },
    [fields, show]
  );

  return { errors, formError, setFormError, show, clear, reset, report };
}

/** A failure no field answers for, said inside the form it belongs to. */
const SurfaceError: React.FC<{ message: string | null }> = ({ message }) =>
  message ? (
    <p role="alert" className={`text-sm ${FIELD_ERROR_CLASS}`}>
      {message}
    </p>
  ) : null;

// =============================================================================
// Main Page Component
// =============================================================================

// Older rows may hold a free-typed category; show those as stored.
const budgetCategoryLabel = (category: string): string =>
  (BUDGET_ITEM_CATEGORY_LABELS as Record<string, string>)[category] ?? category;

export const GrantDetailPage: React.FC = () => {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  // One guard per modal: the three Add buttons are independent, and a shared
  // flag would let an in-flight budget line block an unrelated expenditure.
  const { busy: budgetBusy, run: runBudget } = useSubmitGuard();
  const { busy: expenditureBusy, run: runExpenditure } = useSubmitGuard();
  const { busy: complianceBusy, run: runCompliance } = useSubmitGuard();
  const tz = useTimezone();
  const { members, nameOf } = useMemberNames();
  const { confirm } = useConfirm();
  // Every mutation this page can trigger (edit, budget/expenditure/task
  // creation, task status changes, notes) requires fundraising.manage on the
  // backend — the route itself is gated only at fundraising.view so a viewer
  // can reach the page. Hide the controls that would 403 rather than let a
  // view-only user discover the gap by clicking.
  const canManage = useAuthStore((s) => s.checkPermission)('fundraising.manage');

  const {
    currentApplication,
    isLoading,
    error,
    fetchApplication,
    addBudgetItem,
    addExpenditure,
    updateBudgetItem,
    deleteBudgetItem,
    updateExpenditure,
    deleteExpenditure,
    addComplianceTask,
    updateComplianceTask,
    addGrantNote,
  } = useGrantsStore();

  const [activeTab, setActiveTab] = useState<TabType>('overview');

  // Modal states
  const [showBudgetModal, setShowBudgetModal] = useState(false);
  const [showExpenditureModal, setShowExpenditureModal] = useState(false);
  const [showComplianceModal, setShowComplianceModal] = useState(false);

  // The budget line or expenditure the open modal edits; null when it adds one.
  const [editingBudgetItemId, setEditingBudgetItemId] = useState<string | null>(null);
  const [editingExpenditureId, setEditingExpenditureId] = useState<string | null>(null);

  // Budget item form
  const [budgetCategory, setBudgetCategory] = useState('');
  const [budgetDescription, setBudgetDescription] = useState('');
  const [budgetAmount, setBudgetAmount] = useState('');

  // Expenditure form
  const [expenditureDescription, setExpenditureDescription] = useState('');
  const [expenditureAmount, setExpenditureAmount] = useState('');
  const [expenditureDate, setExpenditureDate] = useState('');
  const [expenditureVendor, setExpenditureVendor] = useState('');
  const [expenditureInvoice, setExpenditureInvoice] = useState('');
  const [expenditureBudgetItemId, setExpenditureBudgetItemId] = useState('');

  // Compliance task form
  const [complianceType, setComplianceType] = useState<ComplianceTaskType>(ComplianceTaskTypeEnum.PERFORMANCE_REPORT);
  const [complianceTitle, setComplianceTitle] = useState('');
  const [complianceDescription, setComplianceDescription] = useState('');
  const [complianceDueDate, setComplianceDueDate] = useState('');
  const [compliancePriority, setCompliancePriority] = useState<GrantPriority>(GrantPriorityEnum.MEDIUM);
  const [complianceReportTemplate, setComplianceReportTemplate] = useState('');
  const [complianceAssignee, setComplianceAssignee] = useState('');

  // Activity note form
  const [newNoteContent, setNewNoteContent] = useState('');
  const [isSubmittingNote, setIsSubmittingNote] = useState(false);

  const budgetErrors = useSurfaceErrors(BUDGET_FIELDS, BUDGET_ORDER);
  const expenditureErrors = useSurfaceErrors(EXPENDITURE_FIELDS, EXPENDITURE_ORDER);
  const complianceErrors = useSurfaceErrors(COMPLIANCE_FIELDS, COMPLIANCE_ORDER);
  const noteErrors = useSurfaceErrors(NOTE_FIELDS, NOTE_ORDER);

  // What each dialog held when it opened: empty for an add, the stored record
  // for an edit, so reopening an edit and closing it untouched does not ask.
  const [budgetBaseline, setBudgetBaseline] = useState(() => JSON.stringify(['', '', '']));
  const [expenditureBaseline, setExpenditureBaseline] = useState(() => JSON.stringify(['', '', '', '', '', '']));
  const budgetSnapshot = JSON.stringify([budgetCategory, budgetDescription, budgetAmount]);
  const expenditureSnapshot = JSON.stringify([
    expenditureDescription,
    expenditureAmount,
    expenditureDate,
    expenditureVendor,
    expenditureInvoice,
    expenditureBudgetItemId,
  ]);
  const complianceDirty =
    complianceType !== ComplianceTaskTypeEnum.PERFORMANCE_REPORT ||
    complianceTitle !== '' ||
    complianceDescription !== '' ||
    complianceDueDate !== '' ||
    compliancePriority !== GrantPriorityEnum.MEDIUM ||
    complianceReportTemplate !== '' ||
    complianceAssignee !== '';

  // ---------------------------------------------------------------------------
  // Data loading
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!id) return;
    void fetchApplication(id);
  }, [id, fetchApplication]);

  // ---------------------------------------------------------------------------
  // Derived data
  // ---------------------------------------------------------------------------

  const application = currentApplication;
  const budgetItems = useMemo(() => application?.budgetItems ?? [], [application?.budgetItems]);
  const expenditures = useMemo(() => application?.expenditures ?? [], [application?.expenditures]);
  const complianceTasks = useMemo(() => application?.complianceTasks ?? [], [application?.complianceTasks]);
  const grantNotes = useMemo(() => application?.grantNotes ?? [], [application?.grantNotes]);

  // The API serializes these Decimals as strings ("500.00"), whatever the type
  // says, so a bare `+` concatenated them and the totals read "-" (W68).
  const budgetTotal = useMemo(
    () => budgetItems.reduce((sum, item) => sum + Number(item.amountBudgeted), 0),
    [budgetItems]
  );

  const spentTotal = useMemo(() => budgetItems.reduce((sum, item) => sum + Number(item.amountSpent), 0), [budgetItems]);

  const remainingTotal = budgetTotal - spentTotal;

  // ---------------------------------------------------------------------------
  // Modal form handlers
  // ---------------------------------------------------------------------------

  const resetBudgetForm = () => {
    setEditingBudgetItemId(null);
    setBudgetCategory('');
    setBudgetDescription('');
    setBudgetAmount('');
    setBudgetBaseline(JSON.stringify(['', '', '']));
    budgetErrors.reset();
  };

  const resetExpenditureForm = () => {
    setEditingExpenditureId(null);
    setExpenditureDescription('');
    setExpenditureAmount('');
    setExpenditureDate('');
    setExpenditureVendor('');
    setExpenditureInvoice('');
    setExpenditureBudgetItemId('');
    setExpenditureBaseline(JSON.stringify(['', '', '', '', '', '']));
    expenditureErrors.reset();
  };

  const resetComplianceForm = () => {
    setComplianceType(ComplianceTaskTypeEnum.PERFORMANCE_REPORT);
    setComplianceTitle('');
    setComplianceDescription('');
    setComplianceDueDate('');
    setCompliancePriority(GrantPriorityEnum.MEDIUM);
    setComplianceReportTemplate('');
    setComplianceAssignee('');
    complianceErrors.reset();
  };

  // Escape, the X and Cancel all ask before throwing typed values away (forms
  // review F-6); the shells are not given isDirty, so the question is asked
  // once. A closed dialog has nothing to ask about, so its guard is unarmed.
  const requestCloseBudget = useDiscardGuard({
    isDirty: showBudgetModal ? budgetSnapshot !== budgetBaseline : undefined,
    onClose: () => {
      setShowBudgetModal(false);
      resetBudgetForm();
    },
  });
  const requestCloseExpenditure = useDiscardGuard({
    isDirty: showExpenditureModal ? expenditureSnapshot !== expenditureBaseline : undefined,
    onClose: () => {
      setShowExpenditureModal(false);
      resetExpenditureForm();
    },
  });
  const requestCloseCompliance = useDiscardGuard({
    isDirty: showComplianceModal ? complianceDirty : undefined,
    onClose: () => {
      setShowComplianceModal(false);
      resetComplianceForm();
    },
  });

  const openEditBudgetItem = (item: (typeof budgetItems)[number]) => {
    const seeded = [item.category, item.description ?? '', String(Number(item.amountBudgeted))] as const;
    setEditingBudgetItemId(item.id);
    setBudgetCategory(seeded[0]);
    setBudgetDescription(seeded[1]);
    setBudgetAmount(seeded[2]);
    setBudgetBaseline(JSON.stringify(seeded));
    budgetErrors.reset();
    setShowBudgetModal(true);
  };

  const openEditExpenditure = (exp: (typeof expenditures)[number]) => {
    const seeded = [
      exp.description,
      String(Number(exp.amount)),
      (exp.expenditureDate ?? '').slice(0, 10),
      exp.vendor ?? '',
      exp.invoiceNumber ?? '',
      exp.budgetItemId ?? '',
    ] as const;
    setEditingExpenditureId(exp.id);
    setExpenditureDescription(seeded[0]);
    setExpenditureAmount(seeded[1]);
    setExpenditureDate(seeded[2]);
    setExpenditureVendor(seeded[3]);
    setExpenditureInvoice(seeded[4]);
    setExpenditureBudgetItemId(seeded[5]);
    setExpenditureBaseline(JSON.stringify(seeded));
    expenditureErrors.reset();
    setShowExpenditureModal(true);
  };

  const handleDeleteBudgetItem = async (item: (typeof budgetItems)[number]) => {
    if (!id) return;
    // The expenditures charged to a line are kept and left uncharged
    // (budget_item_id is ON DELETE SET NULL), so the dialog says so.
    const charged = expenditures.filter((exp) => exp.budgetItemId === item.id).length;
    const ok = await confirm({
      title: 'Delete this budget line?',
      message:
        charged > 0
          ? `"${item.description}" will be removed. ${charged === 1 ? '1 expenditure is' : `${charged} expenditures are`} charged to it; ${charged === 1 ? 'it stays' : 'they stay'} on the Expenditures tab with no budget line.`
          : `"${item.description}" will be removed.`,
      confirmLabel: 'Delete line',
      cancelLabel: 'Keep it',
    });
    if (!ok) return;
    try {
      await deleteBudgetItem(id, item.id);
      toast.success('Budget line deleted');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to delete budget line'));
    }
  };

  const handleDeleteExpenditure = async (exp: (typeof expenditures)[number]) => {
    if (!id) return;
    const ok = await confirm({
      title: 'Delete this expenditure?',
      message: `"${exp.description}" (${formatCurrency(exp.amount)}) will be removed, and its budget line's amount spent goes down by that much.`,
      confirmLabel: 'Delete expenditure',
      cancelLabel: 'Keep it',
    });
    if (!ok) return;
    try {
      await deleteExpenditure(id, exp.id);
      toast.success('Expenditure deleted');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to delete expenditure'));
    }
  };

  const handleSubmitBudgetItem = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const next: Partial<Record<BudgetField, string>> = {};
    if (!budgetCategory) next.category = 'Choose a category.';
    if (!budgetDescription.trim()) next.description = 'Describe what this line pays for.';
    const amount = amountError(budgetAmount, 'Enter the amount budgeted.');
    if (amount) next.amountBudgeted = amount;
    budgetErrors.setFormError(null);
    // An edit refuses as a whole here rather than saving around a refused
    // field (the single-save rule): this is a grant's money, and the brief for
    // finance forms keeps what is sent exactly as it was.
    if (!budgetErrors.show(next)) return;
    void runBudget(async () => {
      if (!id) return;
      const payload = {
        category: budgetCategory,
        description: budgetDescription,
        amountBudgeted: parseFloat(budgetAmount),
      };
      try {
        if (editingBudgetItemId) {
          await updateBudgetItem(id, editingBudgetItemId, payload);
          toast.success('Budget item updated');
        } else {
          await addBudgetItem(id, payload);
          toast.success('Budget item added');
        }
        resetBudgetForm();
        setShowBudgetModal(false);
      } catch (err: unknown) {
        budgetErrors.report(err, editingBudgetItemId ? 'Failed to update budget item' : 'Failed to add budget item');
      }
    });
  };

  const handleSubmitExpenditure = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const next: Partial<Record<ExpenditureField, string>> = {};
    if (!expenditureDescription.trim()) next.description = 'Describe the expenditure.';
    const amount = amountError(expenditureAmount, 'Enter the amount spent.');
    if (amount) next.amount = amount;
    if (!expenditureDate) next.expenditureDate = 'Enter the date of the expenditure.';
    expenditureErrors.setFormError(null);
    // Refused as a whole on an edit too, for the reason given on the budget line.
    if (!expenditureErrors.show(next)) return;
    void runExpenditure(async () => {
      if (!id) return;
      try {
        if (editingExpenditureId) {
          // An update leaves an omitted key alone, so the optional fields go
          // as null when emptied, to clear them (pitfall 1).
          const saved = await updateExpenditure(id, editingExpenditureId, {
            description: expenditureDescription,
            amount: parseFloat(expenditureAmount),
            expenditureDate,
            vendor: blankToNull(expenditureVendor),
            invoiceNumber: blankToNull(expenditureInvoice),
            budgetItemId: blankToNull(expenditureBudgetItemId),
          });
          toast.success('Expenditure updated');
          for (const warning of saved.warnings ?? []) {
            toast(warning, { icon: '⚠️', duration: 8000 });
          }
        } else {
          const recorded = await addExpenditure(id, {
            description: expenditureDescription,
            amount: parseFloat(expenditureAmount),
            expenditureDate,
            vendor: expenditureVendor || null,
            invoiceNumber: expenditureInvoice || null,
            budgetItemId: expenditureBudgetItemId || null,
          });
          toast.success('Expenditure recorded');
          // GF-7: an overspend is recorded anyway and reported, not refused.
          for (const warning of recorded.warnings ?? []) {
            toast(warning, { icon: '⚠️', duration: 8000 });
          }
        }
        resetExpenditureForm();
        setShowExpenditureModal(false);
      } catch (err: unknown) {
        expenditureErrors.report(
          err,
          editingExpenditureId ? 'Failed to update expenditure' : 'Failed to record expenditure'
        );
      }
    });
  };

  const handleSubmitComplianceTask = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const next: Partial<Record<ComplianceField, string>> = {};
    if (!complianceTitle.trim()) next.title = 'Give the task a title.';
    if (!complianceDueDate) next.dueDate = 'Enter the date the task is due.';
    complianceErrors.setFormError(null);
    if (!complianceErrors.show(next)) return;
    void runCompliance(async () => {
      if (!id) return;
      try {
        await addComplianceTask(id, {
          taskType: complianceType,
          title: complianceTitle,
          description: complianceDescription || null,
          dueDate: complianceDueDate,
          priority: compliancePriority,
          reportTemplate: complianceReportTemplate || null,
          ...(complianceAssignee ? { assignedTo: complianceAssignee } : {}),
        });
        toast.success('Compliance task added');
        resetComplianceForm();
        setShowComplianceModal(false);
      } catch (err: unknown) {
        complianceErrors.report(err, 'Failed to add compliance task');
      }
    });
  };

  const handleMarkTaskComplete = async (taskId: string) => {
    if (!id) return;
    try {
      await updateComplianceTask(id, taskId, {
        // The service stamps completed_date with the department's today (W68:
        // the page sent a UTC instant, which a date field refuses).
        status: ComplianceTaskStatusEnum.COMPLETED,
        // completed_date is a calendar `date` on the backend; a full ISO
        // timestamp is rejected with a 422, and the UTC date can be a day off
        // from the department's local date.
        completedDate: getTodayLocalDate(tz),
      });
      toast.success('Task marked complete');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to update task'));
    }
  };

  const handleChangeTaskStatus = async (taskId: string, status: ComplianceTaskStatus) => {
    if (!id) return;
    try {
      await updateComplianceTask(id, taskId, { status });
      toast.success('Task status updated');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to update task status'));
    }
  };

  const handleSubmitNote = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!id || isSubmittingNote) return;
    noteErrors.setFormError(null);
    if (!noteErrors.show(newNoteContent.trim() ? {} : { content: 'Write the note before adding it.' })) return;
    setIsSubmittingNote(true);
    try {
      await addGrantNote(id, {
        noteType: GrantNoteTypeEnum.GENERAL,
        content: newNoteContent.trim(),
      });
      toast.success('Note added');
      setNewNoteContent('');
      noteErrors.reset();
    } catch (err: unknown) {
      noteErrors.report(err, 'Failed to add note');
    } finally {
      setIsSubmittingNote(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Loading & not-found states
  // ---------------------------------------------------------------------------

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <Loader2 className="mx-auto mb-4 h-12 w-12 animate-spin text-red-500" />
          <p className="text-theme-text-secondary">Loading grant application...</p>
        </div>
      </div>
    );
  }

  if (!application) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <FileText className="text-theme-text-muted mx-auto mb-4 h-16 w-16" />
          <h2 className="text-theme-text-primary mb-2 text-xl font-bold">Application Not Found</h2>
          <p className="text-theme-text-muted mb-6">
            This grant application doesn&apos;t exist or couldn&apos;t be loaded.
          </p>
          <button
            type="button"
            onClick={() => void navigate('/grants/applications')}
            className="rounded-lg bg-red-800 px-6 py-3 text-sm font-medium text-white hover:bg-red-900"
          >
            Back to Applications
          </button>
        </div>
      </div>
    );
  }

  // Read defensively: both are untyped JSON, and a row written straight
  // through the API may hold a shape this page cannot render.
  const storedBudget = readBudgetSummary(application.budgetSummary);
  const budgetLines = BUDGET_CATEGORY_ORDER.filter((category) => storedBudget.amounts[category] !== '').map(
    (category) => ({ category, amount: Number(storedBudget.amounts[category]) })
  );
  const budgetSummary = {
    lines: budgetLines,
    total: budgetLines.reduce((sum, line) => sum + line.amount, 0),
    notes: storedBudget.notes,
  };
  const keyContacts = readKeyContacts(application.keyContacts);

  // ---------------------------------------------------------------------------
  // Tab definitions
  // ---------------------------------------------------------------------------

  const tabs: { id: TabType; label: string; icon: React.ReactNode }[] = [
    { id: 'overview', label: 'Overview', icon: <Info className="h-4 w-4" /> },
    { id: 'budget', label: 'Budget', icon: <Wallet className="h-4 w-4" /> },
    {
      id: 'expenditures',
      label: 'Expenditures',
      icon: <Receipt className="h-4 w-4" />,
    },
    {
      id: 'compliance',
      label: 'Compliance & Follow-Up',
      icon: <ClipboardCheck className="h-4 w-4" />,
    },
    {
      id: 'activity',
      label: 'Activity Log',
      icon: <MessageSquare className="h-4 w-4" />,
    },
  ];

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="min-h-screen">
      {/* ================================================================== */}
      {/* Header                                                             */}
      {/* ================================================================== */}
      <div className="border-theme-surface-border bg-theme-surface border-b">
        <div className="mx-auto max-w-7xl px-6 py-6">
          <Breadcrumbs />
          {/* Back link */}
          <button
            type="button"
            onClick={() => void navigate('/grants/applications')}
            className="text-theme-text-secondary hover:text-theme-text-primary touch:min-h-11 mb-4 inline-flex items-center gap-1.5 text-sm transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Applications
          </button>

          <div className="page-header gap-4 sm:items-start">
            <div className="page-header-title">
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-theme-text-primary text-2xl font-bold">{application.grantProgramName}</h1>
                <span
                  className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${APPLICATION_STATUS_COLORS[application.applicationStatus] ?? 'bg-theme-surface-secondary text-theme-text-secondary'}`}
                >
                  {APPLICATION_STATUS_LABELS[application.applicationStatus] ?? application.applicationStatus}
                </span>
                <span
                  className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${PRIORITY_COLORS[application.priority] ?? 'bg-theme-surface-secondary text-theme-text-secondary'}`}
                >
                  {PRIORITY_LABELS[application.priority] ?? application.priority}
                </span>
              </div>
              <p className="text-theme-text-secondary mt-1 text-sm">{application.grantAgency}</p>
            </div>

            {canManage && (
              <button
                type="button"
                onClick={() => void navigate(`/grants/applications/${application.id}/edit`)}
                className="touch:min-h-11 inline-flex items-center gap-2 rounded-lg bg-red-800 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-900"
              >
                <Edit className="h-4 w-4" />
                Edit
              </button>
            )}
          </div>

          {/* Key stats */}
          <StatGrid columns={4} gap={4} className="mt-6">
            <div className="border-theme-surface-border bg-theme-surface-secondary rounded-lg border p-4">
              <div className="text-theme-text-secondary flex items-center gap-2 text-sm">
                <DollarSign className="h-4 w-4" />
                Amount Requested
              </div>
              <p className="text-theme-text-primary mt-1 text-xl font-bold">
                {formatCurrencyWhole(application.amountRequested)}
              </p>
            </div>
            <div className="border-theme-surface-border bg-theme-surface-secondary rounded-lg border p-4">
              <div className="text-theme-text-secondary flex items-center gap-2 text-sm">
                <DollarSign className="h-4 w-4" />
                Amount Awarded
              </div>
              <p className="mt-1 text-xl font-bold text-emerald-700 dark:text-emerald-600">
                {formatCurrencyWhole(application.amountAwarded)}
              </p>
            </div>
            <div className="border-theme-surface-border bg-theme-surface-secondary rounded-lg border p-4">
              <div className="text-theme-text-secondary flex items-center gap-2 text-sm">
                <Target className="h-4 w-4" />
                Match Amount
              </div>
              <p className="text-theme-text-primary mt-1 text-xl font-bold">
                {formatCurrencyWhole(application.matchAmount)}
              </p>
            </div>
            <div className="border-theme-surface-border bg-theme-surface-secondary rounded-lg border p-4">
              <div className="text-theme-text-secondary flex items-center gap-2 text-sm">
                <Calendar className="h-4 w-4" />
                Grant Period
              </div>
              <p className="text-theme-text-primary mt-1 text-sm font-semibold">
                {application.grantStartDate ? formatDate(application.grantStartDate, tz) : '--'} &mdash;{' '}
                {application.grantEndDate ? formatDate(application.grantEndDate, tz) : '--'}
              </p>
            </div>
          </StatGrid>
        </div>
      </div>

      {/* Overspend (GF-7): measured on the server, warned about, never blocked */}
      {application.overspentBy != null && Number(application.overspentBy) > 0 && (
        <div className="mx-auto max-w-7xl px-6 pt-4">
          <div className="alert-warning flex items-start gap-3" role="status">
            <AlertTriangle className="text-theme-alert-warning-icon mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
            <p className="text-theme-text-primary text-sm">
              Spending on this grant is {formatCurrency(Number(application.overspentBy))} over the{' '}
              {formatCurrency(Number(application.amountAwarded ?? 0))} awarded. Expenditures are still recorded; check
              the budget or the award amount with the funder.
            </p>
          </div>
        </div>
      )}

      {/* Error display */}
      {error && (
        <div className="mx-auto max-w-7xl px-6 pt-4">
          <div className="flex items-center gap-3 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3">
            <AlertTriangle className="h-5 w-5 text-red-700 dark:text-red-400" />
            <span className="text-sm text-red-700 dark:text-red-300">{error}</span>
          </div>
        </div>
      )}

      {/* ================================================================== */}
      {/* Tabs                                                               */}
      {/* ================================================================== */}
      <div className="mx-auto max-w-7xl px-6 pt-6">
        <div className="segmented-group hscroll flex space-x-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`touch:min-h-11 flex flex-1 items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors ${
                activeTab === tab.id
                  ? 'bg-red-800 text-white'
                  : 'text-theme-text-muted hover:bg-theme-surface-secondary hover:text-theme-text-primary'
              }`}
            >
              {tab.icon}
              <span>{tab.label}</span>
            </button>
          ))}
        </div>
      </div>

      {/* ================================================================== */}
      {/* Tab Content                                                        */}
      {/* ================================================================== */}
      <div data-page-main className="mx-auto max-w-7xl px-6 py-6">
        {/* ---------------------------------------------------------------- */}
        {/* Overview Tab                                                     */}
        {/* ---------------------------------------------------------------- */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            {/* Project description */}
            <div className="card p-6">
              <h3 className="text-theme-text-primary text-lg font-semibold">Project Description</h3>
              <p className="text-theme-text-secondary mt-2 text-sm leading-relaxed whitespace-pre-wrap">
                {application.projectDescription ?? 'No description provided.'}
              </p>
            </div>

            {/* Narrative summary */}
            {application.narrativeSummary && (
              <div className="card p-6">
                <h3 className="text-theme-text-primary text-lg font-semibold">Narrative Summary</h3>
                <p className="text-theme-text-secondary mt-2 text-sm leading-relaxed whitespace-pre-wrap">
                  {application.narrativeSummary}
                </p>
              </div>
            )}

            {/* Budget summary */}
            {budgetSummary.lines.length > 0 || budgetSummary.notes ? (
              <div className="card p-6">
                <h3 className="text-theme-text-primary text-lg font-semibold">Budget Summary</h3>
                {budgetSummary.lines.length > 0 && (
                  <dl className="mt-3 space-y-1 text-sm">
                    {budgetSummary.lines.map(({ category, amount }) => (
                      <div key={category} className="flex justify-between gap-4">
                        <dt className="text-theme-text-secondary">{BUDGET_ITEM_CATEGORY_LABELS[category]}</dt>
                        <dd className="text-theme-text-primary font-medium">{formatCurrency(amount)}</dd>
                      </div>
                    ))}
                    <div className="border-theme-surface-border flex justify-between gap-4 border-t pt-1">
                      <dt className="text-theme-text-primary font-semibold">Total</dt>
                      <dd className="text-theme-text-primary font-semibold">{formatCurrency(budgetSummary.total)}</dd>
                    </div>
                  </dl>
                )}
                {budgetSummary.notes && (
                  <p className="text-theme-text-secondary mt-3 text-sm whitespace-pre-wrap">{budgetSummary.notes}</p>
                )}
              </div>
            ) : null}

            {/* Key contacts */}
            <div className="card p-6">
              <h3 className="text-theme-text-primary text-lg font-semibold">Key Contacts</h3>
              {keyContacts.length === 0 ? (
                <p className="text-theme-text-secondary mt-2 text-sm">No contacts recorded.</p>
              ) : (
                <ul className="mt-2 space-y-2 text-sm">
                  {keyContacts.map((contact, index) => (
                    <li key={index}>
                      <span className="text-theme-text-primary font-medium">{contact.name}</span>
                      {contact.role && <span className="text-theme-text-secondary">, {contact.role}</span>}
                      {(contact.phone || contact.email) && (
                        <div className="text-theme-text-secondary">
                          {[contact.phone, contact.email].filter(Boolean).join(' · ')}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Key dates timeline */}
            <div className="card p-6">
              <h3 className="text-theme-text-primary mb-4 text-lg font-semibold">Key Dates</h3>
              <div className="space-y-3">
                {[
                  {
                    label: 'Application Deadline',
                    date: application.applicationDeadline,
                    icon: <Clock className="h-4 w-4 text-red-500" />,
                  },
                  {
                    label: 'Submitted',
                    date: application.submittedDate,
                    icon: <Send className="h-4 w-4 text-indigo-500" />,
                  },
                  {
                    label: 'Award Date',
                    date: application.awardDate,
                    icon: <CheckCircle2 className="h-4 w-4 text-green-500" />,
                  },
                  {
                    label: 'Grant Start',
                    date: application.grantStartDate,
                    icon: <Calendar className="h-4 w-4 text-blue-500" />,
                  },
                  {
                    label: 'Grant End',
                    date: application.grantEndDate,
                    icon: <Calendar className="h-4 w-4 text-orange-500" />,
                  },
                  {
                    label: 'Next Report Due',
                    date: application.nextReportDue,
                    icon: <FileText className="h-4 w-4 text-amber-500" />,
                  },
                  {
                    label: 'Final Report Due',
                    date: application.finalReportDue,
                    icon: <FileText className="h-4 w-4 text-red-500" />,
                  },
                ].map((item) => (
                  <div
                    key={item.label}
                    className="hover:bg-theme-surface-hover flex items-center gap-3 rounded-lg px-3 py-2"
                  >
                    {item.icon}
                    <span className="text-theme-text-primary w-40 text-sm font-medium">{item.label}</span>
                    <span className="text-theme-text-secondary text-sm">
                      {item.date ? formatDate(item.date, tz) : '--'}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ---------------------------------------------------------------- */}
        {/* Budget Tab                                                       */}
        {/* ---------------------------------------------------------------- */}
        {activeTab === 'budget' && (
          <div className="space-y-6">
            {/* Summary bar */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div className="card p-4 text-center">
                <p className="text-theme-text-secondary text-sm">Total Budgeted</p>
                <p className="text-theme-text-primary mt-1 text-xl font-bold">{formatCurrency(budgetTotal)}</p>
              </div>
              <div className="card p-4 text-center">
                <p className="text-theme-text-secondary text-sm">Total Spent</p>
                <p className="mt-1 text-xl font-bold text-red-600">{formatCurrency(spentTotal)}</p>
              </div>
              <div className="card p-4 text-center">
                <p className="text-theme-text-secondary text-sm">Remaining</p>
                <p
                  className={`mt-1 text-xl font-bold ${remainingTotal >= 0 ? 'text-green-700 dark:text-green-600' : 'text-red-600'}`}
                >
                  {formatCurrency(remainingTotal)}
                </p>
              </div>
            </div>

            {/* Add button */}
            {canManage && (
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => setShowBudgetModal(true)}
                  className="inline-flex items-center gap-2 rounded-lg bg-red-800 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-900"
                >
                  <Plus className="h-4 w-4" />
                  Add Budget Item
                </button>
              </div>
            )}

            {/* Budget table */}
            <div className="card overflow-hidden">
              {budgetItems.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12">
                  <Wallet className="text-theme-text-secondary mb-3 h-12 w-12 opacity-40" />
                  <p className="text-theme-text-secondary">No budget items yet</p>
                </div>
              ) : (
                <div className="rwd-table-container overflow-x-auto">
                  <table className="rwd-table rwd-table-wide w-full">
                    <thead>
                      <tr className="border-theme-surface-border border-b">
                        <th
                          scope="col"
                          className="text-theme-text-secondary px-4 py-3 text-left text-xs font-medium tracking-wider uppercase"
                        >
                          Category
                        </th>
                        <th
                          scope="col"
                          className="text-theme-text-secondary px-4 py-3 text-left text-xs font-medium tracking-wider uppercase"
                        >
                          Description
                        </th>
                        <th
                          scope="col"
                          className="text-theme-text-secondary px-4 py-3 text-right text-xs font-medium tracking-wider uppercase"
                        >
                          Budgeted
                        </th>
                        <th
                          scope="col"
                          className="text-theme-text-secondary px-4 py-3 text-right text-xs font-medium tracking-wider uppercase"
                        >
                          Spent
                        </th>
                        <th
                          scope="col"
                          className="text-theme-text-secondary px-4 py-3 text-right text-xs font-medium tracking-wider uppercase"
                        >
                          Remaining
                        </th>
                        <th
                          scope="col"
                          className="text-theme-text-secondary px-4 py-3 text-left text-xs font-medium tracking-wider uppercase"
                        >
                          Progress
                        </th>
                        {canManage && (
                          <th scope="col" className="px-4 py-3">
                            <span className="sr-only">Actions</span>
                          </th>
                        )}
                      </tr>
                    </thead>
                    <tbody className="divide-theme-surface-border divide-y">
                      {budgetItems.map((item) => {
                        // Strings on the wire: compared bare, "900.00" > "1000.00".
                        const budgeted = Number(item.amountBudgeted);
                        const spent = Number(item.amountSpent);
                        const remaining = budgeted - spent;
                        const percent = budgeted > 0 ? Math.min((spent / budgeted) * 100, 100) : 0;
                        const isOver = spent > budgeted;
                        return (
                          <tr key={item.id}>
                            <td
                              data-label="Category"
                              className="text-theme-text-primary px-4 py-3 text-sm font-medium whitespace-nowrap"
                            >
                              {budgetCategoryLabel(item.category)}
                            </td>
                            <td data-label="Description" className="text-theme-text-secondary px-4 py-3 text-sm">
                              {item.description}
                            </td>
                            <td
                              data-label="Budgeted"
                              className="text-theme-text-primary px-4 py-3 text-right text-sm whitespace-nowrap"
                            >
                              {formatCurrency(item.amountBudgeted)}
                            </td>
                            <td
                              data-label="Spent"
                              className="text-theme-text-primary px-4 py-3 text-right text-sm whitespace-nowrap"
                            >
                              {formatCurrency(item.amountSpent)}
                            </td>
                            <td
                              data-label="Remaining"
                              className={`px-4 py-3 text-right text-sm font-medium whitespace-nowrap ${isOver ? 'text-red-600' : 'text-green-700 dark:text-green-600'}`}
                            >
                              {formatCurrency(remaining)}
                            </td>
                            <td data-label="Progress" className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                <div className="bg-theme-surface-hover h-2 w-24 overflow-hidden rounded-full">
                                  <div
                                    className={`h-full rounded-full transition-all ${isOver ? 'bg-red-500' : 'bg-green-500'}`}
                                    style={{ width: `${percent}%` }}
                                  />
                                </div>
                                <span className="text-theme-text-secondary text-xs">{Math.round(percent)}%</span>
                              </div>
                            </td>
                            {canManage && (
                              <td data-label="Actions" className="px-4 py-3 whitespace-nowrap">
                                <div className="flex items-center justify-end gap-1">
                                  <button
                                    type="button"
                                    onClick={() => openEditBudgetItem(item)}
                                    className="text-theme-text-secondary hover:bg-theme-surface-hover hover:text-theme-text-primary touch-target-phone rounded p-1 transition-colors"
                                    aria-label={`Edit budget line ${item.description}`}
                                    title="Edit"
                                  >
                                    <Pencil className="h-4 w-4" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void handleDeleteBudgetItem(item)}
                                    className="text-theme-text-secondary touch-target-phone rounded p-1 transition-colors hover:bg-red-500/10 hover:text-red-700"
                                    aria-label={`Delete budget line ${item.description}`}
                                    title="Delete"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </button>
                                </div>
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                    {/* In the card layout the empty footer cells hide, and the totals keep their labels. */}
                    <tfoot className="border-theme-surface-border border-t">
                      <tr className="bg-theme-surface-secondary font-semibold">
                        <th
                          scope="row"
                          data-label="Total"
                          className="rwd-table-lead text-theme-text-primary px-4 py-3 text-left text-sm"
                        >
                          Total
                        </th>
                        <td aria-hidden="true" className="px-4 py-3" />
                        <td
                          data-label="Budgeted"
                          className="text-theme-text-primary px-4 py-3 text-right text-sm whitespace-nowrap"
                        >
                          {formatCurrency(budgetTotal)}
                        </td>
                        <td
                          data-label="Spent"
                          className="text-theme-text-primary px-4 py-3 text-right text-sm whitespace-nowrap"
                        >
                          {formatCurrency(spentTotal)}
                        </td>
                        <td
                          data-label="Remaining"
                          className={`px-4 py-3 text-right text-sm whitespace-nowrap ${remainingTotal >= 0 ? 'text-green-700 dark:text-green-600' : 'text-red-600'}`}
                        >
                          {formatCurrency(remainingTotal)}
                        </td>
                        <td aria-hidden="true" className="px-4 py-3" />
                        {canManage && <td aria-hidden="true" className="px-4 py-3" />}
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ---------------------------------------------------------------- */}
        {/* Expenditures Tab                                                 */}
        {/* ---------------------------------------------------------------- */}
        {activeTab === 'expenditures' && (
          <div className="space-y-6">
            <div className="split-row gap-3 sm:items-center">
              <h3 className="split-row-main text-theme-text-primary text-lg font-semibold">Expenditures</h3>
              {canManage && (
                <button
                  type="button"
                  onClick={() => setShowExpenditureModal(true)}
                  className="split-row-aside inline-flex items-center gap-2 rounded-lg bg-red-800 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-900"
                >
                  <Plus className="h-4 w-4" />
                  Record Expenditure
                </button>
              )}
            </div>

            <div className="card overflow-hidden">
              {expenditures.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12">
                  <Receipt className="text-theme-text-secondary mb-3 h-12 w-12 opacity-40" />
                  <p className="text-theme-text-secondary">No expenditures recorded</p>
                </div>
              ) : (
                <div className="rwd-table-container overflow-x-auto">
                  <table className="rwd-table rwd-table-xwide w-full">
                    <thead>
                      <tr className="border-theme-surface-border border-b">
                        <th
                          scope="col"
                          className="text-theme-text-secondary px-4 py-3 text-left text-xs font-medium tracking-wider uppercase"
                        >
                          Date
                        </th>
                        <th
                          scope="col"
                          className="text-theme-text-secondary px-4 py-3 text-left text-xs font-medium tracking-wider uppercase"
                        >
                          Description
                        </th>
                        <th
                          scope="col"
                          className="text-theme-text-secondary px-4 py-3 text-left text-xs font-medium tracking-wider uppercase"
                        >
                          Vendor
                        </th>
                        <th
                          scope="col"
                          className="text-theme-text-secondary px-4 py-3 text-right text-xs font-medium tracking-wider uppercase"
                        >
                          Amount
                        </th>
                        <th
                          scope="col"
                          className="text-theme-text-secondary px-4 py-3 text-left text-xs font-medium tracking-wider uppercase"
                        >
                          Budget Category
                        </th>
                        <th
                          scope="col"
                          className="text-theme-text-secondary px-4 py-3 text-left text-xs font-medium tracking-wider uppercase"
                        >
                          Receipt
                        </th>
                        {canManage && (
                          <th scope="col" className="px-4 py-3">
                            <span className="sr-only">Actions</span>
                          </th>
                        )}
                      </tr>
                    </thead>
                    <tbody className="divide-theme-surface-border divide-y">
                      {expenditures.map((exp) => {
                        const linkedBudgetItem = budgetItems.find((b) => b.id === exp.budgetItemId);
                        return (
                          <tr key={exp.id} className="hover:bg-theme-surface-hover transition-colors">
                            <td
                              data-label="Date"
                              className="text-theme-text-primary px-4 py-3 text-sm whitespace-nowrap"
                            >
                              {formatDate(exp.expenditureDate, tz)}
                            </td>
                            <td data-label="Description" className="text-theme-text-primary px-4 py-3 text-sm">
                              {exp.description}
                            </td>
                            <td data-label="Vendor" className="text-theme-text-secondary px-4 py-3 text-sm">
                              {exp.vendor ?? '--'}
                            </td>
                            <td
                              data-label="Amount"
                              className="text-theme-text-primary px-4 py-3 text-right text-sm font-semibold whitespace-nowrap"
                            >
                              {formatCurrency(exp.amount)}
                            </td>
                            <td data-label="Budget Category" className="text-theme-text-secondary px-4 py-3 text-sm">
                              {linkedBudgetItem ? budgetCategoryLabel(linkedBudgetItem.category) : '--'}
                            </td>
                            <td data-label="Receipt" className="px-4 py-3 text-sm whitespace-nowrap">
                              {exp.receiptUrl && isSafeExternalUrl(exp.receiptUrl) ? (
                                <a
                                  href={exp.receiptUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 text-red-600 hover:underline"
                                >
                                  <FileText className="h-3 w-3" />
                                  View
                                </a>
                              ) : (
                                <span className="text-theme-text-secondary">--</span>
                              )}
                            </td>
                            {canManage && (
                              <td data-label="Actions" className="px-4 py-3 whitespace-nowrap">
                                <div className="flex items-center justify-end gap-1">
                                  <button
                                    type="button"
                                    onClick={() => openEditExpenditure(exp)}
                                    className="text-theme-text-secondary hover:bg-theme-surface-hover hover:text-theme-text-primary touch-target-phone rounded p-1 transition-colors"
                                    aria-label={`Edit expenditure ${exp.description}`}
                                    title="Edit"
                                  >
                                    <Pencil className="h-4 w-4" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void handleDeleteExpenditure(exp)}
                                    className="text-theme-text-secondary touch-target-phone rounded p-1 transition-colors hover:bg-red-500/10 hover:text-red-700"
                                    aria-label={`Delete expenditure ${exp.description}`}
                                    title="Delete"
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </button>
                                </div>
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ---------------------------------------------------------------- */}
        {/* Compliance & Follow-Up Tab                                       */}
        {/* ---------------------------------------------------------------- */}
        {activeTab === 'compliance' && (
          <div className="space-y-6">
            <div className="split-row gap-3 sm:items-center">
              <h3 className="split-row-main text-theme-text-primary text-lg font-semibold">
                Compliance & Follow-Up Tasks
              </h3>
              {canManage && (
                <button
                  type="button"
                  onClick={() => setShowComplianceModal(true)}
                  className="split-row-aside inline-flex items-center gap-2 rounded-lg bg-red-800 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-900"
                >
                  <Plus className="h-4 w-4" />
                  Add Task
                </button>
              )}
            </div>

            {complianceTasks.length === 0 ? (
              <div className="card flex flex-col items-center justify-center px-4 py-12">
                <ClipboardCheck className="text-theme-text-secondary mb-3 h-12 w-12 opacity-40" />
                <p className="text-theme-text-secondary">No compliance tasks yet</p>
              </div>
            ) : (
              <div className="space-y-3">
                {complianceTasks.map((task) => (
                  <div key={task.id} className="card p-4">
                    <div className="flex flex-wrap items-start gap-4">
                      {/* Type icon */}
                      <div className="mt-0.5 flex-shrink-0">
                        {COMPLIANCE_TASK_TYPE_ICONS[task.taskType] ?? (
                          <Info className="text-theme-text-secondary h-5 w-5" />
                        )}
                      </div>

                      {/* Content */}
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h4 className="text-theme-text-primary text-sm font-semibold">{task.title}</h4>
                          <span
                            className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${PRIORITY_COLORS[task.priority] ?? 'bg-theme-surface-secondary text-theme-text-secondary'}`}
                          >
                            {PRIORITY_LABELS[task.priority] ?? task.priority}
                          </span>
                          <span className="text-theme-text-secondary text-xs">
                            {COMPLIANCE_TASK_TYPE_LABELS[task.taskType] ?? task.taskType}
                          </span>
                        </div>

                        {task.description && (
                          <p className="text-theme-text-secondary mt-1 text-sm">{task.description}</p>
                        )}

                        <div className="mt-2 flex flex-wrap items-center gap-4 text-xs">
                          <span className={getDueDateClasses(task.dueDate)}>Due: {formatDate(task.dueDate, tz)}</span>
                          {task.assignedTo && (
                            <span className="text-theme-text-secondary">Assigned: {nameOf(task.assignedTo)}</span>
                          )}
                        </div>
                      </div>

                      {/* Status dropdown + mark complete (manage only — a
                          viewer sees the same badge everyone else on the app
                          gets for a status they can't change) */}
                      <div className="flex flex-shrink-0 items-center gap-2">
                        {canManage ? (
                          <>
                            <select
                              value={task.status}
                              onChange={(e) =>
                                void handleChangeTaskStatus(task.id, e.target.value as ComplianceTaskStatus)
                              }
                              className={`rounded-full border-0 px-2.5 py-0.5 text-xs font-medium focus:ring-2 focus:ring-red-500 focus:outline-none ${COMPLIANCE_STATUS_COLORS[task.status] ?? 'bg-theme-surface-secondary text-theme-text-secondary'}`}
                            >
                              {Object.entries(COMPLIANCE_STATUS_LABELS).map(([value, label]) => (
                                <option key={value} value={value}>
                                  {label}
                                </option>
                              ))}
                            </select>

                            {task.status !== ComplianceTaskStatusEnum.COMPLETED && (
                              <button
                                type="button"
                                onClick={() => void handleMarkTaskComplete(task.id)}
                                className="inline-flex items-center gap-1 rounded-lg border border-green-500/30 bg-green-500/10 px-3 py-1.5 text-xs font-medium text-green-800 transition-colors hover:bg-green-500/20"
                              >
                                <CheckCircle2 className="h-3.5 w-3.5" />
                                Mark Complete
                              </button>
                            )}
                          </>
                        ) : (
                          <span
                            className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${COMPLIANCE_STATUS_COLORS[task.status] ?? 'bg-theme-surface-secondary text-theme-text-secondary'}`}
                          >
                            {COMPLIANCE_STATUS_LABELS[task.status] ?? task.status}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ---------------------------------------------------------------- */}
        {/* Activity Log Tab                                                 */}
        {/* ---------------------------------------------------------------- */}
        {activeTab === 'activity' && (
          <div className="space-y-6">
            <h3 className="text-theme-text-primary text-lg font-semibold">Activity Log</h3>

            {/* Timeline */}
            {grantNotes.length === 0 ? (
              <div className="card flex flex-col items-center justify-center px-4 py-12">
                <MessageSquare className="text-theme-text-secondary mb-3 h-12 w-12 opacity-40" />
                <p className="text-theme-text-secondary">No activity yet</p>
              </div>
            ) : (
              <div className="space-y-0">
                {grantNotes.map((note, index) => (
                  <div key={note.id} className="flex gap-4">
                    {/* Timeline line + icon */}
                    <div className="flex flex-col items-center">
                      <div className="border-theme-surface-border bg-theme-surface flex h-8 w-8 items-center justify-center rounded-full border">
                        {NOTE_TYPE_ICONS[note.noteType] ?? (
                          <MessageSquare className="text-theme-text-secondary h-4 w-4" />
                        )}
                      </div>
                      {index < grantNotes.length - 1 && <div className="bg-theme-surface-border w-px flex-1" />}
                    </div>

                    {/* Content */}
                    <div className="mb-6 min-w-0 flex-1 pb-2">
                      <p className="text-theme-text-primary text-sm">{note.content}</p>
                      <div className="text-theme-text-secondary mt-1 flex items-center gap-2 text-xs">
                        {note.createdByName && <span>{note.createdByName}</span>}
                        {note.createdByName && <span>&middot;</span>}
                        <span>{formatDate(note.createdAt, tz)}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Add note (manage only — create_note requires fundraising.manage) */}
            {canManage && (
              <form onSubmit={(e) => void handleSubmitNote(e)} noValidate className="card space-y-3 p-4">
                <SurfaceError message={noteErrors.formError} />
                <FormField id={NOTE_FIELDS.content.id} label="Add Note" required error={noteErrors.errors.content}>
                  {(field) => (
                    <textarea
                      {...field}
                      rows={3}
                      value={newNoteContent}
                      onChange={(e) => {
                        setNewNoteContent(e.target.value);
                        noteErrors.clear('content');
                      }}
                      placeholder="Add an update or a call summary..."
                      className={`${inputClass} resize-none`}
                    />
                  )}
                </FormField>
                <div className="flex justify-end">
                  {/* Disabled only while sending; a blank note is named on the field. */}
                  <button
                    type="submit"
                    disabled={isSubmittingNote}
                    className="inline-flex items-center gap-2 rounded-lg bg-red-800 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-900 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isSubmittingNote ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                    Add Note
                  </button>
                </div>
              </form>
            )}
          </div>
        )}
      </div>

      {/* ================================================================== */}
      {/* Modals                                                             */}
      {/* ================================================================== */}

      {/* Add Budget Item Modal */}
      <Modal
        open={showBudgetModal}
        onClose={requestCloseBudget}
        title={editingBudgetItemId ? 'Edit Budget Item' : 'Add Budget Item'}
        onSubmit={handleSubmitBudgetItem}
      >
        <div className="space-y-4">
          <SurfaceError message={budgetErrors.formError} />
          <FormField id={BUDGET_FIELDS.category.id} label="Category" required error={budgetErrors.errors.category}>
            {(field) => (
              <select
                {...field}
                value={budgetCategory}
                onChange={(e) => {
                  setBudgetCategory(e.target.value);
                  budgetErrors.clear('category');
                }}
                className={selectClass}
              >
                <option value="">Select category...</option>
                {/* The values are the backend's category codes; it refuses the labels. */}
                {BUDGET_CATEGORY_ORDER.map((category) => (
                  <option key={category} value={category}>
                    {BUDGET_ITEM_CATEGORY_LABELS[category]}
                  </option>
                ))}
              </select>
            )}
          </FormField>
          <FormField
            id={BUDGET_FIELDS.description.id}
            label="Description"
            required
            error={budgetErrors.errors.description}
            maxLength={BUDGET_FIELDS.description.maxLength}
            count={budgetDescription.length}
          >
            {(field) => (
              <input
                {...field}
                type="text"
                autoComplete="off"
                value={budgetDescription}
                onChange={(e) => {
                  setBudgetDescription(e.target.value);
                  budgetErrors.clear('description');
                }}
                placeholder="e.g., 10 sets of turnout gear"
                className={inputClass}
              />
            )}
          </FormField>
          <FormField
            id={BUDGET_FIELDS.amountBudgeted.id}
            label="Amount"
            required
            error={budgetErrors.errors.amountBudgeted}
          >
            {(field) => (
              <input
                {...field}
                type="number"
                inputMode="decimal"
                min="0"
                step="0.01"
                value={budgetAmount}
                onChange={(e) => {
                  setBudgetAmount(e.target.value);
                  budgetErrors.clear('amountBudgeted');
                }}
                placeholder="0.00"
                className={inputClass}
              />
            )}
          </FormField>
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={requestCloseBudget}
              className="border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-hover rounded-lg border px-4 py-2 text-sm font-medium transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={budgetBusy}
              className="rounded-lg bg-red-800 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-900 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {editingBudgetItemId ? 'Save Changes' : 'Add Budget Item'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Record Expenditure Modal */}
      <Modal
        open={showExpenditureModal}
        onClose={requestCloseExpenditure}
        title={editingExpenditureId ? 'Edit Expenditure' : 'Record Expenditure'}
        onSubmit={handleSubmitExpenditure}
      >
        <div className="space-y-4">
          <SurfaceError message={expenditureErrors.formError} />
          <FormField
            id={EXPENDITURE_FIELDS.description.id}
            label="Description"
            required
            error={expenditureErrors.errors.description}
            maxLength={EXPENDITURE_FIELDS.description.maxLength}
            count={expenditureDescription.length}
          >
            {(field) => (
              <input
                {...field}
                type="text"
                autoComplete="off"
                value={expenditureDescription}
                onChange={(e) => {
                  setExpenditureDescription(e.target.value);
                  expenditureErrors.clear('description');
                }}
                placeholder="e.g., Purchase of SCBA units"
                className={inputClass}
              />
            )}
          </FormField>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField
              id={EXPENDITURE_FIELDS.amount.id}
              label="Amount"
              required
              error={expenditureErrors.errors.amount}
            >
              {(field) => (
                <input
                  {...field}
                  type="number"
                  inputMode="decimal"
                  min="0"
                  step="0.01"
                  value={expenditureAmount}
                  onChange={(e) => {
                    setExpenditureAmount(e.target.value);
                    expenditureErrors.clear('amount');
                  }}
                  placeholder="0.00"
                  className={inputClass}
                />
              )}
            </FormField>
            <FormField
              id={EXPENDITURE_FIELDS.expenditureDate.id}
              label="Date"
              required
              error={expenditureErrors.errors.expenditureDate}
            >
              {(field) => (
                <input
                  {...field}
                  type="date"
                  value={expenditureDate}
                  onChange={(e) => {
                    setExpenditureDate(e.target.value);
                    expenditureErrors.clear('expenditureDate');
                  }}
                  className={inputClass}
                />
              )}
            </FormField>
          </div>
          <FormField
            id={EXPENDITURE_FIELDS.vendor.id}
            label="Vendor"
            optional
            error={expenditureErrors.errors.vendor}
            maxLength={EXPENDITURE_FIELDS.vendor.maxLength}
            count={expenditureVendor.length}
          >
            {(field) => (
              <input
                {...field}
                type="text"
                autoComplete="off"
                value={expenditureVendor}
                onChange={(e) => {
                  setExpenditureVendor(e.target.value);
                  expenditureErrors.clear('vendor');
                }}
                placeholder="e.g., Acme Fire Equipment"
                className={inputClass}
              />
            )}
          </FormField>
          <FormField
            id={EXPENDITURE_FIELDS.invoiceNumber.id}
            label="Invoice / PO Number"
            optional
            error={expenditureErrors.errors.invoiceNumber}
            maxLength={EXPENDITURE_FIELDS.invoiceNumber.maxLength}
            count={expenditureInvoice.length}
          >
            {(field) => (
              <input
                {...field}
                type="text"
                autoComplete="off"
                value={expenditureInvoice}
                onChange={(e) => {
                  setExpenditureInvoice(e.target.value);
                  expenditureErrors.clear('invoiceNumber');
                }}
                placeholder="e.g., INV-1042"
                className={inputClass}
              />
            )}
          </FormField>
          <FormField
            id={EXPENDITURE_FIELDS.budgetItemId.id}
            label="Budget Item"
            optional
            error={expenditureErrors.errors.budgetItemId}
          >
            {(field) => (
              <select
                {...field}
                value={expenditureBudgetItemId}
                onChange={(e) => {
                  setExpenditureBudgetItemId(e.target.value);
                  expenditureErrors.clear('budgetItemId');
                }}
                className={selectClass}
              >
                <option value="">None</option>
                {budgetItems.map((item) => (
                  <option key={item.id} value={item.id}>
                    {budgetCategoryLabel(item.category)} - {item.description}
                  </option>
                ))}
              </select>
            )}
          </FormField>
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={requestCloseExpenditure}
              className="border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-hover rounded-lg border px-4 py-2 text-sm font-medium transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={expenditureBusy}
              className="rounded-lg bg-red-800 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-900 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {editingExpenditureId ? 'Save Changes' : 'Record Expenditure'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Add Compliance Task Modal */}
      <Modal
        open={showComplianceModal}
        onClose={requestCloseCompliance}
        title="Add Compliance Task"
        onSubmit={handleSubmitComplianceTask}
      >
        <div className="space-y-4">
          <SurfaceError message={complianceErrors.formError} />
          <FormField id={COMPLIANCE_FIELDS.taskType.id} label="Task Type" error={complianceErrors.errors.taskType}>
            {(field) => (
              <select
                {...field}
                value={complianceType}
                onChange={(e) => {
                  setComplianceType(e.target.value as ComplianceTaskType);
                  complianceErrors.clear('taskType');
                }}
                className={selectClass}
              >
                {Object.entries(COMPLIANCE_TASK_TYPE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            )}
          </FormField>
          <FormField
            id={COMPLIANCE_FIELDS.title.id}
            label="Title"
            required
            error={complianceErrors.errors.title}
            maxLength={COMPLIANCE_FIELDS.title.maxLength}
            count={complianceTitle.length}
          >
            {(field) => (
              <input
                {...field}
                type="text"
                autoComplete="off"
                value={complianceTitle}
                onChange={(e) => {
                  setComplianceTitle(e.target.value);
                  complianceErrors.clear('title');
                }}
                placeholder="e.g., Q1 Performance Report"
                className={inputClass}
              />
            )}
          </FormField>
          <FormField
            id={COMPLIANCE_FIELDS.description.id}
            label="Description"
            optional
            error={complianceErrors.errors.description}
          >
            {(field) => (
              <textarea
                {...field}
                rows={2}
                value={complianceDescription}
                onChange={(e) => {
                  setComplianceDescription(e.target.value);
                  complianceErrors.clear('description');
                }}
                placeholder="Additional details..."
                className={`${inputClass} resize-none`}
              />
            )}
          </FormField>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <FormField
              id={COMPLIANCE_FIELDS.dueDate.id}
              label="Due Date"
              required
              error={complianceErrors.errors.dueDate}
            >
              {(field) => (
                <input
                  {...field}
                  type="date"
                  value={complianceDueDate}
                  onChange={(e) => {
                    setComplianceDueDate(e.target.value);
                    complianceErrors.clear('dueDate');
                  }}
                  className={inputClass}
                />
              )}
            </FormField>
            <FormField id={COMPLIANCE_FIELDS.priority.id} label="Priority" error={complianceErrors.errors.priority}>
              {(field) => (
                <select
                  {...field}
                  value={compliancePriority}
                  onChange={(e) => {
                    setCompliancePriority(e.target.value as GrantPriority);
                    complianceErrors.clear('priority');
                  }}
                  className={selectClass}
                >
                  {Object.entries(PRIORITY_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              )}
            </FormField>
          </div>
          <FormField
            id={COMPLIANCE_FIELDS.reportTemplate.id}
            label="Report Template"
            optional
            error={complianceErrors.errors.reportTemplate}
          >
            {(field) => (
              <input
                {...field}
                type="text"
                autoComplete="off"
                value={complianceReportTemplate}
                onChange={(e) => {
                  setComplianceReportTemplate(e.target.value);
                  complianceErrors.clear('reportTemplate');
                }}
                placeholder="Template name or URL"
                className={inputClass}
              />
            )}
          </FormField>
          {/* The member directory needs members.view or users.view, which
              fundraising.manage does not imply: without it there is no list
              to pick from, and the task is created unassigned as before. */}
          {members && (
            <FormField
              id={COMPLIANCE_FIELDS.assignedTo.id}
              label="Assigned To"
              optional
              error={complianceErrors.errors.assignedTo}
            >
              {(field) => (
                <select
                  {...field}
                  value={complianceAssignee}
                  onChange={(e) => {
                    setComplianceAssignee(e.target.value);
                    complianceErrors.clear('assignedTo');
                  }}
                  className={selectClass}
                >
                  <option value="">Unassigned</option>
                  {members.map((member) => (
                    <option key={member.id} value={member.id}>
                      {memberLabel(member)}
                    </option>
                  ))}
                </select>
              )}
            </FormField>
          )}
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={requestCloseCompliance}
              className="border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-hover rounded-lg border px-4 py-2 text-sm font-medium transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={complianceBusy}
              className="rounded-lg bg-red-800 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-900 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Add Task
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default GrantDetailPage;
