import React from 'react';
import { Loader2, AlertCircle, ClipboardPen } from 'lucide-react';
import type { FollowUpFormStageConfig, StageConfig } from '../../types';
import type { FormDef } from '@/services/formTypes';

interface FollowUpFormConfigProps {
  config: StageConfig;
  setConfig: React.Dispatch<React.SetStateAction<StageConfig>>;
  errors: Record<string, string>;
  setErrors: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  availableForms: FormDef[];
  formsLoading: boolean;
  formsError: string | null;
  retryLoadForms: () => void;
}

/**
 * Settings for a Follow-up Form stage: which form to send, the message in the
 * link email, and whether submitting completes the stage.
 */
const FollowUpFormConfig: React.FC<FollowUpFormConfigProps> = ({
  config,
  setConfig,
  errors,
  setErrors,
  availableForms,
  formsLoading,
  formsError,
  retryLoadForms,
}) => {
  const followUp = config as FollowUpFormStageConfig;

  return (
    <div className="space-y-4">
      <div className="bg-theme-surface-hover border-theme-surface-border rounded-lg border p-4">
        <div className="mb-2 flex items-center gap-2">
          <ClipboardPen className="text-theme-text-muted h-4 w-4" aria-hidden="true" />
          <span className="text-theme-text-primary text-sm font-medium">Sends the applicant a form to complete</span>
        </div>
        <p className="text-theme-text-muted text-xs">
          When an applicant reaches this stage they are emailed a personal link to the form, which needs no sign-in.
          Fields set to pre-fill from the applicant open with what is on file, and a changed answer updates the
          applicant&rsquo;s record. Their answers save as they go, and the link works until they submit or the
          application is closed.
        </p>
      </div>

      <div>
        <label htmlFor="stage-follow-up-form-id" className="text-theme-text-muted mb-2 block text-sm">
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
              id="stage-follow-up-form-id"
              value={followUp.follow_up_form_id}
              onChange={(e) => {
                const formId = e.target.value;
                const selected = availableForms.find((f) => f.id === formId);
                setConfig({
                  ...followUp,
                  follow_up_form_id: formId,
                  follow_up_form_name: selected?.name ?? '',
                });
                setErrors((prev) => ({ ...prev, follow_up_form_id: '' }));
              }}
              className="form-input"
            >
              <option value="">Select a form...</option>
              {availableForms.map((form) => (
                <option key={form.id} value={form.id}>
                  {form.name}
                </option>
              ))}
            </select>
            <p className="text-theme-text-muted mt-1 text-xs">
              {availableForms.length === 0
                ? 'No published forms found. Build and publish the follow-up form in the Forms module first.'
                : 'Only published forms are listed. The form does not need to be public: applicants reach it through their own link.'}
            </p>
          </>
        )}
        {errors.follow_up_form_id && (
          <p className="mt-1 text-sm text-red-700 dark:text-red-400">{errors.follow_up_form_id}</p>
        )}
      </div>

      <div>
        <label htmlFor="stage-follow-up-message" className="text-theme-text-muted mb-2 block text-sm">
          Message in the link email (optional)
        </label>
        <textarea
          id="stage-follow-up-message"
          value={followUp.custom_message ?? ''}
          onChange={(e) => setConfig({ ...followUp, custom_message: e.target.value })}
          placeholder="e.g., Please complete this before your interview."
          rows={2}
          className="form-input resize-none"
        />
      </div>

      <label className="text-theme-text-secondary flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={followUp.auto_advance ?? true}
          onChange={(e) => setConfig({ ...followUp, auto_advance: e.target.checked })}
          className="form-checkbox"
        />
        Advance the applicant when they submit the form
      </label>
      <p className="text-theme-text-muted ml-6 text-xs">
        Unticked, the stage stays open after the form is submitted, for a coordinator to complete.
      </p>
    </div>
  );
};

export default FollowUpFormConfig;
