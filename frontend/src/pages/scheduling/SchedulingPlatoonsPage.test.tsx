import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

const mockGetOverview = vi.fn();
const mockBulkAssign = vi.fn();

vi.mock('../../modules/scheduling/services/api', () => ({
  schedulingService: {
    getPlatoonOverview: (...a: unknown[]) => mockGetOverview(...a) as unknown,
    bulkAssignPlatoon: (...a: unknown[]) => mockBulkAssign(...a) as unknown,
  },
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

import SchedulingPlatoonsPage from './SchedulingPlatoonsPage';

const renderPage = () =>
  render(
    <MemoryRouter>
      <SchedulingPlatoonsPage />
    </MemoryRouter>,
  );

const overview = {
  platoons_enabled: true,
  groups: [
    {
      platoon: 'A',
      member_count: 1,
      members: [{ user_id: 'u1', user_name: 'Alice Adams', rank: 'captain' }],
    },
    {
      platoon: null,
      member_count: 1,
      members: [{ user_id: 'u2', user_name: 'Bob Brown', rank: null }],
    },
  ],
};

describe('SchedulingPlatoonsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetOverview.mockResolvedValue(overview);
    mockBulkAssign.mockResolvedValue({ updated: 1, platoon: 'A' });
  });

  it('renders each platoon group and the unassigned bucket', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Platoon A' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Unassigned' })).toBeInTheDocument();
    expect(screen.getByText('Alice Adams')).toBeInTheDocument();
    expect(screen.getByText('Bob Brown')).toBeInTheDocument();
  });

  it('shows a warning when platoon scheduling is disabled', async () => {
    mockGetOverview.mockResolvedValue({ ...overview, platoons_enabled: false });
    renderPage();
    expect(
      await screen.findByText(/platoon scheduling is turned off/i),
    ).toBeInTheDocument();
  });

  it('bulk-assigns selected members to the chosen platoon', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Bob Brown');

    // Select the unassigned member, choose platoon A, assign.
    await user.click(screen.getByRole('checkbox', { name: /bob brown/i }));
    await user.selectOptions(screen.getByRole('combobox'), 'A');
    await user.click(screen.getByRole('button', { name: /assign to platoon/i }));

    await waitFor(() => expect(mockBulkAssign).toHaveBeenCalledWith(['u2'], 'A'));
  });

  it('clears the platoon for selected members', async () => {
    const user = userEvent.setup();
    mockBulkAssign.mockResolvedValue({ updated: 1, platoon: null });
    renderPage();
    await screen.findByText('Alice Adams');

    await user.click(screen.getByRole('checkbox', { name: /alice adams/i }));
    await user.click(screen.getByRole('button', { name: /clear platoon/i }));

    await waitFor(() => expect(mockBulkAssign).toHaveBeenCalledWith(['u1'], null));
  });

  it('disables the assign actions when nothing is selected', async () => {
    renderPage();
    await screen.findByRole('heading', { name: 'Platoon A' });
    expect(screen.getByRole('button', { name: /assign to platoon/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /clear platoon/i })).toBeDisabled();
  });
});
