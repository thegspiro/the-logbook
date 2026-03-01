/**
 * Template Editor Component
 *
 * Provides form fields for editing an email template's subject, HTML body,
 * plain-text body, and CSS styles. Includes a variable insertion helper.
 */

import React, { useState, useRef } from 'react';
import {
  Save,
  Variable,
  Loader2,
  ChevronDown,
  ChevronUp,
  Info,
} from 'lucide-react';
import type { EmailTemplate, EmailTemplateUpdate, TemplateVariable } from '../types';

interface TemplateEditorProps {
  template: EmailTemplate;
  isSaving: boolean;
  onSave: (data: EmailTemplateUpdate) => void;
  onDirtyChange?: (dirty: boolean) => void;
}

export const TemplateEditor: React.FC<TemplateEditorProps> = ({
  template,
  isSaving,
  onSave,
  onDirtyChange,
}) => {
  const [subject, setSubject] = useState(template.subject);
  const [htmlBody, setHtmlBody] = useState(template.html_body);
  const [textBody, setTextBody] = useState(template.text_body ?? '');
  const [cssStyles, setCssStyles] = useState(template.css_styles ?? '');
  const [showCss, setShowCss] = useState(false);
  const [showTextBody, setShowTextBody] = useState(false);
  const [showVariables, setShowVariables] = useState(false);
  const htmlRef = useRef<HTMLTextAreaElement>(null);
  const subjectRef = useRef<HTMLInputElement>(null);

  // Track dirty state
  const isDirty =
    subject !== template.subject ||
    htmlBody !== template.html_body ||
    textBody !== (template.text_body ?? '') ||
    cssStyles !== (template.css_styles ?? '');

  React.useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  // Reset when template changes
  React.useEffect(() => {
    setSubject(template.subject);
    setHtmlBody(template.html_body);
    setTextBody(template.text_body ?? '');
    setCssStyles(template.css_styles ?? '');
  }, [template.id, template.subject, template.html_body, template.text_body, template.css_styles]);

  const handleSave = () => {
    const data: EmailTemplateUpdate = {};
    if (subject !== template.subject) data.subject = subject;
    if (htmlBody !== template.html_body) data.html_body = htmlBody;
    if (textBody !== (template.text_body ?? '')) data.text_body = textBody;
    if (cssStyles !== (template.css_styles ?? '')) data.css_styles = cssStyles;
    onSave(data);
  };

  const insertVariable = (variable: TemplateVariable) => {
    const tag = `{{${variable.name}}}`;
    const textarea = htmlRef.current;
    if (textarea) {
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const before = htmlBody.slice(0, start);
      const after = htmlBody.slice(end);
      setHtmlBody(before + tag + after);
      // Restore cursor position after the inserted tag
      requestAnimationFrame(() => {
        textarea.focus();
        textarea.selectionStart = start + tag.length;
        textarea.selectionEnd = start + tag.length;
      });
    } else {
      setHtmlBody((prev) => prev + tag);
    }
  };

  const labelClass = 'block text-sm font-medium text-theme-text-secondary mb-1';
  const inputClass =
    'w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary placeholder-slate-500 dark:placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-theme-focus-ring font-mono text-sm';

  return (
    <div className="space-y-4">
      {/* Header with save button */}
      <div className="flex items-center justify-between">
        <h3 className="text-theme-text-primary text-lg font-semibold">
          Edit Template
        </h3>
        <button
          onClick={handleSave}
          disabled={!isDirty || isSaving}
          className="flex items-center space-x-2 px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSaving ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Save className="w-4 h-4" />
          )}
          <span>Save Changes</span>
        </button>
      </div>

      {/* Subject */}
      <div>
        <label htmlFor="template-subject" className={labelClass}>
          Subject Line
        </label>
        <input
          ref={subjectRef}
          id="template-subject"
          type="text"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          className={inputClass.replace('font-mono', '')}
          placeholder="Email subject..."
        />
      </div>

      {/* Variable helper */}
      {template.available_variables.length > 0 && (
        <div className="card-secondary">
          <button
            onClick={() => setShowVariables(!showVariables)}
            className="w-full flex items-center justify-between px-4 py-2.5 text-sm text-theme-text-secondary hover:text-theme-text-primary transition-colors"
          >
            <span className="flex items-center space-x-2">
              <Variable className="w-4 h-4" />
              <span>Available Variables ({template.available_variables.length})</span>
            </span>
            {showVariables ? (
              <ChevronUp className="w-4 h-4" />
            ) : (
              <ChevronDown className="w-4 h-4" />
            )}
          </button>
          {showVariables && (
            <div className="px-4 pb-3 border-t border-theme-surface-border pt-3">
              <p className="text-theme-text-muted text-xs mb-2 flex items-center gap-1">
                <Info className="w-3 h-3" />
                Click a variable to insert it at the cursor in the HTML body.
              </p>
              <div className="flex flex-wrap gap-2">
                {template.available_variables.map((v) => (
                  <button
                    key={v.name}
                    onClick={() => insertVariable(v)}
                    title={v.description}
                    className="inline-flex items-center px-2.5 py-1 bg-orange-500/10 border border-orange-500/30 rounded text-xs text-orange-600 dark:text-orange-400 hover:bg-orange-500/20 transition-colors font-mono"
                  >
                    {`{{${v.name}}}`}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* HTML Body */}
      <div>
        <label htmlFor="template-html" className={labelClass}>
          HTML Body
        </label>
        <textarea
          ref={htmlRef}
          id="template-html"
          rows={16}
          value={htmlBody}
          onChange={(e) => setHtmlBody(e.target.value)}
          className={inputClass}
          placeholder="<div class='container'>...</div>"
        />
      </div>

      {/* Plain-text body (collapsible) */}
      <div>
        <button
          onClick={() => setShowTextBody(!showTextBody)}
          className="flex items-center space-x-2 text-sm text-theme-text-secondary hover:text-theme-text-primary transition-colors"
        >
          {showTextBody ? (
            <ChevronUp className="w-4 h-4" />
          ) : (
            <ChevronDown className="w-4 h-4" />
          )}
          <span>Plain-Text Body (Fallback)</span>
        </button>
        {showTextBody && (
          <textarea
            id="template-text"
            rows={8}
            value={textBody}
            onChange={(e) => setTextBody(e.target.value)}
            className={`${inputClass} mt-2`}
            placeholder="Plain text version for email clients that don't support HTML..."
          />
        )}
      </div>

      {/* CSS Styles (collapsible) */}
      <div>
        <button
          onClick={() => setShowCss(!showCss)}
          className="flex items-center space-x-2 text-sm text-theme-text-secondary hover:text-theme-text-primary transition-colors"
        >
          {showCss ? (
            <ChevronUp className="w-4 h-4" />
          ) : (
            <ChevronDown className="w-4 h-4" />
          )}
          <span>CSS Styles</span>
        </button>
        {showCss && (
          <textarea
            id="template-css"
            rows={8}
            value={cssStyles}
            onChange={(e) => setCssStyles(e.target.value)}
            className={`${inputClass} mt-2`}
            placeholder=".container { max-width: 600px; ... }"
          />
        )}
      </div>
    </div>
  );
};
