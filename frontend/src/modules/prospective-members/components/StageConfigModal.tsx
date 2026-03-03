/**
 * Stage Configuration Modal
 *
 * Modal for configuring a pipeline stage's type and requirements.
 */

import React, { useState, useEffect } from 'react';
import {
  X,
  FileText,
  Upload,
  Vote,
  CheckCircle,
  Plus,
  Trash2,
  Clock,
  Bell,
  CalendarCheck,
  Globe,
  Loader2,
  AlertCircle,
  Mail,
} from 'lucide-react';
import type {
  PipelineStage,
  PipelineStageCreate,
  StageType,
  FormStageConfig,
  DocumentStageConfig,
  ElectionStageConfig,
  ElectionPackageFieldConfig,
  ManualApprovalConfig,
  MeetingStageConfig,
  MeetingType,
  StatusPageToggleConfig,
  AutomatedEmailStageConfig,
  StageConfig,
} from '../types';
import { DEFAULT_ELECTION_PACKAGE_FIELDS } from '../types';
import { formsService } from '@/services/formsServices';
import type { FormDef } from '@/services/inventoryService';
import { pipelineService } from '../services/api';
import type { FormPipelineValidation } from '../types';
import { eventService } from '@/services/eventServices';
import type { EventListItem } from '@/types/event';
import { getEventTypeLabel } from '@/utils/eventHelpers';
import { formatDateTime } from '@/utils/dateFormatting';

interface StageConfigModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (stage: PipelineStageCreate) => void;
  editingStage?: PipelineStage | null;
  existingStageCount: number;
}

const STAGE_TYPE_OPTIONS: { value: StageType; label: string; icon: React.ElementType; description: string }[] = [
  {
    value: 'form_submission',
    label: 'Form Submission',
    icon: FileText,
    description: 'Require a form to be filled out before advancing.',
  },
  {
    value: 'document_upload',
    label: 'Document Upload',
    icon: Upload,
    description: 'Require document uploads (ID, background check, etc.).',
  },
  {
    value: 'meeting',
    label: 'Meeting',
    icon: CalendarCheck,
    description: 'Require attendance at or scheduling of a meeting.',
  },
  {
    value: 'election_vote',
    label: 'Election / Vote',
    icon: Vote,
    description: 'Require a membership vote via the Elections module.',
  },
  {
    value: 'manual_approval',
    label: 'Manual Approval',
    icon: CheckCircle,
    description: 'Admin or designated role manually approves advancement.',
  },
  {
    value: 'status_page_toggle',
    label: 'Enable Status Page',
    icon: Globe,
    description: 'Activate the public status page for the prospect at this stage.',
  },
  {
    value: 'automated_email',
    label: 'Automated Email',
    icon: Mail,
    description: 'Send an automated email to the prospect at this stage.',
  },
];

// Stage presets for quick configuration
interface StagePreset {
  label: string;
  name: string;
  description: string;
  stageType: StageType;
  config: () => StageConfig;
}

const STAGE_PRESETS: StagePreset[] = [
  {
    label: 'Application Form',
    name: 'Application Form',
    description: 'Collect basic applicant information via a form.',
    stageType: 'form_submission',
    config: () => ({ form_id: '', form_name: '' }),
  },
  {
    label: 'Background Check Docs',
    name: 'Background Check Documents',
    description: 'Require background check and ID documents.',
    stageType: 'document_upload',
    config: () => ({ required_document_types: ['Background Check', 'Photo ID'], allow_multiple: true }),
  },
  {
    label: 'Chief Interview',
    name: 'Meeting with Chief',
    description: 'Schedule a one-on-one meeting with the fire chief.',
    stageType: 'meeting',
    config: () => ({
      meeting_type: 'chief_meeting' as MeetingType,
      meeting_description: 'Interview with the fire chief to discuss expectations and commitment.',
    }),
  },
  {
    label: 'Membership Vote',
    name: 'Membership Election',
    description: 'Hold a membership vote for the applicant.',
    stageType: 'election_vote',
    config: () => ({
      voting_method: 'simple_majority' as const,
      victory_condition: 'majority' as const,
      eligible_voter_roles: ['member'],
      anonymous_voting: true,
    }),
  },
  {
    label: 'Welcome Email',
    name: 'Send Welcome Email',
    description: 'Send welcome information to the accepted member.',
    stageType: 'automated_email',
    config: () => ({
      email_subject: 'Welcome to the Department!',
      include_welcome: true,
      welcome_message: 'Congratulations! We are pleased to welcome you.',
      include_faq_link: true,
      faq_url: '',
      include_next_meeting: true,
      next_meeting_details: '',
      include_status_tracker: false,
      custom_sections: [],
    }),
  },
  {
    label: 'Coordinator Approval',
    name: 'Coordinator Approval',
    description: 'Membership coordinator reviews and approves.',
    stageType: 'manual_approval',
    config: () => ({ approver_roles: ['membership_coordinator'], require_notes: true }),
  },
];

const MEETING_TYPE_OPTIONS: { value: MeetingType; label: string; description: string }[] = [
  {
    value: 'chief_meeting',
    label: 'Meeting with Chief',
    description: 'One-on-one or small group meeting with the chief.',
  },
  { value: 'informational', label: 'Informational Meeting', description: 'General info session about the department.' },
  { value: 'business_meeting', label: 'Business Meeting', description: 'Attend a regular business meeting.' },
  { value: 'other', label: 'Other', description: 'Custom meeting type.' },
];

const EVENT_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'business_meeting', label: 'Business Meeting' },
  { value: 'training', label: 'Training' },
  { value: 'public_education', label: 'Public Education' },
  { value: 'social', label: 'Social' },
  { value: 'fundraiser', label: 'Fundraiser' },
  { value: 'ceremony', label: 'Ceremony' },
  { value: 'other', label: 'Other' },
];

const DEFAULT_CONFIGS: Record<StageType, () => StageConfig> = {
  form_submission: () => ({ form_id: '', form_name: '' }),
  document_upload: () => ({ required_document_types: [''], allow_multiple: true }),
  election_vote: () => ({
    voting_method: 'simple_majority' as const,
    victory_condition: 'majority' as const,
    eligible_voter_roles: [],
    anonymous_voting: true,
  }),
  manual_approval: () => ({ approver_roles: [], require_notes: false }),
  meeting: () => ({ meeting_type: 'chief_meeting' as MeetingType, meeting_description: '' }),
  status_page_toggle: () => ({ enable_public_status: true, custom_message: '' }),
  automated_email: () => ({
    email_subject: 'Welcome to the Membership Process',
    include_welcome: true,
    welcome_message: '',
    include_faq_link: false,
    faq_url: '',
    include_next_meeting: false,
    next_meeting_details: '',
    include_status_tracker: false,
    custom_sections: [],
  }),
};

