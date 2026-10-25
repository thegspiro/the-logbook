/**
 * The "Allow embedding" block of a form's Share dialog.
 *
 * Embedding needs two switches, at two levels: this form's own, and the
 * department's list of websites (Organization Settings → Forms). The block
 * says which one is missing rather than offering embed code that would show a
 * blank frame on the department's site.
 */

import React, { useEffect, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Link } from 'react-router';
import { organizationService } from '../../services/api';
import type { FormDef } from '../../services/api';
import { buildFormEmbedSnippet } from '../../utils/formEmbedSnippet';

interface FormEmbedShareProps {
  form: FormDef;
  onToggleEmbed: (form: FormDef) => void;
}

export const FormEmbedShare: React.FC<FormEmbedShareProps> = ({ form, onToggleEmbed }) => {
  const [origins, setOrigins] = useState<string[] | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    organizationService
      .getSettings()
      .then((data) => {
        if (!cancelled) setOrigins(data.forms?.embed_allowed_origins ?? []);
      })
      .catch(() => {
        if (!cancelled) setOrigins([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const needsSignIn = form.require_authentication || !form.allow_multiple_submissions;
  const snippet = form.public_slug ? buildFormEmbedSnippet(window.location.origin, form.public_slug, form.name) : '';

  const copySnippet = () => {
    void navigator.clipboard.writeText(snippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-3">
      <label htmlFor="share-allow-embed" className="card-secondary mobile-touch-row cursor-pointer gap-3 p-4">
        <input
          type="checkbox"
          id="share-allow-embed"
          checked={form.allow_embed}
          onChange={() => onToggleEmbed(form)}
          className="form-checkbox shrink-0"
        />
        <span className="text-sm">
          <span className="text-theme-text-primary block font-medium">Allow embedding on your website</span>
          <span className="text-theme-text-muted mt-0.5 block text-xs">
            Shows this form inside a page on your department&rsquo;s own website, and only there.
          </span>
        </span>
      </label>

      {form.allow_embed && origins !== null && origins.length === 0 && (
        <div className="alert-warning text-sm" role="note">
          Your department has not listed its website yet, so the form will not show anywhere. Add it under{' '}
          <Link to="/settings?tab=forms" className="font-semibold underline">
            Organization Settings &rarr; Forms
          </Link>{' '}
          (needs the settings permission).
        </div>
      )}

      {form.allow_embed && origins !== null && origins.length > 0 && snippet && (
        <div>
          <label htmlFor="share-embed-code" className="text-theme-text-secondary mb-2 block text-sm font-medium">
            Embed code
          </label>
          <textarea
            id="share-embed-code"
            readOnly
            rows={6}
            value={snippet}
            className="form-input w-full font-mono text-xs"
            onFocus={(e) => e.currentTarget.select()}
          />
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <p className="text-theme-text-muted text-xs">Works on: {origins.join(', ')}</p>
            <button type="button" onClick={copySnippet} className="btn-secondary flex items-center gap-1.5">
              {copied ? (
                <Check className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Copy className="h-4 w-4" aria-hidden="true" />
              )}
              {copied ? 'Copied' : 'Copy embed code'}
            </button>
          </div>
          {needsSignIn && (
            <p className="text-theme-text-muted mt-2 text-xs">
              Visitors must sign in to submit this form, which cannot happen inside another website. The embedded form
              will offer to open in a new tab instead.
            </p>
          )}
        </div>
      )}
    </div>
  );
};

export default FormEmbedShare;
