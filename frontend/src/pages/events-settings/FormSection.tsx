import React from 'react';
import { FileText, ExternalLink, Loader2 } from 'lucide-react';
import type { FormSectionProps } from './types';

const FormSection: React.FC<FormSectionProps> = ({
  generatingForm,
  onGenerateForm,
  onNavigateToForms,
}) => {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-theme-text-primary">Public Event Request Form</h3>
        <p className="text-sm text-theme-text-muted mt-1">
          Generate a public form for community members to request outreach events.
        </p>
      </div>

      <div className="space-y-4">
        <div>
          <button
            type="button"
            onClick={onGenerateForm}
            disabled={generatingForm}
            className="btn-primary flex font-medium gap-2 items-center text-sm"
          >
            {generatingForm ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <FileText className="w-4 h-4" />
                Generate Event Request Form
              </>
            )}
          </button>
          <p className="text-xs text-theme-text-muted mt-2">
            The form will be created in Draft status and you will be redirected to the Forms page
            where you can customize fields and styling before publishing.
          </p>
        </div>

        <div className="border-t border-theme-surface-border pt-4">
          <button
            type="button"
            onClick={onNavigateToForms}
            className="text-sm text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            View all public forms
          </button>
        </div>
      </div>
    </div>
  );
};

export default FormSection;
