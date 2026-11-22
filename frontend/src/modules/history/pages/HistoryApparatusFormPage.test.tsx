import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router';

const mockFleetOptions = vi.fn();
const mockCreateFromFleet = vi.fn();
const mockCreate = vi.fn();
const mockListEntries = vi.fn();
const mockListSources = vi.fn();
const mockIsModuleOn = vi.fn();

vi.mock('../services/api', () => ({
  historyApparatusService: {
    fleetOptions: (...args: unknown[]) => mockFleetOptions(...args) as unknown,
    createFromFleet: (...args: unknown[]) => mockCreateFromFleet(...args) as unknown,
    createApparatus: (...args: unknown[]) => mockCreate(...args) as unknown,
  },
  historyListService: {
    list: (...args: unknown[]) => mockListEntries(...args) as unknown,
  },
  historyMediaService: {
    listSources: (...args: unknown[]) => mockListSources(...args) as unknown,
  },
}));

vi.mock('../../../hooks/useEnabledModules', () => ({
  useEnabledModules: () => ({
    enabledModules: null,
    isModuleOn: (key: string) => mockIsModuleOn(key) as boolean,
    isLoading: false,
  }),
}));

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import HistoryApparatusFormPage from './HistoryApparatusFormPage';

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/history/apparatus/new']}>
      <Routes>
        <Route path="/history/apparatus/new" element={<HistoryApparatusFormPage />} />
        <Route path="/history/apparatus/:apparatusId" element={<p>Apparatus page</p>} />
      </Routes>
    </MemoryRouter>
  );

describe('HistoryApparatusFormPage', () => {
  beforeEach(() => {
    mockFleetOptions.mockReset();
    mockCreateFromFleet.mockReset();
    mockCreate.mockReset();
    mockListEntries.mockReset();
    mockListEntries.mockResolvedValue([]);
    mockListSources.mockReset();
    mockListSources.mockResolvedValue([]);
    mockIsModuleOn.mockReset();
    mockIsModuleOn.mockReturnValue(true);
    mockFleetOptions.mockResolvedValue([
      {
        id: 'f1',
        unit_number: 'E-2',
        name: 'Old Two',
        description: '1987 Pierce Arrow',
        is_archived: true,
        history_apparatus_id: null,
      },
      {
        id: 'f2',
        unit_number: 'E-3',
        name: null,
        description: '2005 E-One',
        is_archived: false,
        history_apparatus_id: 'a9',
      },
    ]);
  });

  it('starts a record from a fleet truck, and not from one that already has a record', async () => {
    mockCreateFromFleet.mockResolvedValue({ id: 'a1' });
    renderPage();
    const truck = await screen.findByRole('combobox', { name: 'Truck' });
    expect(screen.getByRole('option', { name: /E-3/ })).toBeDisabled();
    await userEvent.selectOptions(truck, 'f1');
    await userEvent.click(screen.getByRole('button', { name: 'Start record' }));
    expect(mockCreateFromFleet).toHaveBeenCalledWith('f1');
    expect(await screen.findByText('Apparatus page')).toBeInTheDocument();
  });

  it('offers no fleet when the Apparatus module is off', async () => {
    mockIsModuleOn.mockReturnValue(false);
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Add an apparatus' })).toBeInTheDocument();
    await waitFor(() => expect(mockListSources).toHaveBeenCalled());
    expect(mockFleetOptions).not.toHaveBeenCalled();
    expect(screen.queryByRole('heading', { name: 'Start from a truck in the fleet' })).not.toBeInTheDocument();
  });

  it('adds an apparatus entered by hand with its unit numbers', async () => {
    mockCreate.mockResolvedValue({ id: 'a2' });
    mockIsModuleOn.mockReturnValue(false);
    renderPage();
    await userEvent.type(await screen.findByRole('textbox', { name: /Name/ }), 'Hand-drawn hose reel');
    await userEvent.click(screen.getByRole('button', { name: 'Add a unit number' }));
    await userEvent.type(screen.getByRole('textbox', { name: 'Unit number' }), 'Hose 1');
    await userEvent.click(screen.getByRole('button', { name: 'Add apparatus' }));
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Hand-drawn hose reel',
        designations: [expect.objectContaining({ designation: 'Hose 1' })],
      })
    );
  });
});
