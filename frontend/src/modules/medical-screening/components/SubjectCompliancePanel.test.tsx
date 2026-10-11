import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import type { ComplianceSummary } from '../types';

const mockListSubjects = vi.fn();
const mockGetUserCompliance = vi.fn();
const mockGetProspectCompliance = vi.fn();

vi.mock('../services/api', () => ({
  medicalScreeningService: {
    listSubjects: (...a: unknown[]) => mockListSubjects(...a) as unknown,
    getUserCompliance: (...a: unknown[]) => mockGetUserCompliance(...a) as unknown,
    getProspectCompliance: (...a: unknown[]) => mockGetProspectCompliance(...a) as unknown,
  },
}));

import { SubjectCompliancePanel, type ComplianceSubject } from './SubjectCompliancePanel';
import { useMedicalScreeningStore } from '../store/medicalScreeningStore';

const summary = (overrides: Partial<ComplianceSummary> = {}): ComplianceSummary => ({
  subject_id: 'u-1',
  subject_name: 'Jake Thompson',
  subject_type: 'user',
  total_requirements: 3,
  compliant_count: 2,
  non_compliant_count: 1,
  expiring_soon_count: 1,
  is_fully_compliant: false,
  self_recorded_count: 0,
  items: [
    {
      requirement_id: 'req-1',
      requirement_name: 'Annual physical',
      screening_type: 'physical_exam',
      is_compliant: true,
      last_screening_date: '2026-01-10',
      expiration_date: '2027-01-10',
      days_until_expiration: 120,
      status: 'passed',
      self_recorded: false,
    },
    {
      requirement_id: 'req-2',
      requirement_name: 'Respirator fit',
      screening_type: 'fitness_assessment',
      is_compliant: true,
      expiration_date: '2026-10-20',
      days_until_expiration: 9,
      status: 'passed',
      self_recorded: true,
    },
    {
      requirement_id: 'req-3',
      requirement_name: 'Drug screen',
      screening_type: 'drug_screening',
      is_compliant: false,
      self_recorded: false,
    },
  ],
  ...overrides,
});

const Harness = () => {
  const [subject, setSubject] = useState<ComplianceSubject | null>(null);
  return <SubjectCompliancePanel subject={subject} onSubjectChange={setSubject} />;
};

describe('SubjectCompliancePanel', () => {
  beforeEach(() => {
    mockListSubjects.mockReset();
    mockGetUserCompliance.mockReset();
    mockGetProspectCompliance.mockReset();
    mockListSubjects.mockResolvedValue({
      members: [{ id: 'u-1', name: 'Jake Thompson' }],
      prospects: [{ id: 'p-1', name: 'Alex Rivera' }],
    });
    mockGetUserCompliance.mockResolvedValue(summary());
    mockGetProspectCompliance.mockResolvedValue(
      summary({
        subject_id: 'p-1',
        subject_name: 'Alex Rivera',
        subject_type: 'prospect',
        total_requirements: 0,
        compliant_count: 0,
        non_compliant_count: 0,
        expiring_soon_count: 0,
        is_fully_compliant: true,
        items: [],
      })
    );
    useMedicalScreeningStore.setState({ compliance: null, complianceLoading: false, error: null });
  });

  it("shows a member's requirements as the server graded them", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const picker = await screen.findByLabelText('Show compliance for');
    await waitFor(() => expect(picker).toBeEnabled());
    await user.selectOptions(picker, 'user:u-1');

    expect(await screen.findByText('2 of 3 requirements met · 1 not met · 1 expiring soon')).toBeInTheDocument();
    expect(mockGetUserCompliance).toHaveBeenCalledWith('u-1');
    expect(screen.getByText('Met')).toBeInTheDocument();
    expect(screen.getByText('Expires in 9 days')).toBeInTheDocument();
    expect(screen.getByText('No qualifying record')).toBeInTheDocument();
    expect(screen.getByText('Self-recorded')).toBeInTheDocument();
  });

  it('reads a prospect through the prospect endpoint and does not call zero requirements compliant', async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const picker = await screen.findByLabelText('Show compliance for');
    await waitFor(() => expect(picker).toBeEnabled());
    await user.selectOptions(picker, 'prospect:p-1');

    expect(await screen.findByText('No screening requirements are active.')).toBeInTheDocument();
    expect(mockGetProspectCompliance).toHaveBeenCalledWith('p-1');
    expect(mockGetUserCompliance).not.toHaveBeenCalled();
    expect(screen.queryByText(/requirements met/)).not.toBeInTheDocument();
  });

  it('shows nothing until someone is chosen', async () => {
    render(<Harness />);
    await screen.findByLabelText('Show compliance for');

    expect(mockGetUserCompliance).not.toHaveBeenCalled();
    expect(screen.queryByText(/requirements met/)).not.toBeInTheDocument();
  });
});
