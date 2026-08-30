import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmProvider } from '@/contexts/ConfirmContext';
import FacilitiesSettingsPage from './FacilitiesSettingsPage';

const mocks = vi.hoisted(() => ({
  getTypes: vi.fn(),
  getStatuses: vi.fn(),
  getMaintenanceTypes: vi.fn(),
  deleteType: vi.fn(),
  deleteStatus: vi.fn(),
  deleteMaintenanceType: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
}));
vi.mock('../../../services/facilitiesServices', () => ({ facilitiesService: { ...mocks } }));
vi.mock('react-hot-toast', () => ({ default: { error: mocks.error, success: mocks.success } }));

const renderPage = () =>
  render(
    <MemoryRouter>
      <ConfirmProvider>
        <FacilitiesSettingsPage />
      </ConfirmProvider>
    </MemoryRouter>
  );

describe('FacilitiesSettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getTypes.mockResolvedValue([
      { id: 'used', name: 'Station', isActive: true, isSystem: false, sortOrder: 2, usageCount: 4 },
      { id: 'free', name: 'Annex', isActive: false, isSystem: false, sortOrder: 3, usageCount: 0 },
      { id: 'system', name: 'System type', isActive: true, isSystem: true, sortOrder: 1, usageCount: 0 },
    ]);
    mocks.getStatuses.mockResolvedValue([]);
    mocks.getMaintenanceTypes.mockResolvedValue([]);
  });
  it('shows state, ownership, ordering and usage and protects referenced/system lookups', async () => {
    renderPage();
    expect(await screen.findByText('Station')).toBeInTheDocument();
    expect(screen.getByText('Inactive')).toBeInTheDocument();
    expect(screen.getAllByText('Organization')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Delete Station' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Delete System type' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Delete Annex' })).toBeEnabled();
    expect(screen.getByText('4')).toBeInTheDocument();
  });
  it('surfaces a backend conflict when usage changes before deletion', async () => {
    mocks.deleteType.mockRejectedValueOnce({ response: { data: { detail: 'Facility type is in use by 1 facility' } } });
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Delete Annex' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith('Facility type is in use by 1 facility'));
    expect(mocks.getTypes).toHaveBeenCalledTimes(2);
  });
  it('deletes nothing when the confirmation is declined', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Delete Annex' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Keep it' }));
    expect(mocks.deleteType).not.toHaveBeenCalled();
    expect(mocks.getTypes).toHaveBeenCalledTimes(1);
  });
});
