/**
 * Workflow review W74: a member's IP exception request and the admin queue.
 *
 * - A refused request wiped the use case and justification the member had
 *   typed: the page caught the failure, so the form cleared either way.
 * - The admin queue named no member, showed no justification, and every row's
 *   buttons read "Approve" / "Reject" alike.
 * - A rejected request read "Rejected" to its member with no reason.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { IPExceptionRequestForm } from './IPExceptionRequestForm';
import { IPExceptionTable } from './IPExceptionTable';
import type { IPException } from '../types';

vi.mock('../../../hooks/useTimezone', () => ({ useTimezone: () => 'America/Chicago' }));

const exception = (overrides: Partial<IPException> = {}): IPException => ({
  id: 'e-1',
  ipAddress: '203.0.113.50',
  exceptionType: 'allowlist',
  reason: 'At a conference in Denver',
  userId: 'u-1',
  organizationId: 'org-1',
  requestedDurationDays: 7,
  validUntil: '2026-10-27T15:47:00Z',
  approvalStatus: 'pending',
  requestedBy: 'u-1',
  requestedAt: '2026-10-20T15:47:00Z',
  useCase: 'travel',
  ...overrides,
});

const fill = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.type(screen.getByLabelText('IP Address'), '999.1.1.1');
  await user.selectOptions(screen.getByLabelText('Use Case'), 'travel');
  await user.type(screen.getByLabelText('Justification'), 'At a conference in Denver');
  await user.click(screen.getByRole('button', { name: 'Submit Request' }));
};

describe('IPExceptionRequestForm (W74)', () => {
  it('keeps what the member typed when the request is refused', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(false);
    render(<IPExceptionRequestForm onSubmit={onSubmit} isSaving={false} />);

    await fill(user);

    expect(onSubmit).toHaveBeenCalled();
    expect(screen.getByLabelText('Use Case')).toHaveValue('travel');
    expect(screen.getByLabelText('Justification')).toHaveValue('At a conference in Denver');
  });

  it('clears once the request is filed', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(true);
    render(<IPExceptionRequestForm onSubmit={onSubmit} isSaving={false} />);

    await fill(user);

    expect(screen.getByLabelText('Justification')).toHaveValue('');
  });
});

describe('IPExceptionTable (W74)', () => {
  it('names the member, shows the justification and names each action', () => {
    render(
      <IPExceptionTable
        exceptions={[exception({ userName: 'Jordan Avery' })]}
        showActions
        onApprove={vi.fn()}
        onReject={vi.fn()}
      />
    );

    expect(screen.getByRole('columnheader', { name: 'Member' })).toBeInTheDocument();
    expect(screen.getByText('Jordan Avery')).toBeInTheDocument();
    expect(screen.getByText('At a conference in Denver')).toBeInTheDocument();
    expect(screen.getByText('Pending')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve 203.0.113.50 for Jordan Avery' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reject 203.0.113.50 for Jordan Avery' })).toBeInTheDocument();
  });

  it("omits the member column on a member's own list, and says why one was rejected", () => {
    render(
      <IPExceptionTable
        exceptions={[exception({ approvalStatus: 'rejected', rejectionReason: 'Not a valid address' })]}
      />
    );

    expect(screen.queryByRole('columnheader', { name: 'Member' })).not.toBeInTheDocument();
    expect(screen.getByText('Rejected')).toBeInTheDocument();
    expect(screen.getByText('Not a valid address')).toBeInTheDocument();
  });
});