export const StageConfigModal: React.FC<StageConfigModalProps> = ({
  isOpen,
  onClose,
  onSave,
  editingStage,
  existingStageCount,
}) => {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [stageType, setStageType] = useState<StageType>('manual_approval');
  const [config, setConfig] = useState<StageConfig>(DEFAULT_CONFIGS.manual_approval());
  const [isRequired, setIsRequired] = useState(true);
  const [notifyProspect, setNotifyProspect] = useState(false);
  const [publicVisible, setPublicVisible] = useState(true);
  const [hasTimeoutOverride, setHasTimeoutOverride] = useState(false);
  const [timeoutOverrideDays, setTimeoutOverrideDays] = useState<number>(180);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [availableForms, setAvailableForms] = useState<FormDef[]>([]);
  const [formsLoading, setFormsLoading] = useState(false);
  const [formsError, setFormsError] = useState<string | null>(null);
  const [formValidation, setFormValidation] = useState<FormPipelineValidation | null>(null);
  const [formValidationLoading, setFormValidationLoading] = useState(false);
  const [upcomingEvents, setUpcomingEvents] = useState<EventListItem[]>([]);
  const [eventsLoading, setEventsLoading] = useState(false);

  // Fetch published forms when the modal opens
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    const fetchForms = async () => {
      setFormsLoading(true);
      setFormsError(null);
      try {
        const response = await formsService.getForms({ status: 'published', limit: 200 });
        if (!cancelled) {
          setAvailableForms(response.forms);
        }
      } catch {
        if (!cancelled) {
          setFormsError('Failed to load forms');
        }
      } finally {
        if (!cancelled) {
          setFormsLoading(false);
        }
      }
    };
    void fetchForms();
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  // Fetch upcoming events when the modal opens
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    const fetchEvents = async () => {
      setEventsLoading(true);
      try {
        const events = await eventService.getEvents({
          end_after: new Date().toISOString(),
          include_cancelled: false,
          limit: 100,
        });
        if (!cancelled) {
          // Sort by start_datetime ascending (soonest first)
          const sorted = [...events].sort(
            (a, b) => new Date(a.start_datetime).getTime() - new Date(b.start_datetime).getTime()
          );
          setUpcomingEvents(sorted);
        }
      } catch {
        // Non-critical — events dropdown will simply be empty
        if (!cancelled) setUpcomingEvents([]);
      } finally {
        if (!cancelled) setEventsLoading(false);
      }
    };
    void fetchEvents();
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  useEffect(() => {
    setFormValidation(null);
    if (editingStage) {
      setName(editingStage.name);
      setDescription(editingStage.description ?? '');
      setStageType(editingStage.stage_type);
      setConfig(editingStage.config);
      setIsRequired(editingStage.is_required);
      setNotifyProspect(editingStage.notify_prospect_on_completion ?? false);
      setPublicVisible(editingStage.public_visible ?? true);
      if (editingStage.inactivity_timeout_days != null) {
        setHasTimeoutOverride(true);
        setTimeoutOverrideDays(editingStage.inactivity_timeout_days);
      } else {
        setHasTimeoutOverride(false);
        setTimeoutOverrideDays(180);
      }
      // Validate pre-selected form for pipeline compatibility
      if (editingStage.stage_type === 'form_submission' && (editingStage.config as FormStageConfig).form_id) {
        const formId = (editingStage.config as FormStageConfig).form_id;
        setFormValidationLoading(true);
        void pipelineService.validateFormForPipeline(formId).then(
          (result) => {
            setFormValidation(result);
            setFormValidationLoading(false);
          },
          () => {
            setFormValidationLoading(false);
          }
        );
      }
    } else {
      setName('');
      setDescription('');
      setStageType('manual_approval');
      setConfig(DEFAULT_CONFIGS.manual_approval());
      setIsRequired(true);
      setNotifyProspect(false);
      setPublicVisible(true);
      setHasTimeoutOverride(false);
      setTimeoutOverrideDays(180);
    }
    setErrors({});
  }, [editingStage, isOpen]);

  /** Get next upcoming event for a given event type */
  const getNextEventForType = (eventType: string): EventListItem | undefined => {
    return upcomingEvents.find((e) => e.event_type === eventType);
  };

  /** Render a preview card for the next upcoming event of a given type */
  const renderEventPreview = (eventType: string | undefined) => {
    if (!eventType) return null;
    if (eventsLoading) {
      return (
        <div className="text-theme-text-muted mt-2 flex items-center gap-2 text-sm">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading events...
        </div>
      );
    }
    const nextEvent = getNextEventForType(eventType);
    if (!nextEvent) {
      return (
        <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
          No upcoming {getEventTypeLabel(eventType).toLowerCase()} events found.
        </p>
      );
    }
    return (
      <div className="border-theme-surface-border bg-theme-surface-hover mt-2 rounded-md border p-3">
        <p className="text-theme-text-muted mb-1 text-xs font-medium">Next upcoming event:</p>
        <p className="text-theme-text-primary text-sm font-medium">{nextEvent.title}</p>
        <p className="text-theme-text-muted mt-0.5 text-xs">
          {formatDateTime(nextEvent.start_datetime)}
          {nextEvent.location_name
            ? ` — ${nextEvent.location_name}`
            : nextEvent.location
              ? ` — ${nextEvent.location}`
              : ''}
        </p>
      </div>
    );
  };

  const handleStageTypeChange = (type: StageType) => {
    setStageType(type);
    setConfig(DEFAULT_CONFIGS[type]());
  };

  const retryLoadForms = () => {
    setFormsLoading(true);
    setFormsError(null);
    void formsService.getForms({ status: 'published', limit: 200 }).then(
      (response) => {
        setAvailableForms(response.forms);
        setFormsLoading(false);
      },
      () => {
        setFormsError('Failed to load forms');
        setFormsLoading(false);
      }
    );
  };

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};
    if (!name.trim()) newErrors.name = 'Stage name is required';

    if (stageType === 'form_submission') {
      const c = config as FormStageConfig;
      if (!c.form_id) newErrors.form_id = 'Please select a form';
    }

    if (stageType === 'document_upload') {
      const c = config as DocumentStageConfig;
      const validTypes = c.required_document_types.filter((t) => t.trim());
      if (validTypes.length === 0) newErrors.document_types = 'At least one document type is required';
    }

    if (stageType === 'election_vote') {
      const c = config as ElectionStageConfig;
      if (!c.eligible_voter_roles || c.eligible_voter_roles.length === 0) {
        newErrors.eligible_voter_roles = 'At least one eligible voter role is required';
      }
      const pct = c.victory_percentage ?? 67;
      if (pct < 1 || pct > 100 || !Number.isFinite(pct)) {
        newErrors.victory_percentage = 'Victory percentage must be between 1 and 100';
      }
    }

    if (stageType === 'manual_approval') {
      const c = config as ManualApprovalConfig;
      if (!c.approver_roles || c.approver_roles.length === 0) {
        newErrors.approver_roles = 'At least one approver role is required';
      }
    }

    if (stageType === 'automated_email') {
      const c = config as AutomatedEmailStageConfig;
      if (!c.email_subject.trim()) newErrors.email_subject = 'Email subject is required';
    }

    if (hasTimeoutOverride) {
      if (!Number.isFinite(timeoutOverrideDays) || timeoutOverrideDays < 1) {
        newErrors.timeout_override = 'Timeout override must be at least 1 day';
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSave = () => {
    if (!validate()) return;

    const stageData: PipelineStageCreate = {
      name: name.trim(),
      description: description.trim() || undefined,
      stage_type: stageType,
      config,
      sort_order: editingStage ? editingStage.sort_order : existingStageCount,
      is_required: isRequired,
      inactivity_timeout_days: hasTimeoutOverride ? timeoutOverrideDays : null,
      notify_prospect_on_completion: notifyProspect,
      public_visible: publicVisible,
    };

    onSave(stageData);
    onClose();
  };

  if (!isOpen) return null;

  const docConfig = config as DocumentStageConfig;
  const electionConfig = config as ElectionStageConfig;
  const approvalConfig = config as ManualApprovalConfig;
  const meetingConfig = config as MeetingStageConfig;
  const statusPageConfig = config as StatusPageToggleConfig;
  const emailConfig = config as AutomatedEmailStageConfig;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="stage-config-modal-title"
      onKeyDown={(e) => {
        if (e.key === 'Escape') onClose();
      }}
    >
      <div className="bg-theme-surface-modal border-theme-surface-border modal-body w-full max-w-2xl rounded-xl border">
        {/* Header */}
        <div className="border-theme-surface-border flex items-center justify-between border-b p-6">
          <h2 id="stage-config-modal-title" className="text-theme-text-primary text-xl font-bold">
            {editingStage ? 'Edit Stage' : 'Add Pipeline Stage'}
          </h2>
          <button
            onClick={onClose}
            className="text-theme-text-muted hover:text-theme-text-primary transition-colors"
            aria-label="Close dialog"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        {/* Body */}
        <div className="space-y-6 p-6">
          {/* Stage Name */}
          <div>
            <label htmlFor="stage-name" className="text-theme-text-secondary mb-2 block text-sm font-medium">
              Stage Name <span aria-hidden="true">*</span>
            </label>
            <input
              id="stage-name"
              type="text"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setErrors((prev) => ({ ...prev, name: '' }));
              }}
              placeholder="e.g., Application Review"
              required
              aria-required="true"
              className="bg-theme-surface-hover border-theme-surface-border text-theme-text-primary placeholder-theme-text-muted focus:ring-theme-focus-ring w-full rounded-lg border px-4 py-2.5 focus:ring-2 focus:outline-hidden"
            />
            {errors.name && <p className="mt-1 text-sm text-red-700 dark:text-red-400">{errors.name}</p>}
          </div>

          {/* Description */}
          <div>
            <label htmlFor="stage-description" className="text-theme-text-secondary mb-2 block text-sm font-medium">
              Description
            </label>
            <textarea
              id="stage-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe what happens at this stage..."
              rows={2}
              className="bg-theme-surface-hover border-theme-surface-border text-theme-text-primary placeholder-theme-text-muted focus:ring-theme-focus-ring w-full resize-none rounded-lg border px-4 py-2.5 focus:ring-2 focus:outline-hidden"
            />
          </div>

          {/* Stage Presets (only when creating, not editing) */}
          {!editingStage && (
            <div>
              <label className="text-theme-text-secondary mb-2 block text-sm font-medium">Quick Presets</label>
              <div className="flex flex-wrap gap-2">
                {STAGE_PRESETS.map((preset) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => {
                      setName(preset.name);
                      setDescription(preset.description);
                      setStageType(preset.stageType);
                      setConfig(preset.config());
                    }}
                    className="border-theme-surface-border text-theme-text-secondary hover:text-theme-text-primary rounded-lg border px-3 py-1.5 text-xs transition-colors hover:border-red-500/50"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Stage Type */}
          <div>
            <label className="text-theme-text-secondary mb-3 block text-sm font-medium">Stage Type *</label>
            <div className="form-grid-2">
              {STAGE_TYPE_OPTIONS.map((opt) => {
                const Icon = opt.icon;
                const selected = stageType === opt.value;
                return (
                  <button
                    key={opt.value}
                    onClick={() => handleStageTypeChange(opt.value)}
                    className={`flex flex-col items-start rounded-lg border p-4 text-left transition-all ${
                      selected
                        ? 'border-red-500 bg-red-500/10'
                        : 'border-theme-surface-border bg-theme-surface-hover hover:border-theme-surface-border'
                    }`}
                  >
                    <div className="mb-1 flex items-center gap-2">
                      <Icon
                        className={`h-4 w-4 ${selected ? 'text-red-700 dark:text-red-400' : 'text-theme-text-muted'}`}
                        aria-hidden="true"
                      />
                      <span
                        className={`text-sm font-medium ${selected ? 'text-theme-text-primary' : 'text-theme-text-secondary'}`}
                      >
                        {opt.label}
                      </span>
                    </div>
                    <p className="text-theme-text-muted text-xs">{opt.description}</p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Type-Specific Configuration */}
          <div className="border-theme-surface-border border-t pt-6">
            <h3 className="text-theme-text-secondary mb-4 text-sm font-medium">Stage Configuration</h3>

            {/* Form Submission Config */}
            {stageType === 'form_submission' && (
              <div>
                <label htmlFor="stage-form-id" className="text-theme-text-muted mb-2 block text-sm">
                  Form
                </label>
                {formsLoading ? (
                  <div className="text-theme-text-muted flex items-center gap-2 py-2.5 text-sm">
                    <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                    Loading forms...
                  </div>
                ) : formsError ? (
                  <div className="flex items-center gap-2 py-2.5 text-sm text-red-700 dark:text-red-400">
                    <AlertCircle className="h-4 w-4" aria-hidden="true" />
                    {formsError}
                    <button
                      type="button"
                      onClick={retryLoadForms}
                      className="text-red-700 underline hover:no-underline dark:text-red-400"
                    >
                      Retry
                    </button>
                  </div>
                ) : (
                  <>
                    <select
                      id="stage-form-id"
                      value={(config as FormStageConfig).form_id}
                      onChange={(e) => {
                        const formId = e.target.value;
                        const selectedForm = availableForms.find((f) => f.id === formId);
                        setConfig({
                          ...config,
                          form_id: formId,
                          form_name: selectedForm?.name ?? '',
                        } as FormStageConfig);
                        setErrors((prev) => ({ ...prev, form_id: '' }));
                        setFormValidation(null);
                        if (formId) {
                          setFormValidationLoading(true);
                          void pipelineService.validateFormForPipeline(formId).then(
                            (result) => {
                              setFormValidation(result);
                              setFormValidationLoading(false);
                            },
                            () => {
                              setFormValidationLoading(false);
                            }
                          );
                        }
                      }}
                      className="bg-theme-surface-hover border-theme-surface-border text-theme-text-primary focus:ring-theme-focus-ring w-full rounded-lg border px-4 py-2.5 focus:ring-2 focus:outline-hidden"
                    >
                      <option value="">Select a form...</option>
                      {availableForms.map((form) => (
                        <option key={form.id} value={form.id}>
                          {form.name}
                          {form.category ? ` (${form.category})` : ''}
                        </option>
                      ))}
                    </select>
                    {availableForms.length === 0 && (
                      <p className="text-theme-text-muted mt-1 text-xs">
                        No published forms found. Create and publish a form in the Forms module first.
                      </p>
                    )}
                  </>
                )}
                {errors.form_id && <p className="mt-1 text-sm text-red-700 dark:text-red-400">{errors.form_id}</p>}

                {/* Integration type status */}
                {(config as FormStageConfig).form_id && (() => {
                  const selected = availableForms.find((f) => f.id === (config as FormStageConfig).form_id);
                  if (!selected) return null;
                  if (selected.integration_type === 'membership_interest') {
                    return (
                      <p className="mt-2 flex items-center gap-1.5 text-xs text-green-700 dark:text-green-400">
                        <CheckCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        Configured for membership pipeline (label-based mapping)
                      </p>
                    );
                  }
                  return (
                    <p className="text-theme-text-muted mt-2 text-xs">
                      This form will be auto-configured for the membership pipeline when you save.
                    </p>
                  );
                })()}

                {/* Form-to-pipeline field validation */}
                {formValidationLoading && (
                  <div className="text-theme-text-muted mt-3 flex items-center gap-2 text-sm">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
                    Checking field compatibility...
                  </div>
                )}
                {formValidation && !formValidationLoading && (
                  <div
                    className={`mt-3 rounded-lg border p-3 text-sm ${
                      formValidation.valid
                        ? 'border-green-300 bg-green-50 dark:border-green-700 dark:bg-green-900/20'
                        : 'border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-900/20'
                    }`}
                  >
                    <p
                      className={`mb-1.5 font-medium ${
                        formValidation.valid
                          ? 'text-green-800 dark:text-green-300'
                          : 'text-amber-800 dark:text-amber-300'
                      }`}
                    >
                      {formValidation.valid ? 'All required fields detected' : 'Missing required fields'}
                    </p>
                    <ul className="space-y-0.5">
                      {(['first_name', 'last_name', 'email'] as const).map((field) => {
                        const mapped = formValidation.mapped_fields[field];
                        const friendly: Record<string, string> = {
                          first_name: 'First Name',
                          last_name: 'Last Name',
                          email: 'Email',
                        };
                        return (
                          <li key={field} className="flex items-center gap-1.5">
                            {mapped ? (
                              <>
                                <CheckCircle className="h-3.5 w-3.5 shrink-0 text-green-600 dark:text-green-400" />
                                <span className="text-green-800 dark:text-green-300">
                                  {friendly[field]}{' '}
                                  <span className="text-green-600/70 dark:text-green-400/70">
                                    — mapped from &ldquo;{mapped.label}&rdquo;
                                  </span>
                                </span>
                              </>
                            ) : (
                              <>
                                <AlertCircle className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
                                <span className="text-amber-800 dark:text-amber-300">
                                  {friendly[field]} — not found
                                </span>
                              </>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                    {formValidation.suggestions.length > 0 && (
                      <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">{formValidation.suggestions[0]}</p>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Document Upload Config */}
            {stageType === 'document_upload' && (
              <div className="space-y-4">
                <div>
                  <label className="text-theme-text-muted mb-2 block text-sm">Required Document Types</label>
                  {docConfig.required_document_types.map((docType, idx) => (
                    <div key={idx} className="mb-2 flex items-center gap-2">
                      <input
                        type="text"
                        value={docType}
                        onChange={(e) => {
                          const updated = [...docConfig.required_document_types];
                          updated[idx] = e.target.value;
                          setConfig({ ...docConfig, required_document_types: updated });
                        }}
                        placeholder="e.g., Photo ID, Background Check"
                        aria-label={`Document type ${idx + 1}`}
                        className="bg-theme-surface-hover border-theme-surface-border text-theme-text-primary placeholder-theme-text-muted focus:ring-theme-focus-ring flex-1 rounded-lg border px-4 py-2 focus:ring-2 focus:outline-hidden"
                      />
                      {docConfig.required_document_types.length > 1 && (
                        <button
                          onClick={() => {
                            const updated = docConfig.required_document_types.filter((_, i) => i !== idx);
                            setConfig({ ...docConfig, required_document_types: updated });
                          }}
                          className="text-theme-text-muted transition-colors hover:text-red-700 dark:hover:text-red-400"
                          aria-label={`Remove document type ${idx + 1}`}
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  ))}
                  <button
                    onClick={() =>
                      setConfig({
                        ...docConfig,
                        required_document_types: [...docConfig.required_document_types, ''],
                      })
                    }
                    className="flex items-center gap-1 text-sm text-red-700 transition-colors hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                  >
                    <Plus className="h-3 w-3" aria-hidden="true" /> Add document type
                  </button>
                  {errors.document_types && (
                    <p className="mt-1 text-sm text-red-700 dark:text-red-400">{errors.document_types}</p>
                  )}
                </div>
                <label className="text-theme-text-secondary flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={docConfig.allow_multiple}
                    onChange={(e) => setConfig({ ...docConfig, allow_multiple: e.target.checked })}
                    className="border-theme-surface-border bg-theme-surface-hover focus:ring-theme-focus-ring rounded-sm text-red-700 dark:text-red-500"
                  />
                  Allow multiple files per document type
                </label>
              </div>
            )}

            {/* Meeting Config */}
            {stageType === 'meeting' && (
              <div className="space-y-4">
                <div>
                  <label htmlFor="stage-meeting-type" className="text-theme-text-muted mb-2 block text-sm">
                    Meeting Type
                  </label>
                  <select
                    id="stage-meeting-type"
                    value={meetingConfig.meeting_type}
                    onChange={(e) => setConfig({ ...meetingConfig, meeting_type: e.target.value as MeetingType })}
                    className="bg-theme-surface-hover border-theme-surface-border text-theme-text-primary focus:ring-theme-focus-ring w-full rounded-lg border px-4 py-2.5 focus:ring-2 focus:outline-hidden"
                  >
                    {MEETING_TYPE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                  <p className="text-theme-text-muted mt-1 text-xs">
                    {MEETING_TYPE_OPTIONS.find((o) => o.value === meetingConfig.meeting_type)?.description}
                  </p>
                </div>
                <div>
                  <label htmlFor="stage-meeting-event-type" className="text-theme-text-muted mb-2 block text-sm">
                    Link to Upcoming Event (optional)
                  </label>
                  <select
                    id="stage-meeting-event-type"
                    value={meetingConfig.linked_event_type ?? ''}
                    onChange={(e) => {
                      const eventType = e.target.value || undefined;
                      const nextEvent = eventType ? getNextEventForType(eventType) : undefined;
                      setConfig({
                        ...meetingConfig,
                        linked_event_type: eventType,
                        linked_event_id: nextEvent?.id,
                      });
                    }}
                    className="bg-theme-surface-hover border-theme-surface-border text-theme-text-primary focus:ring-theme-focus-ring w-full rounded-lg border px-4 py-2.5 focus:ring-2 focus:outline-hidden"
                  >
                    <option value="">None — enter details manually</option>
                    {EVENT_TYPE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        Next {opt.label}
                      </option>
                    ))}
                  </select>
                  <p className="text-theme-text-muted mt-1 text-xs">
                    Automatically pull details from the next upcoming event of this type.
                  </p>
                  {renderEventPreview(meetingConfig.linked_event_type)}
                </div>
                <div>
                  <label htmlFor="stage-meeting-description" className="text-theme-text-muted mb-2 block text-sm">
                    Meeting Details (optional)
                  </label>
                  <textarea
                    id="stage-meeting-description"
                    value={meetingConfig.meeting_description ?? ''}
                    onChange={(e) => setConfig({ ...meetingConfig, meeting_description: e.target.value })}
                    placeholder="e.g., Meet with Chief Smith to discuss expectations and department culture..."
                    rows={2}
                    className="bg-theme-surface-hover border-theme-surface-border text-theme-text-primary placeholder-theme-text-muted focus:ring-theme-focus-ring w-full resize-none rounded-lg border px-4 py-2.5 focus:ring-2 focus:outline-hidden"
                  />
                </div>
              </div>
            )}

            {/* Election Vote Config */}
            {stageType === 'election_vote' && (
              <div className="space-y-4">
                <div>
                  <label htmlFor="stage-voting-method" className="text-theme-text-muted mb-2 block text-sm">
                    Voting Method
                  </label>
                  <select
                    id="stage-voting-method"
                    value={electionConfig.voting_method}
                    onChange={(e) =>
                      setConfig({
                        ...electionConfig,
                        voting_method: e.target.value as ElectionStageConfig['voting_method'],
                      })
                    }
                    className="bg-theme-surface-hover border-theme-surface-border text-theme-text-primary focus:ring-theme-focus-ring w-full rounded-lg border px-4 py-2.5 focus:ring-2 focus:outline-hidden"
                  >
                    <option value="simple_majority">Simple Majority</option>
                    <option value="approval">Approval Voting</option>
                    <option value="supermajority">Supermajority</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="stage-victory-condition" className="text-theme-text-muted mb-2 block text-sm">
                    Victory Condition
                  </label>
                  <select
                    id="stage-victory-condition"
                    value={electionConfig.victory_condition}
                    onChange={(e) =>
                      setConfig({
                        ...electionConfig,
                        victory_condition: e.target.value as ElectionStageConfig['victory_condition'],
                      })
                    }
                    className="bg-theme-surface-hover border-theme-surface-border text-theme-text-primary focus:ring-theme-focus-ring w-full rounded-lg border px-4 py-2.5 focus:ring-2 focus:outline-hidden"
                  >
                    <option value="most_votes">Most Votes</option>
                    <option value="majority">Majority (&gt;50%)</option>
                    <option value="supermajority">Supermajority</option>
                  </select>
                </div>
                {electionConfig.victory_condition === 'supermajority' && (
                  <div>
                    <label htmlFor="stage-victory-percentage" className="text-theme-text-muted mb-2 block text-sm">
                      Required Percentage
                    </label>
                    <input
                      id="stage-victory-percentage"
                      type="number"
                      min={51}
                      max={100}
                      value={electionConfig.victory_percentage ?? 67}
                      onChange={(e) => setConfig({ ...electionConfig, victory_percentage: Number(e.target.value) })}
                      className="bg-theme-surface-hover border-theme-surface-border text-theme-text-primary focus:ring-theme-focus-ring w-32 rounded-lg border px-4 py-2 focus:ring-2 focus:outline-hidden"
                    />
                    <span className="text-theme-text-muted ml-2 text-sm">%</span>
                  </div>
                )}
                <label className="text-theme-text-secondary flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={electionConfig.anonymous_voting}
                    onChange={(e) => setConfig({ ...electionConfig, anonymous_voting: e.target.checked })}
                    className="border-theme-surface-border bg-theme-surface-hover focus:ring-theme-focus-ring rounded-sm text-red-700 dark:text-red-500"
                  />
                  Anonymous voting
                </label>

                {/* Election Package Fields */}
                <div className="border-theme-surface-border mt-4 border-t pt-4">
                  <h4 className="text-theme-text-secondary mb-2 text-sm font-medium">Election Package Contents</h4>
                  <p className="text-theme-text-muted mb-3 text-xs">
                    Choose what applicant information is included in the election package for voters and the secretary.
                  </p>
                  {(() => {
                    const fields: ElectionPackageFieldConfig = electionConfig.package_fields ?? {
                      ...DEFAULT_ELECTION_PACKAGE_FIELDS,
                    };
                    const updateField = (key: keyof ElectionPackageFieldConfig, value: boolean | string) => {
                      setConfig({
                        ...electionConfig,
                        package_fields: { ...fields, [key]: value },
                      });
                    };
                    return (
                      <div className="space-y-2">
                        <label className="text-theme-text-secondary flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={fields.include_email}
                            onChange={(e) => updateField('include_email', e.target.checked)}
                            className="border-theme-surface-border bg-theme-surface-hover focus:ring-theme-focus-ring rounded-sm text-red-700 dark:text-red-500"
                          />
                          Include email address
                        </label>
                        <label className="text-theme-text-secondary flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={fields.include_phone}
                            onChange={(e) => updateField('include_phone', e.target.checked)}
                            className="border-theme-surface-border bg-theme-surface-hover focus:ring-theme-focus-ring rounded-sm text-red-700 dark:text-red-500"
                          />
                          Include phone number
                        </label>
                        <label className="text-theme-text-secondary flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={fields.include_address}
                            onChange={(e) => updateField('include_address', e.target.checked)}
                            className="border-theme-surface-border bg-theme-surface-hover focus:ring-theme-focus-ring rounded-sm text-red-700 dark:text-red-500"
                          />
                          Include address
                        </label>
                        <label className="text-theme-text-secondary flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={fields.include_date_of_birth}
                            onChange={(e) => updateField('include_date_of_birth', e.target.checked)}
                            className="border-theme-surface-border bg-theme-surface-hover focus:ring-theme-focus-ring rounded-sm text-red-700 dark:text-red-500"
                          />
                          Include date of birth
                        </label>
                        <label className="text-theme-text-secondary flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={fields.include_documents}
                            onChange={(e) => updateField('include_documents', e.target.checked)}
                            className="border-theme-surface-border bg-theme-surface-hover focus:ring-theme-focus-ring rounded-sm text-red-700 dark:text-red-500"
                          />
                          Include uploaded documents
                        </label>
                        <label className="text-theme-text-secondary flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={fields.include_stage_history}
                            onChange={(e) => updateField('include_stage_history', e.target.checked)}
                            className="border-theme-surface-border bg-theme-surface-hover focus:ring-theme-focus-ring rounded-sm text-red-700 dark:text-red-500"
                          />
                          Include stage completion history
                        </label>
                        <div className="pt-1">
                          <label
                            htmlFor="stage-custom-note-prompt"
                            className="text-theme-text-muted mb-1 block text-xs"
                          >
                            Custom note prompt (optional)
                          </label>
                          <input
                            id="stage-custom-note-prompt"
                            type="text"
                            value={fields.custom_note_prompt ?? ''}
                            onChange={(e) => updateField('custom_note_prompt', e.target.value)}
                            placeholder="e.g., Please describe the applicant's qualifications..."
                            className="bg-theme-surface-hover border-theme-surface-border text-theme-text-primary placeholder-theme-text-muted focus:ring-theme-focus-ring w-full rounded-lg border px-3 py-2 text-sm focus:ring-2 focus:outline-hidden"
                          />
                        </div>
                      </div>
                    );
                  })()}
                </div>
              </div>
            )}

            {/* Manual Approval Config */}
            {stageType === 'manual_approval' && (
              <div className="space-y-4">
                <label className="text-theme-text-secondary flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={approvalConfig.require_notes}
                    onChange={(e) => setConfig({ ...approvalConfig, require_notes: e.target.checked })}
                    className="border-theme-surface-border bg-theme-surface-hover focus:ring-theme-focus-ring rounded-sm text-red-700 dark:text-red-500"
                  />
                  Require approval notes
                </label>
                <p className="text-theme-text-muted text-xs">
                  Approver roles can be configured in the organization settings. Any user with the{' '}
                  <code className="text-theme-text-muted">prospective_members.manage</code> permission can approve.
                </p>
              </div>
            )}

            {/* Status Page Toggle Config */}
            {stageType === 'status_page_toggle' && (
              <div className="space-y-4">
                <div className="bg-theme-surface-hover border-theme-surface-border rounded-lg border p-4">
                  <div className="mb-2 flex items-center gap-2">
                    <Globe className="text-theme-text-muted h-4 w-4" aria-hidden="true" />
                    <span className="text-theme-text-primary text-sm font-medium">
                      {statusPageConfig.enable_public_status ? 'Enables' : 'Disables'} the public status page
                    </span>
                  </div>
                  <p className="text-theme-text-muted text-xs">
                    When the prospect reaches this stage, their public status page will be
                    {statusPageConfig.enable_public_status ? ' activated' : ' deactivated'}. They will receive a link to
                    check their application progress.
                  </p>
                </div>
                <label className="text-theme-text-secondary flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={statusPageConfig.enable_public_status}
                    onChange={(e) => setConfig({ ...statusPageConfig, enable_public_status: e.target.checked })}
                    className="border-theme-surface-border bg-theme-surface-hover focus:ring-theme-focus-ring rounded-sm text-red-700 dark:text-red-500"
                  />
                  Enable public status page at this stage
                </label>
                <div>
                  <label htmlFor="stage-status-page-message" className="text-theme-text-muted mb-2 block text-sm">
                    Custom Status Message (optional)
                  </label>
                  <textarea
                    id="stage-status-page-message"
                    value={statusPageConfig.custom_message ?? ''}
                    onChange={(e) => setConfig({ ...statusPageConfig, custom_message: e.target.value })}
                    placeholder="e.g., Welcome! You can now track your application progress here."
                    rows={2}
                    className="bg-theme-surface-hover border-theme-surface-border text-theme-text-primary placeholder-theme-text-muted focus:ring-theme-focus-ring w-full resize-none rounded-lg border px-4 py-2.5 focus:ring-2 focus:outline-hidden"
                  />
                </div>
              </div>
            )}

            {/* Automated Email Config */}
            {stageType === 'automated_email' && (
              <div className="space-y-4">
                <div>
                  <label htmlFor="stage-email-subject" className="text-theme-text-muted mb-2 block text-sm">
                    Email Subject
                  </label>
                  <input
                    id="stage-email-subject"
                    type="text"
                    value={emailConfig.email_subject}
                    onChange={(e) => setConfig({ ...emailConfig, email_subject: e.target.value })}
                    placeholder="e.g., Welcome to the Membership Process"
                    className="bg-theme-surface-hover border-theme-surface-border text-theme-text-primary placeholder-theme-text-muted focus:ring-theme-focus-ring w-full rounded-lg border px-4 py-2.5 focus:ring-2 focus:outline-hidden"
                  />
                  {errors.email_subject && (
                    <p className="mt-1 text-sm text-red-700 dark:text-red-400">{errors.email_subject}</p>
                  )}
                </div>

                <p className="text-theme-text-muted text-xs">
                  Configure the sections to include in the email. The prospect's name will be used as the greeting
                  automatically.
                </p>

                {/* Welcome Section */}
                <div className="border-theme-surface-border space-y-3 rounded-lg border p-4">
                  <label className="text-theme-text-secondary flex items-center gap-2 text-sm font-medium">
                    <input
                      type="checkbox"
                      checked={emailConfig.include_welcome}
                      onChange={(e) => setConfig({ ...emailConfig, include_welcome: e.target.checked })}
                      className="border-theme-surface-border bg-theme-surface-hover focus:ring-theme-focus-ring rounded-sm text-red-700 dark:text-red-500"
                    />
                    Welcome Message
                  </label>
                  {emailConfig.include_welcome && (
                    <textarea
                      value={emailConfig.welcome_message ?? ''}
                      onChange={(e) => setConfig({ ...emailConfig, welcome_message: e.target.value })}
                      placeholder="Thank you for your interest in joining our department! We look forward to getting to know you through this process."
                      rows={3}
                      aria-label="Welcome message content"
                      className="bg-theme-surface-hover border-theme-surface-border text-theme-text-primary placeholder-theme-text-muted focus:ring-theme-focus-ring w-full resize-none rounded-lg border px-4 py-2.5 text-sm focus:ring-2 focus:outline-hidden"
                    />
                  )}
                </div>

                {/* FAQ Link Section */}
                <div className="border-theme-surface-border space-y-3 rounded-lg border p-4">
                  <label className="text-theme-text-secondary flex items-center gap-2 text-sm font-medium">
                    <input
                      type="checkbox"
                      checked={emailConfig.include_faq_link}
                      onChange={(e) => setConfig({ ...emailConfig, include_faq_link: e.target.checked })}
                      className="border-theme-surface-border bg-theme-surface-hover focus:ring-theme-focus-ring rounded-sm text-red-700 dark:text-red-500"
                    />
                    Membership FAQ Link
                  </label>
                  {emailConfig.include_faq_link && (
                    <input
                      type="url"
                      value={emailConfig.faq_url ?? ''}
                      onChange={(e) => setConfig({ ...emailConfig, faq_url: e.target.value })}
                      placeholder="https://your-department.com/membership-faq"
                      aria-label="FAQ URL"
                      className="bg-theme-surface-hover border-theme-surface-border text-theme-text-primary placeholder-theme-text-muted focus:ring-theme-focus-ring w-full rounded-lg border px-4 py-2.5 text-sm focus:ring-2 focus:outline-hidden"
                    />
                  )}
                </div>

                {/* Next Meeting Section */}
                <div className="border-theme-surface-border space-y-3 rounded-lg border p-4">
                  <label className="text-theme-text-secondary flex items-center gap-2 text-sm font-medium">
                    <input
                      type="checkbox"
                      checked={emailConfig.include_next_meeting}
                      onChange={(e) => setConfig({ ...emailConfig, include_next_meeting: e.target.checked })}
                      className="border-theme-surface-border bg-theme-surface-hover focus:ring-theme-focus-ring rounded-sm text-red-700 dark:text-red-500"
                    />
                    Next Meeting Details
                  </label>
                  {emailConfig.include_next_meeting && (
                    <div className="space-y-3">
                      <div>
                        <label
                          htmlFor="email-meeting-event-type"
                          className="text-theme-text-muted mb-1.5 block text-xs"
                        >
                          Pull from upcoming event
                        </label>
                        <select
                          id="email-meeting-event-type"
                          value={emailConfig.next_meeting_event_type ?? ''}
                          onChange={(e) => {
                            const eventType = e.target.value || undefined;
                            const nextEvent = eventType ? getNextEventForType(eventType) : undefined;
                            setConfig({
                              ...emailConfig,
                              next_meeting_event_type: eventType,
                              next_meeting_event_id: nextEvent?.id,
                            });
                          }}
                          className="bg-theme-surface-hover border-theme-surface-border text-theme-text-primary focus:ring-theme-focus-ring w-full rounded-lg border px-4 py-2 text-sm focus:ring-2 focus:outline-hidden"
                        >
                          <option value="">None — enter details manually</option>
                          {EVENT_TYPE_OPTIONS.map((opt) => (
                            <option key={opt.value} value={opt.value}>
                              Next {opt.label}
                            </option>
                          ))}
                        </select>
                        {renderEventPreview(emailConfig.next_meeting_event_type)}
                      </div>
                      <div>
                        <label htmlFor="email-meeting-details" className="text-theme-text-muted mb-1.5 block text-xs">
                          {emailConfig.next_meeting_event_type ? 'Additional details (optional)' : 'Meeting details'}
                        </label>
                        <textarea
                          id="email-meeting-details"
                          value={emailConfig.next_meeting_details ?? ''}
                          onChange={(e) => setConfig({ ...emailConfig, next_meeting_details: e.target.value })}
                          placeholder={
                            emailConfig.next_meeting_event_type
                              ? 'Any extra info to include alongside the event details...'
                              : 'Our next informational meeting is on the first Monday of the month at 7 PM at Station 1. All prospective members are encouraged to attend.'
                          }
                          rows={2}
                          aria-label="Next meeting details"
                          className="bg-theme-surface-hover border-theme-surface-border text-theme-text-primary placeholder-theme-text-muted focus:ring-theme-focus-ring w-full resize-none rounded-lg border px-4 py-2.5 text-sm focus:ring-2 focus:outline-hidden"
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Application Tracker Section */}
                <div className="border-theme-surface-border space-y-2 rounded-lg border p-4">
                  <label className="text-theme-text-secondary flex items-center gap-2 text-sm font-medium">
                    <input
                      type="checkbox"
                      checked={emailConfig.include_status_tracker}
                      onChange={(e) => setConfig({ ...emailConfig, include_status_tracker: e.target.checked })}
                      className="border-theme-surface-border bg-theme-surface-hover focus:ring-theme-focus-ring rounded-sm text-red-700 dark:text-red-500"
                    />
                    Application Tracker Link
                  </label>
                  <p className="text-theme-text-muted ml-6 text-xs">
                    Includes a link to the prospect's public status page so they can track their application progress.
                    Requires the public status page to be enabled.
                  </p>
                </div>

                {/* Custom Sections */}
                <div className="pt-2">
                  <h4 className="text-theme-text-secondary mb-3 text-sm font-medium">Custom Sections</h4>
                  {(emailConfig.custom_sections ?? []).map((section, idx) => (
                    <div key={section.id} className="border-theme-surface-border mb-3 space-y-3 rounded-lg border p-4">
                      <div className="flex items-center justify-between">
                        <label className="text-theme-text-secondary flex items-center gap-2 text-sm font-medium">
                          <input
                            type="checkbox"
                            checked={section.enabled}
                            onChange={(e) => {
                              const updated = [...(emailConfig.custom_sections ?? [])];
                              const item = updated[idx];
                              if (item) {
                                updated[idx] = { ...item, enabled: e.target.checked };
                                setConfig({ ...emailConfig, custom_sections: updated });
                              }
                            }}
                            className="border-theme-surface-border bg-theme-surface-hover focus:ring-theme-focus-ring rounded-sm text-red-700 dark:text-red-500"
                          />
                          Custom Section
                        </label>
                        <button
                          onClick={() => {
                            const updated = (emailConfig.custom_sections ?? []).filter((_, i) => i !== idx);
                            setConfig({ ...emailConfig, custom_sections: updated });
                          }}
                          className="text-theme-text-muted transition-colors hover:text-red-700 dark:hover:text-red-400"
                          aria-label={`Remove custom section ${idx + 1}`}
                        >
                          <Trash2 className="h-4 w-4" aria-hidden="true" />
                        </button>
                      </div>
                      <input
                        type="text"
                        value={section.title}
                        onChange={(e) => {
                          const updated = [...(emailConfig.custom_sections ?? [])];
                          const item = updated[idx];
                          if (item) {
                            updated[idx] = { ...item, title: e.target.value };
                            setConfig({ ...emailConfig, custom_sections: updated });
                          }
                        }}
                        placeholder="Section title"
                        aria-label={`Custom section ${idx + 1} title`}
                        className="bg-theme-surface-hover border-theme-surface-border text-theme-text-primary placeholder-theme-text-muted focus:ring-theme-focus-ring w-full rounded-lg border px-4 py-2 text-sm focus:ring-2 focus:outline-hidden"
                      />
                      <textarea
                        value={section.content}
                        onChange={(e) => {
                          const updated = [...(emailConfig.custom_sections ?? [])];
                          const item = updated[idx];
                          if (item) {
                            updated[idx] = { ...item, content: e.target.value };
                            setConfig({ ...emailConfig, custom_sections: updated });
                          }
                        }}
                        placeholder="Section content..."
                        rows={2}
                        aria-label={`Custom section ${idx + 1} content`}
                        className="bg-theme-surface-hover border-theme-surface-border text-theme-text-primary placeholder-theme-text-muted focus:ring-theme-focus-ring w-full resize-none rounded-lg border px-4 py-2.5 text-sm focus:ring-2 focus:outline-hidden"
                      />
                    </div>
                  ))}
                  <button
                    onClick={() => {
                      const newSection = {
                        id: crypto.randomUUID(),
                        title: '',
                        content: '',
                        enabled: true,
                      };
                      setConfig({
                        ...emailConfig,
                        custom_sections: [...(emailConfig.custom_sections ?? []), newSection],
                      });
                    }}
                    className="flex items-center gap-1 text-sm text-red-700 transition-colors hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                  >
                    <Plus className="h-3 w-3" aria-hidden="true" /> Add custom section
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Inactivity Timeout Override */}
          <div className="border-theme-surface-border border-t pt-6">
            <div className="mb-3 flex items-center gap-2">
              <Clock className="text-theme-text-muted h-4 w-4" aria-hidden="true" />
              <h3 className="text-theme-text-secondary text-sm font-medium">Inactivity Timeout Override</h3>
            </div>
            <p className="text-theme-text-muted mb-3 text-xs">
              Override the pipeline's default inactivity timeout for this stage. Useful for stages that naturally take
              longer (e.g., background checks, scheduling votes).
            </p>
            <label className="text-theme-text-secondary mb-3 flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={hasTimeoutOverride}
                onChange={(e) => setHasTimeoutOverride(e.target.checked)}
                className="border-theme-surface-border bg-theme-surface-hover focus:ring-theme-focus-ring rounded-sm text-red-700 dark:text-red-500"
              />
              Use a custom timeout for this stage
            </label>
            {hasTimeoutOverride && (
              <div className="ml-6 flex items-center gap-3">
                <input
                  type="number"
                  min={1}
                  max={730}
                  value={timeoutOverrideDays}
                  onChange={(e) => setTimeoutOverrideDays(Math.max(1, Number(e.target.value)))}
                  aria-label="Timeout override days"
                  className="bg-theme-surface-hover border-theme-surface-border text-theme-text-primary focus:ring-theme-focus-ring w-24 rounded-lg border px-3 py-2 text-sm focus:ring-2 focus:outline-hidden"
                />
                <span className="text-theme-text-muted text-sm">days before marked inactive</span>
              </div>
            )}
          </div>

          {/* Required toggle */}
          <label className="text-theme-text-secondary flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isRequired}
              onChange={(e) => setIsRequired(e.target.checked)}
              className="border-theme-surface-border bg-theme-surface-hover focus:ring-theme-focus-ring rounded-sm text-red-700 dark:text-red-500"
            />
            This stage is required (cannot be skipped)
          </label>

          {/* Prospect Notification & Public Visibility */}
          <div className="border-theme-surface-border space-y-3 border-t pt-6">
            <div className="mb-2 flex items-center gap-2">
              <Bell className="text-theme-text-muted h-4 w-4" aria-hidden="true" />
              <h3 className="text-theme-text-secondary text-sm font-medium">Prospect Communication</h3>
            </div>
            <label className="text-theme-text-secondary flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={notifyProspect}
                onChange={(e) => setNotifyProspect(e.target.checked)}
                className="border-theme-surface-border bg-theme-surface-hover focus:ring-theme-focus-ring rounded-sm text-red-700 dark:text-red-500"
              />
              Notify prospect when this stage is completed
            </label>
            <p className="text-theme-text-muted ml-6 text-xs">
              When checked, the prospect will receive an email notification when they advance past this stage.
            </p>
            <label className="text-theme-text-secondary flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={publicVisible}
                onChange={(e) => setPublicVisible(e.target.checked)}
                className="border-theme-surface-border bg-theme-surface-hover focus:ring-theme-focus-ring rounded-sm text-red-700 dark:text-red-500"
              />
              Show this stage on the public status page
            </label>
            <p className="text-theme-text-muted ml-6 text-xs">
              When unchecked, this stage will be hidden from the prospect's status check page. Useful for internal-only
              steps like background checks.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="border-theme-surface-border flex items-center justify-end gap-3 border-t p-6">
          <button
            onClick={onClose}
            className="text-theme-text-secondary hover:text-theme-text-primary px-4 py-2 transition-colors"
          >
            Cancel
          </button>
          <button onClick={handleSave} className="btn-primary px-6">
            {editingStage ? 'Update Stage' : 'Add Stage'}
          </button>
        </div>
      </div>
    </div>
  );
};
