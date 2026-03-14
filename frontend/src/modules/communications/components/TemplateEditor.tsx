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
  const [defaultCc, setDefaultCc] = useState((template.default_cc ?? []).join(', '));
  const [defaultBcc, setDefaultBcc] = useState((template.default_bcc ?? []).join(', '));
  const [showCss, setShowCss] = useState(false);
  const [showTextBody, setShowTextBody] = useState(false);
  const [showVariables, setShowVariables] = useState(false);
  const [showRecipients, setShowRecipients] = useState(
    () => (template.default_cc?.length ?? 0) > 0 || (template.default_bcc?.length ?? 0) > 0,
  );
  const htmlRef = useRef<HTMLTextAreaElement>(null);
  const subjectRef = useRef<HTMLInputElement>(null);

  // Parse comma-separated emails into arrays (empty string → empty array)
  const parsedCc = defaultCc.split(',').map((e) => e.trim()).filter(Boolean);
  const parsedBcc = defaultBcc.split(',').map((e) => e.trim()).filter(Boolean);
  const origCc = (template.default_cc ?? []).join(', ');
  const origBcc = (template.default_bcc ?? []).join(', ');

  // Track dirty state
  const isDirty =
    subject !== template.subject ||
    htmlBody !== template.html_body ||
    textBody !== (template.text_body ?? '') ||
    cssStyles !== (template.css_styles ?? '') ||
    defaultCc !== origCc ||
    defaultBcc !== origBcc;

  React.useEffect(() => {
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  // Reset when template changes
  React.useEffect(() => {
    setSubject(template.subject);
    setHtmlBody(template.html_body);
    setTextBody(template.text_body ?? '');
    setCssStyles(template.css_styles ?? '');
    setDefaultCc((template.default_cc ?? []).join(', '));
    setDefaultBcc((template.default_bcc ?? []).join(', '));
    setShowRecipients(
      (template.default_cc?.length ?? 0) > 0 || (template.default_bcc?.length ?? 0) > 0,
    );
  }, [template.id, template.subject, template.html_body, template.text_body, template.css_styles, template.default_cc, template.default_bcc]);

  const handleSave = () => {
    const data: EmailTemplateUpdate = {};
    if (subject !== template.subject) data.subject = subject;
    if (htmlBody !== template.html_body) data.html_body = htmlBody;
    if (textBody !== (template.text_body ?? '')) data.text_body = textBody;
    if (cssStyles !== (template.css_styles ?? '')) data.css_styles = cssStyles;
    if (defaultCc !== origCc) data.default_cc = parsedCc.length > 0 ? parsedCc : null;
    if (defaultBcc !== origBcc) data.default_bcc = parsedBcc.length > 0 ? parsedBcc : null;
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

  const labelClass = 'form-label';
  const inputClass =
    'form-input font-mono';

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

      {/* Default CC / BCC (collapsible) */}
      <div>
        <button
          onClick={() => setShowRecipients(!showRecipients)}
          className="flex items-center space-x-2 text-sm text-theme-text-secondary hover:text-theme-text-primary transition-colors"
        >
          {showRecipients ? (
            <ChevronUp className="w-4 h-4" />
          ) : (
            <ChevronDown className="w-4 h-4" />
          )}
          <span>Default CC / BCC Recipients</span>
        </button>
        {showRecipients && (
          <div className="mt-2 space-y-3">
            <div>
              <label htmlFor="template-default-cc" className={labelClass}>
                Default CC (comma-separated)
              </label>
              <input
                id="template-default-cc"
                type="text"
                value={defaultCc}
                onChange={(e) => setDefaultCc(e.target.value)}
                className={inputClass.replace('font-mono', '')}
                placeholder="chief@dept.org, admin@dept.org"
              />
              <p className="mt-1 text-xs text-theme-text-muted">
                These addresses will be CC'd on every email sent with this template.
              </p>
            </div>
            <div>
              <label htmlFor="template-default-bcc" className={labelClass}>
                Default BCC (comma-separated)
              </label>
              <input
                id="template-default-bcc"
                type="text"
                value={defaultBcc}
                onChange={(e) => setDefaultBcc(e.target.value)}
                className={inputClass.replace('font-mono', '')}
                placeholder="records@dept.org"
              />
              <p className="mt-1 text-xs text-theme-text-muted">
                These addresses will be BCC'd (hidden from other recipients) on every email sent with this template.
              </p>
            </div>
          </div>
        )}
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
                    className="inline-flex items-center px-2.5 py-1 bg-orange-500/10 border border-orange-500/30 rounded-sm text-xs text-orange-600 dark:text-orange-400 hover:bg-orange-500/20 transition-colors font-mono"
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
