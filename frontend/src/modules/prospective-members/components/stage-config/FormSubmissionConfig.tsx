import React from 'react';
import { Loader2, AlertCircle, CheckCircle } from 'lucide-react';
import type { FormStageConfig, StageConfig, FormPipelineValidation } from '../../types';
import type { FormDef } from '@/services/formTypes';
import { pipelineService } from '../../services/api';

interface FormSubmissionConfigProps {
  config: StageConfig;
  setConfig: React.Dispatch<React.SetStateAction<StageConfig>>;
  errors: Record<string, string>;
  setErrors: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  availableForms: FormDef[];
  formsLoading: boolean;
  formsError: string | null;
  retryLoadForms: () => void;
  formValidation: FormPipelineValidation | null;
  formValidationLoading: boolean;
  setFormValidation: React.Dispatch<React.SetStateAction<FormPipelineValidation | null>>;
  setFormValidationLoading: React.Dispatch<React.SetStateAction<boolean>>;
}

const FormSubmissionConfig: React.FC<FormSubmissionConfigProps> = ({
  config,
  setConfig,
  errors,
  setErrors,
  availableForms,
  formsLoading,
  formsError,
  retryLoadForms,
  formValidation,
  formValidationLoading,
  setFormValidation,
  setFormValidationLoading,
}) => {
  return (
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

      <label className="text-theme-text-secondary flex items-center gap-2 text-sm mt-4">
        <input
          type="checkbox"
          checked={(config as FormStageConfig).auto_advance ?? false}
          onChange={(e) => setConfig({ ...(config as FormStageConfig), auto_advance: e.target.checked })}
          className="border-theme-surface-border bg-theme-surface-hover focus:ring-theme-focus-ring rounded-sm text-red-700 dark:text-red-500"
        />
        Auto-advance when form is submitted
      </label>
      <p className="text-theme-text-muted text-xs ml-6">
        Automatically complete this step and advance the prospect when the linked form is submitted.
      </p>
    </div>
  );
};

export default FormSubmissionConfig;
