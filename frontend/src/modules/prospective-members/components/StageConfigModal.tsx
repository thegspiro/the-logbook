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
} from '../types';
import { DEFAULT_ELECTION_PACKAGE_FIELDS } from '../types';

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
];

const DEFAULT_CONFIGS: Record<StageType, () => FormStageConfig | DocumentStageConfig | ElectionStageConfig | ManualApprovalConfig> = {
  form_submission: () => ({ form_id: '', form_name: '' }),
  document_upload: () => ({ required_document_types: [''], allow_multiple: true }),
  election_vote: () => ({
    voting_method: 'simple_majority' as const,
    victory_condition: 'majority' as const,
    eligible_voter_roles: [],
    anonymous_voting: true,
  }),
  manual_approval: () => ({ approver_roles: [], require_notes: false }),
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
  const [config, setConfig] = useState<FormStageConfig | DocumentStageConfig | ElectionStageConfig | ManualApprovalConfig>(
    DEFAULT_CONFIGS.manual_approval()
  );
  const [isRequired, setIsRequired] = useState(true);
  const [notifyProspect, setNotifyProspect] = useState(false);
  const [publicVisible, setPublicVisible] = useState(true);
  const [hasTimeoutOverride, setHasTimeoutOverride] = useState(false);
  const [timeoutOverrideDays, setTimeoutOverrideDays] = useState<number>(180);
  const [errors, setErrors] = useState<Record<string, string>>({});

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

  const handleStageTypeChange = (type: StageType) => {
    setStageType(type);
    setConfig(DEFAULT_CONFIGS[type]());
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
              className="w-full bg-theme-surface-hover border border-theme-surface-border rounded-lg px-4 py-2.5 text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-red-500"
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
              className="w-full bg-theme-surface-hover border border-theme-surface-border rounded-lg px-4 py-2.5 text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-red-500 resize-none"
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
                  Form ID (from Forms module)
                </label>
                <input
                  id="stage-form-id"
                  type="text"
                  value={(config as FormStageConfig).form_id}
                  onChange={(e) =>
                    setConfig({ ...config, form_id: e.target.value } as FormStageConfig)
                  }
                  placeholder="Enter form ID or select from Forms module"
                  className="w-full bg-theme-surface-hover border border-theme-surface-border rounded-lg px-4 py-2.5 text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-red-500"
                />
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
                        className="flex-1 bg-theme-surface-hover border border-theme-surface-border rounded-lg px-4 py-2 text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-red-500"
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
                    className="rounded border-theme-surface-border bg-theme-surface-hover text-red-700 dark:text-red-500 focus:ring-red-500"
                  />
                  Allow multiple files per document type
                </label>
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
                    className="w-full bg-theme-surface-hover border border-theme-surface-border rounded-lg px-4 py-2.5 text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-red-500"
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
                    className="w-full bg-theme-surface-hover border border-theme-surface-border rounded-lg px-4 py-2.5 text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-red-500"
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
                      className="w-32 bg-theme-surface-hover border border-theme-surface-border rounded-lg px-4 py-2 text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-red-500"
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
                    className="rounded border-theme-surface-border bg-theme-surface-hover text-red-700 dark:text-red-500 focus:ring-red-500"
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
                            className="rounded border-theme-surface-border bg-theme-surface-hover text-red-700 dark:text-red-500 focus:ring-red-500"
                          />
                          Include email address
                        </label>
                        <label className="flex items-center gap-2 text-sm text-theme-text-secondary">
                          <input
                            type="checkbox"
                            checked={fields.include_phone}
                            onChange={(e) => updateField('include_phone', e.target.checked)}
                            className="rounded border-theme-surface-border bg-theme-surface-hover text-red-700 dark:text-red-500 focus:ring-red-500"
                          />
                          Include phone number
                        </label>
                        <label className="flex items-center gap-2 text-sm text-theme-text-secondary">
                          <input
                            type="checkbox"
                            checked={fields.include_address}
                            onChange={(e) => updateField('include_address', e.target.checked)}
                            className="rounded border-theme-surface-border bg-theme-surface-hover text-red-700 dark:text-red-500 focus:ring-red-500"
                          />
                          Include address
                        </label>
                        <label className="flex items-center gap-2 text-sm text-theme-text-secondary">
                          <input
                            type="checkbox"
                            checked={fields.include_date_of_birth}
                            onChange={(e) => updateField('include_date_of_birth', e.target.checked)}
                            className="rounded border-theme-surface-border bg-theme-surface-hover text-red-700 dark:text-red-500 focus:ring-red-500"
                          />
                          Include date of birth
                        </label>
                        <label className="flex items-center gap-2 text-sm text-theme-text-secondary">
                          <input
                            type="checkbox"
                            checked={fields.include_documents}
                            onChange={(e) => updateField('include_documents', e.target.checked)}
                            className="rounded border-theme-surface-border bg-theme-surface-hover text-red-700 dark:text-red-500 focus:ring-red-500"
                          />
                          Include uploaded documents
                        </label>
                        <label className="flex items-center gap-2 text-sm text-theme-text-secondary">
                          <input
                            type="checkbox"
                            checked={fields.include_stage_history}
                            onChange={(e) => updateField('include_stage_history', e.target.checked)}
                            className="rounded border-theme-surface-border bg-theme-surface-hover text-red-700 dark:text-red-500 focus:ring-red-500"
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
                            className="w-full bg-theme-surface-hover border border-theme-surface-border rounded-lg px-3 py-2 text-sm text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-red-500"
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
                    className="rounded border-theme-surface-border bg-theme-surface-hover text-red-700 dark:text-red-500 focus:ring-red-500"
                  />
                  Require approval notes
                </label>
                <p className="text-xs text-theme-text-muted">
                  Approver roles can be configured in the organization settings.
                  Any user with the <code className="text-theme-text-muted">prospective_members.manage</code> permission can approve.
                </p>
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
                className="rounded border-theme-surface-border bg-theme-surface-hover text-red-700 dark:text-red-500 focus:ring-red-500"
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
                  className="w-24 bg-theme-surface-hover border border-theme-surface-border rounded-lg px-3 py-2 text-theme-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
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
              className="rounded border-theme-surface-border bg-theme-surface-hover text-red-700 dark:text-red-500 focus:ring-red-500"
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
                className="rounded border-theme-surface-border bg-theme-surface-hover text-red-700 dark:text-red-500 focus:ring-red-500"
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
                className="rounded border-theme-surface-border bg-theme-surface-hover text-red-700 dark:text-red-500 focus:ring-red-500"
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
            className="px-6 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
          >
            {editingStage ? 'Update Stage' : 'Add Stage'}
          </button>
        </div>
      </div>
    </div>
  );
};
