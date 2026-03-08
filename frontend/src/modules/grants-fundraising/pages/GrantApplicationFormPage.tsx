/**
 * Grant Application Form Page
 *
 * Form for creating or editing grant applications. Determines mode based
 * on the presence of an :id route parameter.
 */

import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Save, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { grantsService } from '../services/api';
import type { GrantApplication, GrantOpportunity } from '../types';
import { ApplicationStatus, GrantPriority } from '../types';

const inputClass =
  'w-full rounded-lg border border-theme-input-border bg-theme-input-bg px-3 py-2 text-sm text-theme-text-primary placeholder:text-theme-text-secondary focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500';
const selectClass = inputClass;
const labelClass = 'block text-sm font-medium text-theme-text-secondary mb-1';

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
  matchAmount: string;
  matchSource: string;
  applicationDeadline: string;
  grantStartDate: string;
  grantEndDate: string;
  projectDescription: string;
  narrativeSummary: string;
  budgetSummary: string;
  keyContacts: string;
  federalAwardId: string;
  performancePeriodMonths: string;
  reportingFrequency: string;
  assignedTo: string;
  priority: string;
  notes: string;
}

const EMPTY_FORM: FormData = {
  grantProgramName: '',
  grantAgency: '',
  opportunityId: '',
  applicationStatus: ApplicationStatus.RESEARCHING,
  amountRequested: '',
  matchAmount: '',
  matchSource: '',
  applicationDeadline: '',
  grantStartDate: '',
  grantEndDate: '',
  projectDescription: '',
  narrativeSummary: '',
  budgetSummary: '',
  keyContacts: '',
  federalAwardId: '',
  performancePeriodMonths: '',
  reportingFrequency: '',
  assignedTo: '',
  priority: GrantPriority.MEDIUM,
  notes: '',
};

