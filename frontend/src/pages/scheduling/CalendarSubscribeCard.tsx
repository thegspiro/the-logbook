/**
 * Calendar Subscribe Card
 *
 * Collapsible card on My Shifts that surfaces the member's personal ICS feed
 * URL so they can subscribe from Google/Apple Calendar/Outlook. The token is
 * created on first open and can be rotated to invalidate an old URL.
 */

import React, { useState } from 'react';
import { CalendarPlus, Copy, Check, RefreshCw, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { schedulingService } from '../../modules/scheduling/services/api';
import { getErrorMessage } from '../../utils/errorHandling';

export const CalendarSubscribeCard: React.FC = () => {
  const [open, setOpen] = useState(false);
  const [feedPath, setFeedPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [copied, setCopied] = useState(false);

  const fullUrl = feedPath ? `${window.location.origin}${feedPath}` : '';

  const handleOpen = async () => {
    const next = !open;
    setOpen(next);
    if (next && !feedPath) {
      setLoading(true);
      try {
        const res = await schedulingService.getCalendarFeed();
        setFeedPath(res.feed_path);
      } catch (err) {
        toast.error(getErrorMessage(err, 'Failed to load calendar link'));
      } finally {
        setLoading(false);
      }
    }
  };

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
    setRotating(true);
    try {
      const res = await schedulingService.rotateCalendarFeed();
      setFeedPath(res.feed_path);
      toast.success('Calendar link reset — update your subscription.');
    } catch (err) {
      toast.error(getErrorMessage(err, 'Failed to reset calendar link'));
    } finally {
      setRotating(false);
    }
  };

  return (
    <div className="card">
      <button
        onClick={() => { void handleOpen(); }}
        className="flex w-full items-center gap-2 text-left"
        aria-expanded={open}
      >
        <CalendarPlus className="h-4 w-4 text-violet-500 shrink-0" />
        <span className="text-sm font-medium text-theme-text-primary">Subscribe to my shifts</span>
        <span className="ml-auto text-xs text-theme-text-muted">
          {open ? 'Hide' : 'Add to calendar app'}
        </span>
      </button>

      {open && (
        <div className="mt-3 space-y-2">
          <p className="text-xs text-theme-text-muted">
            Add this link in Google Calendar, Apple Calendar, or Outlook to see your shifts.
            The link is private to you — don&apos;t share it.
          </p>
          {loading ? (
            <div className="flex items-center gap-2 text-xs text-theme-text-muted">
              <Loader2 className="h-3 w-3 animate-spin" /> Loading your link…
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
                  aria-label="Calendar subscription URL"
                />
                <button
                  onClick={() => { void handleCopy(); }}
                  className="btn-icon shrink-0"
                  aria-label="Copy calendar link"
                  title="Copy link"
                >
                  {copied ? <Check className="h-4 w-4 text-green-600" /> : <Copy className="h-4 w-4" />}
                </button>
              </div>
              <button
                onClick={() => { void handleRotate(); }}
                disabled={rotating}
                className="inline-flex items-center gap-1.5 text-xs text-theme-text-muted hover:text-theme-text-primary disabled:opacity-50"
              >
                {rotating ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                Reset link
              </button>
            </>
          ) : null}
        </div>
      )}
    </div>
  );
};
