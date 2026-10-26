import React, { useEffect, useRef, useState } from 'react';
import { Mail, UserCheck } from 'lucide-react';
import type { GuestCheckInResult, GuestLookupResult } from '../types/event';

/**
 * Email-first sign-in for an event that adds its guests to the prospective
 * members pipeline.
 *
 * The visitor types an email; an active applicant is shown their first name and
 * last initial and confirms, a member account is pointed at the member QR code,
 * and anyone else is asked to see a member of staff. Nothing is recorded until
 * the applicant confirms, and the confirm call carries only the token the
 * lookup issued, so the browser never names whom it is signing in.
 *
 * Bare `fetch`, for the reason GuestCheckInPage gives: the shared axios
 * instance would bounce an anonymous visitor to /login on a 401.
 */

interface GuestEmailSignInProps {
  /** The guest QR code's public API base: a room display's, or an event's own. */
  apiBase: string;
  onSignedIn: (result: GuestCheckInResult, displayName: string) => void;
}

type Step =
  { kind: 'email' } | { kind: 'confirm'; displayName: string; token: string } | { kind: 'stopped'; message: string };

const CONNECTION_ERROR = 'Unable to connect. Please check your signal and try again.';

const errorDetail = (body: unknown, fallback: string): string => {
  const detail = (body as { detail?: unknown } | null)?.detail;
  return typeof detail === 'string' ? detail : fallback;
};

export const GuestEmailSignIn: React.FC<GuestEmailSignInProps> = ({ apiBase, onSignedIn }) => {
  const [email, setEmail] = useState('');
  // Honeypot. Hidden from real users, so anything here came from a bot.
  const [website, setWebsite] = useState('');
  const [step, setStep] = useState<Step>({ kind: 'email' });
  const [hint, setHint] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const emailInput = useRef<HTMLInputElement>(null);
  // Set when the visitor is sent back to the email step, so the field is
  // focused for the retry but not on first load, where it would pop a phone
  // keyboard over the event details.
  const refocusEmail = useRef(false);

  useEffect(() => {
    if (step.kind === 'email' && refocusEmail.current) {
      refocusEmail.current = false;
      emailInput.current?.focus();
    }
  }, [step]);

  const backToEmail = (nextHint: string | null, nextError: string | null = null) => {
    setStep({ kind: 'email' });
    setHint(nextHint);
    setError(nextError);
    refocusEmail.current = true;
  };

  const handleLookup = async (e: React.FormEvent) => {
    e.preventDefault();
    const typed = email.trim();
    if (!typed || busy) return;

    setBusy(true);
    setError(null);
    setHint(null);
    try {
      const response = await fetch(`${apiBase}/guest-lookup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: typed, hp_website: website || undefined }),
      });
      const body = (await response.json().catch(() => null)) as GuestLookupResult | null;

      if (!response.ok || !body) {
        setError(errorDetail(body, 'Unable to look you up. Please ask a member for help.'));
        return;
      }

      if (body.status === 'prospect' && body.confirm_token && body.display_name) {
        setStep({ kind: 'confirm', displayName: body.display_name, token: body.confirm_token });
      } else {
        setStep({ kind: 'stopped', message: body.message });
      }
    } catch {
      setError(CONNECTION_ERROR);
    } finally {
      setBusy(false);
    }
  };

  const handleConfirm = async (displayName: string, token: string) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`${apiBase}/guest-confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm_token: token }),
      });
      const body = (await response.json().catch(() => null)) as GuestCheckInResult | null;

      if (!response.ok || !body) {
        // An expired or refused confirmation cannot be retried as it stands;
        // the visitor starts again from their email.
        backToEmail(null, errorDetail(body, 'Unable to sign you in. Please ask a member for help.'));
        return;
      }
      onSignedIn(body, displayName);
    } catch {
      setError(CONNECTION_ERROR);
    } finally {
      setBusy(false);
    }
  };

  if (step.kind === 'confirm') {
    return (
      <div className="space-y-6 text-center">
        <UserCheck className="mx-auto h-12 w-12 text-green-700 dark:text-green-400" aria-hidden="true" />
        <div>
          <p className="text-theme-text-secondary">Welcome back!</p>
          <h3 className="text-theme-text-primary mt-1 text-2xl font-bold">Is this you, {step.displayName}?</h3>
        </div>

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-500/30 dark:bg-red-500/10">
            <p className="text-red-800 dark:text-red-400">{error}</p>
          </div>
        )}

        <div className="flex flex-col gap-3">
          <button
            type="button"
            disabled={busy}
            onClick={() => void handleConfirm(step.displayName, step.token)}
            className="btn-success w-full px-8 py-4 text-lg font-semibold transition disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? 'Checking you in...' : 'Yes, check me in'}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => backToEmail('Please check your email address for typos and try again.')}
            className="btn-secondary w-full px-8 py-3"
          >
            That's not me
          </button>
        </div>
      </div>
    );
  }

  if (step.kind === 'stopped') {
    return (
      <div className="space-y-4">
        <div className="alert-warning p-6" role="status">
          <p>{step.message}</p>
        </div>
        <button type="button" onClick={() => backToEmail(null)} className="btn-secondary w-full px-8 py-3">
          Try a different email
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={(e) => void handleLookup(e)} className="space-y-4">
      <p className="text-theme-text-secondary text-sm">
        Enter the email address you gave us when you applied, and we'll find your details.
      </p>

      <div>
        <label htmlFor="guest-lookup-email" className="form-label">
          Email <span className="text-red-600">*</span>
        </label>
        <div className="relative">
          <Mail
            className="text-theme-text-muted pointer-events-none absolute top-1/2 left-3 h-5 w-5 -translate-y-1/2"
            aria-hidden="true"
          />
          <input
            ref={emailInput}
            id="guest-lookup-email"
            type="email"
            required
            maxLength={255}
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-describedby={hint ? 'guest-lookup-hint' : undefined}
            className="form-input pl-10"
          />
        </div>
        {hint && (
          <p id="guest-lookup-hint" className="text-theme-text-secondary mt-2 text-sm">
            {hint}
          </p>
        )}
      </div>

      {/* Honeypot — hidden from people, irresistible to form-filling bots. */}
      <div aria-hidden="true" className="hidden">
        <label htmlFor="guest-lookup-website">Website</label>
        <input
          id="guest-lookup-website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={website}
          onChange={(e) => setWebsite(e.target.value)}
        />
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-500/30 dark:bg-red-500/10">
          <p className="text-red-800 dark:text-red-400">{error}</p>
        </div>
      )}

      <button
        type="submit"
        disabled={busy || !email.trim()}
        className="btn-success w-full px-8 py-4 text-lg font-semibold transition disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? 'Looking you up...' : 'Continue'}
      </button>

      <p className="text-theme-text-muted text-center text-sm">
        Already a member? Scan the member QR code on the display instead.
      </p>
    </form>
  );
};

export default GuestEmailSignIn;
