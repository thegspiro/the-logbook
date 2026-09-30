import { describe, it, expect, vi, beforeEach } from 'vitest';
import type React from 'react';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '@/test/utils';
import type { ApprovalChain, ApprovalStepRecord } from '../types';

const mockGetChain = vi.fn();
vi.mock('../services/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/api')>()),
  approvalChainService: { get: (...args: unknown[]) => mockGetChain(...args) as unknown },
}));

const mockApproveStep = vi.fn();
const mockDenyStep = vi.fn();
vi.mock('../store/financeStore', () => ({
  useFinanceStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ approveStep: mockApproveStep, denyStep: mockDenyStep }),
}));

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

const mockCheckPermission = vi.fn();
vi.mock('@/stores/authStore', () => ({
  useAuthStore: (selector: (s: { checkPermission: (p: string) => boolean }) => unknown) =>
    selector({ checkPermission: (p) => mockCheckPermission(p) as boolean }),
}));

import { ApprovalStepActions } from './ApprovalStepActions';

const record = (id: string, stepId: string, status: ApprovalStepRecord['status'], stepOrder: number) =>
  ({
    id,
    chainId: 'chain-1',
    stepId,
    entityType: 'purchase_request',
    entityId: 'pr-1',
    status,
    stepName: `Step ${stepId}`,
    stepOrder,
    createdAt: '2026-09-20T15:00:00Z',
  }) satisfies ApprovalStepRecord;

const chain = (types: Record<string, 'approval' | 'notification'>): Partial<ApprovalChain> => ({
  id: 'chain-1',
  steps: Object.entries(types).map(([id, stepType], i) => ({
    id,
    chainId: 'chain-1',
    stepOrder: i,
    name: `Step ${id}`,
    stepType,
    allowSelfApproval: false,
    required: true,
    createdAt: '2026-09-01T00:00:00Z',
  })),
});

// Step a is done, b is the one waiting, c comes after it.
const steps = [
  record('sr-a', 'a', 'approved', 1),
  record('sr-b', 'b', 'pending', 2),
  record('sr-c', 'c', 'pending', 3),
];

const renderActions = (props: Partial<React.ComponentProps<typeof ApprovalStepActions>> = {}) => {
  const onDecided = vi.fn();
  renderWithRouter(
    <ApprovalStepActions
      isPendingApproval
      steps={steps}
      subject="New supply hose (PR-0001)"
      onDecided={onDecided}
      {...props}
    />
  );
  return { onDecided };
};

// Lets the chain lookup resolve and its state update render, so a "nothing is
// shown" assertion is made after the component has decided, not before.
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

describe('ApprovalStepActions', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetChain.mockReset();
    mockCheckPermission.mockReset();
    mockApproveStep.mockReset();
    mockDenyStep.mockReset();
    mockGetChain.mockResolvedValue(chain({ a: 'approval', b: 'approval', c: 'approval' }));
    mockCheckPermission.mockImplementation((p: string) => p === 'finance.approve');
    mockApproveStep.mockResolvedValue(undefined);
    mockDenyStep.mockResolvedValue(undefined);
  });

  it('approves the step the request is waiting on, then asks the page to re-fetch', async () => {
    const user = userEvent.setup();
    const { onDecided } = renderActions();

    await user.click(await screen.findByRole('button', { name: 'Approve' }));
    await user.type(within(screen.getByRole('dialog')).getByLabelText(/Notes/), 'Fine');
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Approve' }));

    await waitFor(() => expect(mockApproveStep).toHaveBeenCalledWith('sr-b', 'Fine'));
    expect(onDecided).toHaveBeenCalledTimes(1);
    expect(mockGetChain).toHaveBeenCalledWith('chain-1');
  });

  it('denies the current step with the reason given', async () => {
    const user = userEvent.setup();
    renderActions();

    await user.click(await screen.findByRole('button', { name: 'Deny' }));
    await user.type(within(screen.getByRole('dialog')).getByLabelText(/Reason/), 'Duplicate request');
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Deny' }));

    await waitFor(() => expect(mockDenyStep).toHaveBeenCalledWith('sr-b', 'Duplicate request'));
  });

  it('takes the first pending step in the order the API sent, not a re-sort by step order', async () => {
    // Two steps sharing an order: the backend's own tiebreak put sr-y first,
    // and that is the one it will accept a decision on.
    const tied = [record('sr-y', 'y', 'pending', 1), record('sr-x', 'x', 'pending', 1)];
    mockGetChain.mockResolvedValue(chain({ x: 'approval', y: 'approval' }));
    const user = userEvent.setup();
    renderActions({ steps: tied });

    await user.click(await screen.findByRole('button', { name: 'Approve' }));
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Approve' }));

    await waitFor(() => expect(mockApproveStep).toHaveBeenCalledWith('sr-y', undefined));
  });

  it('shows nothing when the request is not pending approval', () => {
    renderActions({ isPendingApproval: false });

    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    expect(mockGetChain).not.toHaveBeenCalled();
  });

  it('shows nothing to a viewer without finance.approve', () => {
    mockCheckPermission.mockReturnValue(false);
    renderActions();

    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    expect(mockGetChain).not.toHaveBeenCalled();
  });

  it('shows nothing when no step is pending', () => {
    renderActions({ steps: [record('sr-a', 'a', 'approved', 1), record('sr-b', 'b', 'sent', 2)] });

    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    expect(mockGetChain).not.toHaveBeenCalled();
  });

  it('shows nothing when the waiting step is a notification', async () => {
    mockGetChain.mockResolvedValue(chain({ a: 'approval', b: 'notification', c: 'approval' }));
    renderActions();

    await waitFor(() => expect(mockGetChain).toHaveBeenCalledWith('chain-1'));
    await settle();
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Deny' })).not.toBeInTheDocument();
  });

  it('shows nothing when the step’s type cannot be read', async () => {
    mockGetChain.mockRejectedValue(new Error('offline'));
    renderActions();

    await waitFor(() => expect(mockGetChain).toHaveBeenCalledWith('chain-1'));
    await settle();
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
  });
});
