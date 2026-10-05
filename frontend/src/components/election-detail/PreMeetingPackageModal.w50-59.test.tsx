/**
 * W50-59 — a reserved-TLD address passes the browser's email check, the
 * server's `EmailStr` refuses the whole batch with a 422, and the modal
 * showed the validator entry verbatim ("recipient_emails.2: value is not a
 * valid email address …") — an index into a list the secretary never sees
 * numbered, and no word that nothing was sent. The page now resolves the
 * index against the list it sent and the modal shows the address by name.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../../services/api', () => ({
  electionService: {
    getPackageRecipients: vi.fn(),
    downloadPackagePdf: vi.fn(),
  },
}));

import PreMeetingPackageModal from './PreMeetingPackageModal';
import { describePackageSendError } from '../../utils/electionHelpers';

const SENT = ['sue@dept.org', 'pat@dept.org', 'clerk@review-valley.test'];
const FALLBACK = 'Failed to send pre-meeting package';

const http422 = (detail: unknown) => ({ response: { status: 422, data: { detail } } });

describe('describePackageSendError (W50-59)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("names the refused address from the API's `recipient_emails.<index>` spelling", () => {
    const err = http422([
      {
        field: 'recipient_emails.2',
        message: 'value is not a valid email address: The part after the @-sign is a special-use or reserved name.',
      },
    ]);
    const text = describePackageSendError(err, SENT, FALLBACK);
    expect(text).toBe(
      "This address was refused by the mail server's address check: clerk@review-valley.test. Nothing was sent — remove or correct it and send again."
    );
    expect(text).not.toContain('recipient_emails');
  });

  it("names every refused address from FastAPI's own loc spelling", () => {
    const err = http422([
      { loc: ['body', 'recipient_emails', 0], msg: 'value is not a valid email address' },
      { loc: ['body', 'recipient_emails', 2], msg: 'value is not a valid email address' },
    ]);
    expect(describePackageSendError(err, SENT, FALLBACK)).toBe(
      "These addresses were refused by the mail server's address check: sue@dept.org, clerk@review-valley.test. Nothing was sent — remove or correct them and send again."
    );
  });

  it('falls back to the ordinary message when the 422 is not about an address', () => {
    const err = http422([{ field: 'message', message: 'Value is too long.' }]);
    expect(describePackageSendError(err, SENT, FALLBACK)).toBe('message: Value is too long.');
  });

  it('falls back to the ordinary message for a non-validation failure', () => {
    const err = { response: { status: 500, data: { detail: 'An unexpected error occurred' } } };
    expect(describePackageSendError(err, SENT, FALLBACK)).toBe('An unexpected error occurred');
    expect(describePackageSendError(new Error('Network Error'), SENT, FALLBACK)).toBe('Network Error');
  });
});

describe('PreMeetingPackageModal error alert (W50-59)', () => {
  it('shows the address-naming message the page hands it', () => {
    const error = describePackageSendError(
      http422([{ field: 'recipient_emails.2', message: 'value is not a valid email address' }]),
      SENT,
      FALLBACK
    );
    render(
      <PreMeetingPackageModal
        electionId="el1"
        electionTitle="Annual Officer Election"
        sending={false}
        error={error}
        onSubmit={vi.fn()}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByRole('alert')).toHaveTextContent('clerk@review-valley.test');
    expect(screen.getByRole('alert')).toHaveTextContent('Nothing was sent');
  });
});
