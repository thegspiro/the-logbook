import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router';

const getWidgetPreferences = vi.fn();
const getWidgetSummary = vi.fn();
const saveWidgetPreferences = vi.fn();
const toastSuccess = vi.fn();
const toastError = vi.fn();

vi.mock('../../modules/scheduling/services/api', () => ({
  schedulingService: {
    getWidgetPreferences: (...args: unknown[]) => getWidgetPreferences(...args) as unknown,
    getWidgetSummary: (...args: unknown[]) => getWidgetSummary(...args) as unknown,
    saveWidgetPreferences: (...args: unknown[]) => saveWidgetPreferences(...args) as unknown,
  },
}));

vi.mock('react-hot-toast', () => ({
  default: {
    success: (...args: unknown[]) => {
      toastSuccess(...args);
    },
    error: (...args: unknown[]) => {
      toastError(...args);
    },
  },
}));

import SchedulingWidgets from './SchedulingWidgets';

const summary = {
  timezone: 'America/New_York',
  window_start: '2026-08-22T04:00:00Z',
  window_end: '2026-09-05T04:00:00Z',
  today_staffing: 11,
  future_coverage_gaps: 2,
  open_slots: 3,
  pending_staffing_changes: 4,
  incomplete_closeouts: 5,
  workload_imbalance: 6,
  special_operations: 7,
  scheduling_enabled: true,
};

const renderWidget = () =>
  render(
    <BrowserRouter>
      <SchedulingWidgets timezone="America/New_York" />
    </BrowserRouter>
  );

describe('SchedulingWidgets', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getWidgetPreferences.mockResolvedValue({ widgets: {} });
    getWidgetSummary.mockResolvedValue(summary);
    saveWidgetPreferences.mockResolvedValue({ widgets: {} });
  });

  it('renders all operational totals without exposing the raw timezone identifier', async () => {
    renderWidget();
    expect(await screen.findByLabelText('Today’s Staffing: 11. View filtered schedule.')).toBeInTheDocument();
    // The organization timezone still drives which day "today" is; it is not
    // copy for the member to read.
    expect(screen.queryByText('America/New_York', { exact: false })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Special Operations: 7. View filtered schedule.')).toBeInTheDocument();
    expect(getWidgetSummary).toHaveBeenCalledTimes(7);
  });

  it('shows the disabled state instead of actionable totals', async () => {
    getWidgetSummary.mockResolvedValue({ ...summary, scheduling_enabled: false });
    renderWidget();
    expect(await screen.findByText('Scheduling is disabled for this organization.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Today’s Staffing: 11. View filtered schedule.')).not.toBeInTheDocument();
  });

  it('saves defaults for the selected widget and reloads validated preferences', async () => {
    const user = userEvent.setup();
    renderWidget();
    await screen.findByLabelText('Today’s Staffing: 11. View filtered schedule.');
    await user.type(screen.getByLabelText('Station ID'), 'station-1');
    await user.type(screen.getByLabelText('Platoon'), 'A');
    await user.selectOptions(screen.getByLabelText('Days'), '30');
    await user.click(screen.getByRole('button', { name: 'Save defaults' }));
    await waitFor(() =>
      expect(saveWidgetPreferences).toHaveBeenCalledWith({
        widgets: { today_staffing: { station_id: 'station-1', platoon: 'A', horizon_days: 30 } },
      })
    );
    expect(toastSuccess).toHaveBeenCalledWith('Widget defaults saved');
  });

  it('reports permission loss or removed-filter failures without retaining a false success state', async () => {
    getWidgetPreferences.mockRejectedValue(new Error('Forbidden'));
    renderWidget();
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(screen.getAllByText('0')).toHaveLength(7);
  });
});
