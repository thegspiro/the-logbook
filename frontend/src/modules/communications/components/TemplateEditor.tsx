/**
 * Template Editor Component
 *
 * The form fields for one email template: subject, footer, CC/BCC, the
 * variable and block palettes, the HTML body, and the collapsed plain-text
 * and CSS boxes.
 *
 * It does not own the draft and does not own Save. Both live in the page:
 * Save is a sticky pair in the header, because with the editor and preview
 * side by side the button was scrolling out of sight while the thing it saves
 * stayed on screen; and the draft has a second reader now — the live preview
 * renders the body you are typing, not the one on the server.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Variable, ChevronDown, ChevronUp, Info, UserCheck } from 'lucide-react';
import type { EmailFooter, EmailTemplate, TemplateVariable } from '../types';
import type { TemplateDraft } from '../hooks/useTemplateDraft';
import { BlockPalette } from './BlockPalette';
import { COLOURWAYS, EMAIL_LAYOUTS, FALLBACK_COLOURWAY } from '../constants/blocks';

interface TemplateEditorProps {
  template: EmailTemplate;
  /** The unsaved state, owned by the page. */
  draft: TemplateDraft;
  /**
   * Signature variables from the department office directory. Kept separate
   * from the template's own variables: they apply to every template, so
   * folding them into one list would bury the type-specific ones.
   */
  officerVariables?: TemplateVariable[];
  /** The department's footer library, for the "closes with" picker. */
  footers?: EmailFooter[];
  /** Which footer a template that has not chosen one renders with. */
  footerDefaultKey?: string;
}

