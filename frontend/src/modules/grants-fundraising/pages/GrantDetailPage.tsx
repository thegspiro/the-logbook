/**
 * Grant Detail Page
 *
 * Detailed view of a single grant application with tabbed sections:
 * Overview, Budget, Expenditures, Compliance & Follow-Up, and Activity Log.
 * Includes modals for adding budget items, recording expenditures, and
 * creating compliance tasks.
 */

import React, { useEffect, useState, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import toast from 'react-hot-toast';
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
} from 'lucide-react';
import type {
  ComplianceTaskType,
  ComplianceTaskStatus,
  GrantPriority,
} from '../types';
import {
  APPLICATION_STATUS_COLORS,
  PRIORITY_COLORS,
  COMPLIANCE_STATUS_COLORS,
  ComplianceTaskType as ComplianceTaskTypeEnum,
  ComplianceTaskStatus as ComplianceTaskStatusEnum,
  GrantPriority as GrantPriorityEnum,
} from '../types';
import { useGrantsStore } from '../store/grantsStore';
import { formatDate } from '../../../utils/dateFormatting';
import { useTimezone } from '../../../hooks/useTimezone';

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

const NOTE_TYPE_ICONS: Record<string, React.ReactNode> = {
  status_change: <ChevronRight className="h-4 w-4 text-blue-500" />,
  document: <FileText className="h-4 w-4 text-indigo-500" />,
  contact: <Users className="h-4 w-4 text-green-500" />,
  milestone: <Target className="h-4 w-4 text-amber-500" />,
  comment: <MessageSquare className="h-4 w-4 text-theme-text-secondary" />,
  submission: <Send className="h-4 w-4 text-purple-500" />,
  review: <Eye className="h-4 w-4 text-cyan-500" />,
  financial: <DollarSign className="h-4 w-4 text-emerald-500" />,
};

const COMPLIANCE_TASK_TYPE_ICONS: Record<string, React.ReactNode> = {
  performance_report: <BarChart3 className="h-5 w-5 text-blue-500" />,
  financial_report: <DollarSign className="h-5 w-5 text-green-500" />,
  progress_update: <FileText className="h-5 w-5 text-indigo-500" />,
  site_visit: <Eye className="h-5 w-5 text-amber-500" />,
  audit: <Shield className="h-5 w-5 text-red-500" />,
  equipment_inventory: <ClipboardCheck className="h-5 w-5 text-purple-500" />,
  nfirs_submission: <Send className="h-5 w-5 text-cyan-500" />,
  closeout_report: <FileText className="h-5 w-5 text-gray-500" />,
  other: <Info className="h-5 w-5 text-theme-text-secondary" />,
};

const formatCurrency = (amount: number | null | undefined) => {
  if (amount == null) return '--';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
};

const formatCurrencyPrecise = (amount: number | null | undefined) => {
  if (amount == null) return '--';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(amount);
};

// =============================================================================
// Modal Overlay Component
// =============================================================================

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}

const Modal: React.FC<ModalProps> = ({ open, onClose, title, children }) => {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
        role="presentation"
      />
      <div className="relative z-10 mx-4 w-full max-w-lg rounded-xl border border-theme-surface-border bg-theme-surface p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-theme-text-primary">
            {title}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-theme-text-secondary hover:bg-theme-surface-hover hover:text-theme-text-primary"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
};

// =============================================================================
// Shared form class constants
// =============================================================================

const inputClass =
  'w-full rounded-lg border border-theme-surface-border bg-theme-bg px-3 py-2 text-sm text-theme-text-primary placeholder:text-theme-text-secondary focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500';

const selectClass =
  'w-full rounded-lg border border-theme-surface-border bg-theme-bg px-3 py-2 text-sm text-theme-text-primary focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500';

const labelClass = 'block text-sm font-medium text-theme-text-primary mb-1';

// =============================================================================
// Due date urgency helper
// =============================================================================

