import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import userEvent from '@testing-library/user-event';
import { ConfirmProvider } from '../../../contexts/ConfirmContext';

// Forms batch 23: the apparatus form under the shared field, its summary, the
// single-save rule on edit and the discard question.

vi.mock('@/hooks/useRanks', () => ({ useRanks: () => ({ ranks: [], loading: false }) }));
vi.mock('@/modules/scheduling/components/shiftTemplateTypes', () => ({ getPositionOptions: () => [] }));
vi.mock('@/modules/scheduling/services/shiftSettingsApi', () => ({
  ensureShiftSettingsLoaded: () => Promise.resolve({}),
  getCachedShiftSettings: () => ({ customPositions: [] }),
}));
vi.mock('../hooks/useApparatusNfpaSettings', () => ({ useApparatusNfpaSettings: () => ({ enabled: false }) }));

const store = {
  currentApparatus: null as Record<string, unknown> | null,
  types: [{ id: 'type-1', name: 'Engine' }],
  statuses: [{ id: 'st-in', name: 'In Service', requiresReason: false, isArchivedStatus: false }],
  isLoading: false,
  fetchApparatus: vi.fn(),
  fetchTypes: vi.fn(),
  fetchStatuses: vi.fn(),
};
vi.mock('../store/apparatusStore', () => ({ useApparatusStore: () => store }));

const createApparatus = vi.fn();
const updateApparatus = vi.fn();
vi.mock('../services/api', () => ({
  apparatusService: {
    createApparatus: (...args: unknown[]) => createApparatus(...args) as unknown,
    updateApparatus: (...args: unknown[]) => updateApparatus(...args) as unknown,
  },
  evocLevelService: { getLevels: () => Promise.resolve([]) },
}));

const toastError = vi.fn();
vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: (...args: unknown[]) => toastError(...args) as unknown },
}));

import ApparatusFormPage from './ApparatusFormPage';

const existing = {
  id: 'app-1',
  unitNumber: 'E-2',
  name: 'Pumper',
  make: 'Pierce',
  apparatusTypeId: 'type-1',
  statusId: 'st-in',
  minStaffing: 3,
  crewPositions: [],
  isFinanced: false,
  nfpaTrackingEnabled: false,
};

const unprocessable = (field: string, msg: string) =>
  Object.assign(new Error('Unprocessable'), {
    isAxiosError: true,
    response: { status: 422, data: { detail: [{ loc: ['body', field], msg }] } },
  });

const renderAt = (path: string) =>
  render(
    <ConfirmProvider>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/apparatus/new" element={<ApparatusFormPage />} />
          <Route path="/apparatus/:id/edit" element={<ApparatusFormPage />} />
          <Route path="/apparatus" element={<p>Apparatus list</p>} />
        </Routes>
      </MemoryRouter>
    </ConfirmProvider>
  );

