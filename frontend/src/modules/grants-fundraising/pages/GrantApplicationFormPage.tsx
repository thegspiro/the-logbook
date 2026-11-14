/**
 * Grant Application Form Page
 *
 * Form for creating or editing grant applications. Determines mode based
 * on the presence of an :id route parameter.
 */

import React, { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
import { ArrowLeft, Plus, Save, Trash2, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { grantsService } from '../services/api';
import type { GrantApplication, GrantOpportunity } from '../types';
import { ApplicationStatus, BUDGET_ITEM_CATEGORY_LABELS, GrantPriority } from '../types';
import {
  BUDGET_CATEGORY_ORDER,
  EMPTY_CONTACT_ROW,
  buildBudgetSummary,
  buildKeyContacts,
  budgetSummaryErrors,
  emptyBudgetAmounts,
  keyContactErrors,
  readBudgetSummary,
  readKeyContacts,
} from '../utils/applicationStructuredFields';
import type { BudgetAmounts, ContactRow } from '../utils/applicationStructuredFields';
import { getErrorMessage, toAppError } from '@/utils/errorHandling';
import { formCoercions } from '@/utils/formValues';
import { FormField } from '@/components/ux/FormField';
import { mapServerFieldErrors, type ServerFieldSpec } from '@/utils/serverFieldErrors';
import { displayNameOf } from '@/utils/memberName';
import { userService } from '@/services/api';
import type { User } from '@/types/user';

const inputClass = 'form-input';
const selectClass = inputClass;
const labelClass = 'form-label';

const APPLICATION_STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: ApplicationStatus.RESEARCHING, label: 'Researching' },
  { value: ApplicationStatus.PREPARING, label: 'Preparing' },
  { value: ApplicationStatus.INTERNAL_REVIEW, label: 'Internal Review' },
  { value: ApplicationStatus.SUBMITTED, label: 'Submitted' },
  { value: ApplicationStatus.UNDER_REVIEW, label: 'Under Review' },
  { value: ApplicationStatus.AWARDED, label: 'Awarded' },
  { value: ApplicationStatus.DENIED, label: 'Denied' },
  { value: ApplicationStatus.ACTIVE, label: 'Active' },
  { value: ApplicationStatus.REPORTING, label: 'Reporting' },
  { value: ApplicationStatus.CLOSED, label: 'Closed' },
];

const PRIORITY_OPTIONS: { value: string; label: string }[] = [
  { value: GrantPriority.LOW, label: 'Low' },
  { value: GrantPriority.MEDIUM, label: 'Medium' },
  { value: GrantPriority.HIGH, label: 'High' },
  { value: GrantPriority.CRITICAL, label: 'Critical' },
];

const REPORTING_FREQUENCY_OPTIONS: { value: string; label: string }[] = [
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'semi_annual', label: 'Semi-Annual' },
  { value: 'annual', label: 'Annual' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'other', label: 'Other' },
];

interface FormData {
  grantProgramName: string;
  grantAgency: string;
  opportunityId: string;
  applicationStatus: string;
  amountRequested: string;
  amountAwarded: string;
  matchAmount: string;
  matchSource: string;
  applicationDeadline: string;
  submittedDate: string;
  awardDate: string;
  grantStartDate: string;
  grantEndDate: string;
  projectDescription: string;
  narrativeSummary: string;
  federalAwardId: string;
  performancePeriodMonths: string;
  reportingFrequency: string;
  nextReportDue: string;
  finalReportDue: string;
  assignedTo: string;
  priority: string;
  notes: string;
}

/** `GrantApplicationCreate`'s max_length; the other text fields have none. */
const MAX_LENGTH: Partial<Record<keyof FormData, number>> = {
  grantProgramName: 255,
  grantAgency: 255,
  matchSource: 255,
  federalAwardId: 100,
};

/**
 * The fields as a 422 names them; each key is also its payload key. Grant
 * request schemas report the camelCase alias, and the mapper reads both
 * spellings. The budget and contacts are checked as a whole.
 */
