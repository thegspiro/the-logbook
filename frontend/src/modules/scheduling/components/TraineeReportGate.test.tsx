import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../test/utils';

const mockGetRequirement = vi.fn();
vi.mock('../services/api', () => ({
  schedulingService: {
    getTraineeReportRequirement: (...a: unknown[]) => mockGetRequirement(...a) as unknown,
  },
}));

import TraineeReportGate, { type TraineeReportGateState } from './TraineeReportGate';

const onChange = vi.fn<(state: TraineeReportGateState) => void>();
const lastState = () => onChange.mock.calls[onChange.mock.calls.length - 1]?.[0];

describe('TraineeReportGate — shift evaluations', () => {
  beforeEach(() => {
    onChange.mockReset();
    mockGetRequirement.mockReset();
    // The report setting is off; only the evaluation is missing.
    mockGetRequirement.mockResolvedValue({
      required: false,
      missing: [],
      missing_evaluations: [{ user_id: 'u2', name: 'Marcus Bell (EMT Field Internship)' }],
      can_override: false,
    });
  });

  it('names a missing evaluation and blocks close-out even with the report setting off', async () => {
    renderWithRouter(<TraineeReportGate shiftId="sh1" onChange={onChange} />);

    expect(await screen.findByText('Marcus Bell (EMT Field Internship)')).toBeInTheDocument();
    expect(screen.getByText('A shift evaluation is still needed for:')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open the shift report to fill them in' })).toHaveAttribute(
      'href',
      '/scheduling?tab=shift-reports&shift=sh1&view=create'
    );
    await waitFor(() => expect(lastState()?.blocked).toBe(true));
  });

  it('lets a scheduling admin override a missing evaluation with a reason', async () => {
    mockGetRequirement.mockResolvedValue({
      required: false,
      missing: [],
      missing_evaluations: [{ user_id: 'u2', name: 'Marcus Bell (EMT Field Internship)' }],
      can_override: true,
    });
    const user = userEvent.setup();
    renderWithRouter(<TraineeReportGate shiftId="sh1" onChange={onChange} />);

    await user.click(await screen.findByRole('checkbox', { name: 'Close out anyway, without this evaluation' }));
    await waitFor(() => expect(lastState()).toEqual({ blocked: true, override: true, reason: '' }));
    await user.type(screen.getByLabelText('Reason for closing out without the shift evaluations'), 'Officer off sick');

    await waitFor(() => expect(lastState()).toEqual({ blocked: false, override: true, reason: 'Officer off sick' }));
  });

  it('names both lists when a report and an evaluation are missing', async () => {
    mockGetRequirement.mockResolvedValue({
      required: true,
      missing: [{ user_id: 'u3', name: 'Terry Trainee' }],
      missing_evaluations: [{ user_id: 'u2', name: 'Marcus Bell (EMT Field Internship)' }],
      can_override: true,
    });
    renderWithRouter(<TraineeReportGate shiftId="sh1" onChange={onChange} />);

    expect(await screen.findByText('Terry Trainee')).toBeInTheDocument();
    expect(screen.getByText('Marcus Bell (EMT Field Internship)')).toBeInTheDocument();
    expect(
      screen.getByRole('checkbox', { name: 'Close out anyway, without these reports and evaluations' })
    ).toBeInTheDocument();
  });

  it('shows nothing and blocks nothing when nothing is missing', async () => {
    mockGetRequirement.mockResolvedValue({ required: true, missing: [], missing_evaluations: [], can_override: true });
    const { container } = renderWithRouter(<TraineeReportGate shiftId="sh1" onChange={onChange} />);

    await waitFor(() => expect(mockGetRequirement).toHaveBeenCalledWith('sh1'));
    await waitFor(() => expect(lastState()?.blocked).toBe(false));
    expect(container).toBeEmptyDOMElement();
  });
});
