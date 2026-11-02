import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComplianceSummary } from '../types';

const mockGetUserCompliance = vi.fn();
const mockGetProspectCompliance = vi.fn();

vi.mock('../services/api', () => ({
  medicalScreeningService: {
    getUserCompliance: (...a: unknown[]) => mockGetUserCompliance(...a) as unknown,
    getProspectCompliance: (...a: unknown[]) => mockGetProspectCompliance(...a) as unknown,
  },
}));

import { SubjectCompliancePanel } from './SubjectCompliancePanel';
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

describe('SubjectCompliancePanel', () => {
  beforeEach(() => {
    mockGetUserCompliance.mockReset();
    mockGetProspectCompliance.mockReset();
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
    render(<SubjectCompliancePanel subject={{ type: 'user', id: 'u-1', name: 'Jake Thompson' }} onClose={vi.fn()} />);

    expect(await screen.findByText('2 of 3 requirements met · 1 not met · 1 expiring soon')).toBeInTheDocument();
    expect(mockGetUserCompliance).toHaveBeenCalledWith('u-1');
    expect(screen.getByRole('heading', { name: 'Jake Thompson' })).toBeInTheDocument();
    expect(screen.getByText('Met')).toBeInTheDocument();
    expect(screen.getByText('Expires in 9 days')).toBeInTheDocument();
    expect(screen.getByText('No qualifying record')).toBeInTheDocument();
    expect(screen.getByText('Self-recorded')).toBeInTheDocument();
  });

  it('reads a prospect through the prospect endpoint and does not call zero requirements compliant', async () => {
    render(<SubjectCompliancePanel subject={{ type: 'prospect', id: 'p-1', name: 'Alex Rivera' }} onClose={vi.fn()} />);

    expect(await screen.findByText('No screening requirements are active.')).toBeInTheDocument();
    expect(mockGetProspectCompliance).toHaveBeenCalledWith('p-1');
    expect(mockGetUserCompliance).not.toHaveBeenCalled();
    expect(screen.queryByText(/requirements met/)).not.toBeInTheDocument();
  });

  it('renders nothing and asks for nothing until someone is chosen', () => {
    const { container } = render(<SubjectCompliancePanel subject={null} onClose={vi.fn()} />);

    expect(container).toBeEmptyDOMElement();
    expect(mockGetUserCompliance).not.toHaveBeenCalled();
  });

  it('closes', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<SubjectCompliancePanel subject={{ type: 'user', id: 'u-1', name: 'Jake Thompson' }} onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // Deep-dive review 2026-11-02: the panel renders below the whole roster, so
  // on a 20-member department View opened it ~1,300px under the row tapped and
  // the tap looked like it did nothing — on a phone and at 1280x900 alike.
  it('brings itself into view and takes focus when someone is chosen', async () => {
    const scrollIntoView = vi.mocked(Element.prototype.scrollIntoView);
    scrollIntoView.mockClear();
    const { rerender } = render(
      <SubjectCompliancePanel subject={{ type: 'user', id: 'u-1', name: 'Jake Thompson' }} onClose={vi.fn()} />
    );

    const heading = screen.getByRole('heading', { name: 'Jake Thompson' });
    expect(heading).toHaveFocus();
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView.mock.instances[0]).toBe(screen.getByRole('region', { name: 'Jake Thompson' }));

    rerender(
      <SubjectCompliancePanel subject={{ type: 'prospect', id: 'p-1', name: 'Alex Rivera' }} onClose={vi.fn()} />
    );
    expect(screen.getByRole('heading', { name: 'Alex Rivera' })).toHaveFocus();
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
  });

  // W71b-1: a failed result now leaves the requirement unmet; the panel must
  // say it failed, not that it "Expired", which sends an officer to book a
  // routine renewal for a member who was found unfit.
  it('labels a requirement unmet by a failed result as failed', async () => {
    mockGetUserCompliance.mockResolvedValue(
      summary({
        compliant_count: 0,
        non_compliant_count: 1,
        expiring_soon_count: 0,
        total_requirements: 1,
        items: [
          {
            requirement_id: 'req-1',
            requirement_name: 'Annual physical',
            screening_type: 'physical_exam',
            is_compliant: false,
            last_screening_date: '2026-10-25',
            status: 'failed',
            self_recorded: false,
          },
        ],
      })
    );
    render(<SubjectCompliancePanel subject={{ type: 'user', id: 'u-1', name: 'Jake Thompson' }} onClose={vi.fn()} />);

    expect(await screen.findByText('Failed — not cleared')).toBeInTheDocument();
    expect(screen.queryByText('Expired')).not.toBeInTheDocument();
  });
});
