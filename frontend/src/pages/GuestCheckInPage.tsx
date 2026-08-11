import React, { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { CheckCircle2, MapPin, UserPlus } from 'lucide-react';
import { useTimezone } from '../hooks/useTimezone';
import { formatDateCustom } from '../utils/dateFormatting';
import type { GuestCheckInEventInfo, GuestCheckInResult } from '../types/event';

/**
 * Guest Check-In Page (Public — No Authentication Required)
 *
 * Landing page for the guest QR code on a room display. Lets a visitor at an
 * outreach event — a volunteer interest night, an open house — record their own
 * attendance without an account.
 *
 * Deliberately standalone: it lives outside AppLayout and makes bare `fetch`
 * calls rather than using the shared axios instance, because that instance
 * carries session cookies and a 401 interceptor that would bounce an anonymous
 * visitor to /login — the exact wall this page exists to remove.
 */

const GuestCheckInPage: React.FC = () => {
  const { code, eventId } = useParams<{ code: string; eventId: string }>();
  const fallbackTz = useTimezone();

  const [info, setInfo] = useState<GuestCheckInEventInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [interestReason, setInterestReason] = useState('');
  // Honeypot. Hidden from real users, so anything here came from a bot.
  const [website, setWebsite] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [result, setResult] = useState<GuestCheckInResult | null>(null);

  // This page runs with no session, so useTimezone() can only fall back to the
  // device's own zone. Prefer the department timezone the API reports.
  const tz = info?.timezone || fallbackTz;

  const fetchInfo = useCallback(async () => {
    if (!code || !eventId) return;
    try {
      const response = await fetch(`/api/public/v1/display/${code}/events/${eventId}/guest`);
      if (!response.ok) {
        setLoadError(
          response.status === 404
            ? 'Sign-in is not available for this event. Please check with a member of the department.'
            : 'Unable to load this event. Please try again in a moment.'
        );
        return;
      }
      setInfo((await response.json()) as GuestCheckInEventInfo);
      setLoadError(null);
    } catch {
      setLoadError('Unable to connect. Please check your signal and try again.');
    } finally {
      setLoading(false);
    }
  }, [code, eventId]);

  useEffect(() => {
    void fetchInfo();
  }, [fetchInfo]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!code || !eventId || submitting) return;

    setSubmitting(true);
    setSubmitError(null);

    try {
      const response = await fetch(`/api/public/v1/display/${code}/events/${eventId}/guest-check-in`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          // Optional fields use `||` so an untouched input sends `undefined`
          // rather than an empty string, which the API rejects with a 422.
          email: email.trim() || undefined,
          phone: phone.trim() || undefined,
          interest_reason: interestReason.trim() || undefined,
          hp_website: website || undefined,
        }),
      });

      const body = (await response.json().catch(() => null)) as (GuestCheckInResult & { detail?: string }) | null;

      if (!response.ok) {
        setSubmitError(
          typeof body?.detail === 'string' ? body.detail : 'Unable to sign you in. Please ask a member for help.'
        );
        return;
      }

      setResult(body);
    } catch {
      setSubmitError('Unable to connect. Please check your signal and try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const formatWhen = (isoString: string) =>
    formatDateCustom(
      isoString,
      { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' },
      tz
    );

  if (loading) {
    return (
      <div className="bg-theme-surface-secondary flex min-h-screen items-center justify-center">
        <div className="text-theme-text-secondary">Loading event...</div>
      </div>
    );
  }

  if (loadError || !info) {
    return (
      <div className="bg-theme-surface-secondary mx-auto min-h-screen max-w-xl p-6">
        <div className="bg-theme-surface rounded-lg p-8 text-center shadow-md">
          <MapPin className="text-theme-text-muted mx-auto mb-4 h-12 w-12" />
          <h1 className="text-theme-text-primary mb-2 text-2xl font-bold">Sign-In Unavailable</h1>
          <p className="text-theme-text-secondary">{loadError}</p>
        </div>
      </div>
    );
  }

  if (result) {
    return (
      <div className="bg-theme-surface-secondary mx-auto min-h-screen max-w-xl p-6">
        <div className="bg-theme-surface rounded-lg p-8 text-center shadow-md">
          <div className="mb-6 inline-flex h-20 w-20 items-center justify-center rounded-full bg-green-100 dark:bg-green-500/20">
            <CheckCircle2 className="h-12 w-12 text-green-600 dark:text-green-400" />
          </div>
          <h1 className="text-theme-text-primary mb-2 text-3xl font-bold">You're signed in!</h1>
          <p className="text-theme-text-secondary mb-8 text-lg">{result.message}</p>

          <div className="alert-info p-6 text-left">
            <h2 className="text-theme-alert-info-title mb-3 text-xl font-semibold">{result.event_name}</h2>
            <div className="text-theme-alert-info-text space-y-2">
              {info.location_name && (
                <p>
                  <span className="font-medium">Where:</span> {info.location_name}
                </p>
              )}
              {result.checked_in_at && (
                <p>
                  <span className="font-medium">Signed in at:</span>{' '}
                  {formatDateCustom(result.checked_in_at, { hour: 'numeric', minute: '2-digit' }, tz)}
                </p>
              )}
            </div>
          </div>

          {info.collects_prospect_details && (
            <div className="mt-6 rounded-lg border border-green-200 bg-green-50 p-4 text-left dark:border-green-500/30 dark:bg-green-500/10">
              <div className="flex items-start">
                <UserPlus className="mt-0.5 mr-2 h-5 w-5 shrink-0 text-green-600" />
                <div>
                  <p className="mb-1 text-sm font-medium text-green-900 dark:text-green-300">We have your details</p>
                  <p className="text-sm text-green-800 dark:text-green-400">
                    Someone will be in touch about becoming a member. You can close this page.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="bg-theme-surface-secondary mx-auto min-h-screen max-w-xl p-6">
      <div className="bg-theme-surface rounded-lg p-8 shadow-md">
        <div className="mb-8 text-center">
          <h1 className="text-theme-text-primary mb-2 text-3xl font-bold">Welcome!</h1>
          {info.organization_name && <p className="text-theme-text-secondary text-lg">{info.organization_name}</p>}
        </div>

        <div className="bg-theme-surface-secondary mb-8 rounded-lg p-6">
          <h2 className="text-theme-text-primary mb-3 text-xl font-semibold">{info.event_name}</h2>
          <div className="text-theme-text-secondary space-y-2">
            <p>
              <span className="font-medium">When:</span> {formatWhen(info.start_datetime)}
            </p>
            {info.location_name && (
              <p>
                <span className="font-medium">Where:</span> {info.location_name}
              </p>
            )}
          </div>
        </div>

        {!info.is_open ? (
          <div className="alert-warning p-6" role="status">
            <h3 className="mb-2 font-semibold">Sign-in is not open</h3>
            <p>{info.closed_reason || 'Please ask a member of the department to record your attendance.'}</p>
          </div>
        ) : (
          <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
            <p className="text-theme-text-secondary text-sm">
              Not a member? Sign in here so we know you were with us
              {info.collects_prospect_details ? ' — and so we can follow up if you want to join.' : '.'}
            </p>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="guest-first-name" className="form-label">
                  First name <span className="text-red-600">*</span>
                </label>
                <input
                  id="guest-first-name"
                  type="text"
                  required
                  maxLength={100}
                  autoComplete="given-name"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  className="form-input"
                />
              </div>
              <div>
                <label htmlFor="guest-last-name" className="form-label">
                  Last name <span className="text-red-600">*</span>
                </label>
                <input
                  id="guest-last-name"
                  type="text"
                  required
                  maxLength={100}
                  autoComplete="family-name"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  className="form-input"
                />
              </div>
            </div>

            <div>
              <label htmlFor="guest-email" className="form-label">
                Email {info.collects_prospect_details && <span className="text-theme-text-muted">(to hear back)</span>}
              </label>
              <input
                id="guest-email"
                type="email"
                maxLength={255}
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="form-input"
              />
            </div>

            <div>
              <label htmlFor="guest-phone" className="form-label">
                Phone
              </label>
              <input
                id="guest-phone"
                type="tel"
                maxLength={50}
                autoComplete="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="form-input"
              />
            </div>

            {info.collects_prospect_details && (
              <div>
                <label htmlFor="guest-interest" className="form-label">
                  What brings you here today?
                </label>
                <textarea
                  id="guest-interest"
                  rows={3}
                  maxLength={2000}
                  value={interestReason}
                  onChange={(e) => setInterestReason(e.target.value)}
                  className="form-input"
                />
              </div>
            )}

            {/* Honeypot — hidden from people, irresistible to form-filling bots. */}
            <div aria-hidden="true" className="hidden">
              <label htmlFor="guest-website">Website</label>
              <input
                id="guest-website"
                type="text"
                tabIndex={-1}
                autoComplete="off"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
              />
            </div>

            {submitError && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-500/30 dark:bg-red-500/10">
                <p className="text-red-800 dark:text-red-400">{submitError}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={submitting || !firstName.trim() || !lastName.trim()}
              className="btn-success w-full px-8 py-4 text-lg font-semibold transition disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? 'Signing in...' : 'Sign In'}
            </button>

            <p className="text-theme-text-muted text-center text-sm">
              Already a member? Scan the member QR code on the display instead.
            </p>
          </form>
        )}
      </div>
    </div>
  );
};

export default GuestCheckInPage;
