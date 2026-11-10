import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../test/utils';

const mockCreateFacility = vi.fn();

vi.mock('../store/facilitiesStore', () => ({
  useFacilitiesStore: () => ({ createFacility: (...a: unknown[]) => mockCreateFacility(...a) as unknown }),
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import CreateFacilityModal from './CreateFacilityModal';

import toast from 'react-hot-toast';

const renderModal = (onClose = vi.fn()) =>
  renderWithRouter(
    <CreateFacilityModal facilityTypes={[]} facilityStatuses={[]} onClose={onClose} onCreated={vi.fn()} />
  );

describe('CreateFacilityModal email', () => {
  beforeEach(() => {
    mockCreateFacility.mockReset();
    mockCreateFacility.mockResolvedValue({ id: 'f-1', name: 'Station 2' });
  });

  // The browser's own type="email" check never ran (the dialog submitted from
  // a plain button, and FormField leaves native validation off so the field
  // can be flagged): "not-an-email" was saved as the station's address, and
  // the server accepts any string.
  it('refuses an address without an @ and says why', async () => {
    const user = userEvent.setup();
    renderModal();
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Station 2');
    const email = screen.getByRole('textbox', { name: 'Email' });
    await user.type(email, 'not-an-email');

    expect(email).toHaveAttribute('aria-invalid', 'true');
    expect(email).toHaveAccessibleDescription(/Enter an email address/);

    // Forms review F-3: the button used to grey out here; pressing it now
    // returns focus to the address that stops it.
    await user.click(screen.getByRole('button', { name: 'Add Facility' }));
    expect(email).toHaveFocus();
    expect(mockCreateFacility).not.toHaveBeenCalled();
  });

  it('leaves the email check to the dialog, not a browser bubble', () => {
    renderModal();
    expect(screen.getByTestId('modal-panel')).toHaveAttribute('novalidate');
  });

  it('saves a valid address', async () => {
    const user = userEvent.setup();
    renderModal();
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Station 2');
    await user.type(screen.getByRole('textbox', { name: 'Email' }), 'st2@example.com');
    await user.click(screen.getByRole('button', { name: 'Add Facility' }));
    expect(mockCreateFacility).toHaveBeenCalledWith(expect.objectContaining({ email: 'st2@example.com' }));
  });
});

describe('CreateFacilityModal refusals', () => {
  beforeEach(() => {
    mockCreateFacility.mockReset();
  });

  it('names a missing name on an empty save and focuses it', async () => {
    const user = userEvent.setup();
    renderModal();

    await user.click(screen.getByRole('button', { name: 'Add Facility' }));

    const name = screen.getByRole('textbox', { name: 'Name' });
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(name).toHaveAccessibleDescription('Enter a name for the facility.');
    expect(name).toHaveFocus();
    expect(mockCreateFacility).not.toHaveBeenCalled();
  });

  it('puts a refused field on that field, and says any other failure in the dialog', async () => {
    mockCreateFacility
      .mockRejectedValueOnce({
        response: { status: 422, data: { detail: [{ field: 'zip_code', message: 'Value is too long.' }] } },
      })
      .mockRejectedValueOnce({ response: { status: 500, data: { detail: 'Database unavailable' } } });
    const user = userEvent.setup();
    renderModal();
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Station 2');

    await user.click(screen.getByRole('button', { name: 'Add Facility' }));
    const zip = await screen.findByRole('textbox', { name: 'Zip Code', description: 'Value is too long.' });
    expect(zip).toHaveFocus();

    await user.click(screen.getByRole('button', { name: 'Add Facility' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});

describe('CreateFacilityModal errors and discarding', () => {
  beforeEach(() => {
    mockCreateFacility.mockReset();
    mockCreateFacility.mockResolvedValue({ id: 'f-1', name: 'Station 2' });
    vi.mocked(toast.error).mockClear();
  });

  it('flags a missing name on the field when Enter submits', async () => {
    const user = userEvent.setup();
    renderModal();
    await user.type(screen.getByRole('textbox', { name: 'City' }), 'Springfield{Enter}');
    const name = screen.getByRole('textbox', { name: 'Name' });
    expect(name).toHaveAccessibleDescription('Enter a name for the facility.');
    expect(mockCreateFacility).not.toHaveBeenCalled();
  });

  it('asks before Escape or Cancel discards what was typed', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderModal(onClose);
    await user.type(screen.getByRole('textbox', { name: 'Name' }), 'Station 9');

    fireEvent.keyDown(document, { key: 'Escape' });
    await user.click(await screen.findByRole('button', { name: 'Keep editing' }));
    expect(onClose).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await user.click(await screen.findByRole('button', { name: 'Discard changes' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
