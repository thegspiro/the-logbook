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

const MEETING_TYPE_OPTIONS: { value: MeetingType; label: string; description: string }[] = [
  { value: 'chief_meeting', label: 'Meeting with Chief', description: 'One-on-one or small group meeting with the chief.' },
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
  const [config, setConfig] = useState<StageConfig>(
    DEFAULT_CONFIGS.manual_approval()
  );
  const [isRequired, setIsRequired] = useState(true);
  const [notifyProspect, setNotifyProspect] = useState(false);
  const [publicVisible, setPublicVisible] = useState(true);
  const [hasTimeoutOverride, setHasTimeoutOverride] = useState(false);
  const [timeoutOverrideDays, setTimeoutOverrideDays] = useState<number>(180);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [availableForms, setAvailableForms] = useState<FormDef[]>([]);
  const [formsLoading, setFormsLoading] = useState(false);
  const [formsError, setFormsError] = useState<string | null>(null);
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
    return () => { cancelled = true; };
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
    return () => { cancelled = true; };
  }, [isOpen]);

  useEffect(() => {
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
        <div className="flex items-center gap-2 text-sm text-theme-text-muted mt-2">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          Loading events...
        </div>
      );
    }
    const nextEvent = getNextEventForType(eventType);
    if (!nextEvent) {
      return (
        <p className="text-xs text-amber-600 dark:text-amber-400 mt-2">
          No upcoming {getEventTypeLabel(eventType).toLowerCase()} events found.
        </p>
      );
    }
    return (
      <div className="mt-2 rounded-md border border-theme-surface-border bg-theme-surface-hover p-3">
        <p className="text-xs font-medium text-theme-text-muted mb-1">Next upcoming event:</p>
        <p className="text-sm font-medium text-theme-text-primary">{nextEvent.title}</p>
        <p className="text-xs text-theme-text-muted mt-0.5">
          {formatDateTime(nextEvent.start_datetime)}
          {nextEvent.location_name ? ` — ${nextEvent.location_name}` : nextEvent.location ? ` — ${nextEvent.location}` : ''}
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
      (response) => { setAvailableForms(response.forms); setFormsLoading(false); },
      () => { setFormsError('Failed to load forms'); setFormsLoading(false); }
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
      const validTypes = c.required_document_types.filter(t => t.trim());
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
      sort_order: editingStage
        ? editingStage.sort_order
        : existingStageCount,
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
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="stage-config-modal-title"
      onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
    >
      <div className="bg-theme-surface-modal border border-theme-surface-border rounded-xl max-w-2xl w-full modal-body">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-theme-surface-border">
          <h2 id="stage-config-modal-title" className="text-xl font-bold text-theme-text-primary">
            {editingStage ? 'Edit Stage' : 'Add Pipeline Stage'}
          </h2>
          <button
            onClick={onClose}
            className="text-theme-text-muted hover:text-theme-text-primary transition-colors"
            aria-label="Close dialog"
          >
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 space-y-6">
          {/* Stage Name */}
          <div>
            <label htmlFor="stage-name" className="block text-sm font-medium text-theme-text-secondary mb-2">
              Stage Name <span aria-hidden="true">*</span>
            </label>
            <input
              id="stage-name"
              type="text"
              value={name}
              onChange={(e) => { setName(e.target.value); setErrors(prev => ({ ...prev, name: '' })); }}
              placeholder="e.g., Application Review"
              required
              aria-required="true"
              className="w-full bg-theme-surface-hover border border-theme-surface-border rounded-lg px-4 py-2.5 text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-theme-focus-ring"
            />
            {errors.name && <p className="mt-1 text-sm text-red-700 dark:text-red-400">{errors.name}</p>}
          </div>

          {/* Description */}
          <div>
            <label htmlFor="stage-description" className="block text-sm font-medium text-theme-text-secondary mb-2">
              Description
            </label>
            <textarea
              id="stage-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe what happens at this stage..."
              rows={2}
              className="w-full bg-theme-surface-hover border border-theme-surface-border rounded-lg px-4 py-2.5 text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-theme-focus-ring resize-none"
            />
          </div>

          {/* Stage Type */}
          <div>
            <label className="block text-sm font-medium text-theme-text-secondary mb-3">
              Stage Type *
            </label>
            <div className="form-grid-2">
              {STAGE_TYPE_OPTIONS.map((opt) => {
                const Icon = opt.icon;
                const selected = stageType === opt.value;
                return (
                  <button
                    key={opt.value}
                    onClick={() => handleStageTypeChange(opt.value)}
                    className={`flex flex-col items-start p-4 rounded-lg border transition-all text-left ${
                      selected
                        ? 'border-red-500 bg-red-500/10'
                        : 'border-theme-surface-border bg-theme-surface-hover hover:border-theme-surface-border'
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <Icon className={`w-4 h-4 ${selected ? 'text-red-700 dark:text-red-400' : 'text-theme-text-muted'}`} aria-hidden="true" />
                      <span className={`text-sm font-medium ${selected ? 'text-theme-text-primary' : 'text-theme-text-secondary'}`}>
                        {opt.label}
                      </span>
                    </div>
                    <p className="text-xs text-theme-text-muted">{opt.description}</p>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Type-Specific Configuration */}
          <div className="border-t border-theme-surface-border pt-6">
            <h3 className="text-sm font-medium text-theme-text-secondary mb-4">Stage Configuration</h3>

            {/* Form Submission Config */}
            {stageType === 'form_submission' && (
              <div>
                <label htmlFor="stage-form-id" className="block text-sm text-theme-text-muted mb-2">
                  Form
                </label>
                {formsLoading ? (
                  <div className="flex items-center gap-2 text-sm text-theme-text-muted py-2.5">
                    <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                    Loading forms...
                  </div>
                ) : formsError ? (
                  <div className="flex items-center gap-2 text-sm text-red-700 dark:text-red-400 py-2.5">
                    <AlertCircle className="w-4 h-4" aria-hidden="true" />
                    {formsError}
                    <button
                      type="button"
                      onClick={retryLoadForms}
                      className="text-red-700 dark:text-red-400 underline hover:no-underline"
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
                        const selectedForm = availableForms.find(f => f.id === e.target.value);
                        setConfig({
                          ...config,
                          form_id: e.target.value,
                          form_name: selectedForm?.name ?? '',
                        } as FormStageConfig);
                        setErrors(prev => ({ ...prev, form_id: '' }));
                      }}
                      className="w-full bg-theme-surface-hover border border-theme-surface-border rounded-lg px-4 py-2.5 text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-theme-focus-ring"
                    >
                      <option value="">Select a form...</option>
                      {availableForms.map((form) => (
                        <option key={form.id} value={form.id}>
                          {form.name}{form.category ? ` (${form.category})` : ''}
                        </option>
                      ))}
                    </select>
                    {availableForms.length === 0 && (
                      <p className="mt-1 text-xs text-theme-text-muted">
                        No published forms found. Create and publish a form in the Forms module first.
                      </p>
                    )}
                  </>
                )}
                {errors.form_id && (
                  <p className="mt-1 text-sm text-red-700 dark:text-red-400">{errors.form_id}</p>
                )}
              </div>
            )}

            {/* Document Upload Config */}
            {stageType === 'document_upload' && (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm text-theme-text-muted mb-2">
                    Required Document Types
                  </label>
                  {docConfig.required_document_types.map((docType, idx) => (
                    <div key={idx} className="flex items-center gap-2 mb-2">
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
                        className="flex-1 bg-theme-surface-hover border border-theme-surface-border rounded-lg px-4 py-2 text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-theme-focus-ring"
                      />
                      {docConfig.required_document_types.length > 1 && (
                        <button
                          onClick={() => {
                            const updated = docConfig.required_document_types.filter((_, i) => i !== idx);
                            setConfig({ ...docConfig, required_document_types: updated });
                          }}
                          className="text-theme-text-muted hover:text-red-700 dark:hover:text-red-400 transition-colors"
                          aria-label={`Remove document type ${idx + 1}`}
                        >
                          <Trash2 className="w-4 h-4" aria-hidden="true" />
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
                    className="flex items-center gap-1 text-sm text-red-700 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 transition-colors"
                  >
                    <Plus className="w-3 h-3" aria-hidden="true" /> Add document type
                  </button>
                  {errors.document_types && (
                    <p className="mt-1 text-sm text-red-700 dark:text-red-400">{errors.document_types}</p>
                  )}
                </div>
                <label className="flex items-center gap-2 text-sm text-theme-text-secondary">
                  <input
                    type="checkbox"
                    checked={docConfig.allow_multiple}
                    onChange={(e) =>
                      setConfig({ ...docConfig, allow_multiple: e.target.checked })
                    }
                    className="rounded border-theme-surface-border bg-theme-surface-hover text-red-700 dark:text-red-500 focus:ring-theme-focus-ring"
                  />
                  Allow multiple files per document type
                </label>
              </div>
            )}

            {/* Meeting Config */}
            {stageType === 'meeting' && (
              <div className="space-y-4">
                <div>
                  <label htmlFor="stage-meeting-type" className="block text-sm text-theme-text-muted mb-2">
                    Meeting Type
                  </label>
                  <select
                    id="stage-meeting-type"
                    value={meetingConfig.meeting_type}
                    onChange={(e) =>
                      setConfig({ ...meetingConfig, meeting_type: e.target.value as MeetingType })
                    }
                    className="w-full bg-theme-surface-hover border border-theme-surface-border rounded-lg px-4 py-2.5 text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-theme-focus-ring"
                  >
                    {MEETING_TYPE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-theme-text-muted">
                    {MEETING_TYPE_OPTIONS.find(o => o.value === meetingConfig.meeting_type)?.description}
                  </p>
                </div>
                <div>
                  <label htmlFor="stage-meeting-event-type" className="block text-sm text-theme-text-muted mb-2">
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
                    className="w-full bg-theme-surface-hover border border-theme-surface-border rounded-lg px-4 py-2.5 text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-theme-focus-ring"
                  >
                    <option value="">None — enter details manually</option>
                    {EVENT_TYPE_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        Next {opt.label}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-xs text-theme-text-muted">
                    Automatically pull details from the next upcoming event of this type.
                  </p>
                  {renderEventPreview(meetingConfig.linked_event_type)}
                </div>
                <div>
                  <label htmlFor="stage-meeting-description" className="block text-sm text-theme-text-muted mb-2">
                    Meeting Details (optional)
                  </label>
                  <textarea
                    id="stage-meeting-description"
                    value={meetingConfig.meeting_description ?? ''}
                    onChange={(e) =>
                      setConfig({ ...meetingConfig, meeting_description: e.target.value })
                    }
                    placeholder="e.g., Meet with Chief Smith to discuss expectations and department culture..."
                    rows={2}
                    className="w-full bg-theme-surface-hover border border-theme-surface-border rounded-lg px-4 py-2.5 text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-theme-focus-ring resize-none"
                  />
                </div>
              </div>
            )}

            {/* Election Vote Config */}
            {stageType === 'election_vote' && (
              <div className="space-y-4">
                <div>
                  <label htmlFor="stage-voting-method" className="block text-sm text-theme-text-muted mb-2">Voting Method</label>
                  <select
                    id="stage-voting-method"
                    value={electionConfig.voting_method}
                    onChange={(e) =>
                      setConfig({ ...electionConfig, voting_method: e.target.value as ElectionStageConfig['voting_method'] })
                    }
                    className="w-full bg-theme-surface-hover border border-theme-surface-border rounded-lg px-4 py-2.5 text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-theme-focus-ring"
                  >
                    <option value="simple_majority">Simple Majority</option>
                    <option value="approval">Approval Voting</option>
                    <option value="supermajority">Supermajority</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="stage-victory-condition" className="block text-sm text-theme-text-muted mb-2">Victory Condition</label>
                  <select
                    id="stage-victory-condition"
                    value={electionConfig.victory_condition}
                    onChange={(e) =>
                      setConfig({ ...electionConfig, victory_condition: e.target.value as ElectionStageConfig['victory_condition'] })
                    }
                    className="w-full bg-theme-surface-hover border border-theme-surface-border rounded-lg px-4 py-2.5 text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-theme-focus-ring"
                  >
                    <option value="most_votes">Most Votes</option>
                    <option value="majority">Majority (&gt;50%)</option>
                    <option value="supermajority">Supermajority</option>
                  </select>
                </div>
                {electionConfig.victory_condition === 'supermajority' && (
                  <div>
                    <label htmlFor="stage-victory-percentage" className="block text-sm text-theme-text-muted mb-2">
                      Required Percentage
                    </label>
                    <input
                      id="stage-victory-percentage"
                      type="number"
                      min={51}
                      max={100}
                      value={electionConfig.victory_percentage ?? 67}
                      onChange={(e) =>
                        setConfig({ ...electionConfig, victory_percentage: Number(e.target.value) })
                      }
                      className="w-32 bg-theme-surface-hover border border-theme-surface-border rounded-lg px-4 py-2 text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-theme-focus-ring"
                    />
                    <span className="ml-2 text-theme-text-muted text-sm">%</span>
                  </div>
                )}
                <label className="flex items-center gap-2 text-sm text-theme-text-secondary">
                  <input
                    type="checkbox"
                    checked={electionConfig.anonymous_voting}
                    onChange={(e) =>
                      setConfig({ ...electionConfig, anonymous_voting: e.target.checked })
                    }
                    className="rounded border-theme-surface-border bg-theme-surface-hover text-red-700 dark:text-red-500 focus:ring-theme-focus-ring"
                  />
                  Anonymous voting
                </label>

                {/* Election Package Fields */}
                <div className="border-t border-theme-surface-border pt-4 mt-4">
                  <h4 className="text-sm font-medium text-theme-text-secondary mb-2">
                    Election Package Contents
                  </h4>
                  <p className="text-xs text-theme-text-muted mb-3">
                    Choose what applicant information is included in the election package for voters and the secretary.
                  </p>
                  {(() => {
                    const fields: ElectionPackageFieldConfig =
                      electionConfig.package_fields ?? { ...DEFAULT_ELECTION_PACKAGE_FIELDS };
                    const updateField = (key: keyof ElectionPackageFieldConfig, value: boolean | string) => {
                      setConfig({
                        ...electionConfig,
                        package_fields: { ...fields, [key]: value },
                      });
                    };
                    return (
                      <div className="space-y-2">
                        <label className="flex items-center gap-2 text-sm text-theme-text-secondary">
                          <input
                            type="checkbox"
                            checked={fields.include_email}
                            onChange={(e) => updateField('include_email', e.target.checked)}
                            className="rounded border-theme-surface-border bg-theme-surface-hover text-red-700 dark:text-red-500 focus:ring-theme-focus-ring"
                          />
                          Include email address
                        </label>
                        <label className="flex items-center gap-2 text-sm text-theme-text-secondary">
                          <input
                            type="checkbox"
                            checked={fields.include_phone}
                            onChange={(e) => updateField('include_phone', e.target.checked)}
                            className="rounded border-theme-surface-border bg-theme-surface-hover text-red-700 dark:text-red-500 focus:ring-theme-focus-ring"
                          />
                          Include phone number
                        </label>
                        <label className="flex items-center gap-2 text-sm text-theme-text-secondary">
                          <input
                            type="checkbox"
                            checked={fields.include_address}
                            onChange={(e) => updateField('include_address', e.target.checked)}
                            className="rounded border-theme-surface-border bg-theme-surface-hover text-red-700 dark:text-red-500 focus:ring-theme-focus-ring"
                          />
                          Include address
                        </label>
                        <label className="flex items-center gap-2 text-sm text-theme-text-secondary">
                          <input
                            type="checkbox"
                            checked={fields.include_date_of_birth}
                            onChange={(e) => updateField('include_date_of_birth', e.target.checked)}
                            className="rounded border-theme-surface-border bg-theme-surface-hover text-red-700 dark:text-red-500 focus:ring-theme-focus-ring"
                          />
                          Include date of birth
                        </label>
                        <label className="flex items-center gap-2 text-sm text-theme-text-secondary">
                          <input
                            type="checkbox"
                            checked={fields.include_documents}
                            onChange={(e) => updateField('include_documents', e.target.checked)}
                            className="rounded border-theme-surface-border bg-theme-surface-hover text-red-700 dark:text-red-500 focus:ring-theme-focus-ring"
                          />
                          Include uploaded documents
                        </label>
                        <label className="flex items-center gap-2 text-sm text-theme-text-secondary">
                          <input
                            type="checkbox"
                            checked={fields.include_stage_history}
                            onChange={(e) => updateField('include_stage_history', e.target.checked)}
                            className="rounded border-theme-surface-border bg-theme-surface-hover text-red-700 dark:text-red-500 focus:ring-theme-focus-ring"
                          />
                          Include stage completion history
                        </label>
                        <div className="pt-1">
                          <label htmlFor="stage-custom-note-prompt" className="block text-xs text-theme-text-muted mb-1">
                            Custom note prompt (optional)
                          </label>
                          <input
                            id="stage-custom-note-prompt"
                            type="text"
                            value={fields.custom_note_prompt ?? ''}
                            onChange={(e) => updateField('custom_note_prompt', e.target.value)}
                            placeholder="e.g., Please describe the applicant's qualifications..."
                            className="w-full bg-theme-surface-hover border border-theme-surface-border rounded-lg px-3 py-2 text-sm text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-theme-focus-ring"
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
                <label className="flex items-center gap-2 text-sm text-theme-text-secondary">
                  <input
                    type="checkbox"
                    checked={approvalConfig.require_notes}
                    onChange={(e) =>
                      setConfig({ ...approvalConfig, require_notes: e.target.checked })
                    }
                    className="rounded border-theme-surface-border bg-theme-surface-hover text-red-700 dark:text-red-500 focus:ring-theme-focus-ring"
                  />
                  Require approval notes
                </label>
                <p className="text-xs text-theme-text-muted">
                  Approver roles can be configured in the organization settings.
                  Any user with the <code className="text-theme-text-muted">prospective_members.manage</code> permission can approve.
                </p>
              </div>
            )}

            {/* Status Page Toggle Config */}
            {stageType === 'status_page_toggle' && (
              <div className="space-y-4">
                <div className="bg-theme-surface-hover rounded-lg p-4 border border-theme-surface-border">
                  <div className="flex items-center gap-2 mb-2">
                    <Globe className="w-4 h-4 text-theme-text-muted" aria-hidden="true" />
                    <span className="text-sm font-medium text-theme-text-primary">
                      {statusPageConfig.enable_public_status ? 'Enables' : 'Disables'} the public status page
                    </span>
                  </div>
                  <p className="text-xs text-theme-text-muted">
                    When the prospect reaches this stage, their public status page will be
                    {statusPageConfig.enable_public_status ? ' activated' : ' deactivated'}.
                    They will receive a link to check their application progress.
                  </p>
                </div>
                <label className="flex items-center gap-2 text-sm text-theme-text-secondary">
                  <input
                    type="checkbox"
                    checked={statusPageConfig.enable_public_status}
                    onChange={(e) =>
                      setConfig({ ...statusPageConfig, enable_public_status: e.target.checked })
                    }
                    className="rounded border-theme-surface-border bg-theme-surface-hover text-red-700 dark:text-red-500 focus:ring-theme-focus-ring"
                  />
                  Enable public status page at this stage
                </label>
                <div>
                  <label htmlFor="stage-status-page-message" className="block text-sm text-theme-text-muted mb-2">
                    Custom Status Message (optional)
                  </label>
                  <textarea
                    id="stage-status-page-message"
                    value={statusPageConfig.custom_message ?? ''}
                    onChange={(e) =>
                      setConfig({ ...statusPageConfig, custom_message: e.target.value })
                    }
                    placeholder="e.g., Welcome! You can now track your application progress here."
                    rows={2}
                    className="w-full bg-theme-surface-hover border border-theme-surface-border rounded-lg px-4 py-2.5 text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-theme-focus-ring resize-none"
                  />
                </div>
              </div>
            )}

            {/* Automated Email Config */}
            {stageType === 'automated_email' && (
              <div className="space-y-4">
                <div>
                  <label htmlFor="stage-email-subject" className="block text-sm text-theme-text-muted mb-2">
                    Email Subject
                  </label>
                  <input
                    id="stage-email-subject"
                    type="text"
                    value={emailConfig.email_subject}
                    onChange={(e) =>
                      setConfig({ ...emailConfig, email_subject: e.target.value })
                    }
                    placeholder="e.g., Welcome to the Membership Process"
                    className="w-full bg-theme-surface-hover border border-theme-surface-border rounded-lg px-4 py-2.5 text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-theme-focus-ring"
                  />
                  {errors.email_subject && (
                    <p className="mt-1 text-sm text-red-700 dark:text-red-400">{errors.email_subject}</p>
                  )}
                </div>

                <p className="text-xs text-theme-text-muted">
                  Configure the sections to include in the email. The prospect's name will be used as the greeting automatically.
                </p>

                {/* Welcome Section */}
                <div className="rounded-lg border border-theme-surface-border p-4 space-y-3">
                  <label className="flex items-center gap-2 text-sm font-medium text-theme-text-secondary">
                    <input
                      type="checkbox"
                      checked={emailConfig.include_welcome}
                      onChange={(e) =>
                        setConfig({ ...emailConfig, include_welcome: e.target.checked })
                      }
                      className="rounded border-theme-surface-border bg-theme-surface-hover text-red-700 dark:text-red-500 focus:ring-theme-focus-ring"
                    />
                    Welcome Message
                  </label>
                  {emailConfig.include_welcome && (
                    <textarea
                      value={emailConfig.welcome_message ?? ''}
                      onChange={(e) =>
                        setConfig({ ...emailConfig, welcome_message: e.target.value })
                      }
                      placeholder="Thank you for your interest in joining our department! We look forward to getting to know you through this process."
                      rows={3}
                      aria-label="Welcome message content"
                      className="w-full bg-theme-surface-hover border border-theme-surface-border rounded-lg px-4 py-2.5 text-sm text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-theme-focus-ring resize-none"
                    />
                  )}
                </div>

                {/* FAQ Link Section */}
                <div className="rounded-lg border border-theme-surface-border p-4 space-y-3">
                  <label className="flex items-center gap-2 text-sm font-medium text-theme-text-secondary">
                    <input
                      type="checkbox"
                      checked={emailConfig.include_faq_link}
                      onChange={(e) =>
                        setConfig({ ...emailConfig, include_faq_link: e.target.checked })
                      }
                      className="rounded border-theme-surface-border bg-theme-surface-hover text-red-700 dark:text-red-500 focus:ring-theme-focus-ring"
                    />
                    Membership FAQ Link
                  </label>
                  {emailConfig.include_faq_link && (
                    <input
                      type="url"
                      value={emailConfig.faq_url ?? ''}
                      onChange={(e) =>
                        setConfig({ ...emailConfig, faq_url: e.target.value })
                      }
                      placeholder="https://your-department.com/membership-faq"
                      aria-label="FAQ URL"
                      className="w-full bg-theme-surface-hover border border-theme-surface-border rounded-lg px-4 py-2.5 text-sm text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-theme-focus-ring"
                    />
                  )}
                </div>

                {/* Next Meeting Section */}
                <div className="rounded-lg border border-theme-surface-border p-4 space-y-3">
                  <label className="flex items-center gap-2 text-sm font-medium text-theme-text-secondary">
                    <input
                      type="checkbox"
                      checked={emailConfig.include_next_meeting}
                      onChange={(e) =>
                        setConfig({ ...emailConfig, include_next_meeting: e.target.checked })
                      }
                      className="rounded border-theme-surface-border bg-theme-surface-hover text-red-700 dark:text-red-500 focus:ring-theme-focus-ring"
                    />
                    Next Meeting Details
                  </label>
                  {emailConfig.include_next_meeting && (
                    <div className="space-y-3">
                      <div>
                        <label htmlFor="email-meeting-event-type" className="block text-xs text-theme-text-muted mb-1.5">
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
                          className="w-full bg-theme-surface-hover border border-theme-surface-border rounded-lg px-4 py-2 text-sm text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-theme-focus-ring"
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
                        <label htmlFor="email-meeting-details" className="block text-xs text-theme-text-muted mb-1.5">
                          {emailConfig.next_meeting_event_type ? 'Additional details (optional)' : 'Meeting details'}
                        </label>
                        <textarea
                          id="email-meeting-details"
                          value={emailConfig.next_meeting_details ?? ''}
                          onChange={(e) =>
                            setConfig({ ...emailConfig, next_meeting_details: e.target.value })
                          }
                          placeholder={emailConfig.next_meeting_event_type
                            ? 'Any extra info to include alongside the event details...'
                            : 'Our next informational meeting is on the first Monday of the month at 7 PM at Station 1. All prospective members are encouraged to attend.'}
                          rows={2}
                          aria-label="Next meeting details"
                          className="w-full bg-theme-surface-hover border border-theme-surface-border rounded-lg px-4 py-2.5 text-sm text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-theme-focus-ring resize-none"
                        />
                      </div>
                    </div>
                  )}
                </div>

                {/* Application Tracker Section */}
                <div className="rounded-lg border border-theme-surface-border p-4 space-y-2">
                  <label className="flex items-center gap-2 text-sm font-medium text-theme-text-secondary">
                    <input
                      type="checkbox"
                      checked={emailConfig.include_status_tracker}
                      onChange={(e) =>
                        setConfig({ ...emailConfig, include_status_tracker: e.target.checked })
                      }
                      className="rounded border-theme-surface-border bg-theme-surface-hover text-red-700 dark:text-red-500 focus:ring-theme-focus-ring"
                    />
                    Application Tracker Link
                  </label>
                  <p className="text-xs text-theme-text-muted ml-6">
                    Includes a link to the prospect's public status page so they can track their application progress.
                    Requires the public status page to be enabled.
                  </p>
                </div>

                {/* Custom Sections */}
                <div className="pt-2">
                  <h4 className="text-sm font-medium text-theme-text-secondary mb-3">Custom Sections</h4>
                  {(emailConfig.custom_sections ?? []).map((section, idx) => (
                    <div key={section.id} className="rounded-lg border border-theme-surface-border p-4 mb-3 space-y-3">
                      <div className="flex items-center justify-between">
                        <label className="flex items-center gap-2 text-sm font-medium text-theme-text-secondary">
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
                            className="rounded border-theme-surface-border bg-theme-surface-hover text-red-700 dark:text-red-500 focus:ring-theme-focus-ring"
                          />
                          Custom Section
                        </label>
                        <button
                          onClick={() => {
                            const updated = (emailConfig.custom_sections ?? []).filter((_, i) => i !== idx);
                            setConfig({ ...emailConfig, custom_sections: updated });
                          }}
                          className="text-theme-text-muted hover:text-red-700 dark:hover:text-red-400 transition-colors"
                          aria-label={`Remove custom section ${idx + 1}`}
                        >
                          <Trash2 className="w-4 h-4" aria-hidden="true" />
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
                        className="w-full bg-theme-surface-hover border border-theme-surface-border rounded-lg px-4 py-2 text-sm text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-theme-focus-ring"
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
                        className="w-full bg-theme-surface-hover border border-theme-surface-border rounded-lg px-4 py-2.5 text-sm text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-theme-focus-ring resize-none"
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
                    className="flex items-center gap-1 text-sm text-red-700 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 transition-colors"
                  >
                    <Plus className="w-3 h-3" aria-hidden="true" /> Add custom section
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Inactivity Timeout Override */}
          <div className="border-t border-theme-surface-border pt-6">
            <div className="flex items-center gap-2 mb-3">
              <Clock className="w-4 h-4 text-theme-text-muted" aria-hidden="true" />
              <h3 className="text-sm font-medium text-theme-text-secondary">Inactivity Timeout Override</h3>
            </div>
            <p className="text-xs text-theme-text-muted mb-3">
              Override the pipeline's default inactivity timeout for this stage.
              Useful for stages that naturally take longer (e.g., background checks, scheduling votes).
            </p>
            <label className="flex items-center gap-2 text-sm text-theme-text-secondary mb-3">
              <input
                type="checkbox"
                checked={hasTimeoutOverride}
                onChange={(e) => setHasTimeoutOverride(e.target.checked)}
                className="rounded border-theme-surface-border bg-theme-surface-hover text-red-700 dark:text-red-500 focus:ring-theme-focus-ring"
              />
              Use a custom timeout for this stage
            </label>
            {hasTimeoutOverride && (
              <div className="flex items-center gap-3 ml-6">
                <input
                  type="number"
                  min={1}
                  max={730}
                  value={timeoutOverrideDays}
                  onChange={(e) => setTimeoutOverrideDays(Math.max(1, Number(e.target.value)))}
                  aria-label="Timeout override days"
                  className="w-24 bg-theme-surface-hover border border-theme-surface-border rounded-lg px-3 py-2 text-theme-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-theme-focus-ring"
                />
                <span className="text-sm text-theme-text-muted">days before marked inactive</span>
              </div>
            )}
          </div>

          {/* Required toggle */}
          <label className="flex items-center gap-2 text-sm text-theme-text-secondary">
            <input
              type="checkbox"
              checked={isRequired}
              onChange={(e) => setIsRequired(e.target.checked)}
              className="rounded border-theme-surface-border bg-theme-surface-hover text-red-700 dark:text-red-500 focus:ring-theme-focus-ring"
            />
            This stage is required (cannot be skipped)
          </label>

          {/* Prospect Notification & Public Visibility */}
          <div className="border-t border-theme-surface-border pt-6 space-y-3">
            <div className="flex items-center gap-2 mb-2">
              <Bell className="w-4 h-4 text-theme-text-muted" aria-hidden="true" />
              <h3 className="text-sm font-medium text-theme-text-secondary">Prospect Communication</h3>
            </div>
            <label className="flex items-center gap-2 text-sm text-theme-text-secondary">
              <input
                type="checkbox"
                checked={notifyProspect}
                onChange={(e) => setNotifyProspect(e.target.checked)}
                className="rounded border-theme-surface-border bg-theme-surface-hover text-red-700 dark:text-red-500 focus:ring-theme-focus-ring"
              />
              Notify prospect when this stage is completed
            </label>
            <p className="text-xs text-theme-text-muted ml-6">
              When checked, the prospect will receive an email notification when they advance past this stage.
            </p>
            <label className="flex items-center gap-2 text-sm text-theme-text-secondary">
              <input
                type="checkbox"
                checked={publicVisible}
                onChange={(e) => setPublicVisible(e.target.checked)}
                className="rounded border-theme-surface-border bg-theme-surface-hover text-red-700 dark:text-red-500 focus:ring-theme-focus-ring"
              />
              Show this stage on the public status page
            </label>
            <p className="text-xs text-theme-text-muted ml-6">
              When unchecked, this stage will be hidden from the prospect's status check page. Useful for internal-only steps like background checks.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-6 border-t border-theme-surface-border">
          <button
            onClick={onClose}
            className="px-4 py-2 text-theme-text-secondary hover:text-theme-text-primary transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="btn-primary px-6"
          >
            {editingStage ? 'Update Stage' : 'Add Stage'}
          </button>
        </div>
      </div>
    </div>
  );
};
