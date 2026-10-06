import { describe, it, expect, vi, beforeEach } from 'vitest';
import type React from 'react';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '@/test/utils';
import type { ApprovalStepRecord } from '../types';

const mockApproveStep = vi.fn();
const mockDenyStep = vi.fn();
vi.mock('../store/financeStore', () => ({
  useFinanceStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ approveStep: mockApproveStep, denyStep: mockDenyStep }),
}));

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import { ApprovalStepActions } from './ApprovalStepActions';

type Flags = Pick<ApprovalStepRecord, 'assigneeLabel' | 'canAct' | 'requiresOverride'>;

const record = (
  id: string,
  stepId: string,
  status: ApprovalStepRecord['status'],
  stepOrder: number,
  flags: Flags = {}
): ApprovalStepRecord => ({
  id,
  chainId: 'chain-1',
  stepId,
  entityType: 'purchase_request',
  entityId: 'pr-1',
  status,
  stepName: `Step ${stepId}`,
  stepOrder,
  createdAt: '2026-09-20T15:00:00Z',
  assigneeLabel: `Approver ${stepId}`,
  canAct: false,
  requiresOverride: false,
  ...flags,
});

// Step a is done, b is the one waiting, c comes after it. The backend sets the
// viewer flags only on b, the step the request is waiting on.
const stepsWith = (flags: Flags) => [
  record('sr-a', 'a', 'approved', 1),
  record('sr-b', 'b', 'pending', 2, { assigneeLabel: 'Treasurer position', ...flags }),
  record('sr-c', 'c', 'pending', 3),
];

const renderActions = (props: Partial<React.ComponentProps<typeof ApprovalStepActions>> = {}) => {
  const onDecided = vi.fn();
  renderWithRouter(
    <ApprovalStepActions
      isPendingApproval
      steps={stepsWith({ canAct: true })}
      subject="New supply hose (PR-0001)"
      onDecided={onDecided}
      {...props}
    />
  );
  return { onDecided };
};

describe('ApprovalStepActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApproveStep.mockReset();
    mockDenyStep.mockReset();
    mockApproveStep.mockResolvedValue(undefined);
    mockDenyStep.mockResolvedValue(undefined);
  });

  it('says who the step is waiting on and offers Approve / Deny to its named approver', async () => {
    const user = userEvent.setup();
    const { onDecided } = renderActions();

    expect(screen.getByText(/Waiting on/)).toHaveTextContent('Waiting on Treasurer position.');
    await user.click(screen.getByRole('button', { name: 'Approve' }));
    await user.type(within(screen.getByRole('dialog')).getByLabelText(/Notes/), 'Fine');
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Approve' }));

    await waitFor(() => expect(mockApproveStep).toHaveBeenCalledWith('sr-b', 'Fine', undefined));
    expect(onDecided).toHaveBeenCalledTimes(1);
  });

  it('denies the current step with the reason given', async () => {
    const user = userEvent.setup();
    renderActions();

    await user.click(screen.getByRole('button', { name: 'Deny' }));
    await user.type(within(screen.getByRole('dialog')).getByLabelText(/Reason/), 'Duplicate request');
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Deny' }));

    await waitFor(() => expect(mockDenyStep).toHaveBeenCalledWith('sr-b', 'Duplicate request', undefined));
  });

  it('takes the first pending step in the order the API sent, not a re-sort by step order', async () => {
    // Two steps sharing an order: the backend's own tiebreak put sr-y first,
    // and that is the one it will accept a decision on.
    const tied = [
      record('sr-y', 'y', 'pending', 1, { canAct: true }),
      record('sr-x', 'x', 'pending', 1, { canAct: true }),
    ];
    const user = userEvent.setup();
    renderActions({ steps: tied });

    await user.click(screen.getByRole('button', { name: 'Approve' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Approve' }));

    await waitFor(() => expect(mockApproveStep).toHaveBeenCalledWith('sr-y', undefined, undefined));
  });

  it('offers an approvals admin the override actions, which need a reason', async () => {
    const user = userEvent.setup();
    renderActions({ steps: stepsWith({ requiresOverride: true }) });

    expect(screen.getByText(/Waiting on/)).toHaveTextContent('Waiting on Treasurer position.');
    expect(screen.getByText('Not assigned to you')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Approve as approvals admin' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/This step is assigned to/)).toHaveTextContent(
      'This step is assigned to Treasurer position.'
    );
    await user.click(within(dialog).getByRole('button', { name: 'Approve as approvals admin' }));
    expect(within(dialog).getByText('Override reason is required.')).toBeInTheDocument();
    expect(mockApproveStep).not.toHaveBeenCalled();

    await user.type(within(dialog).getByLabelText(/Override reason/), 'Treasurer on leave');
    await user.click(within(dialog).getByRole('button', { name: 'Approve as approvals admin' }));

    await waitFor(() => expect(mockApproveStep).toHaveBeenCalledWith('sr-b', undefined, 'Treasurer on leave'));
  });

  it('only says who the step is waiting on to a viewer who cannot act on it', () => {
    renderActions({ steps: stepsWith({}) });

    expect(screen.getByText(/Waiting on/)).toHaveTextContent('Waiting on Treasurer position.');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('shows nothing when the request is not pending approval', () => {
    renderActions({ isPendingApproval: false });

    expect(screen.queryByText(/Waiting on/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
  });

  it('shows nothing when no step is pending', () => {
    renderActions({ steps: [record('sr-a', 'a', 'approved', 1), record('sr-b', 'b', 'sent', 2)] });

    expect(screen.queryByText(/Waiting on/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
  });

  it('acts only on the step the request is waiting on, whatever later steps say', () => {
    // A later step's flags are never set by the backend; if they were, they
    // must not put buttons on a step that is not current.
    const steps = [
      record('sr-a', 'a', 'pending', 1, { assigneeLabel: 'Chief position' }),
      record('sr-b', 'b', 'pending', 2, { canAct: true }),
    ];
    renderActions({ steps });

    expect(screen.getByText(/Waiting on/)).toHaveTextContent('Waiting on Chief position.');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
