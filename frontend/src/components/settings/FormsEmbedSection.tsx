/**
 * Organization settings: the websites allowed to show the department's forms.
 *
 * A public form with "Allow embedding" on can be placed on the department's
 * own website in an iframe. Every other page of the app refuses to be framed
 * (clickjacking protection); this list is the exception, and only these sites
 * get it. The backend writes the list into each embed page's frame-ancestors,
 * re-checking every entry, so a site missing here is a form that will not show.
 *
 * Explicit Save rather than autosave: a half-typed address on a debounce would
 * be what the next visitor's browser was told.
 */

import React, { useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { organizationService } from '../../services/api';
import { getErrorMessage } from '../../utils/errorHandling';
import { MAX_EMBED_ORIGINS, parseEmbedOrigins } from '../../utils/embedOrigins';
import { SettingsPanelHead } from './SettingsPanelHead';

const FormsEmbedSection: React.FC = () => {
  const [saved, setSaved] = useState<string[]>([]);
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    void (async () => {
      try {
        const data = await organizationService.getSettings();
        if (cancelled) return;
        const origins = data.forms?.embed_allowed_origins ?? [];
        setSaved(origins);
        setText(origins.join('\n'));
      } catch {
        if (!cancelled) setFailed(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const { origins, invalid } = parseEmbedOrigins(text);
  const tooMany = origins.length > MAX_EMBED_ORIGINS;
  let error: string | null = null;
  if (invalid.length > 0) {
    error = `Not a website address of the form https://example.org: ${invalid.join(', ')}. Use https, and leave off any path such as /apply.`;
  } else if (tooMany) {
    error = `List at most ${MAX_EMBED_ORIGINS} websites.`;
  }
  const dirty = origins.join('\n') !== saved.join('\n');

  const handleSave = async () => {
    if (error) return;
    setSaving(true);
    try {
      const next = await organizationService.updateFormsSettings({ embed_allowed_origins: origins });
      setSaved(next.embed_allowed_origins);
      setText(next.embed_allowed_origins.join('\n'));
      toast.success('Forms settings saved');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to save forms settings'));
    } finally {
      setSaving(false);
    }
  };

  const head = (
    <SettingsPanelHead
      title="Forms"
      description="Your department's own websites, where its public forms may be embedded."
      meta={saved.length > 0 ? `${saved.length} website${saved.length === 1 ? '' : 's'}` : undefined}
    />
  );

  if (failed) {
    return (
      <div>
        {head}
        <div className="alert-warning flex flex-wrap items-center gap-2 text-sm" role="alert">
          <span className="min-w-0 flex-1">
            These settings did not load. Retry to see what your department has chosen.
          </span>
          <button
            type="button"
            className="mobile-touch-target px-2 font-semibold underline"
            onClick={() => setAttempt((n) => n + 1)}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      {head}
      <div className="space-y-4" aria-busy={loading}>
        <div>
          <label className="form-label" htmlFor="forms-embed-origins">
            Websites allowed to embed forms
          </label>
          <textarea
            id="forms-embed-origins"
            rows={4}
            className="form-input w-full max-w-lg font-mono"
            placeholder="https://www.yourdepartment.org"
            autoCapitalize="none"
            spellCheck={false}
            value={text}
            disabled={loading || saving}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'forms-embed-origins-hint forms-embed-origins-error' : 'forms-embed-origins-hint'}
            onChange={(e) => setText(e.target.value)}
          />
          <p id="forms-embed-origins-hint" className="text-theme-text-muted mt-1 text-xs">
            One per line, starting with https:// and without a page path. A form shows on these sites only when its own
            &ldquo;Allow embedding&rdquo; switch is on, in its Share dialog. Leave this empty to allow no site.
          </p>
          {error && (
            <p id="forms-embed-origins-error" className="mt-1 text-xs text-red-700 dark:text-red-300">
              {error}
            </p>
          )}
        </div>

        <div className="flex justify-end">
          <button
            type="button"
            className="btn-primary"
            disabled={loading || saving || !dirty || error !== null}
            onClick={() => {
              void handleSave();
            }}
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default FormsEmbedSection;
