/**
 * Where a set of minutes stands once published: the library copy, the public
 * copy beside it, and why there is no public copy when there is not one.
 * What it says comes from the server (`GET /minutes-records/{id}/publishing`),
 * never from a local reading of the department's settings.
 */

import React from 'react';
import { Link } from 'react-router';
import { useTimezone } from '../../../hooks/useTimezone';
import { formatDate } from '../../../utils/dateFormatting';
import type { MinutesPublishingStatus } from '../types/minutes';

interface PublishingStatusNoteProps {
  status: MinutesPublishingStatus | null;
  withdrawing: boolean;
  onWithdraw: () => void;
}

export const PublishingStatusNote: React.FC<PublishingStatusNoteProps> = ({ status, withdrawing, onWithdraw }) => {
  const tz = useTimezone();
  if (!status) return null;

  const versionText = (version: number | null) => (version === null ? '' : ` (version ${version})`);
  const lines: React.ReactNode[] = [];

  if (!status.library_allowed) {
    lines.push(
      <p key="library-blocked">
        These are executive-session minutes. The department has not allowed publishing them, so there is nothing to
        publish. A settings administrator can change that under Minutes → Publishing.
      </p>
    );
  } else if (status.library_published) {
    lines.push(
      <p key="library">
        Filed in Documents{versionText(status.library_version)}
        {status.library_published_at ? `, ${formatDate(status.library_published_at, tz)}` : ''}.
      </p>
    );
  }

  if (status.public_posted) {
    lines.push(
      <p key="public">
        Posted on the{' '}
        <Link to={`/public/minutes/${status.public_copy_id ?? ''}`} className="text-theme-accent-blue underline">
          public minutes page
        </Link>
        {versionText(status.public_version)}
        {status.public_posted_at ? `, ${formatDate(status.public_posted_at, tz)}` : ''}.
        {status.public_replaced_version !== null && ` It replaced version ${status.public_replaced_version}.`}
        {status.public_under_correction && ' It is marked on that page as being corrected.'}
      </p>
    );
  } else if (status.public_withdrawn) {
    lines.push(
      <p key="withdrawn">
        The public copy was taken down. Publishing again
        {status.public_allowed ? ' posts a fresh one.' : ' will not post it, because public posting is off.'}
      </p>
    );
  } else if (status.library_allowed) {
    lines.push(
      <p key="not-public">
        {status.public_allowed
          ? 'Publishing will also post a public copy.'
          : 'Not posted publicly. The department has public posting off for these minutes.'}
      </p>
    );
  }

  if (lines.length === 0) return null;
  return (
    <div className="text-theme-text-secondary mb-3 space-y-1 text-sm" role="status" data-testid="publishing-status">
      {lines}
      {status.public_posted && (
        <button type="button" onClick={onWithdraw} disabled={withdrawing} className="btn-secondary mt-2">
          {withdrawing ? 'Taking down…' : 'Take the public copy down'}
        </button>
      )}
    </div>
  );
};

export default PublishingStatusNote;