const SERVER_FIELDS: Record<keyof FormData | 'budgetSummary' | 'keyContacts', ServerFieldSpec> = {
  grantProgramName: { label: 'Grant Program Name', maxLength: MAX_LENGTH.grantProgramName },
  grantAgency: { label: 'Grant Agency', maxLength: MAX_LENGTH.grantAgency },
  opportunityId: { label: 'Grant Opportunity' },
  applicationStatus: { label: 'Status' },
  amountRequested: { label: 'Amount Requested' },
  amountAwarded: { label: 'Amount Awarded' },
  matchAmount: { label: 'Match Amount' },
  matchSource: { label: 'Match Source', maxLength: MAX_LENGTH.matchSource },
  applicationDeadline: { label: 'Application Deadline' },
  submittedDate: { label: 'Submitted Date' },
  awardDate: { label: 'Award Date' },
  grantStartDate: { label: 'Grant Start Date' },
  grantEndDate: { label: 'Grant End Date' },
  projectDescription: { label: 'Project Description' },
  narrativeSummary: { label: 'Narrative Summary' },
  federalAwardId: { label: 'Federal Award ID', maxLength: MAX_LENGTH.federalAwardId },
  performancePeriodMonths: { label: 'Performance Period' },
  reportingFrequency: { label: 'Reporting Frequency' },
  nextReportDue: { label: 'Next Report Due' },
  finalReportDue: { label: 'Final Report Due' },
  assignedTo: { label: 'Assigned To' },
  priority: { label: 'Priority' },
  notes: { label: 'Notes' },
  budgetSummary: { label: 'Budget Summary' },
  keyContacts: { label: 'Key Contacts' },
};
type ServerField = keyof typeof SERVER_FIELDS;

/** Where to put focus for a field the server refused. */
const focusField = (field: ServerField | undefined) => {
  if (!field) return;
  const id = field === 'budgetSummary' ? 'budgetNotes' : field === 'keyContacts' ? null : field;
  if (id) document.getElementById(id)?.focus();
};

const EMPTY_FORM: FormData = {
  grantProgramName: '',
  grantAgency: '',
  opportunityId: '',
  applicationStatus: ApplicationStatus.RESEARCHING,
  amountRequested: '',
  amountAwarded: '',
  matchAmount: '',
  matchSource: '',
  applicationDeadline: '',
  submittedDate: '',
  awardDate: '',
  grantStartDate: '',
  grantEndDate: '',
  projectDescription: '',
  narrativeSummary: '',
  federalAwardId: '',
  performancePeriodMonths: '',
  reportingFrequency: '',
  nextReportDue: '',
  finalReportDue: '',
  assignedTo: '',
  priority: GrantPriority.MEDIUM,
  notes: '',
};

