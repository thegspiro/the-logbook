import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AdminHoursReviewSettings } from '../types';
import ReviewRulesTab from './ReviewRulesTab';

const getReviewSettings = vi.fn<() => Promise<AdminHoursReviewSettings>>();
const updateSettings = vi.fn<(updates: Record<string, unknown>) => Promise<Record<string, unknown>>>();
let permissions: string[] = [];

vi.mock('../services/api', () => ({
  adminHoursEntryService: { getReviewSettings: () => getReviewSettings() },
}));

vi.mock('../../../services/api', () => ({
  organizationService: { updateSettings: (u: Record<string, unknown>) => updateSettings(u) },
}));

vi.mock('../../../stores/authStore', () => ({
  useAuthStore: (selector: (state: unknown) => unknown) =>
    selector({ checkPermission: (p: string) => permissions.includes(p) }),
}));

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

describe('ReviewRulesTab', () => {
  beforeEach(() => {
    getReviewSettings.mockReset();
    getReviewSettings.mockResolvedValue({ allowSelfApproval: false, resyncRequeueGrowthPercent: 25 });
    updateSettings.mockReset();
    updateSettings.mockResolvedValue({});
    permissions = ['settings.manage'];
  });

  it('shows the rules the server resolved', async () => {
    render(<ReviewRulesTab />);

    const toggle = await screen.findByRole('checkbox', { name: /approve their own entries/i });
    expect(toggle).not.toBeChecked();
    expect(screen.getByRole('spinbutton')).toHaveValue(25);
  });

  it('writes the self-approval switch through the organization settings and re-reads it', async () => {
    render(<ReviewRulesTab />);
    const toggle = await screen.findByRole('checkbox', { name: /approve their own entries/i });
    getReviewSettings.mockResolvedValue({ allowSelfApproval: true, resyncRequeueGrowthPercent: 25 });

    fireEvent.click(toggle);

    await waitFor(() => expect(updateSettings).toHaveBeenCalledWith({ admin_hours: { allow_self_approval: true } }));
    await waitFor(() => expect(toggle).toBeChecked());
    expect(getReviewSettings).toHaveBeenCalledTimes(2);
  });

  it('saves a new growth threshold', async () => {
    render(<ReviewRulesTab />);
    const input = await screen.findByRole('spinbutton');

    fireEvent.change(input, { target: { value: '50' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(updateSettings).toHaveBeenCalledWith({ admin_hours: { resync_requeue_growth_percent: 50 } })
    );
  });

  it('is read-only for a reviewer without settings.manage', async () => {
    permissions = ['admin_hours.manage'];
    render(<ReviewRulesTab />);

    const toggle = await screen.findByRole('checkbox', { name: /approve their own entries/i });
    expect(toggle).toBeDisabled();
    expect(screen.getByRole('spinbutton')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    expect(screen.getByText(/set by a settings administrator/i)).toBeInTheDocument();
  });
});
