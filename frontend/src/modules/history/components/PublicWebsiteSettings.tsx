/**
 * History settings → "Public website": which parts of History the
 * department's website may show through the Public Portal, and the "Today in
 * history" widget.
 *
 * Every part starts switched off. Only records published to the public are
 * ever served, as their cleared copy, so the switches decide which sections
 * exist rather than which fields. The widget's secret link is shown once,
 * when it is made; the server keeps only its hash, so it cannot be shown
 * again, only replaced.
 */
import React, { useEffect, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { Link } from 'react-router';
import toast from 'react-hot-toast';
import { useConfirm } from '../../../contexts/ConfirmContext';
import { getErrorMessage } from '../../../utils/errorHandling';
import { historyService } from '../services/api';
import { buildHistoryWidgetSnippet } from '../utils/widgetSnippet';
import type { HistoryPublicSettings, HistoryPublicSwitches, PublicWidgetTheme } from '../types';

const SWITCHES: { key: keyof HistoryPublicSwitches; label: string; hint: string }[] = [
  { key: 'people', label: 'People', hint: 'Public records of members, past and present' },
  { key: 'honor_roll', label: 'Honor Roll', hint: 'Members who died in the line of duty' },
  { key: 'photos', label: 'Photos', hint: 'Display copies and thumbnails; recordings and films are listed only' },
  { key: 'documents', label: 'Documents', hint: 'A first-page thumbnail and the cleaned PDF' },
  { key: 'events', label: 'Events', hint: 'Fires, dedications and other events' },
  { key: 'apparatus', label: 'Apparatus', hint: 'Past and present apparatus' },
  { key: 'articles', label: 'Articles', hint: 'Text and public photos, with a PDF' },
  { key: 'timeline', label: 'Timeline', hint: 'Dated entries by decade' },
  { key: 'today', label: 'Today in history', hint: 'Needed for the widget below' },
];

const ENDPOINTS = [
  'feed',
  'people',
  'honor-roll',
  'photos',
  'documents',
  'events',
  'apparatus',
  'articles',
  'timeline/decades',
  'timeline?decade=1950',
  'today',
];

export const PublicWebsiteSettings: React.FC = () => {
  const { confirm } = useConfirm();
  const [settings, setSettings] = useState<HistoryPublicSettings | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    historyService
      .getPublicSettings()
      .then((data) => {
        if (!cancelled) setSettings(data);
      })
      .catch((err: unknown) => {
        toast.error(getErrorMessage(err, 'Unable to load the public website settings'));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!settings) return null;

  const save = async (values: Parameters<typeof historyService.updatePublicSettings>[0]) => {
    setBusy(true);
    try {
      setSettings(await historyService.updatePublicSettings(values));
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not save the public website settings'));
    } finally {
      setBusy(false);
    }
  };

  const makeLink = async () => {
    if (settings.widget_link_exists) {
      const ok = await confirm({
        title: 'Replace the widget link',
        message:
          'The current link stops working at once, so any website still showing it shows nothing until it is given the new one.',
        confirmLabel: 'Replace link',
        cancelLabel: 'Keep the current link',
        variant: 'warning',
      });
      if (!ok) return;
    }
    setBusy(true);
    try {
      setToken(await historyService.makeWidgetLink());
      setSettings(await historyService.getPublicSettings());
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not make the widget link'));
    } finally {
      setBusy(false);
    }
  };

  const removeLink = async () => {
    const ok = await confirm({
      title: 'Remove the widget link',
      message: 'Any website showing the widget shows nothing from now on.',
      confirmLabel: 'Remove link',
      cancelLabel: 'Keep it',
      variant: 'danger',
    });
    if (!ok) return;
    setBusy(true);
    try {
      await historyService.removeWidgetLink();
      setToken(null);
      setSettings(await historyService.getPublicSettings());
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not remove the widget link'));
    } finally {
      setBusy(false);
    }
  };

  const snippet = token ? buildHistoryWidgetSnippet(window.location.origin, token) : '';
  const copySnippet = () => {
    void navigator.clipboard.writeText(snippet);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  const portalReady = settings.portal_enabled && settings.portal_has_key;

  return (
    <section aria-labelledby="public-website-heading" className="card space-y-4 p-4">
      <h2 id="public-website-heading" className="text-theme-text-primary text-lg font-semibold">
        Public website
      </h2>
      <p className="text-theme-text-secondary text-sm">
        What your department&rsquo;s own website may show from History, through the Public Portal. Only records
        published to the public are ever shown, as they were cleared.
      </p>
      {!portalReady && (
        <p className="alert-warning rounded-md p-3 text-sm" role="note">
          {settings.portal_enabled
            ? 'The Public Portal has no active API key, so no website can reach History yet.'
            : 'The Public Portal is switched off, so no website can reach History yet.'}{' '}
          <Link to="/admin/public-portal" className="font-semibold underline">
            Open Public Portal settings
          </Link>
        </p>
      )}

      <fieldset className="space-y-2">
        <legend className="form-label">Show on the website</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {SWITCHES.map(({ key, label, hint }) => (
            <label
              key={key}
              htmlFor={`public-${key}`}
              className="card-secondary flex min-h-11 cursor-pointer items-start gap-3 rounded-md p-3"
            >
              <input
                type="checkbox"
                id={`public-${key}`}
                checked={settings[key]}
                disabled={busy}
                onChange={() => void save({ [key]: !settings[key] })}
                className="form-checkbox mt-0.5 shrink-0"
              />
              <span className="text-sm">
                <span className="text-theme-text-primary block font-medium">{label}</span>
                <span className="text-theme-text-muted mt-0.5 block text-xs">{hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <div className="space-y-3">
        <h3 className="text-theme-text-primary font-semibold">&ldquo;Today in history&rdquo; widget</h3>
        <p className="text-theme-text-secondary text-sm">
          One line on your website shows what happened on today&rsquo;s date in earlier years, or the coming
          week&rsquo;s anniversaries on a quiet day. Only your department&rsquo;s own websites may show it: the list
          under Organization Settings &rarr; Forms, which embedded forms use too.
        </p>
        {settings.widget_websites.length === 0 ? (
          <p className="alert-warning rounded-md p-3 text-sm" role="note">
            Your department has not listed its website yet, so the widget will not show anywhere. Add it under{' '}
            <Link to="/settings?tab=forms" className="font-semibold underline">
              Organization Settings &rarr; Forms
            </Link>{' '}
            (needs the settings permission).
          </p>
        ) : (
          <p className="text-theme-text-secondary text-sm">
            May be shown on: <span className="break-all">{settings.widget_websites.join(', ')}</span>
          </p>
        )}
        <div className="flex flex-wrap items-end gap-3">
          <label className="min-w-0 flex-[0_1_12rem]">
            <span className="form-label">Style</span>
            <select
              value={settings.widget_theme}
              disabled={busy}
              onChange={(e) => void save({ widget_theme: e.target.value as PublicWidgetTheme })}
              className="form-input"
            >
              <option value="auto">Follow the visitor&rsquo;s setting</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </label>
          <label htmlFor="public-branding" className="mobile-touch-row cursor-pointer gap-2">
            <input
              type="checkbox"
              id="public-branding"
              checked={settings.widget_show_branding}
              disabled={busy}
              onChange={() => void save({ widget_show_branding: !settings.widget_show_branding })}
              className="form-checkbox shrink-0"
            />
            <span className="text-theme-text-primary text-sm">Show the department&rsquo;s name and logo</span>
          </label>
        </div>
        {!settings.today && (
          <p className="text-theme-text-muted text-sm">
            Switch on &ldquo;Today in history&rdquo; above for the widget to show.
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-primary rounded-md px-3 py-2"
            disabled={busy}
            onClick={() => void makeLink()}
          >
            {settings.widget_link_exists ? 'Replace the link' : 'Make a widget link'}
          </button>
          {settings.widget_link_exists && (
            <button
              type="button"
              className="btn-secondary rounded-md px-3 py-2"
              disabled={busy}
              onClick={() => void removeLink()}
            >
              Remove the link
            </button>
          )}
        </div>
        {snippet ? (
          <div>
            <label htmlFor="history-widget-code" className="text-theme-text-secondary mb-2 block text-sm font-medium">
              Paste this into your website. It is shown only now; if it is lost, replace the link.
            </label>
            <textarea
              id="history-widget-code"
              readOnly
              value={snippet}
              rows={3}
              className="form-input font-mono text-xs"
            />
            <button
              type="button"
              className="btn-secondary mt-2 inline-flex items-center gap-2 rounded-md px-3 py-2"
              onClick={copySnippet}
            >
              {copied ? (
                <Check className="h-4 w-4" aria-hidden="true" />
              ) : (
                <Copy className="h-4 w-4" aria-hidden="true" />
              )}
              {copied ? 'Copied' : 'Copy code'}
            </button>
          </div>
        ) : (
          settings.widget_link_exists && (
            <p className="text-theme-text-muted text-sm">
              A link exists. Its code was shown when it was made; replace the link to see new code.
            </p>
          )
        )}
      </div>

      <details className="text-sm">
        <summary className="text-theme-text-primary cursor-pointer font-medium">What a website can call</summary>
        <p className="text-theme-text-secondary mt-2">
          Each call carries the Public Portal&rsquo;s API key in the <code>X-API-Key</code> header. A part that is
          switched off answers 404.
        </p>
        <ul className="text-theme-text-secondary mt-2 list-inside list-disc font-mono text-xs">
          {ENDPOINTS.map((path) => (
            <li key={path} className="break-all">
              GET /api/public/v1/history/{path}
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
};
