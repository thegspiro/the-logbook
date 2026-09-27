/**
 * The "Previous version" panel in the template editor.
 *
 * When the email redesign reset every template to the new default, each
 * template's earlier content was saved to a backup. This panel lists those
 * backups for the selected template and loads one back into the editor —
 * not as it was, but as a restore draft the server builds: the department's
 * own subject, plain text, title and message, inside the current design.
 * Nothing is saved until the admin reviews the preview and presses Save, so
 * loading a version is always reversible with Discard.
 *
 * Renders nothing for a template with no backups, which is every template
 * created after the redesign.
 */

import React, { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, History, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';

import { emailTemplatesService } from '../../../services/api';
import type { EmailTemplateBackup } from '../../../services/api';
import { useConfirm } from '../../../contexts/ConfirmContext';
import { useTimezone } from '../../../hooks/useTimezone';
import { formatDateTime } from '../../../utils/dateFormatting';
import { getErrorMessage } from '../../../utils/errorHandling';
import type { TemplateDraft } from '../hooks/useTemplateDraft';

interface TemplateBackupsPanelProps {
  templateId: string;
  draft: Pick<TemplateDraft, 'isDirty' | 'setSubject' | 'setHtmlBody' | 'setTextBody'>;
}

export const TemplateBackupsPanel: React.FC<TemplateBackupsPanelProps> = ({ templateId, draft }) => {
  const tz = useTimezone();
  const { confirm } = useConfirm();
  const [backups, setBackups] = useState<EmailTemplateBackup[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setLoadError(null);
    setBackups([]);
    setExpandedId(null);
    emailTemplatesService
      .getTemplateBackups(templateId)
      .then((result) => {
        if (!cancelled) setBackups(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(getErrorMessage(err, 'Could not load the previous version of this template.'));
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [templateId]);

  const loadIntoEditor = async (backup: EmailTemplateBackup) => {
    if (draft.isDirty) {
      const ok = await confirm({
        title: 'Replace your unsaved changes?',
        message:
          'Loading this version replaces the subject, message and plain-text body you are editing. ' +
          'Your unsaved changes to those fields will be lost.',
        confirmLabel: 'Load previous version',
        cancelLabel: 'Keep editing',
        variant: 'warning',
      });
      if (!ok) return;
    }
    draft.setSubject(backup.restored_subject);
    draft.setHtmlBody(backup.restored_html_body);
    draft.setTextBody(backup.restored_text_body ?? '');
    toast.success('Loaded into the editor. Check the preview, then Save to keep it.');
  };

  if (isLoading) {
    return (
      <div className="text-theme-text-muted mb-4 flex items-center gap-2 text-xs" aria-live="polite">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        Checking for a previous version…
      </div>
    );
  }

  if (loadError) {
    return (
      <p className="text-theme-text-muted mb-4 text-xs" role="status">
        {loadError}
      </p>
    );
  }

  if (backups.length === 0) return null;

  return (
    <section className="alert-info mb-4" aria-labelledby={`backups-${templateId}`}>
      <h4
        id={`backups-${templateId}`}
        className="text-theme-text-primary flex items-center gap-2 text-sm font-semibold"
      >
        <History className="h-4 w-4" aria-hidden="true" />
        Previous version (before the redesign)
      </h4>
      <p className="text-theme-text-secondary mt-1 text-xs">
        This template was reset to the new email design. Your department&apos;s earlier wording was saved. Loading it
        puts that wording into the new design in the editor; nothing changes until you Save.
      </p>

      <ul className="mt-3 space-y-3">
        {backups.map((backup) => {
          const expanded = expandedId === backup.id;
          return (
            <li key={backup.id} className="border-theme-surface-border bg-theme-surface rounded-lg border p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-theme-text-primary truncate text-sm font-medium">
                    {backup.subject || '(no subject)'}
                  </p>
                  <p className="text-theme-text-muted text-xs">Saved {formatDateTime(backup.created_at, tz)}</p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    void loadIntoEditor(backup);
                  }}
                  className="btn-primary mobile-touch-target px-3 py-1.5 text-sm"
                >
                  Load this wording
                </button>
              </div>
              {backup.text_body && (
                <>
                  <button
                    type="button"
                    onClick={() => setExpandedId(expanded ? null : backup.id)}
                    aria-expanded={expanded}
                    className="text-theme-text-secondary hover:text-theme-text-primary mt-2 flex items-center gap-1 text-xs transition-colors"
                  >
                    {expanded ? (
                      <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                    )}
                    {expanded ? 'Hide the old wording' : 'Show the old wording'}
                  </button>
                  {expanded && (
                    <pre className="text-theme-text-secondary bg-theme-surface-secondary mt-2 max-h-64 overflow-auto rounded p-3 text-xs whitespace-pre-wrap">
                      {backup.text_body}
                    </pre>
                  )}
                </>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
};
