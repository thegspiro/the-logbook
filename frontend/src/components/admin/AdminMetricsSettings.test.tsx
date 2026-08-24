import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetMetricSettings = vi.fn();
const mockUpdateMetricSettings = vi.fn();
vi.mock('../../services/adminHubService', () => ({
  adminHubService: {
    getMetricSettings: (...args: unknown[]) => mockGetMetricSettings(...args) as unknown,
    updateMetricSettings: (...args: unknown[]) => mockUpdateMetricSettings(...args) as unknown,
  },
}));
vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

import { AdminMetricsSettings } from './AdminMetricsSettings';
import type { AdminMetricSettings as Settings } from '../../types/adminHub';

const settings: Settings = {
  moduleKey: 'training',
  options: [
    {
      key: 'compliance_rate',
      label: 'Compliance',
      description: 'Share of active members current on required certifications',
      value: '87%',
      unavailableReason: null,
      fixed: false,
    },
    {
      key: 'hours_this_quarter',
      label: 'Hours this quarter',
      description: 'Approved hours since the quarter began',
      value: '1,840',
      unavailableReason: null,
      fixed: false,
    },
    {
      key: 'active_programs',
      label: 'Active programs',
      description: 'Programs open for enrollment',
      value: '6',
      unavailableReason: null,
      fixed: false,
    },
    {
      key: 'certs_this_year',
      label: 'Certifications this year',
      description: 'New certifications recorded since January 1',
      value: '37',
      unavailableReason: null,
      fixed: false,
    },
    {
      key: 'skills_tests_passed',
      label: 'Skills tests passed',
      description: 'Completed evaluations with a passing result',
      value: null,
      unavailableReason: 'Needs at least one skills-test template',
      fixed: false,
    },
    {
      key: 'needs_attention',
      label: 'Needs attention',
      description: 'The count that feeds the queue below',
      value: null,
      unavailableReason: null,
      fixed: true,
    },
  ],
  selected: ['compliance_rate', 'hours_this_quarter', 'active_programs'],
  appliesToEveryone: true,
  isPersonal: false,
  departmentDefault: ['compliance_rate', 'hours_this_quarter', 'active_programs'],
  builtInDefault: ['compliance_rate', 'hours_this_quarter', 'active_programs'],
};

const renderPanel = () =>
  render(<AdminMetricsSettings moduleKey="training" moduleLabel="Training" permission="training.manage" />);

describe('AdminMetricsSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetMetricSettings.mockResolvedValue(settings);
    mockUpdateMetricSettings.mockImplementation((_module: string, payload: { metricKeys: string[] }) =>
      Promise.resolve({ ...settings, selected: payload.metricKeys })
    );
  });

  it('shows the three chosen slots and the locked fourth', async () => {
    renderPanel();

    await screen.findByRole('heading', { name: 'Headline metrics' });
    expect(screen.getByText('Slot 1 · phone')).toBeInTheDocument();
    expect(screen.getByText('Slot 2 · phone')).toBeInTheDocument();
    expect(screen.getByText('Slot 3')).toBeInTheDocument();
    expect(screen.getByText('Slot 4 · fixed')).toBeInTheDocument();
  });

  // A metric the department cannot produce is listed rather than hidden, so an
  // admin can see what turning a module on would buy them instead of wondering
  // why something is missing.
  it('lists an unavailable metric with its reason and no way to choose it', async () => {
    renderPanel();

    await screen.findByText('Skills tests passed');
    expect(screen.getByText('Needs at least one skills-test template')).toBeInTheDocument();
    expect(screen.getByText('Not available')).toBeInTheDocument();
  });

  it('will not take a fourth open slot until one is freed', async () => {
    const user = userEvent.setup();
    renderPanel();

    await screen.findByText('Certifications this year');
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled();

    // Freeing a slot also returns Compliance to the list, so both rows now
    // offer an Add — the point is that the cap, not the row, was the blocker.
    await user.click(screen.getByRole('button', { name: 'Remove Compliance from slot 1' }));
    const addButtons = screen.getAllByRole('button', { name: 'Add' });
    expect(addButtons).toHaveLength(2);
    for (const button of addButtons) expect(button).toBeEnabled();
  });

  // Drag is the quick gesture; the arrows are the one that works with a
  // keyboard, a screen reader, or a thumb.
  it('reorders slots with the arrow controls', async () => {
    const user = userEvent.setup();
    renderPanel();

    await screen.findByText('Slot 1 · phone');
    await user.click(screen.getByRole('button', { name: 'Move Hours this quarter earlier' }));
    await user.click(screen.getByRole('button', { name: 'Save metrics' }));

    await waitFor(() => {
      expect(mockUpdateMetricSettings).toHaveBeenCalledWith('training', {
        metricKeys: ['hours_this_quarter', 'compliance_rate', 'active_programs'],
        appliesToEveryone: true,
      });
    });
  });

  it('keeps Save inert until something actually changed', async () => {
    const user = userEvent.setup();
    renderPanel();

    await screen.findByText('Slot 1 · phone');
    expect(screen.getByRole('button', { name: 'Save metrics' })).toBeDisabled();

    await user.click(screen.getByRole('switch'));
    expect(screen.getByRole('button', { name: 'Save metrics' })).toBeEnabled();
  });

  // Turning the toggle off means the admin keeps their own four; both fields
  // go on every save, because an omitted key on an update path is how a
  // cleared value quietly survives.
  it('sends the audience toggle with the selection on every save', async () => {
    const user = userEvent.setup();
    renderPanel();

    await screen.findByText('Slot 1 · phone');
    await user.click(screen.getByRole('switch'));
    await user.click(screen.getByRole('button', { name: 'Save metrics' }));

    await waitFor(() => {
      expect(mockUpdateMetricSettings).toHaveBeenCalledWith('training', {
        metricKeys: ['compliance_rate', 'hours_this_quarter', 'active_programs'],
        appliesToEveryone: false,
      });
    });
  });
});
