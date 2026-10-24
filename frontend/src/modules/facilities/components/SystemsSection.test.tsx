import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithRouter } from '../../../test/utils';

const getSystems = vi.fn();
const createSystem = vi.fn();
const updateSystem = vi.fn();
const deleteSystem = vi.fn();

vi.mock('../../../services/api', () => ({
  facilitiesService: {
    getSystems: (...args: unknown[]) => getSystems(...args) as unknown,
    createSystem: (...args: unknown[]) => createSystem(...args) as unknown,
    updateSystem: (...args: unknown[]) => updateSystem(...args) as unknown,
    deleteSystem: (...args: unknown[]) => deleteSystem(...args) as unknown,
  },
}));

import SystemsSection from './SystemsSection';

const hvac = {
  id: 'sys-1',
  facilityId: 'facility-1',
  name: 'Main HVAC Unit',
  systemType: 'hvac',
  condition: 'good',
  description: 'Rooftop unit',
  manufacturer: 'Carrier',
  modelNumber: 'CX-200',
  serialNumber: 'SN-4471',
  installDate: '2020-05-01',
  warrantyExpiration: '2030-05-01',
  testFrequencyDays: 90,
  notes: 'Filter changed quarterly',
  createdAt: '2026-08-16T00:00:00Z',
  updatedAt: '2026-08-16T00:00:00Z',
};

function renderSection() {
  return renderWithRouter(<SystemsSection facilityId="facility-1" canCreate canEdit canDelete />);
}

describe('SystemsSection save payload', () => {
  beforeEach(() => {
    getSystems.mockReset();
    createSystem.mockReset();
    updateSystem.mockReset();
    getSystems.mockResolvedValue([hvac]);
    createSystem.mockResolvedValue(hvac);
    updateSystem.mockResolvedValue(hvac);
  });

  it('sends null for every field emptied on edit, so the clear persists', async () => {
    const user = userEvent.setup();
    renderSection();
    await user.click(await screen.findByRole('button', { name: 'Edit Main HVAC Unit' }));

    for (const value of [
      'Carrier',
      'CX-200',
      'SN-4471',
      '2020-05-01',
      '2030-05-01',
      '90',
      'Filter changed quarterly',
    ]) {
      await user.clear(screen.getByDisplayValue(value));
    }
    await user.click(screen.getByRole('button', { name: /Save Changes/ }));

    await waitFor(() => expect(updateSystem).toHaveBeenCalledTimes(1));
    expect(updateSystem).toHaveBeenCalledWith('sys-1', {
      facility_id: 'facility-1',
      name: 'Main HVAC Unit',
      system_type: 'hvac',
      condition: 'good',
      // No input for description on this form; the stored value is carried.
      description: 'Rooftop unit',
      manufacturer: null,
      model_number: null,
      serial_number: null,
      install_date: null,
      warranty_expiration: null,
      notes: null,
      test_frequency_days: null,
    });
  });

  it('still omits blank fields on create', async () => {
    const user = userEvent.setup();
    renderSection();
    await screen.findByText('Main HVAC Unit');
    await user.click(screen.getByRole('button', { name: /Add System/ }));
    await user.type(screen.getByPlaceholderText('e.g., Main HVAC Unit'), 'Fire Alarm Panel');
    await user.click(screen.getByRole('button', { name: /Save System/ }));

    await waitFor(() => expect(createSystem).toHaveBeenCalledTimes(1));
    const payload: unknown = createSystem.mock.calls[0]?.[0];
    expect(JSON.parse(JSON.stringify(payload))).toEqual({
      facility_id: 'facility-1',
      name: 'Fire Alarm Panel',
      system_type: 'other',
      condition: 'good',
    });
  });
});

describe('SystemsSection removing a system', () => {
  // The endpoint archives; the dialog used to promise a permanent delete.
  beforeEach(() => {
    getSystems.mockReset();
    deleteSystem.mockReset();
    getSystems.mockResolvedValue([hvac]);
    deleteSystem.mockResolvedValue(undefined);
  });

  it('calls it archiving, and says the record is kept', async () => {
    const user = userEvent.setup();
    renderSection();
    await user.click(await screen.findByRole('button', { name: 'Archive Main HVAC Unit' }));

    expect(
      await screen.findByText(
        /Archive "Main HVAC Unit"\? It leaves this facility's systems list, but its record and history are kept\./
      )
    ).toBeInTheDocument();
    expect(screen.queryByText(/cannot be undone/)).not.toBeInTheDocument();
    expect(deleteSystem).not.toHaveBeenCalled();
  });

  it('archives once confirmed', async () => {
    const user = userEvent.setup();
    renderSection();
    await user.click(await screen.findByRole('button', { name: 'Archive Main HVAC Unit' }));
    await user.click(await screen.findByRole('button', { name: 'Archive' }));

    await waitFor(() => expect(deleteSystem).toHaveBeenCalledWith('sys-1'));
  });
});
