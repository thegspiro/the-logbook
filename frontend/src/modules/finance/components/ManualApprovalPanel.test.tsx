/**
 * The manual approve/deny panel on finance request detail pages.
 *
 * A request submitted when no approval chain applies waits for approval with
 * no approval steps, and before this panel nothing in the UI could move it.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockManualApprove = vi.fn();
const mockManualDeny = vi.fn();
vi.mock('../services/api', () => ({
  approvalService: {
    manualApprove: (...args: unknown[]) => mockManualApprove(...args) as unknown,
    manualDeny: (...args: unknown[]) => mockManualDeny(...args) as unknown,
  },
}));

const mockToastSuccess = vi.fn();
const mockToastError = vi.fn();
vi.mock('react-hot-toast', () => ({
  default: {
    success: (...args: unknown[]) => mockToastSuccess(...args) as unknown,
    error: (...args: unknown[]) => mockToastError(...args) as unknown,
  },
}));

import { renderWithRouter } from '@/test/utils';
import { useAuthStore } from '@/stores/authStore';
import { ManualApprovalPanel } from './ManualApprovalPanel';
import { ApprovalEntityType } from '../types';

/** The confirm button inside the open dialog, not the panel button that opened it. */
const dialogButton = async (name: string) => within(await screen.findByRole('dialog')).getByRole('button', { name });

const PROMPT = 'No approval chain applies to this request. Approve or deny it here.';

const signIn = (id: string, permissions: string[]) => {
  useAuthStore.setState({ user: { id, permissions } as never });
};

const onDecided = vi.fn();

const renderPanel = (overrides: Partial<React.ComponentProps<typeof ManualApprovalPanel>> = {}) =>
  renderWithRouter(
    <ManualApprovalPanel
      entityType={ApprovalEntityType.PURCHASE_REQUEST}
      entityId="pr-1"
      status="pending_approval"
      approvalStepCount={0}
      requesterId="requester-1"
      onDecided={onDecided}
      {...overrides}
    />
  );

describe('ManualApprovalPanel', () => {
  beforeEach(() => {
    mockManualApprove.mockReset();
    mockManualApprove.mockResolvedValue(undefined);
    mockManualDeny.mockReset();
    mockManualDeny.mockResolvedValue(undefined);
    mockToastSuccess.mockReset();
    mockToastError.mockReset();
    onDecided.mockReset();
    signIn('approver-1', ['finance.approve']);
  });

  describe('when it shows', () => {
    it('shows for a finance approver on a pending request with no approval steps', () => {
      renderPanel();
      expect(screen.getByText(PROMPT)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Deny' })).toBeInTheDocument();
    });

    it('hides when the request has approval steps', () => {
      renderPanel({ approvalStepCount: 2 });
      expect(screen.queryByText(PROMPT)).not.toBeInTheDocument();
    });

    it('hides when the request is not waiting for approval', () => {
      renderPanel({ status: 'approved' });
      expect(screen.queryByText(PROMPT)).not.toBeInTheDocument();
    });

    it('hides without finance.approve', () => {
      signIn('viewer-1', ['finance.view']);
      renderPanel();
      expect(screen.queryByText(PROMPT)).not.toBeInTheDocument();
    });

    it('offers the requester only Deny', () => {
      signIn('requester-1', ['finance.approve']);
      renderPanel();
      expect(screen.getByText(PROMPT)).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Deny' })).toBeInTheDocument();
    });
  });

  describe('approving', () => {
    it('approves with an optional note and reloads the request', async () => {
      const user = userEvent.setup();
      renderPanel({ entityType: ApprovalEntityType.CHECK_REQUEST, entityId: 'cr-9' });

      await user.click(screen.getByRole('button', { name: 'Approve' }));
      await user.type(screen.getByLabelText(/Note/), 'Within policy');
      await user.click(await dialogButton('Approve'));

      await waitFor(() => expect(mockManualApprove).toHaveBeenCalledWith('check_request', 'cr-9', 'Within policy'));
      expect(mockToastSuccess).toHaveBeenCalledWith('Request approved');
      expect(onDecided).toHaveBeenCalledTimes(1);
    });

    it('sends no note when none is typed', async () => {
      const user = userEvent.setup();
      renderPanel();

      await user.click(screen.getByRole('button', { name: 'Approve' }));
      await user.click(await dialogButton('Approve'));

      await waitFor(() => expect(mockManualApprove).toHaveBeenCalledWith('purchase_request', 'pr-1', undefined));
    });

    it('shows the server message when the approval is refused', async () => {
      mockManualApprove.mockRejectedValue(new Error('You cannot approve your own purchase request.'));
      const user = userEvent.setup();
      renderPanel();

      await user.click(screen.getByRole('button', { name: 'Approve' }));
      await user.click(await dialogButton('Approve'));

      await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('You cannot approve your own purchase request.'));
      expect(onDecided).not.toHaveBeenCalled();
    });
  });

  describe('denying', () => {
    it('requires a reason before denying', async () => {
      const user = userEvent.setup();
      renderPanel();

      await user.click(screen.getByRole('button', { name: 'Deny' }));
      await user.click(await dialogButton('Deny'));

      expect(mockManualDeny).not.toHaveBeenCalled();
    });

    it('denies with the reason and reloads the request', async () => {
      const user = userEvent.setup();
      renderPanel({ entityType: ApprovalEntityType.EXPENSE_REPORT, entityId: 'er-3' });

      await user.click(screen.getByRole('button', { name: 'Deny' }));
      await user.type(screen.getByLabelText(/Reason/), 'Missing receipts');
      await user.click(await dialogButton('Deny'));

      await waitFor(() => expect(mockManualDeny).toHaveBeenCalledWith('expense_report', 'er-3', 'Missing receipts'));
      expect(mockToastSuccess).toHaveBeenCalledWith('Request denied');
      expect(onDecided).toHaveBeenCalledTimes(1);
    });
  });
});