const getDueDateClasses = (dueDate: string): string => {
  const now = new Date();
  const due = new Date(dueDate);
  const diffDays = Math.ceil(
    (due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
  );

  if (diffDays < 0) return 'text-red-600 font-semibold';
  if (diffDays <= 7) return 'text-orange-600 font-semibold';
  if (diffDays <= 30) return 'text-yellow-600';
  return 'text-theme-text-secondary';
};

// =============================================================================
// Main Page Component
// =============================================================================

export const GrantDetailPage: React.FC = () => {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const tz = useTimezone();

  const {
    currentApplication,
    isLoading,
    error,
    fetchApplication,
    addBudgetItem,
    addExpenditure,
    addComplianceTask,
    updateComplianceTask,
    addGrantNote,
  } = useGrantsStore();

  const [activeTab, setActiveTab] = useState<TabType>('overview');

  // Modal states
  const [showBudgetModal, setShowBudgetModal] = useState(false);
  const [showExpenditureModal, setShowExpenditureModal] = useState(false);
  const [showComplianceModal, setShowComplianceModal] = useState(false);

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
  const [complianceType, setComplianceType] = useState<ComplianceTaskType>(
    ComplianceTaskTypeEnum.PERFORMANCE_REPORT,
  );
  const [complianceTitle, setComplianceTitle] = useState('');
  const [complianceDescription, setComplianceDescription] = useState('');
  const [complianceDueDate, setComplianceDueDate] = useState('');
  const [compliancePriority, setCompliancePriority] = useState<GrantPriority>(
    GrantPriorityEnum.MEDIUM,
  );
  const [complianceReportTemplate, setComplianceReportTemplate] = useState('');

  // Activity note form
  const [newNoteContent, setNewNoteContent] = useState('');
  const [isSubmittingNote, setIsSubmittingNote] = useState(false);

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

  const budgetTotal = useMemo(
    () => budgetItems.reduce((sum, item) => sum + item.amountBudgeted, 0),
    [budgetItems],
  );

  const spentTotal = useMemo(
    () => budgetItems.reduce((sum, item) => sum + item.amountSpent, 0),
    [budgetItems],
  );

  const remainingTotal = budgetTotal - spentTotal;

  // ---------------------------------------------------------------------------
  // Modal form handlers
  // ---------------------------------------------------------------------------

  const resetBudgetForm = () => {
    setBudgetCategory('');
    setBudgetDescription('');
    setBudgetAmount('');
  };

  const resetExpenditureForm = () => {
    setExpenditureDescription('');
    setExpenditureAmount('');
    setExpenditureDate('');
    setExpenditureVendor('');
    setExpenditureInvoice('');
    setExpenditureBudgetItemId('');
  };

  const resetComplianceForm = () => {
    setComplianceType(ComplianceTaskTypeEnum.PERFORMANCE_REPORT);
    setComplianceTitle('');
    setComplianceDescription('');
    setComplianceDueDate('');
    setCompliancePriority(GrantPriorityEnum.MEDIUM);
    setComplianceReportTemplate('');
  };

  const handleAddBudgetItem = async () => {
    if (!id || !budgetCategory || !budgetDescription || !budgetAmount) return;
    try {
      await addBudgetItem(id, {
        category: budgetCategory,
        description: budgetDescription,
        amountBudgeted: parseFloat(budgetAmount),
      });
      toast.success('Budget item added');
      resetBudgetForm();
      setShowBudgetModal(false);
    } catch {
      toast.error('Failed to add budget item');
    }
  };

  const handleAddExpenditure = async () => {
    if (!id || !expenditureDescription || !expenditureAmount || !expenditureDate)
      return;
    try {
      await addExpenditure(id, {
        description: expenditureDescription,
        amount: parseFloat(expenditureAmount),
        expenditureDate,
        vendor: expenditureVendor || null,
        invoiceNumber: expenditureInvoice || null,
        budgetItemId: expenditureBudgetItemId || null,
      });
      toast.success('Expenditure recorded');
      resetExpenditureForm();
      setShowExpenditureModal(false);
    } catch {
      toast.error('Failed to record expenditure');
    }
  };

  const handleAddComplianceTask = async () => {
    if (!id || !complianceTitle || !complianceDueDate) return;
    try {
      await addComplianceTask(id, {
        taskType: complianceType,
        title: complianceTitle,
        description: complianceDescription || null,
        dueDate: complianceDueDate,
        priority: compliancePriority,
        reportTemplate: complianceReportTemplate || null,
      });
      toast.success('Compliance task added');
      resetComplianceForm();
      setShowComplianceModal(false);
    } catch {
      toast.error('Failed to add compliance task');
    }
  };

  const handleMarkTaskComplete = async (taskId: string) => {
    if (!id) return;
    try {
      await updateComplianceTask(id, taskId, {
        status: ComplianceTaskStatusEnum.COMPLETED,
        completedDate: new Date().toISOString(),
      });
      toast.success('Task marked as complete');
    } catch {
      toast.error('Failed to update task');
    }
  };

  const handleChangeTaskStatus = async (
    taskId: string,
    status: ComplianceTaskStatus,
  ) => {
    if (!id) return;
    try {
      await updateComplianceTask(id, taskId, { status });
      toast.success('Task status updated');
    } catch {
      toast.error('Failed to update task status');
    }
  };

  const handleAddNote = async () => {
    if (!id || !newNoteContent.trim()) return;
    setIsSubmittingNote(true);
    try {
      await addGrantNote(id, {
        noteType: 'comment',
        content: newNoteContent.trim(),
      });
      toast.success('Note added');
      setNewNoteContent('');
    } catch {
      toast.error('Failed to add note');
    } finally {
      setIsSubmittingNote(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Loading & not-found states
  // ---------------------------------------------------------------------------

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-theme-bg">
        <div className="text-center">
          <Loader2 className="mx-auto mb-4 h-12 w-12 animate-spin text-red-500" />
          <p className="text-theme-text-secondary">Loading grant application...</p>
        </div>
      </div>
    );
  }

  if (!application) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-theme-bg">
        <div className="text-center">
          <FileText className="mx-auto mb-4 h-16 w-16 text-theme-text-muted" />
          <h2 className="mb-2 text-xl font-bold text-theme-text-primary">
            Application Not Found
          </h2>
          <p className="mb-6 text-theme-text-muted">
            The grant application you&apos;re looking for doesn&apos;t exist.
          </p>
          <button
            type="button"
            onClick={() => navigate('/grants/applications')}
            className="rounded-lg bg-red-600 px-6 py-3 text-sm font-medium text-white hover:bg-red-700"
          >
            Back to Applications
          </button>
        </div>
      </div>
    );
  }

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
    <div className="min-h-screen bg-theme-bg">
      {/* ================================================================== */}
      {/* Header                                                             */}
      {/* ================================================================== */}
      <div className="border-b border-theme-surface-border bg-theme-surface">
        <div className="mx-auto max-w-7xl px-6 py-6">
          {/* Back link */}
          <button
            type="button"
            onClick={() => navigate('/grants/applications')}
            className="mb-4 inline-flex items-center gap-1.5 text-sm text-theme-text-secondary hover:text-theme-text-primary transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Applications
          </button>

          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="flex items-center gap-3">
                <h1 className="text-2xl font-bold text-theme-text-primary">
                  {application.grantProgramName}
                </h1>
                <span
                  className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${APPLICATION_STATUS_COLORS[application.applicationStatus] ?? 'bg-gray-100 text-gray-800'}`}
                >
                  {APPLICATION_STATUS_LABELS[application.applicationStatus] ??
                    application.applicationStatus}
                </span>
                <span
                  className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${PRIORITY_COLORS[application.priority] ?? 'bg-gray-100 text-gray-700'}`}
                >
                  {PRIORITY_LABELS[application.priority] ?? application.priority}
                </span>
              </div>
              <p className="mt-1 text-sm text-theme-text-secondary">
                {application.grantAgency}
              </p>
            </div>

            <button
              type="button"
              onClick={() =>
                navigate(`/grants/applications/${application.id}/edit`)
              }
              className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 transition-colors"
            >
              <Edit className="h-4 w-4" />
              Edit
            </button>
          </div>

          {/* Key stats */}
          <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div className="rounded-lg border border-theme-surface-border bg-theme-bg p-4">
              <div className="flex items-center gap-2 text-sm text-theme-text-secondary">
                <DollarSign className="h-4 w-4" />
                Amount Requested
              </div>
              <p className="mt-1 text-xl font-bold text-theme-text-primary">
                {formatCurrency(application.amountRequested)}
              </p>
            </div>
            <div className="rounded-lg border border-theme-surface-border bg-theme-bg p-4">
              <div className="flex items-center gap-2 text-sm text-theme-text-secondary">
                <DollarSign className="h-4 w-4" />
                Amount Awarded
              </div>
              <p className="mt-1 text-xl font-bold text-emerald-600">
                {formatCurrency(application.amountAwarded)}
              </p>
            </div>
            <div className="rounded-lg border border-theme-surface-border bg-theme-bg p-4">
              <div className="flex items-center gap-2 text-sm text-theme-text-secondary">
                <Target className="h-4 w-4" />
                Match Required
              </div>
              <p className="mt-1 text-xl font-bold text-theme-text-primary">
                {formatCurrency(application.matchAmount)}
              </p>
            </div>
            <div className="rounded-lg border border-theme-surface-border bg-theme-bg p-4">
              <div className="flex items-center gap-2 text-sm text-theme-text-secondary">
                <Calendar className="h-4 w-4" />
                Grant Period
              </div>
              <p className="mt-1 text-sm font-semibold text-theme-text-primary">
                {application.grantStartDate
                  ? formatDate(application.grantStartDate, tz)
                  : '--'}{' '}
                &mdash;{' '}
                {application.grantEndDate
                  ? formatDate(application.grantEndDate, tz)
                  : '--'}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Error display */}
      {error && (
        <div className="mx-auto max-w-7xl px-6 pt-4">
          <div className="flex items-center gap-3 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3">
            <AlertTriangle className="h-5 w-5 text-red-400" />
            <span className="text-sm text-red-300">{error}</span>
          </div>
        </div>
      )}

      {/* ================================================================== */}
      {/* Tabs                                                               */}
      {/* ================================================================== */}
      <div className="mx-auto max-w-7xl px-6 pt-6">
        <div className="flex space-x-1 overflow-x-auto rounded-lg border border-theme-surface-border bg-theme-surface p-1">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`flex flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-md px-4 py-2 text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? 'bg-red-600 text-white'
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
      <main className="mx-auto max-w-7xl px-6 py-6">
        {/* ---------------------------------------------------------------- */}
        {/* Overview Tab                                                     */}
        {/* ---------------------------------------------------------------- */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            {/* Project description */}
            <div className="rounded-lg border border-theme-surface-border bg-theme-surface p-6">
              <h3 className="text-lg font-semibold text-theme-text-primary">
                Project Description
              </h3>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-theme-text-secondary">
                {application.projectDescription ?? 'No description provided.'}
              </p>
            </div>

            {/* Narrative summary */}
            {application.narrativeSummary && (
              <div className="rounded-lg border border-theme-surface-border bg-theme-surface p-6">
                <h3 className="text-lg font-semibold text-theme-text-primary">
                  Narrative Summary
                </h3>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-theme-text-secondary">
                  {application.narrativeSummary}
                </p>
              </div>
            )}

            {/* Key contacts */}
            <div className="rounded-lg border border-theme-surface-border bg-theme-surface p-6">
              <h3 className="text-lg font-semibold text-theme-text-primary">
                Key Contacts
              </h3>
              <p className="mt-2 whitespace-pre-wrap text-sm text-theme-text-secondary">
                {application.keyContacts ?? 'No contacts recorded.'}
              </p>
            </div>

            {/* Key dates timeline */}
            <div className="rounded-lg border border-theme-surface-border bg-theme-surface p-6">
              <h3 className="mb-4 text-lg font-semibold text-theme-text-primary">
                Key Dates
              </h3>
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
                    className="flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-theme-surface-hover"
                  >
                    {item.icon}
                    <span className="w-40 text-sm font-medium text-theme-text-primary">
                      {item.label}
                    </span>
                    <span className="text-sm text-theme-text-secondary">
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
            <div className="grid grid-cols-3 gap-4">
              <div className="rounded-lg border border-theme-surface-border bg-theme-surface p-4 text-center">
                <p className="text-sm text-theme-text-secondary">Total Budgeted</p>
                <p className="mt-1 text-xl font-bold text-theme-text-primary">
                  {formatCurrencyPrecise(budgetTotal)}
                </p>
              </div>
              <div className="rounded-lg border border-theme-surface-border bg-theme-surface p-4 text-center">
                <p className="text-sm text-theme-text-secondary">Total Spent</p>
                <p className="mt-1 text-xl font-bold text-red-600">
                  {formatCurrencyPrecise(spentTotal)}
                </p>
              </div>
              <div className="rounded-lg border border-theme-surface-border bg-theme-surface p-4 text-center">
                <p className="text-sm text-theme-text-secondary">Remaining</p>
                <p
                  className={`mt-1 text-xl font-bold ${remainingTotal >= 0 ? 'text-green-600' : 'text-red-600'}`}
                >
                  {formatCurrencyPrecise(remainingTotal)}
                </p>
              </div>
            </div>

            {/* Add button */}
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setShowBudgetModal(true)}
                className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 transition-colors"
              >
                <Plus className="h-4 w-4" />
                Add Item
              </button>
            </div>

            {/* Budget table */}
            <div className="overflow-hidden rounded-lg border border-theme-surface-border bg-theme-surface">
              {budgetItems.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12">
                  <Wallet className="mb-3 h-12 w-12 text-theme-text-secondary opacity-40" />
                  <p className="text-theme-text-secondary">
                    No budget items yet
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-theme-surface-border">
                        <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-theme-text-secondary">
                          Category
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-theme-text-secondary">
                          Description
                        </th>
                        <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-theme-text-secondary">
                          Budgeted
                        </th>
                        <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-theme-text-secondary">
                          Spent
                        </th>
                        <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-theme-text-secondary">
                          Remaining
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-theme-text-secondary">
                          Progress
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-theme-surface-border">
                      {budgetItems.map((item) => {
                        const remaining =
                          item.amountBudgeted - item.amountSpent;
                        const percent =
                          item.amountBudgeted > 0
                            ? Math.min(
                                (item.amountSpent / item.amountBudgeted) * 100,
                                100,
                              )
                            : 0;
                        const isOver = item.amountSpent > item.amountBudgeted;
                        return (
                          <tr key={item.id}>
                            <td className="whitespace-nowrap px-4 py-3 text-sm font-medium text-theme-text-primary">
                              {item.category}
                            </td>
                            <td className="px-4 py-3 text-sm text-theme-text-secondary">
                              {item.description}
                            </td>
                            <td className="whitespace-nowrap px-4 py-3 text-right text-sm text-theme-text-primary">
                              {formatCurrencyPrecise(item.amountBudgeted)}
                            </td>
                            <td className="whitespace-nowrap px-4 py-3 text-right text-sm text-theme-text-primary">
                              {formatCurrencyPrecise(item.amountSpent)}
                            </td>
                            <td
                              className={`whitespace-nowrap px-4 py-3 text-right text-sm font-medium ${isOver ? 'text-red-600' : 'text-green-600'}`}
                            >
                              {formatCurrencyPrecise(remaining)}
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                <div className="h-2 w-24 overflow-hidden rounded-full bg-gray-200">
                                  <div
                                    className={`h-full rounded-full transition-all ${isOver ? 'bg-red-500' : 'bg-green-500'}`}
                                    style={{ width: `${percent}%` }}
                                  />
                                </div>
                                <span className="text-xs text-theme-text-secondary">
                                  {Math.round(percent)}%
                                </span>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                      {/* Total row */}
                      <tr className="bg-theme-surface-secondary font-semibold">
                        <td className="px-4 py-3 text-sm text-theme-text-primary">
                          Total
                        </td>
                        <td className="px-4 py-3" />
                        <td className="whitespace-nowrap px-4 py-3 text-right text-sm text-theme-text-primary">
                          {formatCurrencyPrecise(budgetTotal)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-right text-sm text-theme-text-primary">
                          {formatCurrencyPrecise(spentTotal)}
                        </td>
                        <td
                          className={`whitespace-nowrap px-4 py-3 text-right text-sm ${remainingTotal >= 0 ? 'text-green-600' : 'text-red-600'}`}
                        >
                          {formatCurrencyPrecise(remainingTotal)}
                        </td>
                        <td className="px-4 py-3" />
                      </tr>
                    </tbody>
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
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-theme-text-primary">
                Expenditures
              </h3>
              <button
                type="button"
                onClick={() => setShowExpenditureModal(true)}
                className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 transition-colors"
              >
                <Plus className="h-4 w-4" />
                Record Expenditure
              </button>
            </div>

            <div className="overflow-hidden rounded-lg border border-theme-surface-border bg-theme-surface">
              {expenditures.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12">
                  <Receipt className="mb-3 h-12 w-12 text-theme-text-secondary opacity-40" />
                  <p className="text-theme-text-secondary">
                    No expenditures recorded
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-theme-surface-border">
                        <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-theme-text-secondary">
                          Date
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-theme-text-secondary">
                          Description
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-theme-text-secondary">
                          Vendor
                        </th>
                        <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-theme-text-secondary">
                          Amount
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-theme-text-secondary">
                          Budget Category
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-theme-text-secondary">
                          Receipt
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-theme-surface-border">
                      {expenditures.map((exp) => {
                        const linkedBudgetItem = budgetItems.find(
                          (b) => b.id === exp.budgetItemId,
                        );
                        return (
                          <tr
                            key={exp.id}
                            className="transition-colors hover:bg-theme-surface-hover"
                          >
                            <td className="whitespace-nowrap px-4 py-3 text-sm text-theme-text-primary">
                              {formatDate(exp.expenditureDate, tz)}
                            </td>
                            <td className="px-4 py-3 text-sm text-theme-text-primary">
                              {exp.description}
                            </td>
                            <td className="whitespace-nowrap px-4 py-3 text-sm text-theme-text-secondary">
                              {exp.vendor ?? '--'}
                            </td>
                            <td className="whitespace-nowrap px-4 py-3 text-right text-sm font-semibold text-theme-text-primary">
                              {formatCurrencyPrecise(exp.amount)}
                            </td>
                            <td className="whitespace-nowrap px-4 py-3 text-sm text-theme-text-secondary">
                              {linkedBudgetItem
                                ? linkedBudgetItem.category
                                : '--'}
                            </td>
                            <td className="whitespace-nowrap px-4 py-3 text-sm">
                              {exp.receiptUrl ? (
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
                                <span className="text-theme-text-secondary">
                                  --
                                </span>
                              )}
                            </td>
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
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-theme-text-primary">
                Compliance & Follow-Up Tasks
              </h3>
              <button
                type="button"
                onClick={() => setShowComplianceModal(true)}
                className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 transition-colors"
              >
                <Plus className="h-4 w-4" />
                Add Task
              </button>
            </div>

            {complianceTasks.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-lg border border-theme-surface-border bg-theme-surface py-12">
                <ClipboardCheck className="mb-3 h-12 w-12 text-theme-text-secondary opacity-40" />
                <p className="text-theme-text-secondary">
                  No compliance tasks yet
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {complianceTasks.map((task) => (
                  <div
                    key={task.id}
                    className="rounded-lg border border-theme-surface-border bg-theme-surface p-4"
                  >
                    <div className="flex items-start gap-4">
                      {/* Type icon */}
                      <div className="mt-0.5 flex-shrink-0">
                        {COMPLIANCE_TASK_TYPE_ICONS[task.taskType] ?? (
                          <Info className="h-5 w-5 text-theme-text-secondary" />
                        )}
                      </div>

                      {/* Content */}
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h4 className="text-sm font-semibold text-theme-text-primary">
                            {task.title}
                          </h4>
                          <span
                            className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${PRIORITY_COLORS[task.priority] ?? 'bg-gray-100 text-gray-700'}`}
                          >
                            {PRIORITY_LABELS[task.priority] ?? task.priority}
                          </span>
                          <span className="text-xs text-theme-text-secondary">
                            {COMPLIANCE_TASK_TYPE_LABELS[task.taskType] ??
                              task.taskType}
                          </span>
                        </div>

                        {task.description && (
                          <p className="mt-1 text-sm text-theme-text-secondary">
                            {task.description}
                          </p>
                        )}

                        <div className="mt-2 flex flex-wrap items-center gap-4 text-xs">
                          <span className={getDueDateClasses(task.dueDate)}>
                            Due: {formatDate(task.dueDate, tz)}
                          </span>
                          {task.assignedTo && (
                            <span className="text-theme-text-secondary">
                              Assigned: {task.assignedTo}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Status dropdown + mark complete */}
                      <div className="flex flex-shrink-0 items-center gap-2">
                        <select
                          value={task.status}
                          onChange={(e) =>
                            void handleChangeTaskStatus(
                              task.id,
                              e.target.value as ComplianceTaskStatus,
                            )
                          }
                          className={`rounded-full border-0 px-2.5 py-0.5 text-xs font-medium focus:outline-none focus:ring-2 focus:ring-red-500 ${COMPLIANCE_STATUS_COLORS[task.status] ?? 'bg-gray-100 text-gray-800'}`}
                        >
                          {Object.entries(COMPLIANCE_STATUS_LABELS).map(
                            ([value, label]) => (
                              <option key={value} value={value}>
                                {label}
                              </option>
                            ),
                          )}
                        </select>

                        {task.status !== ComplianceTaskStatusEnum.COMPLETED && (
                          <button
                            type="button"
                            onClick={() =>
                              void handleMarkTaskComplete(task.id)
                            }
                            className="inline-flex items-center gap-1 rounded-lg border border-green-500/30 bg-green-500/10 px-3 py-1.5 text-xs font-medium text-green-700 hover:bg-green-500/20 transition-colors"
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            Mark Complete
                          </button>
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
            <h3 className="text-lg font-semibold text-theme-text-primary">
              Activity Log
            </h3>

            {/* Timeline */}
            {grantNotes.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-lg border border-theme-surface-border bg-theme-surface py-12">
                <MessageSquare className="mb-3 h-12 w-12 text-theme-text-secondary opacity-40" />
                <p className="text-theme-text-secondary">No activity yet</p>
              </div>
            ) : (
              <div className="space-y-0">
                {grantNotes.map((note, index) => (
                  <div key={note.id} className="flex gap-4">
                    {/* Timeline line + icon */}
                    <div className="flex flex-col items-center">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full border border-theme-surface-border bg-theme-surface">
                        {NOTE_TYPE_ICONS[note.noteType] ?? (
                          <MessageSquare className="h-4 w-4 text-theme-text-secondary" />
                        )}
                      </div>
                      {index < grantNotes.length - 1 && (
                        <div className="w-px flex-1 bg-theme-surface-border" />
                      )}
                    </div>

                    {/* Content */}
                    <div className="mb-6 min-w-0 flex-1 pb-2">
                      <p className="text-sm text-theme-text-primary">
                        {note.content}
                      </p>
                      <div className="mt-1 flex items-center gap-2 text-xs text-theme-text-secondary">
                        {note.createdBy && <span>{note.createdBy}</span>}
                        {note.createdBy && <span>&middot;</span>}
                        <span>{formatDate(note.createdAt, tz)}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Add note */}
            <div className="rounded-lg border border-theme-surface-border bg-theme-surface p-4">
              <label htmlFor="new-note" className={labelClass}>
                Add Note
              </label>
              <textarea
                id="new-note"
                rows={3}
                value={newNoteContent}
                onChange={(e) => setNewNoteContent(e.target.value)}
                placeholder="Type your note here..."
                className={`${inputClass} resize-none`}
              />
              <div className="mt-3 flex justify-end">
                <button
                  type="button"
                  disabled={!newNoteContent.trim() || isSubmittingNote}
                  onClick={() => void handleAddNote()}
                  className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {isSubmittingNote ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Plus className="h-4 w-4" />
                  )}
                  Add Note
                </button>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* ================================================================== */}
      {/* Modals                                                             */}
      {/* ================================================================== */}

      {/* Add Budget Item Modal */}
      <Modal
        open={showBudgetModal}
        onClose={() => {
          setShowBudgetModal(false);
          resetBudgetForm();
        }}
        title="Add Budget Item"
      >
        <div className="space-y-4">
          <div>
            <label htmlFor="budget-category" className={labelClass}>
              Category
            </label>
            <select
              id="budget-category"
              value={budgetCategory}
              onChange={(e) => setBudgetCategory(e.target.value)}
              className={selectClass}
            >
              <option value="">Select category...</option>
              <option value="Personnel">Personnel</option>
              <option value="Equipment">Equipment</option>
              <option value="Supplies">Supplies</option>
              <option value="Travel">Travel</option>
              <option value="Training">Training</option>
              <option value="Contractual">Contractual</option>
              <option value="Construction">Construction</option>
              <option value="Indirect Costs">Indirect Costs</option>
              <option value="Other">Other</option>
            </select>
          </div>
          <div>
            <label htmlFor="budget-description" className={labelClass}>
              Description
            </label>
            <input
              id="budget-description"
              type="text"
              value={budgetDescription}
              onChange={(e) => setBudgetDescription(e.target.value)}
              placeholder="e.g., 10 sets of turnout gear"
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="budget-amount" className={labelClass}>
              Amount
            </label>
            <input
              id="budget-amount"
              type="number"
              min="0"
              step="0.01"
              value={budgetAmount}
              onChange={(e) => setBudgetAmount(e.target.value)}
              placeholder="0.00"
              className={inputClass}
            />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => {
                setShowBudgetModal(false);
                resetBudgetForm();
              }}
              className="rounded-lg border border-theme-surface-border px-4 py-2 text-sm font-medium text-theme-text-secondary hover:bg-theme-surface-hover transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!budgetCategory || !budgetDescription || !budgetAmount}
              onClick={() => void handleAddBudgetItem()}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Add Item
            </button>
          </div>
        </div>
      </Modal>

      {/* Record Expenditure Modal */}
      <Modal
        open={showExpenditureModal}
        onClose={() => {
          setShowExpenditureModal(false);
          resetExpenditureForm();
        }}
        title="Record Expenditure"
      >
        <div className="space-y-4">
          <div>
            <label htmlFor="exp-description" className={labelClass}>
              Description
            </label>
            <input
              id="exp-description"
              type="text"
              value={expenditureDescription}
              onChange={(e) => setExpenditureDescription(e.target.value)}
              placeholder="e.g., Purchase of SCBA units"
              className={inputClass}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="exp-amount" className={labelClass}>
                Amount
              </label>
              <input
                id="exp-amount"
                type="number"
                min="0"
                step="0.01"
                value={expenditureAmount}
                onChange={(e) => setExpenditureAmount(e.target.value)}
                placeholder="0.00"
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="exp-date" className={labelClass}>
                Date
              </label>
              <input
                id="exp-date"
                type="date"
                value={expenditureDate}
                onChange={(e) => setExpenditureDate(e.target.value)}
                className={inputClass}
              />
            </div>
          </div>
          <div>
            <label htmlFor="exp-vendor" className={labelClass}>
              Vendor
            </label>
            <input
              id="exp-vendor"
              type="text"
              value={expenditureVendor}
              onChange={(e) => setExpenditureVendor(e.target.value)}
              placeholder="Vendor name"
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="exp-invoice" className={labelClass}>
              Invoice / PO Number
            </label>
            <input
              id="exp-invoice"
              type="text"
              value={expenditureInvoice}
              onChange={(e) => setExpenditureInvoice(e.target.value)}
              placeholder="Optional"
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="exp-budget-item" className={labelClass}>
              Budget Category
            </label>
            <select
              id="exp-budget-item"
              value={expenditureBudgetItemId}
              onChange={(e) => setExpenditureBudgetItemId(e.target.value)}
              className={selectClass}
            >
              <option value="">Select budget item...</option>
              {budgetItems.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.category} - {item.description}
                </option>
              ))}
            </select>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => {
                setShowExpenditureModal(false);
                resetExpenditureForm();
              }}
              className="rounded-lg border border-theme-surface-border px-4 py-2 text-sm font-medium text-theme-text-secondary hover:bg-theme-surface-hover transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={
                !expenditureDescription ||
                !expenditureAmount ||
                !expenditureDate
              }
              onClick={() => void handleAddExpenditure()}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Record Expenditure
            </button>
          </div>
        </div>
      </Modal>

      {/* Add Compliance Task Modal */}
      <Modal
        open={showComplianceModal}
        onClose={() => {
          setShowComplianceModal(false);
          resetComplianceForm();
        }}
        title="Add Compliance Task"
      >
        <div className="space-y-4">
          <div>
            <label htmlFor="comp-type" className={labelClass}>
              Task Type
            </label>
            <select
              id="comp-type"
              value={complianceType}
              onChange={(e) =>
                setComplianceType(e.target.value as ComplianceTaskType)
              }
              className={selectClass}
            >
              {Object.entries(COMPLIANCE_TASK_TYPE_LABELS).map(
                ([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ),
              )}
            </select>
          </div>
          <div>
            <label htmlFor="comp-title" className={labelClass}>
              Title
            </label>
            <input
              id="comp-title"
              type="text"
              value={complianceTitle}
              onChange={(e) => setComplianceTitle(e.target.value)}
              placeholder="e.g., Q1 Performance Report"
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="comp-description" className={labelClass}>
              Description
            </label>
            <textarea
              id="comp-description"
              rows={2}
              value={complianceDescription}
              onChange={(e) => setComplianceDescription(e.target.value)}
              placeholder="Additional details..."
              className={`${inputClass} resize-none`}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="comp-due-date" className={labelClass}>
                Due Date
              </label>
              <input
                id="comp-due-date"
                type="date"
                value={complianceDueDate}
                onChange={(e) => setComplianceDueDate(e.target.value)}
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="comp-priority" className={labelClass}>
                Priority
              </label>
              <select
                id="comp-priority"
                value={compliancePriority}
                onChange={(e) =>
                  setCompliancePriority(e.target.value as GrantPriority)
                }
                className={selectClass}
              >
                {Object.entries(PRIORITY_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label htmlFor="comp-template" className={labelClass}>
              Report Template
            </label>
            <input
              id="comp-template"
              type="text"
              value={complianceReportTemplate}
              onChange={(e) => setComplianceReportTemplate(e.target.value)}
              placeholder="Template name or URL (optional)"
              className={inputClass}
            />
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => {
                setShowComplianceModal(false);
                resetComplianceForm();
              }}
              className="rounded-lg border border-theme-surface-border px-4 py-2 text-sm font-medium text-theme-text-secondary hover:bg-theme-surface-hover transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!complianceTitle || !complianceDueDate}
              onClick={() => void handleAddComplianceTask()}
              className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
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