describe('ApparatusFormPage (batch 23)', () => {
  beforeEach(() => {
    localStorage.setItem('has_session', 'true');
    store.currentApparatus = null;
    createApparatus.mockReset();
    updateApparatus.mockReset();
    toastError.mockReset();
    createApparatus.mockResolvedValue({ id: 'new' });
    updateApparatus.mockResolvedValue(existing);
  });

  afterEach(() => {
    store.currentApparatus = null;
  });

  it('lists what is missing in a summary at the top and sends nothing', async () => {
    const user = userEvent.setup();
    renderAt('/apparatus/new');
    await user.click(await screen.findByRole('button', { name: 'Add Apparatus' }));
    const summary = await screen.findByRole('alert', { name: /Fix these before adding the apparatus/ });
    expect(summary).toHaveTextContent('Unit Number: Unit number is required');
    expect(summary).toHaveFocus();
    expect(createApparatus).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
  });

  it('names an out-of-range year on its field before anything is sent', async () => {
    const user = userEvent.setup();
    renderAt('/apparatus/new');
    await user.type(await screen.findByRole('textbox', { name: /^Unit Number/ }), 'E-9');
    await user.selectOptions(screen.getByRole('combobox', { name: /^Apparatus Type/ }), 'type-1');
    await user.selectOptions(screen.getByRole('combobox', { name: /^Status/ }), 'st-in');
    await user.type(screen.getByRole('spinbutton', { name: 'Year' }), '1850');
    await user.click(screen.getByRole('button', { name: 'Add Apparatus' }));
    expect(await screen.findByRole('spinbutton', { name: 'Year' })).toHaveAccessibleDescription(
      'Enter a whole number from 1900 to 2100.'
    );
    expect(createApparatus).not.toHaveBeenCalled();
  });

  it('puts a refusal from the server on the field it names when adding', async () => {
    createApparatus.mockRejectedValue(unprocessable('vin', 'String should have at most 17 characters'));
    const user = userEvent.setup();
    renderAt('/apparatus/new');
    await user.type(await screen.findByRole('textbox', { name: /^Unit Number/ }), 'E-9');
    await user.selectOptions(screen.getByRole('combobox', { name: /^Apparatus Type/ }), 'type-1');
    await user.selectOptions(screen.getByRole('combobox', { name: /^Status/ }), 'st-in');
    await user.click(screen.getByRole('button', { name: 'Add Apparatus' }));
    expect(await screen.findByRole('textbox', { name: 'VIN' })).toHaveAccessibleDescription(
      'String should have at most 17 characters.'
    );
    expect(toastError).not.toHaveBeenCalled();
  });

  it('saves the rest of an edit and keeps a refused field flagged', async () => {
    store.currentApparatus = existing;
    updateApparatus.mockRejectedValueOnce(unprocessable('make', 'Make is not allowed')).mockResolvedValue(existing);
    const user = userEvent.setup();
    renderAt('/apparatus/app-1/edit');
    const name = await screen.findByRole('textbox', { name: 'Name/Nickname' });
    await user.clear(name);
    await user.type(name, 'Old Reliable');
    await user.click(screen.getByRole('button', { name: 'Save Changes' }));
    await waitFor(() => expect(updateApparatus).toHaveBeenCalledTimes(2));
    const resent: unknown = updateApparatus.mock.calls[1]?.[1];
    expect(resent).toMatchObject({ name: 'Old Reliable' });
    expect(resent).not.toHaveProperty('make');
    expect(await screen.findByText('Apparatus saved, except make. Fix it and save again.')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Make' })).toHaveAccessibleDescription('Make is not allowed.');
    expect(screen.queryByText('Apparatus list')).not.toBeInTheDocument();
  });

  it('keeps a failure no field answers for on the page, not in a toast', async () => {
    store.currentApparatus = existing;
    updateApparatus.mockRejectedValue(
      Object.assign(new Error('Conflict'), {
        isAxiosError: true,
        response: { status: 409, data: { detail: 'Unit number E-2 is already in use' } },
      })
    );
    const user = userEvent.setup();
    renderAt('/apparatus/app-1/edit');
    await screen.findByRole('textbox', { name: 'Name/Nickname' });
    await user.click(screen.getByRole('button', { name: 'Save Changes' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Unit number E-2 is already in use');
    expect(toastError).not.toHaveBeenCalled();
  });

  it('asks before Cancel throws typed changes away', async () => {
    const user = userEvent.setup();
    renderAt('/apparatus/new');
    await user.type(await screen.findByRole('textbox', { name: /^Unit Number/ }), 'E-9');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByRole('button', { name: 'Keep editing' })).toBeInTheDocument();
    expect(screen.queryByText('Apparatus list')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(await screen.findByText('Apparatus list')).toBeInTheDocument();
  });

  it('caps the unit number at the server limit', async () => {
    renderAt('/apparatus/new');
    expect(await screen.findByRole('textbox', { name: /^Unit Number/ })).toHaveAttribute('maxlength', '50');
  });
});
