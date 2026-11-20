import { render, screen, waitFor, within } from '@testing-library/react';
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
  createType: vi.fn(),
  updateType: vi.fn(),
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
  it('names the facility form when confirming a facility-type deletion', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Delete Annex' }));
    expect(
      await screen.findByText(/will no longer be offered when creating or editing a facility/)
    ).toBeInTheDocument();
  });
  it('names the maintenance record, not the facility, when confirming a maintenance-type deletion', async () => {
    mocks.getMaintenanceTypes.mockResolvedValue([
      { id: 'mt', name: 'Annual Service', isActive: true, isSystem: false, sortOrder: 1, usageCount: 0 },
    ]);
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Delete Annual Service' }));
    expect(await screen.findByText(/will no longer be offered when logging a maintenance record/)).toBeInTheDocument();
  });
  // The lookup editor was an unnamed div: no dialog role, so its heading did
  // not name anything and a screen reader never announced a dialog opening.
  it('opens the lookup editor as a named dialog', async () => {
    renderPage();
    await userEvent.click(await screen.findByRole('button', { name: 'Add facility type' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add facility type' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
  });

  // Forms review F-3 / F-5: Save stayed greyed out until a name was typed,
  // and the name was required without saying so.
  it('names a missing name on an empty save, announced as required', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Add facility type' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add facility type' });

    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    const name = within(dialog).getByRole('textbox', { name: 'Name' });
    expect(name).toHaveAttribute('aria-required', 'true');
    expect(name).toHaveAccessibleDescription('Enter a name for the facility type.');
    expect(name).toHaveFocus();
    expect(mocks.createType).not.toHaveBeenCalled();
  });

  it('puts a refused name from the server on the field', async () => {
    mocks.createType.mockRejectedValueOnce({
      response: { status: 422, data: { detail: [{ field: 'name', message: 'Value is too long.' }] } },
    });
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Add facility type' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add facility type' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'Annex');

    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    expect(
      await within(dialog).findByRole('textbox', { name: 'Name', description: 'Value is too long.' })
    ).toHaveFocus();
  });

  // Forms review F-6: Cancel, Escape and the X threw a typed name away.
  it('asks before Cancel throws a typed name away', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Add facility type' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add facility type' });
    await user.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'Annex');

    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    await user.click(await screen.findByRole('button', { name: 'Keep editing' }));
    expect(screen.getByRole('dialog', { name: 'Add facility type' })).toBeInTheDocument();
    expect(within(dialog).getByRole('textbox', { name: 'Name' })).toHaveValue('Annex');
  });

  // Owner rule 2026-11-05: an edit saves the rest and keeps a refused field
  // flagged. A blank name used to hold back the Active switch with it.
  it('saves the Active switch on an edit whose name is refused, and keeps the dialog open', async () => {
    mocks.updateType.mockResolvedValue({});
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByRole('button', { name: 'Edit Annex' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit facility type' });
    await user.clear(within(dialog).getByRole('textbox', { name: 'Name' }));
    await user.click(within(dialog).getByRole('checkbox', { name: 'Active' }));

    await user.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(mocks.updateType).toHaveBeenCalledWith('free', { is_active: true }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Facility type saved, except name.');
    expect(within(dialog).getByRole('textbox', { name: 'Name' })).toHaveAccessibleDescription(
      'Enter a name for the facility type.'
    );
  });
});
