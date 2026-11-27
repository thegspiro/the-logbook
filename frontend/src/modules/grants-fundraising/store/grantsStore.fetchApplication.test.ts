/**
 * The grant detail page writes budget lines, expenditures and notes to the
 * grant in its URL. Opening another grant must not leave the previous one
 * standing in while it loads, after its load fails, or when a slower response
 * for the previous one lands late.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { GrantApplication } from '../types';

const mockGetApplication = vi.fn();

vi.mock('../services/api', () => ({
  grantsService: {
    getApplication: (...args: unknown[]) => mockGetApplication(...args) as unknown,
  },
  fundraisingService: {},
}));

import { useGrantsStore } from './grantsStore';

const application = (id: string, grantProgramName: string): GrantApplication => ({
  id,
  organizationId: 'org-1',
  opportunityId: null,
  grantProgramName,
  grantAgency: 'Test Agency',
  applicationStatus: 'active',
  amountRequested: null,
  amountAwarded: null,
  matchAmount: null,
  matchSource: null,
  applicationDeadline: null,
  submittedDate: null,
  awardDate: null,
  grantStartDate: null,
  grantEndDate: null,
  projectDescription: null,
  narrativeSummary: null,
  budgetSummary: null,
  keyContacts: null,
  federalAwardId: null,
  nfirsCompliant: null,
  performancePeriodMonths: null,
  reportingFrequency: null,
  nextReportDue: null,
  finalReportDue: null,
  assignedTo: null,
  priority: 'medium',
  linkedCampaignId: null,
  notes: null,
  createdBy: null,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
});

describe('grantsStore.fetchApplication', () => {
  beforeEach(() => {
    mockGetApplication.mockReset();
    useGrantsStore.setState({
      currentApplication: application('A', 'Alpha'),
      selectedApplication: application('A', 'Alpha'),
      isLoading: false,
      error: null,
    });
  });

  it('drops the previous grant when another one fails to load', async () => {
    mockGetApplication.mockRejectedValue(new Error('network'));

    await useGrantsStore.getState().fetchApplication('B');

    expect(useGrantsStore.getState().currentApplication).toBeNull();
    expect(useGrantsStore.getState().error).not.toBeNull();
  });

  it('keeps the grant on screen while the same grant reloads', async () => {
    let release: (value: GrantApplication) => void = () => undefined;
    mockGetApplication.mockImplementation(
      () =>
        new Promise<GrantApplication>((resolve) => {
          release = resolve;
        })
    );

    const call = useGrantsStore.getState().fetchApplication('A');
    expect(useGrantsStore.getState().currentApplication?.id).toBe('A');
    release(application('A', 'Alpha'));
    await call;
  });

  it('ignores a late response for the grant it left', async () => {
    let releaseA: (value: GrantApplication) => void = () => undefined;
    mockGetApplication.mockImplementationOnce(
      () =>
        new Promise<GrantApplication>((resolve) => {
          releaseA = resolve;
        })
    );
    mockGetApplication.mockResolvedValueOnce(application('B', 'Bravo'));

    const first = useGrantsStore.getState().fetchApplication('A');
    await useGrantsStore.getState().fetchApplication('B');
    releaseA(application('A', 'Alpha'));
    await first;

    expect(useGrantsStore.getState().currentApplication?.id).toBe('B');
  });
});
