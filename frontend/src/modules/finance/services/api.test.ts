/**
 * The manual approval calls for requests that no approval chain applies to.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGet = vi.fn();
const mockPost = vi.fn();

vi.mock('../../../utils/createApiClient', () => ({
  createApiClient: () => ({
    get: (...args: unknown[]) => mockGet(...args) as unknown,
    post: (...args: unknown[]) => mockPost(...args) as unknown,
  }),
}));

// Import AFTER mocks are in place
import { approvalChainService, approvalService } from './api';
import { ApprovalEntityType } from '../types';

describe('approvalService manual approval', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockPost.mockReset();
    mockPost.mockResolvedValue({ data: undefined });
  });

  it('lists requests with no approval steps', async () => {
    const rows = [
      {
        entityType: 'purchase_request',
        entityId: 'pr-1',
        entityTitle: 'Hose couplings',
        entityAmount: '1200.00',
        requesterName: 'Pat Smith',
        submittedAt: '2026-09-01T12:00:00Z',
      },
    ];
    mockGet.mockResolvedValue({ data: rows });

    await expect(approvalService.getUnrouted()).resolves.toEqual(rows);
    expect(mockGet).toHaveBeenCalledWith('/finance/approvals/unrouted');
  });

  it('returns an empty list for a non-array body', async () => {
    mockGet.mockResolvedValue({ data: null });
    await expect(approvalService.getUnrouted()).resolves.toEqual([]);
  });

  it('approves by entity type and id, with the note', async () => {
    await approvalService.manualApprove(ApprovalEntityType.CHECK_REQUEST, 'cr-1', 'Within policy');
    expect(mockPost).toHaveBeenCalledWith('/finance/approvals/manual/check_request/cr-1/approve', {
      notes: 'Within policy',
    });
  });

  it('omits a blank note', async () => {
    await approvalService.manualApprove(ApprovalEntityType.PURCHASE_REQUEST, 'pr-1', '');
    expect(mockPost).toHaveBeenCalledWith('/finance/approvals/manual/purchase_request/pr-1/approve', {
      notes: undefined,
    });
  });

  it('denies with the reason', async () => {
    await approvalService.manualDeny(ApprovalEntityType.EXPENSE_REPORT, 'er-1', 'Missing receipts');
    expect(mockPost).toHaveBeenCalledWith('/finance/approvals/manual/expense_report/er-1/deny', {
      reason: 'Missing receipts',
    });
  });
});

describe('approvalService step decisions', () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockPost.mockReset();
    mockPost.mockResolvedValue({ data: { id: 'sr-1' } });
  });

  const bodyOf = (call = 0) => (mockPost.mock.calls[call]?.[1] ?? {}) as Record<string, unknown>;

  it('approves without an override reason key when none is given', async () => {
    await approvalService.approve('sr-1', 'Fine');
    expect(mockPost).toHaveBeenCalledWith('/finance/approvals/sr-1/approve', { notes: 'Fine' });
    expect(Object.keys(bodyOf())).not.toContain('overrideReason');
  });

  it('approves with the override reason when one is given', async () => {
    await approvalService.approve('sr-1', undefined, 'Treasurer is on leave');
    expect(mockPost).toHaveBeenCalledWith('/finance/approvals/sr-1/approve', {
      notes: undefined,
      overrideReason: 'Treasurer is on leave',
    });
    expect(bodyOf().overrideReason).toBe('Treasurer is on leave');
  });

  it('denies without an override reason key when none is given', async () => {
    await approvalService.deny('sr-2', 'Duplicate');
    expect(mockPost).toHaveBeenCalledWith('/finance/approvals/sr-2/deny', { notes: 'Duplicate' });
    expect(Object.keys(bodyOf())).not.toContain('overrideReason');
  });

  it('denies with the override reason when one is given', async () => {
    await approvalService.deny('sr-2', 'Duplicate', 'Position vacant');
    expect(bodyOf()).toEqual({ notes: 'Duplicate', overrideReason: 'Position vacant' });
  });

  it('treats a blank override reason as not given', async () => {
    await approvalService.approve('sr-1', 'Fine', '');
    expect(Object.keys(bodyOf())).not.toContain('overrideReason');
  });
});

describe('approvalChainService.getApproverCoverage', () => {
  beforeEach(() => {
    mockGet.mockReset();
  });

  it('reads the coverage report', async () => {
    const rows = [{ chainId: 'c1', stepId: 's1', problem: 'not_found', pendingRequestCount: 2 }];
    mockGet.mockResolvedValue({ data: rows });

    await expect(approvalChainService.getApproverCoverage()).resolves.toEqual(rows);
    expect(mockGet).toHaveBeenCalledWith('/finance/approval-chains/approver-coverage');
  });

  it('returns an empty list for a non-array body', async () => {
    mockGet.mockResolvedValue({ data: null });
    await expect(approvalChainService.getApproverCoverage()).resolves.toEqual([]);
  });
});