export const GrantApplicationFormPage: React.FC = () => {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isEditing = Boolean(id);

  const [formData, setFormData] = useState<FormData>(EMPTY_FORM);
  const [opportunities, setOpportunities] = useState<GrantOpportunity[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Load opportunities for the select dropdown
  useEffect(() => {
    const loadOpportunities = async () => {
      try {
        const data = await grantsService.listOpportunities();
        setOpportunities(data);
      } catch {
        // Silently fail — the dropdown will just be empty
      }
    };
    void loadOpportunities();
  }, []);

  // Load existing application when editing
  useEffect(() => {
    if (isEditing && id) {
      const loadApplication = async () => {
        try {
          setIsLoading(true);
          const app: GrantApplication = await grantsService.getApplication(id);
          setFormData({
            grantProgramName: app.grantProgramName,
            grantAgency: app.grantAgency,
            opportunityId: app.opportunityId ?? '',
            applicationStatus: app.applicationStatus,
            amountRequested:
              app.amountRequested != null ? String(app.amountRequested) : '',
            matchAmount:
              app.matchAmount != null ? String(app.matchAmount) : '',
            matchSource: app.matchSource ?? '',
            applicationDeadline:
              app.applicationDeadline?.split('T')[0] ?? '',
            grantStartDate: app.grantStartDate?.split('T')[0] ?? '',
            grantEndDate: app.grantEndDate?.split('T')[0] ?? '',
            projectDescription: app.projectDescription ?? '',
            narrativeSummary: app.narrativeSummary ?? '',
            budgetSummary: app.budgetSummary ?? '',
            keyContacts: app.keyContacts ?? '',
            federalAwardId: app.federalAwardId ?? '',
            performancePeriodMonths:
              app.performancePeriodMonths != null
                ? String(app.performancePeriodMonths)
                : '',
            reportingFrequency: app.reportingFrequency ?? '',
            assignedTo: app.assignedTo ?? '',
            priority: app.priority,
            notes: app.notes ?? '',
          });
        } catch {
          toast.error('Failed to load application.');
        } finally {
          setIsLoading(false);
        }
      };
      void loadApplication();
    }
  }, [isEditing, id]);

  const handleChange = (
    e: React.ChangeEvent<
      HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
    >,
  ) => {
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
      newErrors.grantProgramName = 'Grant program name is required';
    }
    if (!formData.grantAgency.trim()) {
      newErrors.grantAgency = 'Grant agency is required';
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) {
      toast.error('Please fix the errors before submitting.');
      return;
    }
    setIsSubmitting(true);

    const payload: Partial<GrantApplication> = {
      grantProgramName: formData.grantProgramName,
      grantAgency: formData.grantAgency,
      opportunityId: formData.opportunityId || null,
      applicationStatus:
        formData.applicationStatus as GrantApplication['applicationStatus'],
      amountRequested: formData.amountRequested
        ? Number(formData.amountRequested)
        : null,
      matchAmount: formData.matchAmount ? Number(formData.matchAmount) : null,
      matchSource: formData.matchSource || null,
      applicationDeadline: formData.applicationDeadline || null,
      grantStartDate: formData.grantStartDate || null,
      grantEndDate: formData.grantEndDate || null,
      projectDescription: formData.projectDescription || null,
      narrativeSummary: formData.narrativeSummary || null,
      budgetSummary: formData.budgetSummary || null,
      keyContacts: formData.keyContacts || null,
      federalAwardId: formData.federalAwardId || null,
      performancePeriodMonths: formData.performancePeriodMonths
        ? Number(formData.performancePeriodMonths)
        : null,
      reportingFrequency: formData.reportingFrequency || null,
      assignedTo: formData.assignedTo || null,
      priority: formData.priority as GrantApplication['priority'],
      notes: formData.notes || null,
    };

    try {
      if (isEditing && id) {
        await grantsService.updateApplication(id, payload);
        toast.success('Application updated successfully.');
        navigate(`/grants/applications/${id}`);
      } else {
        const created = await grantsService.createApplication(payload);
        toast.success('Application created successfully.');
        navigate(`/grants/applications/${created.id}`);
      }
    } catch {
      toast.error('Failed to save application.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="h-8 w-8 animate-spin rounded-full border-b-2 border-red-500" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <button
          onClick={() => navigate('/grants/applications')}
          className="rounded-lg p-2 text-theme-text-muted hover:bg-theme-surface-hover hover:text-theme-text-primary transition-colors"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div>
          <h1 className="text-xl font-bold text-theme-text-primary">
            {isEditing ? 'Edit Application' : 'New Grant Application'}
          </h1>
          <p className="text-sm text-theme-text-muted">
            {isEditing
              ? 'Update grant application details'
              : 'Create a new grant application'}
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
        <div className="rounded-lg border border-theme-surface-border bg-theme-surface p-6">
          <h2 className="mb-4 font-semibold text-theme-text-primary">
            Program Information
          </h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label htmlFor="grantProgramName" className={labelClass}>
                Grant Program Name <span className="text-red-500">*</span>
              </label>
              <input
                id="grantProgramName"
                name="grantProgramName"
                type="text"
                value={formData.grantProgramName}
                onChange={handleChange}
                className={`${inputClass} ${errors.grantProgramName ? 'border-red-500' : ''}`}
                placeholder="e.g. Assistance to Firefighters Grant"
              />
              {errors.grantProgramName && (
                <p className="mt-1 text-xs text-red-500">
                  {errors.grantProgramName}
                </p>
              )}
            </div>
            <div>
              <label htmlFor="grantAgency" className={labelClass}>
                Grant Agency <span className="text-red-500">*</span>
              </label>
              <input
                id="grantAgency"
                name="grantAgency"
                type="text"
                value={formData.grantAgency}
                onChange={handleChange}
                className={`${inputClass} ${errors.grantAgency ? 'border-red-500' : ''}`}
                placeholder="e.g. FEMA"
              />
              {errors.grantAgency && (
                <p className="mt-1 text-xs text-red-500">
                  {errors.grantAgency}
                </p>
              )}
            </div>
            <div>
              <label htmlFor="opportunityId" className={labelClass}>
                Opportunity ID
              </label>
              <select
                id="opportunityId"
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
            </div>
            <div>
              <label htmlFor="applicationStatus" className={labelClass}>
                Application Status
              </label>
              <select
                id="applicationStatus"
                name="applicationStatus"
                value={formData.applicationStatus}
                onChange={handleChange}
                className={selectClass}
              >
                {APPLICATION_STATUS_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="priority" className={labelClass}>
                Priority
              </label>
              <select
                id="priority"
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
            </div>
            <div>
              <label htmlFor="assignedTo" className={labelClass}>
                Assigned To
              </label>
              <input
                id="assignedTo"
                name="assignedTo"
                type="text"
                value={formData.assignedTo}
                onChange={handleChange}
                className={inputClass}
                placeholder="e.g. John Smith"
              />
            </div>
          </div>
        </div>

        {/* Funding Details */}
        <div className="rounded-lg border border-theme-surface-border bg-theme-surface p-6">
          <h2 className="mb-4 font-semibold text-theme-text-primary">
            Funding Details
          </h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div>
              <label htmlFor="amountRequested" className={labelClass}>
                Amount Requested
              </label>
              <input
                id="amountRequested"
                name="amountRequested"
                type="number"
                min="0"
                step="0.01"
                value={formData.amountRequested}
                onChange={handleChange}
                className={inputClass}
                placeholder="0.00"
              />
            </div>
            <div>
              <label htmlFor="matchAmount" className={labelClass}>
                Match Amount
              </label>
              <input
                id="matchAmount"
                name="matchAmount"
                type="number"
                min="0"
                step="0.01"
                value={formData.matchAmount}
                onChange={handleChange}
                className={inputClass}
                placeholder="0.00"
              />
            </div>
            <div>
              <label htmlFor="matchSource" className={labelClass}>
                Match Source
              </label>
              <input
                id="matchSource"
                name="matchSource"
                type="text"
                value={formData.matchSource}
                onChange={handleChange}
                className={inputClass}
                placeholder="e.g. Municipal budget"
              />
            </div>
            <div>
              <label htmlFor="federalAwardId" className={labelClass}>
                Federal Award ID
              </label>
              <input
                id="federalAwardId"
                name="federalAwardId"
                type="text"
                value={formData.federalAwardId}
                onChange={handleChange}
                className={inputClass}
                placeholder="e.g. EMW-2025-FO-00123"
              />
            </div>
          </div>
        </div>

        {/* Dates */}
        <div className="rounded-lg border border-theme-surface-border bg-theme-surface p-6">
          <h2 className="mb-4 font-semibold text-theme-text-primary">Dates</h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            <div>
              <label htmlFor="applicationDeadline" className={labelClass}>
                Application Deadline
              </label>
              <input
                id="applicationDeadline"
                name="applicationDeadline"
                type="date"
                value={formData.applicationDeadline}
                onChange={handleChange}
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="grantStartDate" className={labelClass}>
                Grant Start Date
              </label>
              <input
                id="grantStartDate"
                name="grantStartDate"
                type="date"
                value={formData.grantStartDate}
                onChange={handleChange}
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="grantEndDate" className={labelClass}>
                Grant End Date
              </label>
              <input
                id="grantEndDate"
                name="grantEndDate"
                type="date"
                value={formData.grantEndDate}
                onChange={handleChange}
                className={inputClass}
              />
            </div>
            <div>
              <label htmlFor="performancePeriodMonths" className={labelClass}>
                Performance Period (months)
              </label>
              <input
                id="performancePeriodMonths"
                name="performancePeriodMonths"
                type="number"
                min="0"
                value={formData.performancePeriodMonths}
                onChange={handleChange}
                className={inputClass}
                placeholder="12"
              />
            </div>
          </div>
        </div>

        {/* Reporting */}
        <div className="rounded-lg border border-theme-surface-border bg-theme-surface p-6">
          <h2 className="mb-4 font-semibold text-theme-text-primary">
            Reporting
          </h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label htmlFor="reportingFrequency" className={labelClass}>
                Reporting Frequency
              </label>
              <select
                id="reportingFrequency"
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
            </div>
          </div>
        </div>

        {/* Project Details */}
        <div className="rounded-lg border border-theme-surface-border bg-theme-surface p-6">
          <h2 className="mb-4 font-semibold text-theme-text-primary">
            Project Details
          </h2>
          <div className="space-y-4">
            <div>
              <label htmlFor="projectDescription" className={labelClass}>
                Project Description
              </label>
              <textarea
                id="projectDescription"
                name="projectDescription"
                rows={4}
                value={formData.projectDescription}
                onChange={handleChange}
                className={inputClass}
                placeholder="Describe the project this grant will fund..."
              />
            </div>
            <div>
              <label htmlFor="narrativeSummary" className={labelClass}>
                Narrative Summary
              </label>
              <textarea
                id="narrativeSummary"
                name="narrativeSummary"
                rows={4}
                value={formData.narrativeSummary}
                onChange={handleChange}
                className={inputClass}
                placeholder="Executive summary of the grant narrative..."
              />
            </div>
            <div>
              <label htmlFor="budgetSummary" className={labelClass}>
                Budget Summary
              </label>
              <textarea
                id="budgetSummary"
                name="budgetSummary"
                rows={3}
                value={formData.budgetSummary}
                onChange={handleChange}
                className={inputClass}
                placeholder="Overview of the grant budget allocation..."
              />
            </div>
            <div>
              <label htmlFor="keyContacts" className={labelClass}>
                Key Contacts
              </label>
              <textarea
                id="keyContacts"
                name="keyContacts"
                rows={3}
                value={formData.keyContacts}
                onChange={handleChange}
                className={inputClass}
                placeholder="Key contacts for this grant application..."
              />
            </div>
            <div>
              <label htmlFor="notes" className={labelClass}>
                Notes
              </label>
              <textarea
                id="notes"
                name="notes"
                rows={3}
                value={formData.notes}
                onChange={handleChange}
                className={inputClass}
                placeholder="Internal notes about this application..."
              />
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center justify-end gap-3">
          <button
            type="button"
            onClick={() => navigate('/grants/applications')}
            className="inline-flex items-center gap-2 rounded-lg bg-theme-surface-hover px-6 py-2.5 text-sm font-medium text-theme-text-primary hover:bg-theme-surface transition-colors"
          >
            <X className="h-4 w-4" />
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-60 transition-colors"
          >
            <Save className="h-4 w-4" />
            {isSubmitting
              ? 'Saving...'
              : isEditing
                ? 'Update Application'
                : 'Create Application'}
          </button>
        </div>
      </form>
    </div>
  );
};

export default GrantApplicationFormPage;
