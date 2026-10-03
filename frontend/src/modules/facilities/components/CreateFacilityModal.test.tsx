import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../test/utils';

const mockCreateFacility = vi.fn();

vi.mock('../store/facilitiesStore', () => ({
  useFacilitiesStore: () => ({ createFacility: (...a: unknown[]) => mockCreateFacility(...a) as unknown }),
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import CreateFacilityModal from './CreateFacilityModal';

const renderModal = () =>
  renderWithRouter(
    <CreateFacilityModal facilityTypes={[]} facilityStatuses={[]} onClose={vi.fn()} onCreated={vi.fn()} />
  );

describe('CreateFacilityModal email', () => {
  beforeEach(() => {
    mockCreateFacility.mockReset();
    mockCreateFacility.mockResolvedValue({ id: 'f-1', name: 'Station 2' });
  });

  // The field is type="email", but the modal submits from a plain button, so
  // the browser never checked it: "not-an-email" was saved as the station's
  // address, and the server accepts any string.
  it('refuses an address without an @ and says why', async () => {
    const user = userEvent.setup();
    renderModal();
    await user.type(screen.getByRole('textbox', { name: 'Name *' }), 'Station 2');
    const email = screen.getByRole('textbox', { name: 'Email' });
    await user.type(email, 'not-an-email');

    expect(email).toHaveAttribute('aria-invalid', 'true');
    expect(email).toHaveAccessibleDescription(/Enter an email address/);
    expect(screen.getByRole('button', { name: 'Add Facility' })).toBeDisabled();
    expect(mockCreateFacility).not.toHaveBeenCalled();
  });

  it('saves a valid address', async () => {
    const user = userEvent.setup();
    renderModal();
    await user.type(screen.getByRole('textbox', { name: 'Name *' }), 'Station 2');
    await user.type(screen.getByRole('textbox', { name: 'Email' }), 'st2@example.com');
    await user.click(screen.getByRole('button', { name: 'Add Facility' }));
    expect(mockCreateFacility).toHaveBeenCalledWith(expect.objectContaining({ email: 'st2@example.com' }));
  });
});