export const TemplateEditor: React.FC<TemplateEditorProps> = ({
  template,
  draft,
  officerVariables = [],
  footers = [],
  footerDefaultKey = '',
}) => {
  const {
    subject,
    setSubject,
    htmlBody,
    setHtmlBody,
    textBody,
    setTextBody,
    cssStyles,
    setCssStyles,
    footerKey,
    setFooterKey,
    headerAccent,
    setHeaderAccent,
    statusChip,
    setStatusChip,
    layout,
    setLayout,
    defaultCc,
    setDefaultCc,
    defaultBcc,
    setDefaultBcc,
    ccError,
    bccError,
  } = draft;

  const [showCss, setShowCss] = useState(false);
  const [showTextBody, setShowTextBody] = useState(false);
  const [showVariables, setShowVariables] = useState(false);
  const [showOfficerVariables, setShowOfficerVariables] = useState(false);
  const [showRecipients, setShowRecipients] = useState(
    () => (template.default_cc?.length ?? 0) > 0 || (template.default_bcc?.length ?? 0) > 0
  );
  const htmlRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setShowRecipients((template.default_cc?.length ?? 0) > 0 || (template.default_bcc?.length ?? 0) > 0);
  }, [template.id, template.default_cc, template.default_bcc]);

  /**
   * Drop *snippet* in at the cursor, or append when the textarea has never
   * been focused. Generalised from the variable chips, which did exactly this
   * for a `{{tag}}` — a block is the same operation with a longer string.
   */
  const insertSnippet = useCallback(
    (snippet: string) => {
      const textarea = htmlRef.current;
      if (!textarea) {
        setHtmlBody((prev) => prev + snippet);
        return;
      }
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      setHtmlBody((prev) => prev.slice(0, start) + snippet + prev.slice(end));
      // The cursor lands after what was inserted, so a run of clicks builds a
      // body in order rather than stacking everything at one offset.
      requestAnimationFrame(() => {
        textarea.focus();
        textarea.selectionStart = start + snippet.length;
        textarea.selectionEnd = start + snippet.length;
      });
    },
    [setHtmlBody]
  );

  const insertVariable = useCallback(
    (variable: TemplateVariable) => insertSnippet(`{{${variable.name}}}`),
    [insertSnippet]
  );

  const labelClass = 'form-label';
  const inputClass = 'form-input font-mono';
  const plainInputClass = 'form-input';

  // Falls back to the first colourway so the preview pill is never colourless
  // for a template that predates these columns.
  const chipPreview = COLOURWAYS.find((c) => c.accent === headerAccent.toLowerCase()) ?? FALLBACK_COLOURWAY;

  const defaultFooter = footers.find((footer) => footer.key === footerDefaultKey);
  // Falls back to the default footer, matching what the renderer does with a
  // key naming a footer that has since been deleted.
  const selectedFooter = footers.find((footer) => footer.key === footerKey) ?? defaultFooter;

  return (
    <div className="space-y-4">
      {/* Subject */}
      <div>
        <div className="flex items-center justify-between">
          <label htmlFor="template-subject" className={labelClass}>
            Subject Line
          </label>
          <span
            className={`text-xs ${subject.length > 60 ? 'text-yellow-500' : 'text-theme-text-muted'}`}
            aria-live="polite"
          >
            {subject.length}/500{subject.length > 60 ? ' — may be truncated in some email clients' : ''}
          </span>
        </div>
        <input
          id="template-subject"
          type="text"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          className={plainInputClass}
          placeholder="Email subject..."
          maxLength={500}
          aria-describedby="subject-hint"
        />
      </div>

      {/* Footer */}
      {footers.length > 0 && (
        <div>
          <label htmlFor="template-footer" className={labelClass}>
            Closes with
          </label>
          <select
            id="template-footer"
            value={footerKey}
            onChange={(e) => setFooterKey(e.target.value)}
            className="form-input"
            aria-describedby="footer-hint"
          >
            <option value="">
              Department default
              {defaultFooter ? ` — ${defaultFooter.name}` : ''}
            </option>
            {footers.map((footer) => (
              <option key={footer.key} value={footer.key}>
                {footer.name}
              </option>
            ))}
          </select>
          <p id="footer-hint" className="text-theme-text-muted mt-1 text-xs">
            {selectedFooter?.description ||
              'Edit the wording under the Footers tab — it applies to every template using it.'}
          </p>
        </div>
      )}

      {/* Layout and accent.
          Both are columns on the template rather than hexes buried in the
          body, which is what makes a colourway something an officer can
          change from here instead of it taking a deploy. The seven accents
          are the only ones the API accepts: each carries white button text
          and tints a chip behind text of its own colour, and both are easy
          to get wrong by eye and fail for the member squinting at a phone
          in daylight. */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <span className={labelClass}>Layout</span>
          <div className="bg-theme-surface-secondary mt-1 flex rounded-lg p-0.5">
            {EMAIL_LAYOUTS.map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => setLayout(option.id)}
                aria-pressed={(layout || 'notice') === option.id}
                title={option.hint}
                className={`mobile-touch-target flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors ${
                  (layout || 'notice') === option.id
                    ? 'bg-red-800 text-white'
                    : 'text-theme-text-muted hover:text-theme-text-primary'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <span className={labelClass}>Header accent</span>
          <div className="mt-1 flex flex-wrap gap-2">
            {COLOURWAYS.map((option) => {
              const isSelected = headerAccent.toLowerCase() === option.accent;
              return (
                <button
                  key={option.accent}
                  type="button"
                  onClick={() => setHeaderAccent(option.accent)}
                  aria-pressed={isSelected}
                  aria-label={option.label}
                  title={option.label}
                  style={{ backgroundColor: option.accent }}
                  className={`h-[22px] w-[22px] rounded-md transition-shadow ${
                    isSelected ? 'ring-2 ring-white ring-offset-2 ring-offset-current' : ''
                  }`}
                />
              );
            })}
          </div>
        </div>
      </div>

      {/* Status chip */}
      <div>
        <label htmlFor="template-chip" className={labelClass}>
          Status chip
        </label>
        <div className="flex items-center gap-3">
          <input
            id="template-chip"
            type="text"
            value={statusChip}
            onChange={(e) => setStatusChip(e.target.value)}
            className={`${plainInputClass} flex-1`}
            placeholder="Action required"
            maxLength={40}
            aria-describedby="chip-hint"
          />
          {/* Shown as it will render, because the chip is uppercased and
              letter-spaced by the email stylesheet — what is typed here and
              what a member sees are not the same string. */}
          <span
            className="inline-block shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold tracking-[0.08em] uppercase"
            style={{
              backgroundColor: chipPreview.tint,
              color: chipPreview.accent,
            }}
          >
            {statusChip || 'No chip'}
          </span>
        </div>
        <p id="chip-hint" className="text-theme-text-muted mt-1 text-xs">
          Leave it empty and the header carries no chip at all.
        </p>
      </div>

      {/* Default CC / BCC (collapsible) */}
      <div>
        <button
          onClick={() => setShowRecipients(!showRecipients)}
          className="text-theme-text-secondary hover:text-theme-text-primary flex items-center space-x-2 text-sm transition-colors"
        >
          {showRecipients ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
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
                className={`${plainInputClass} ${ccError ? 'border-red-500' : ''}`}
                placeholder="chief@dept.org, admin@dept.org"
                aria-invalid={!!ccError}
                aria-describedby="cc-hint"
              />
              {ccError ? (
                <p className="mt-1 text-xs text-red-500">{ccError}</p>
              ) : (
                <p id="cc-hint" className="text-theme-text-muted mt-1 text-xs">
                  These addresses will be CC'd on every email sent with this template.
                </p>
              )}
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
                className={`${plainInputClass} ${bccError ? 'border-red-500' : ''}`}
                placeholder="records@dept.org"
                aria-invalid={!!bccError}
                aria-describedby="bcc-hint"
              />
              {bccError ? (
                <p className="mt-1 text-xs text-red-500">{bccError}</p>
              ) : (
                <p id="bcc-hint" className="text-theme-text-muted mt-1 text-xs">
                  These addresses will be BCC'd (hidden from other recipients) on every email sent with this template.
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Blocks */}
      <BlockPalette onInsert={insertSnippet} />

      {/* Variable helper */}
      {template.available_variables.length > 0 && (
        <div className="card-secondary">
          <button
            onClick={() => setShowVariables(!showVariables)}
            className="text-theme-text-secondary hover:text-theme-text-primary flex w-full items-center justify-between px-4 py-2.5 text-sm transition-colors"
          >
            <span className="flex items-center space-x-2">
              <Variable className="h-4 w-4" />
              <span>Available Variables ({template.available_variables.length})</span>
            </span>
            {showVariables ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
          {showVariables && (
            <div className="border-theme-surface-border border-t px-4 pt-3 pb-3">
              <p className="text-theme-text-muted mb-2 flex items-center gap-1 text-xs">
                <Info className="h-3 w-3" />
                Click a variable to insert it at the cursor in the HTML body.
              </p>
              <div className="flex flex-wrap gap-2">
                {template.available_variables.map((v) => (
                  <button
                    key={v.name}
                    onClick={() => insertVariable(v)}
                    title={v.description}
                    className="inline-flex items-center rounded-sm border border-red-500/30 bg-red-500/10 px-2.5 py-1 font-mono text-xs text-red-600 transition-colors hover:bg-red-500/20 dark:text-red-400"
                  >
                    {`{{${v.name}}}`}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Officer signature variables (available to every template) */}
      {officerVariables.length > 0 && (
        <div className="card-secondary">
          <button
            onClick={() => setShowOfficerVariables(!showOfficerVariables)}
            className="text-theme-text-secondary hover:text-theme-text-primary flex w-full items-center justify-between px-4 py-2.5 text-sm transition-colors"
          >
            <span className="flex items-center space-x-2">
              <UserCheck className="h-4 w-4" />
              <span>Officer Signature Variables ({officerVariables.length})</span>
            </span>
            {showOfficerVariables ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
          {showOfficerVariables && (
            <div className="border-theme-surface-border border-t px-4 pt-3 pb-3">
              <p className="text-theme-text-muted mb-2 flex items-center gap-1 text-xs">
                <Info className="h-3 w-3" />
                Resolved from the Officers tab, so a message is signed by whoever holds the office.
              </p>
              <div className="flex flex-wrap gap-2">
                {officerVariables.map((v) => (
                  <button
                    key={v.name}
                    onClick={() => insertVariable(v)}
                    title={v.description}
                    className="inline-flex items-center rounded-sm border border-blue-500/30 bg-blue-500/10 px-2.5 py-1 font-mono text-xs text-blue-600 transition-colors hover:bg-blue-500/20 dark:text-blue-400"
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
          className="text-theme-text-secondary hover:text-theme-text-primary flex items-center space-x-2 text-sm transition-colors"
        >
          {showTextBody ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
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
          className="text-theme-text-secondary hover:text-theme-text-primary flex items-center space-x-2 text-sm transition-colors"
        >
          {showCss ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          <span>CSS Styles</span>
        </button>
        {showCss && (
          <>
            <textarea
              id="template-css"
              rows={8}
              value={cssStyles}
              onChange={(e) => setCssStyles(e.target.value)}
              className={`${inputClass} mt-2`}
              placeholder=".container { max-width: 600px; ... }"
              aria-describedby="css-hint"
            />
            <p id="css-hint" className="text-theme-text-muted mt-1 text-xs">
              {cssStyles.trim()
                ? 'This template uses its own styles. Clear this box to go back to the built-in ones, which are kept up to date for you.'
                : 'Using the built-in styles. Anything you put here replaces them for this template only, and stops it picking up future improvements.'}
            </p>
          </>
        )}
      </div>
    </div>
  );
};
