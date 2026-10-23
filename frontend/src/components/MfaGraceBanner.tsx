/**
 * A privileged member (administration, health records) who has not enrolled in
 * two-factor authentication is inside a grace period. This banner counts it
 * down, so the day it ends is not the first they hear of it; afterwards the
 * app routes them to enrollment instead (ProtectedRoute).
 */

import React from 'react';
import { ShieldAlert } from 'lucide-react';
import { Link } from 'react-router';
import { useAuthStore } from '../stores/authStore';
import { useTimezone } from '../hooks/useTimezone';
import { formatDate } from '../utils/dateFormatting';

export const MfaGraceBanner: React.FC = () => {
  const tz = useTimezone();
  const endsAt = useAuthStore((s) => s.user?.mfa_grace_ends_at);
  const enrolled = useAuthStore((s) => Boolean(s.user?.mfa_enabled));
  if (!endsAt || enrolled) return null;

  return (
    <div className="alert-warning flex items-start gap-2" role="status">
      <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
      <p className="text-sm">
        Your access requires two-factor authentication. Set it up by {formatDate(endsAt, tz)}, after which you will only
        be able to reach the setup screens.{' '}
        <Link to="/account" className="font-medium underline">
          Set it up now
        </Link>
      </p>
    </div>
  );
};
