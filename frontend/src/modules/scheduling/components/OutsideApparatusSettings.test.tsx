import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import toast from 'react-hot-toast';
import { renderWithRouter } from '../../../test/utils';
import { OutsideApparatusSettings } from './OutsideApparatusSettings';
import type { ExternalAgency } from '../services/api';

const mockList = vi.fn();
const mockCreateAgency = vi.fn();
const mockUpdateAgency = vi.fn();
const mockDeleteAgency = vi.fn();
const mockCreateUnit = vi.fn();
const mockUpdateUnit = vi.fn();
const mockDeleteUnit = vi.fn();

vi.mock('../services/api', () => ({
  schedulingService: {
    getExternalAgencies: (...args: unknown[]) => mockList(...args) as unknown,
    createExternalAgency: (...args: unknown[]) => mockCreateAgency(...args) as unknown,
    updateExternalAgency: (...args: unknown[]) => mockUpdateAgency(...args) as unknown,
    deleteExternalAgency: (...args: unknown[]) => mockDeleteAgency(...args) as unknown,
    createExternalApparatus: (...args: unknown[]) => mockCreateUnit(...args) as unknown,
    updateExternalApparatus: (...args: unknown[]) => mockUpdateUnit(...args) as unknown,
    deleteExternalApparatus: (...args: unknown[]) => mockDeleteUnit(...args) as unknown,
  },
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

const agencies: ExternalAgency[] = [
  {
    id: 'a1',
    name: 'Township Fire Company',
    is_active: true,
    apparatus: [{ id: 'u1', agency_id: 'a1', name: 'Engine 42', apparatus_type: 'engine', is_active: true }],
  },
];

describe('OutsideApparatusSettings', () => {
  beforeEach(() => {
    for (const mock of [
      mockList,
      mockCreateAgency,
      mockUpdateAgency,
      mockDeleteAgency,
      mockCreateUnit,
      mockUpdateUnit,
      mockDeleteUnit,
    ]) {
      mock.mockReset();
    }
    vi.mocked(toast.success).mockReset();
    vi.mocked(toast.error).mockReset();
    mockList.mockResolvedValue({ agencies });
    mockCreateAgency.mockResolvedValue({ ...agencies[0], id: 'a2' });
    mockUpdateAgency.mockResolvedValue(agencies[0]);
    mockDeleteAgency.mockResolvedValue(undefined);
    mockCreateUnit.mockResolvedValue(agencies[0]?.apparatus[0]);
    mockUpdateUnit.mockResolvedValue(agencies[0]?.apparatus[0]);
    mockDeleteUnit.mockResolvedValue(undefined);
  });

  it('lists departments with their apparatus', async () => {
    renderWithRouter(<OutsideApparatusSettings />);

    const section = await screen.findByRole('region', { name: 'Township Fire Company' });
    expect(within(section).getByText('Engine 42')).toBeInTheDocument();
    expect(within(section).getByText('· engine')).toBeInTheDocument();
  });

  it('adds a department', async () => {
    const user = userEvent.setup();
    renderWithRouter(<OutsideApparatusSettings />);

    await user.type(await screen.findByLabelText('Add a department'), '  County Rescue ');
    await user.click(screen.getByRole('button', { name: 'Add department' }));

    await waitFor(() => expect(mockCreateAgency).toHaveBeenCalledWith({ name: 'County Rescue' }));
    expect(mockList).toHaveBeenCalledTimes(2);
  });

  it('adds apparatus under a department, leaving a blank type out', async () => {
    const user = userEvent.setup();
    renderWithRouter(<OutsideApparatusSettings />);

    const section = await screen.findByRole('region', { name: 'Township Fire Company' });
    await user.type(within(section).getByLabelText('Add apparatus'), 'Tower 7');
    await user.click(within(section).getByRole('button', { name: 'Add' }));

    await waitFor(() =>
      expect(mockCreateUnit).toHaveBeenCalledWith('a1', { name: 'Tower 7', apparatus_type: undefined })
    );
  });

  it('turns a unit off rather than deleting it', async () => {
    const user = userEvent.setup();
    renderWithRouter(<OutsideApparatusSettings />);

    await user.click(await screen.findByRole('switch', { name: 'Offer Engine 42 to members' }));

    await waitFor(() => expect(mockUpdateUnit).toHaveBeenCalledWith('u1', { is_active: false }));
  });

  it('explains a refused delete of a unit shifts were logged on', async () => {
    mockDeleteUnit.mockRejectedValue(
      Object.assign(new Error('in use'), { isAxiosError: true, response: { status: 409, data: { detail: 'in use' } } })
    );
    const user = userEvent.setup();
    renderWithRouter(<OutsideApparatusSettings />);

    await user.click(await screen.findByRole('button', { name: 'Delete Engine 42' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete Engine 42?' });
    await user.click(within(dialog).getByRole('button', { name: 'Delete apparatus' }));

    await waitFor(() => expect(mockDeleteUnit).toHaveBeenCalledWith('u1'));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(expect.stringContaining('Turn it off')));
  });

  it('renames a department', async () => {
    const user = userEvent.setup();
    renderWithRouter(<OutsideApparatusSettings />);

    await user.click(await screen.findByRole('button', { name: 'Rename Township Fire Company' }));
    const dialog = await screen.findByRole('dialog', { name: 'Rename department' });
    const field = within(dialog).getByLabelText('Name');
    await user.clear(field);
    await user.type(field, 'Township FD');
    await user.click(within(dialog).getByRole('button', { name: 'Rename' }));

    await waitFor(() => expect(mockUpdateAgency).toHaveBeenCalledWith('a1', { name: 'Township FD' }));
  });

  it('says members cannot log outside shifts until a department is added', async () => {
    mockList.mockResolvedValue({ agencies: [] });
    renderWithRouter(<OutsideApparatusSettings />);

    expect(await screen.findByText(/members can't log shifts with other departments/)).toBeInTheDocument();
  });
});
