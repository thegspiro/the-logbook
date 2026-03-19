import React from 'react';
import { ExternalLink, Loader2, Globe, Send, Copy, Check, AlertTriangle } from 'lucide-react';
import { FormStatus } from '../../constants/enums';
import { useTimezone } from '../../hooks/useTimezone';
import { formatDate } from '../../utils/dateFormatting';
import type { FormSectionProps } from './types';

const FormSection: React.FC<FormSectionProps> = ({
  generatingForm,
  onGenerateForm,
  onNavigateToForms,
  eventRequestForms,
  loadingForms,
}) => {
  const tz = useTimezone();
  const [copiedSlug, setCopiedSlug] = React.useState<string | null>(null);

  const copyPublicUrl = (slug: string) => {
    const url = `${window.location.origin}/f/${slug}`;
    void navigator.clipboard.writeText(url);
    setCopiedSlug(slug);
    setTimeout(() => setCopiedSlug(null), 2000);
  };

  const statusBadge = (status: string) => {
    switch (status) {
      case FormStatus.PUBLISHED:
        return 'bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/30';
      case FormStatus.DRAFT:
        return 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-500/30';
      case FormStatus.ARCHIVED:
        return 'bg-theme-surface-secondary text-theme-text-muted border-theme-surface-border';
      default:
        return 'bg-theme-surface-secondary text-theme-text-muted border-theme-surface-border';
    }
  };

  const borderColor = (status: string) => {
    switch (status) {
      case FormStatus.PUBLISHED: return 'border-l-green-500';
      case FormStatus.DRAFT: return 'border-l-yellow-500';
      default: return 'border-l-theme-text-muted';
    }
  };

  const publishedForms = eventRequestForms.filter((f) => f.status === FormStatus.PUBLISHED);
  const draftForms = eventRequestForms.filter((f) => f.status === FormStatus.DRAFT);
  const archivedForms = eventRequestForms.filter((f) => f.status === FormStatus.ARCHIVED);

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-theme-text-primary">Public Event Request Form</h3>
        <p className="text-sm text-theme-text-muted mt-1">
          Generate a public form for community members to request outreach events.
        </p>
      </div>

      {/* Existing event request forms */}
      {loadingForms ? (
        <div className="flex items-center gap-2 text-theme-text-muted text-sm py-4">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading event request forms...
        </div>
      ) : eventRequestForms.length > 0 ? (
        <div className="space-y-4">
          {/* Published forms */}
          {publishedForms.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm font-medium text-theme-text-primary flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                Published &mdash; Accepting Submissions ({publishedForms.length})
              </h4>
              {publishedForms.map((form) => (
                <div
                  key={form.id}
                  className={`border border-theme-surface-border rounded-lg p-4 border-l-4 ${borderColor(form.status)}`}
                >
                  <div className="flex items-start justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm text-theme-text-primary">{form.name}</span>
                        <span className={`px-2 py-0.5 text-xs rounded-sm border ${statusBadge(form.status)}`}>
                          {form.status}
                        </span>
                        {form.is_public && (
                          <span className="px-2 py-0.5 text-xs bg-cyan-500/10 text-cyan-700 dark:text-cyan-400 rounded-sm border border-cyan-500/30 inline-flex items-center gap-1">
                            <Globe className="w-3 h-3" />
                            Public
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-xs text-theme-text-muted">
                        {form.published_at && (
                          <span>Published {formatDate(form.published_at, tz)}</span>
                        )}
                        <span>{form.submission_count ?? 0} submissions</span>
                      </div>
                    </div>
                  </div>
                  {form.is_public && form.public_slug && (
                    <div className="flex items-center gap-2 mt-2 bg-cyan-500/5 border border-cyan-500/20 rounded-lg px-3 py-2">
                      <Globe className="w-3.5 h-3.5 text-cyan-700 dark:text-cyan-400 shrink-0" />
                      <span className="text-cyan-700 dark:text-cyan-300 text-xs truncate flex-1">
                        {window.location.origin}/f/{form.public_slug}
                      </span>
                      <button
                        onClick={() => copyPublicUrl(form.public_slug ?? '')}
                        className="shrink-0 text-cyan-700 dark:text-cyan-400 hover:text-cyan-600 dark:hover:text-cyan-300 transition-colors"
                        aria-label="Copy public URL"
                      >
                        {copiedSlug === form.public_slug ? (
                          <Check className="w-3.5 h-3.5 text-green-600 dark:text-green-400" />
                        ) : (
                          <Copy className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Draft forms */}
          {draftForms.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm font-medium text-theme-text-primary flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-yellow-500" />
                Draft &mdash; Not Yet Published ({draftForms.length})
              </h4>
              {draftForms.map((form) => (
                <div
                  key={form.id}
                  className={`border border-theme-surface-border rounded-lg p-4 border-l-4 ${borderColor(form.status)}`}
                >
                  <div className="flex items-center justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm text-theme-text-primary">{form.name}</span>
                        <span className={`px-2 py-0.5 text-xs rounded-sm border ${statusBadge(form.status)}`}>
                          {form.status}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 mt-2 bg-yellow-500/10 border border-yellow-500/20 rounded-lg px-3 py-2">
                    <AlertTriangle className="w-3.5 h-3.5 text-yellow-600 dark:text-yellow-400 shrink-0" />
                    <span className="text-yellow-700 dark:text-yellow-300 text-xs">
                      This form must be published before it can accept submissions. Go to Forms to edit and publish.
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Archived forms */}
          {archivedForms.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm font-medium text-theme-text-muted flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-theme-text-muted" />
                Archived ({archivedForms.length})
              </h4>
              {archivedForms.map((form) => (
                <div
                  key={form.id}
                  className="border border-theme-surface-border rounded-lg p-3 border-l-4 border-l-theme-text-muted opacity-60"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm text-theme-text-muted">{form.name}</span>
                    <span className={`px-2 py-0.5 text-xs rounded-sm border ${statusBadge(form.status)}`}>
                      {form.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}

      {/* Generate new form */}
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
                <Send className="w-4 h-4" />
                Generate Event Request Form
              </>
            )}
          </button>
          <p className="text-xs text-theme-text-muted mt-2">
            The form will be created in Draft status. You can customize fields and publish it from the Forms page.
          </p>
        </div>

        <div className="border-t border-theme-surface-border pt-4">
          <button
            type="button"
            onClick={onNavigateToForms}
            className="text-sm text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            View all forms
          </button>
        </div>
      </div>
    </div>
  );
};

export default FormSection;
