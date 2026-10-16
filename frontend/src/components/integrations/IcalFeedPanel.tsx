/**
 * Department events feed (iCalendar card)
 *
 * Shows the subscribe URL for the department's published events and lets an
 * integrations manager reset it. The URL carries the feed's bearer token, so it
 * is fetched only when this panel is shown and is never cached.
 */

import React, { useEffect, useState } from 'react';
import { Check, Copy, Loader2, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import { integrationsService } from '../../services/api';
import { getErrorMessage } from '../../utils/errorHandling';
import { useConfirm } from '../../contexts/ConfirmContext';

interface IcalFeedPanelProps {
  integrationId: string;
}

export const IcalFeedPanel: React.FC<IcalFeedPanelProps> = ({ integrationId }) => {
  const { confirm } = useConfirm();
  const [feedPath, setFeedPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [rotating, setRotating] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    integrationsService
      .getIcalFeed(integrationId)
      .then((res) => {
        if (!cancelled) setFeedPath(res.feed_path);
      })
      .catch((err: unknown) => {
        if (!cancelled) toast.error(getErrorMessage(err, 'Could not load the calendar feed link'));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [integrationId]);

  const fullUrl = feedPath ? `${window.location.origin}${feedPath}` : '';

  const handleCopy = async () => {
    if (!fullUrl) return;
    try {
      await navigator.clipboard.writeText(fullUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Could not copy — select and copy the link manually.');
    }
  };

  const handleRotate = async () => {
    const confirmed = await confirm({
      title: 'Reset the department feed link?',
      message:
        'The current link stops working at once. Every calendar subscribed to it stops updating until it is given the new link.',
      confirmLabel: 'Reset link',
      cancelLabel: 'Keep current link',
      variant: 'warning',
    });
    if (!confirmed) return;
    setRotating(true);
    try {
      const res = await integrationsService.rotateIcalFeed(integrationId);
      setFeedPath(res.feed_path);
      toast.success('Feed link reset — share the new link with members.');
    } catch (err) {
      toast.error(getErrorMessage(err, 'Could not reset the feed link'));
    } finally {
      setRotating(false);
    }
  };

  return (
    <div className="mb-4 space-y-2" data-testid="ical-feed-panel">
      <p className="text-theme-text-muted text-xs">
        Anyone with this link can see the department&apos;s published events without signing in. Share it with members,
        not publicly.
      </p>
      {loading ? (
        <div className="text-theme-text-muted flex items-center gap-2 text-xs" role="status">
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" /> Loading the feed link…
        </div>
      ) : fullUrl ? (
        <>
          <div className="flex items-center gap-2">
            <input
              type="text"
              readOnly
              value={fullUrl}
              onFocus={(e) => e.currentTarget.select()}
              className="form-input flex-1 text-xs"
              aria-label="Department events feed URL"
            />
            <button
              type="button"
              onClick={() => {
                void handleCopy();
              }}
              className="btn-icon shrink-0"
              aria-label="Copy feed link"
              title="Copy link"
            >
              {copied ? <Check className="h-4 w-4 text-green-700" /> : <Copy className="h-4 w-4" />}
            </button>
          </div>
          <button
            type="button"
            onClick={() => {
              void handleRotate();
            }}
            disabled={rotating}
            className="text-theme-text-muted hover:text-theme-text-primary touch:min-h-11 inline-flex items-center gap-1.5 text-xs disabled:opacity-50"
          >
            {rotating ? (
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
            ) : (
              <RefreshCw className="h-3 w-3" aria-hidden="true" />
            )}
            Reset link
          </button>
        </>
      ) : null}
    </div>
  );
};