export const GrantApplicationFormPage: React.FC = () => {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isEditing = Boolean(id);
  const [searchParams] = useSearchParams();
  const [savedStatus, setSavedStatus] = useState<string | null>(null);
  // null until an existing application has loaded (and always on create,
  // where any starting status may be recorded).
  const [allowedNextStatuses, setAllowedNextStatuses] = useState<string[] | null>(null);
  const statusOptions =
    isEditing && savedStatus && allowedNextStatuses
      ? APPLICATION_STATUS_OPTIONS.filter((opt) => opt.value === savedStatus || allowedNextStatuses.includes(opt.value))
      : APPLICATION_STATUS_OPTIONS;
  // Read once at mount, not from state — the mount effect below needs this
  // exact value without re-running every time formData.opportunityId changes
  // (e.g. as the user picks a different one from the dropdown).
  const initialOpportunityIdRef = useRef(isEditing ? '' : (searchParams.get('opportunity_id') ?? ''));

  const [formData, setFormData] = useState<FormData>(() => ({
    ...EMPTY_FORM,
    opportunityId: initialOpportunityIdRef.current,
  }));
  const [opportunities, setOpportunities] = useState<GrantOpportunity[]>([]);
  const [members, setMembers] = useState<User[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  // Kept beside formData rather than in it: both are structured values, not
  // a single text box each (see utils/applicationStructuredFields).
  const [budgetAmounts, setBudgetAmounts] = useState<BudgetAmounts>(emptyBudgetAmounts);
  const [budgetNotes, setBudgetNotes] = useState('');
  const [contactRows, setContactRows] = useState<ContactRow[]>([]);

  // Load opportunities for the select dropdown
  useEffect(() => {
    const loadOpportunities = async () => {
      try {
        const data = await grantsService.listOpportunities();
        const linkedId = initialOpportunityIdRef.current;
        // An org with more than 100 opportunities may have linked one from
        // outside this unfiltered first page (the opportunities page's own
        // search/filter can reach it, this dropdown's default fetch can't).
        // Fetch it directly so the "Apply" flow's link stays visible and
        // selected instead of silently showing "-- None --".
        if (linkedId && !data.some((opp) => opp.id === linkedId)) {
          try {
            const linked = await grantsService.getOpportunity(linkedId);
            setOpportunities([linked, ...data]);
            return;
          } catch (err: unknown) {
            // A 404 means the id is stale/foreign — fall through silently,
            // matching "no opportunity selected". Any other failure (a
            // network blip, a 500) is not the same thing: leaving the
            // dropdown on "-- None --" while formData.opportunityId still
            // held the id would submit an id the user can no longer see.
            // Clear it so what's displayed is what would be sent, and say
            // why for anything other than "it doesn't exist".
            if (toAppError(err).status !== 404) {
              toast.error(
                'Could not load the linked grant opportunity. Select it again from the Grant Opportunity list.'
              );
            }
            setFormData((prev) => ({ ...prev, opportunityId: '' }));
          }
        }
        setOpportunities(data);
      } catch {
        // Silently fail — the dropdown will just be empty
      }
    };
    void loadOpportunities();
  }, []);

  // Members for the Assigned To picker. The backend stores a member id and
  // refuses one outside the organization, so a name typed into a box can
  // never be saved.
  useEffect(() => {
    void userService
      .getUsers()
      .then(setMembers)
      .catch(() => {
        toast.error('Could not load members for the Assigned To list.');
      });
  }, []);

  // Load existing application when editing
  useEffect(() => {
    if (isEditing && id) {
      const loadApplication = async () => {
        try {
          setIsLoading(true);
          const app: GrantApplication = await grantsService.getApplication(id);
          // GF-7: the statuses this grant may move to come from the server's
          // lifecycle; the picker offers those plus where it is now.
          setSavedStatus(app.applicationStatus);
          setAllowedNextStatuses(app.allowedNextStatuses ?? null);
          setFormData({
            grantProgramName: app.grantProgramName,
            grantAgency: app.grantAgency,
            opportunityId: app.opportunityId ?? '',
            applicationStatus: app.applicationStatus,
            amountRequested: app.amountRequested != null ? String(app.amountRequested) : '',
            amountAwarded: app.amountAwarded != null ? String(app.amountAwarded) : '',
            matchAmount: app.matchAmount != null ? String(app.matchAmount) : '',
            matchSource: app.matchSource ?? '',
            applicationDeadline: app.applicationDeadline?.split('T')[0] ?? '',
            submittedDate: app.submittedDate?.split('T')[0] ?? '',
            awardDate: app.awardDate?.split('T')[0] ?? '',
            grantStartDate: app.grantStartDate?.split('T')[0] ?? '',
            grantEndDate: app.grantEndDate?.split('T')[0] ?? '',
            projectDescription: app.projectDescription ?? '',
            narrativeSummary: app.narrativeSummary ?? '',
            federalAwardId: app.federalAwardId ?? '',
            performancePeriodMonths: app.performancePeriodMonths != null ? String(app.performancePeriodMonths) : '',
            reportingFrequency: app.reportingFrequency ?? '',
            nextReportDue: app.nextReportDue?.split('T')[0] ?? '',
            finalReportDue: app.finalReportDue?.split('T')[0] ?? '',
            assignedTo: app.assignedTo ?? '',
            priority: app.priority,
            notes: app.notes ?? '',
          });
          const budget = readBudgetSummary(app.budgetSummary);
          setBudgetAmounts(budget.amounts);
          setBudgetNotes(budget.notes);
          setContactRows(readKeyContacts(app.keyContacts));
        } catch {
          toast.error('Failed to load application.');
        } finally {
          setIsLoading(false);
        }
      };
      void loadApplication();
    }
  }, [isEditing, id]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    if (errors[name]) {
      setErrors((prev) => {
        const next = { ...prev };
        delete next[name];
        return next;
      });
    }
  };

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};
    if (!formData.grantProgramName.trim()) {
      newErrors.grantProgramName = 'Enter the grant program name';
    }
    if (!formData.grantAgency.trim()) {
      newErrors.grantAgency = 'Enter the grant agency';
    }
    const budgetError = budgetSummaryErrors(budgetAmounts);
    if (budgetError) newErrors.budgetSummary = budgetError;
    const contactError = keyContactErrors(contactRows);
    if (contactError) newErrors.keyContacts = contactError;
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) {
      toast.error('Fill in the required fields marked below.');
      return;
    }
    setIsSubmitting(true);

    // A blank Amount Awarded is omitted on create but sent as null on edit,
    // so clearing a recorded award actually clears it (the update endpoint
    // treats an omitted key as "leave unchanged").
    const coerce = formCoercions(isEditing);
    const amountAwarded = coerce.num(formData.amountAwarded);
    // Omitted on create when nobody is picked; null on edit so choosing
    // "Unassigned" clears the stored member.
    const assignedTo = coerce.pick(formData.assignedTo);
    const payload: Partial<GrantApplication> = {
      grantProgramName: formData.grantProgramName,
      grantAgency: formData.grantAgency,
      opportunityId: formData.opportunityId || null,
      applicationStatus: formData.applicationStatus as GrantApplication['applicationStatus'],
      amountRequested: formData.amountRequested ? Number(formData.amountRequested) : null,
      ...(amountAwarded !== undefined && { amountAwarded }),
      matchAmount: formData.matchAmount ? Number(formData.matchAmount) : null,
      matchSource: formData.matchSource || null,
      applicationDeadline: formData.applicationDeadline || null,
      submittedDate: formData.submittedDate || null,
      awardDate: formData.awardDate || null,
      grantStartDate: formData.grantStartDate || null,
      grantEndDate: formData.grantEndDate || null,
      projectDescription: formData.projectDescription || null,
      narrativeSummary: formData.narrativeSummary || null,
      budgetSummary: buildBudgetSummary(budgetAmounts, budgetNotes),
      keyContacts: buildKeyContacts(contactRows),
      federalAwardId: formData.federalAwardId || null,
      performancePeriodMonths: formData.performancePeriodMonths ? Number(formData.performancePeriodMonths) : null,
      reportingFrequency: formData.reportingFrequency || null,
      nextReportDue: formData.nextReportDue || null,
      finalReportDue: formData.finalReportDue || null,
      ...(assignedTo !== undefined && { assignedTo }),
      priority: formData.priority as GrantApplication['priority'],
      notes: formData.notes || null,
    };

    try {
      if (isEditing && id) {
        let refused: Partial<Record<ServerField, string>> = {};
        try {
          await grantsService.updateApplication(id, payload);
        } catch (err: unknown) {
          // Owner rule (2026-11-05) for a single-save form: a value the
          // application cannot hold is not written, the rest saves, and the
          // field keeps what was typed, flagged, until it is fixed. Anything
          // the form has no field for is a real failure and is reported as one.
          const mapped = mapServerFieldErrors(err, SERVER_FIELDS);
          const keys = Object.keys(mapped?.fieldErrors ?? {}) as ServerField[];
          if (!mapped || keys.length === 0 || mapped.unmatched.length > 0) throw err;
          refused = mapped.fieldErrors;
          const rest: Partial<GrantApplication> = { ...payload };
          for (const key of keys) delete rest[key];
          await grantsService.updateApplication(id, rest);
        }
        const firstRefused = (Object.keys(refused) as ServerField[])[0];
        if (firstRefused) {
          // Stays on the page, so the refused field can be fixed and saved again.
          setErrors(refused);
          toast.error(
            `Application saved, except ${SERVER_FIELDS[firstRefused].label.toLowerCase()}: ${refused[firstRefused] ?? ''} Fix it and save again.`
          );
          focusField(firstRefused);
          return;
        }
        toast.success('Application updated.');
        void navigate(`/grants/applications/${id}`);
      } else {
        const created = await grantsService.createApplication(payload);
        toast.success('Application created.');
        void navigate(`/grants/applications/${created.id}`);
      }
    } catch (err: unknown) {
      // A new application is created only once nothing is refused, so each
      // refusal goes on its field (forms review F-2).
      const mapped = isEditing ? null : mapServerFieldErrors(err, SERVER_FIELDS);
      const keys = Object.keys(mapped?.fieldErrors ?? {}) as ServerField[];
      if (mapped && keys[0]) {
        setErrors(mapped.fieldErrors);
        focusField(keys[0]);
        if (mapped.unmatched.length > 0) toast.error(mapped.unmatched.join(' '));
        return;
      }
      toast.error(getErrorMessage(err, 'Failed to save application. Try again.'));
    } finally {
      setIsSubmitting(false);
    }
  };

  const fieldError = (name: keyof FormData): string | undefined => errors[name];

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16" role="status" aria-live="polite">
        <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-red-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <button
          type="button"
          aria-label="Back to applications"
          onClick={() => void navigate('/grants/applications')}
          className="text-theme-text-muted hover:bg-theme-surface-hover hover:text-theme-text-primary touch-target-phone rounded-lg p-2 transition-colors"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div>
          <h1 className="text-theme-text-primary text-xl font-bold">
            {isEditing ? 'Edit Application' : 'New Grant Application'}
          </h1>
          <p className="text-theme-text-muted text-sm">
            {isEditing
              ? 'Update the details of this application'
              : 'Only the program name and agency are required. You can add the rest later.'}
          </p>
        </div>
      </div>

      <form
        onSubmit={(e) => {
          void handleSubmit(e);
        }}
        className="space-y-6"
      >
        {/* Program Information */}
        <div className="card p-6">
          <h2 className="text-theme-text-primary mb-4 font-semibold">Program Information</h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <FormField
              id="grantProgramName"
              label="Grant Program Name"
              error={fieldError('grantProgramName')}
              required
              maxLength={MAX_LENGTH.grantProgramName}
              count={MAX_LENGTH.grantProgramName ? formData.grantProgramName.length : undefined}
            >
              {(field) => (
                <input
                  {...field}
                  name="grantProgramName"
                  type="text"
                  value={formData.grantProgramName}
                  onChange={handleChange}
                  className={inputClass}
                  placeholder="e.g. Assistance to Firefighters Grant"
                />
              )}
            </FormField>
            <FormField
              id="grantAgency"
              label="Grant Agency"
              error={fieldError('grantAgency')}
              required
              maxLength={MAX_LENGTH.grantAgency}
              count={MAX_LENGTH.grantAgency ? formData.grantAgency.length : undefined}
            >
              {(field) => (
                <input
                  {...field}
                  name="grantAgency"
                  type="text"
                  value={formData.grantAgency}
                  onChange={handleChange}
                  className={inputClass}
                  placeholder="e.g. FEMA"
                />
              )}
            </FormField>
            <FormField id="opportunityId" label="Grant Opportunity" error={fieldError('opportunityId')}>
              {(field) => (
                <select
                  {...field}
                  name="opportunityId"
                  value={formData.opportunityId}
                  onChange={handleChange}
                  className={selectClass}
                >
                  <option value="">-- None --</option>
                  {opportunities.map((opp) => (
                    <option key={opp.id} value={opp.id}>
                      {opp.name} ({opp.agency})
                    </option>
                  ))}
                </select>
              )}
            </FormField>
            <FormField
              id="applicationStatus"
              label="Application Status"
              error={fieldError('applicationStatus')}
              hint={isEditing && allowedNextStatuses?.length === 0 ? 'This status is final.' : undefined}
            >
              {(field) => (
                <select
                  {...field}
                  name="applicationStatus"
                  value={formData.applicationStatus}
                  onChange={handleChange}
                  className={selectClass}
                >
                  {statusOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              )}
            </FormField>
            <FormField id="priority" label="Priority" error={fieldError('priority')}>
              {(field) => (
                <select
                  {...field}
                  name="priority"
                  value={formData.priority}
                  onChange={handleChange}
                  className={selectClass}
                >
                  {PRIORITY_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              )}
            </FormField>
            <FormField id="assignedTo" label="Assigned To" error={fieldError('assignedTo')}>
              {(field) => (
                <select
                  {...field}
                  name="assignedTo"
                  value={formData.assignedTo}
                  onChange={handleChange}
                  className={selectClass}
                >
                  <option value="">Unassigned</option>
                  {/* Keeps a stored assignee who is no longer on the member
                    list selectable, so saving does not silently swap them
                    for whichever option the browser shows first. */}
                  {formData.assignedTo && !members.some((member) => member.id === formData.assignedTo) && (
                    <option value={formData.assignedTo}>Current assignee</option>
                  )}
                  {members.map((member) => (
                    <option key={member.id} value={member.id}>
                      {displayNameOf(member) || member.username}
                    </option>
                  ))}
                </select>
              )}
            </FormField>
          </div>
        </div>

        {/* Funding Details */}
        <div className="card p-6">
          <h2 className="text-theme-text-primary mb-4 font-semibold">Funding Details</h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <FormField id="amountRequested" label="Amount Requested" error={fieldError('amountRequested')}>
              {(field) => (
                <input
                  {...field}
                  name="amountRequested"
                  type="number"
                  min="0"
                  step="0.01"
                  value={formData.amountRequested}
                  onChange={handleChange}
                  className={inputClass}
                  placeholder="0.00"
                />
              )}
            </FormField>
            <FormField id="amountAwarded" label="Amount Awarded" error={fieldError('amountAwarded')}>
              {(field) => (
                <input
                  {...field}
                  name="amountAwarded"
                  type="number"
                  min="0"
                  step="0.01"
                  value={formData.amountAwarded}
                  onChange={handleChange}
                  className={inputClass}
                  placeholder="0.00"
                />
              )}
            </FormField>
            <FormField id="matchAmount" label="Match Amount" error={fieldError('matchAmount')}>
              {(field) => (
                <input
                  {...field}
                  name="matchAmount"
                  type="number"
                  min="0"
                  step="0.01"
                  value={formData.matchAmount}
                  onChange={handleChange}
                  className={inputClass}
                  placeholder="0.00"
                />
              )}
            </FormField>
            <FormField
              id="matchSource"
              label="Match Source"
              error={fieldError('matchSource')}
              maxLength={MAX_LENGTH.matchSource}
              count={MAX_LENGTH.matchSource ? formData.matchSource.length : undefined}
            >
              {(field) => (
                <input
                  {...field}
                  name="matchSource"
                  type="text"
                  value={formData.matchSource}
                  onChange={handleChange}
                  className={inputClass}
                  placeholder="e.g. Municipal budget"
                />
              )}
            </FormField>
            <FormField
              id="federalAwardId"
              label="Federal Award ID"
              error={fieldError('federalAwardId')}
              maxLength={MAX_LENGTH.federalAwardId}
              count={MAX_LENGTH.federalAwardId ? formData.federalAwardId.length : undefined}
            >
              {(field) => (
                <input
                  {...field}
                  name="federalAwardId"
                  type="text"
                  value={formData.federalAwardId}
                  onChange={handleChange}
                  className={inputClass}
                  placeholder="e.g. EMW-2025-FO-00123"
                />
              )}
            </FormField>
          </div>
        </div>

        {/* Dates */}
        <div className="card p-6">
          <h2 className="text-theme-text-primary mb-4 font-semibold">Dates</h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <FormField id="applicationDeadline" label="Application Deadline" error={fieldError('applicationDeadline')}>
              {(field) => (
                <input
                  {...field}
                  name="applicationDeadline"
                  type="date"
                  value={formData.applicationDeadline}
                  onChange={handleChange}
                  className={inputClass}
                />
              )}
            </FormField>
            <FormField id="submittedDate" label="Submitted" error={fieldError('submittedDate')}>
              {(field) => (
                <input
                  {...field}
                  name="submittedDate"
                  type="date"
                  value={formData.submittedDate}
                  onChange={handleChange}
                  className={inputClass}
                />
              )}
            </FormField>
            <FormField id="awardDate" label="Award Date" error={fieldError('awardDate')}>
              {(field) => (
                <input
                  {...field}
                  name="awardDate"
                  type="date"
                  value={formData.awardDate}
                  onChange={handleChange}
                  className={inputClass}
                />
              )}
            </FormField>
            <FormField id="grantStartDate" label="Grant Start Date" error={fieldError('grantStartDate')}>
              {(field) => (
                <input
                  {...field}
                  name="grantStartDate"
                  type="date"
                  value={formData.grantStartDate}
                  onChange={handleChange}
                  className={inputClass}
                />
              )}
            </FormField>
            <FormField id="grantEndDate" label="Grant End Date" error={fieldError('grantEndDate')}>
              {(field) => (
                <input
                  {...field}
                  name="grantEndDate"
                  type="date"
                  value={formData.grantEndDate}
                  onChange={handleChange}
                  className={inputClass}
                />
              )}
            </FormField>
            <FormField
              id="performancePeriodMonths"
              label="Performance Period (months)"
              error={fieldError('performancePeriodMonths')}
            >
              {(field) => (
                <input
                  {...field}
                  name="performancePeriodMonths"
                  type="number"
                  min="0"
                  value={formData.performancePeriodMonths}
                  onChange={handleChange}
                  className={inputClass}
                  placeholder="12"
                />
              )}
            </FormField>
          </div>
        </div>

        {/* Reporting */}
        <div className="card p-6">
          <h2 className="text-theme-text-primary mb-4 font-semibold">Reporting</h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <FormField id="reportingFrequency" label="Reporting Frequency" error={fieldError('reportingFrequency')}>
              {(field) => (
                <select
                  {...field}
                  name="reportingFrequency"
                  value={formData.reportingFrequency}
                  onChange={handleChange}
                  className={selectClass}
                >
                  <option value="">Select frequency</option>
                  {REPORTING_FREQUENCY_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              )}
            </FormField>
            <FormField id="nextReportDue" label="Next Report Due" error={fieldError('nextReportDue')}>
              {(field) => (
                <input
                  {...field}
                  name="nextReportDue"
                  type="date"
                  value={formData.nextReportDue}
                  onChange={handleChange}
                  className={inputClass}
                />
              )}
            </FormField>
            <FormField id="finalReportDue" label="Final Report Due" error={fieldError('finalReportDue')}>
              {(field) => (
                <input
                  {...field}
                  name="finalReportDue"
                  type="date"
                  value={formData.finalReportDue}
                  onChange={handleChange}
                  className={inputClass}
                />
              )}
            </FormField>
          </div>
        </div>

        {/* Project Details */}
        <div className="card p-6">
          <h2 className="text-theme-text-primary mb-4 font-semibold">Project Details</h2>
          <div className="space-y-4">
            <FormField id="projectDescription" label="Project Description" error={fieldError('projectDescription')}>
              {(field) => (
                <textarea
                  {...field}
                  name="projectDescription"
                  rows={4}
                  value={formData.projectDescription}
                  onChange={handleChange}
                  className={inputClass}
                  placeholder="Describe the project this grant will fund..."
                />
              )}
            </FormField>
            <FormField id="narrativeSummary" label="Narrative Summary" error={fieldError('narrativeSummary')}>
              {(field) => (
                <textarea
                  {...field}
                  name="narrativeSummary"
                  rows={4}
                  value={formData.narrativeSummary}
                  onChange={handleChange}
                  className={inputClass}
                  placeholder="Executive summary of the grant narrative..."
                />
              )}
            </FormField>
            <fieldset>
              <legend className={labelClass}>Budget Summary</legend>
              <p className="text-theme-text-muted mb-2 text-xs">
                How much of the request goes to each budget category. Leave a category blank if it does not apply.
              </p>
              <div className="field-grid gap-3">
                {BUDGET_CATEGORY_ORDER.map((category) => (
                  <div key={category}>
                    <label htmlFor={`budget-${category}`} className="text-theme-text-secondary mb-1 block text-xs">
                      {BUDGET_ITEM_CATEGORY_LABELS[category]} ($)
                    </label>
                    <input
                      id={`budget-${category}`}
                      type="number"
                      min="0"
                      step="0.01"
                      inputMode="decimal"
                      value={budgetAmounts[category]}
                      onChange={(e) => {
                        const value = e.target.value;
                        setBudgetAmounts((prev) => ({ ...prev, [category]: value }));
                      }}
                      className={inputClass}
                    />
                  </div>
                ))}
              </div>
              <label htmlFor="budgetNotes" className="text-theme-text-secondary mt-3 mb-1 block text-xs">
                Budget notes
              </label>
              <textarea
                id="budgetNotes"
                rows={2}
                value={budgetNotes}
                onChange={(e) => setBudgetNotes(e.target.value)}
                className={inputClass}
              />
              {errors.budgetSummary && (
                <p role="alert" className="mt-1 text-sm text-red-800 dark:text-red-300">
                  {errors.budgetSummary}
                </p>
              )}
            </fieldset>
            <fieldset>
              <legend className={labelClass}>Key Contacts</legend>
              {contactRows.length === 0 && <p className="text-theme-text-muted mb-2 text-xs">No contacts added.</p>}
              <div className="space-y-3">
                {contactRows.map((row, index) => {
                  const update = (field: keyof ContactRow, value: string) =>
                    setContactRows((prev) => prev.map((r, i) => (i === index ? { ...r, [field]: value } : r)));
                  return (
                    <div
                      key={index}
                      className="border-theme-surface-border grid grid-cols-1 gap-2 rounded-lg border p-3 sm:grid-cols-[repeat(4,minmax(0,1fr))_auto]"
                    >
                      <input
                        aria-label={`Contact ${index + 1} name`}
                        placeholder="Name"
                        value={row.name}
                        onChange={(e) => update('name', e.target.value)}
                        className={inputClass}
                      />
                      <input
                        aria-label={`Contact ${index + 1} role`}
                        placeholder="Role"
                        value={row.role}
                        onChange={(e) => update('role', e.target.value)}
                        className={inputClass}
                      />
                      <input
                        aria-label={`Contact ${index + 1} phone`}
                        placeholder="Phone"
                        type="tel"
                        value={row.phone}
                        onChange={(e) => update('phone', e.target.value)}
                        className={inputClass}
                      />
                      <input
                        aria-label={`Contact ${index + 1} email`}
                        placeholder="Email"
                        type="email"
                        value={row.email}
                        onChange={(e) => update('email', e.target.value)}
                        className={inputClass}
                      />
                      <button
                        type="button"
                        onClick={() => setContactRows((prev) => prev.filter((_, i) => i !== index))}
                        aria-label={`Remove contact ${index + 1}`}
                        className="btn-icon text-theme-text-muted hover:text-red-700"
                      >
                        <Trash2 className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>
                  );
                })}
              </div>
              <button
                type="button"
                onClick={() => setContactRows((prev) => [...prev, { ...EMPTY_CONTACT_ROW }])}
                className="text-theme-text-secondary hover:text-theme-text-primary mt-2 inline-flex items-center gap-1 text-sm font-medium"
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
                Add contact
              </button>
              {errors.keyContacts && (
                <p role="alert" className="mt-1 text-sm text-red-800 dark:text-red-300">
                  {errors.keyContacts}
                </p>
              )}
            </fieldset>
            <FormField id="notes" label="Notes" error={fieldError('notes')}>
              {(field) => (
                <textarea
                  {...field}
                  name="notes"
                  rows={3}
                  value={formData.notes}
                  onChange={handleChange}
                  className={inputClass}
                  placeholder="Internal notes about this application..."
                />
              )}
            </FormField>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={() => void navigate('/grants/applications')}
            className="bg-theme-surface-hover text-theme-text-primary hover:bg-theme-surface touch:min-h-11 inline-flex items-center gap-2 rounded-lg px-6 py-2.5 text-sm font-medium transition-colors"
          >
            <X className="h-4 w-4" />
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className="touch:min-h-11 inline-flex items-center gap-2 rounded-lg bg-red-800 px-6 py-2.5 text-sm font-medium text-white transition-colors hover:bg-red-900 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Save className="h-4 w-4" />
            {isSubmitting ? 'Saving...' : isEditing ? 'Save Changes' : 'Create Application'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default GrantApplicationFormPage;
