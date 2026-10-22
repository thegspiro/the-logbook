/**
 * `/apparatus-basic` is the lightweight fleet list a department gets when the
 * Apparatus module is off, and it is deliberately readable by everyone: shift
 * staffing needs these unit definitions, so the route carries no permission
 * gate and `GET /scheduling/apparatus` is auth-only.
 *
 * Writing is not. Create, update and delete all require `scheduling.manage`
 * on the backend, but the page rendered Add / Edit / Delete unconditionally —
 * and because the nav links this page for every member whenever the Apparatus
 * module is off, that was a full CRUD surface shown to the whole department
 * where every write answered 403.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';

const mockToastError = vi.fn();
const mockToastSuccess = vi.fn();

vi.mock('react-hot-toast', () => ({
  default: {
    success: (...args: unknown[]): void => {
      mockToastSuccess(...args);
    },
    error: (...args: unknown[]): void => {
      mockToastError(...args);
    },
  },
}));

let hasManagePermission = false;

vi.mock('../stores/authStore', () => ({
  useAuthStore: Object.assign(
    (selector: (s: { checkPermission: (p: string) => boolean }) => unknown) =>
      selector({ checkPermission: (p: string) => (p === 'scheduling.manage' ? hasManagePermission : false) }),
    // Opening the dialog reads the department's crew positions, which are
    // cached per organization (shiftSettingsApi reads the store directly).
    { getState: () => ({ user: { organization_id: 'org-1' } }) }
  ),
}));

const mockGetBasicApparatus = vi.fn();
const mockCreateBasicApparatus = vi.fn();
const mockUpdateBasicApparatus = vi.fn();
const mockDeleteBasicApparatus = vi.fn();
const mockReactivateBasicApparatus = vi.fn();

vi.mock('../modules/scheduling/services/api', () => ({
  schedulingService: {
    getBasicApparatus: (...args: unknown[]) => mockGetBasicApparatus(...args) as unknown,
    createBasicApparatus: (...args: unknown[]) => mockCreateBasicApparatus(...args) as unknown,
    updateBasicApparatus: (...args: unknown[]) => mockUpdateBasicApparatus(...args) as unknown,
    deleteBasicApparatus: (...args: unknown[]) => mockDeleteBasicApparatus(...args) as unknown,
    reactivateBasicApparatus: (...args: unknown[]) => mockReactivateBasicApparatus(...args) as unknown,
  },
}));

import ApparatusBasicPage from './ApparatusBasicPage';

const engine = {
  id: 'app-1',
  unit_number: 'E-51',
  name: 'Engine 51',
  apparatus_type: 'engine',
  min_staffing: 4,
  positions: ['Officer', 'Driver'],
  is_active: true,
};

const renderPage = async () => {
  renderWithRouter(<ApparatusBasicPage />);
  expect(await screen.findByText('Engine 51')).toBeInTheDocument();
};

describe('ApparatusBasicPage management controls', () => {
  beforeEach(() => {
    mockGetBasicApparatus.mockReset();
    mockGetBasicApparatus.mockResolvedValue([engine]);
    mockCreateBasicApparatus.mockReset();
    mockUpdateBasicApparatus.mockReset();
    mockDeleteBasicApparatus.mockReset();
    hasManagePermission = false;
  });

  describe('without scheduling.manage', () => {
    beforeEach(() => {
      hasManagePermission = false;
    });

    it('still lists the fleet', async () => {
      await renderPage();
      expect(screen.getByText('E-51')).toBeInTheDocument();
    });

    it('hides Add Apparatus', async () => {
      await renderPage();
      expect(screen.queryByRole('button', { name: /add apparatus/i })).not.toBeInTheDocument();
    });

    it('hides the per-apparatus edit and delete actions', async () => {
      await renderPage();
      expect(screen.queryByRole('button', { name: /^Edit / })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^Delete / })).not.toBeInTheDocument();
    });

    it('explains the empty fleet instead of offering to add one', async () => {
      mockGetBasicApparatus.mockResolvedValue([]);
      renderWithRouter(<ApparatusBasicPage />);
      expect(await screen.findByText('No apparatus defined')).toBeInTheDocument();
      expect(
        screen.getByText('A scheduling officer defines the vehicles and crew positions used for shift assignments.')
      ).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /add first apparatus/i })).not.toBeInTheDocument();
    });

    it('never reaches a write endpoint', async () => {
      await renderPage();
      expect(mockCreateBasicApparatus).not.toHaveBeenCalled();
      expect(mockUpdateBasicApparatus).not.toHaveBeenCalled();
      expect(mockDeleteBasicApparatus).not.toHaveBeenCalled();
    });
  });

  describe('with scheduling.manage', () => {
    beforeEach(() => {
      hasManagePermission = true;
    });

    it('shows Add Apparatus and the per-apparatus actions', async () => {
      await renderPage();
      expect(screen.getByRole('button', { name: /add apparatus/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Edit Engine 51' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Delete Engine 51' })).toBeInTheDocument();
    });

    it('offers the empty-state call to action', async () => {
      mockGetBasicApparatus.mockResolvedValue([]);
      renderWithRouter(<ApparatusBasicPage />);
      expect(await screen.findByRole('button', { name: /add first apparatus/i })).toBeInTheDocument();
    });

    // The form named nothing: the dialog had no name, the unit and name fields
    // were known only by their placeholders, and the type, staffing and every
    // seat select by nothing; each card's actions read "Edit apparatus".
    it("names the dialog, its fields and each unit's actions", async () => {
      const user = userEvent.setup();
      await renderPage();
      expect(screen.getByRole('button', { name: 'Edit Engine 51' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Delete Engine 51' })).toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: /add apparatus/i }));
      const dialog = screen.getByRole('dialog', { name: 'Add Apparatus' });
      expect(within(dialog).getByRole('textbox', { name: /^Unit Number/ })).toBeInTheDocument();
      expect(within(dialog).getByRole('textbox', { name: /^Name/ })).toBeInTheDocument();
      expect(within(dialog).getByRole('combobox', { name: 'Apparatus Type' })).toBeInTheDocument();
      expect(within(dialog).getByRole('spinbutton', { name: /^Minimum Staffing/ })).toBeInTheDocument();
      expect(within(dialog).getByRole('combobox', { name: 'Crew position 2' })).toBeInTheDocument();
      expect(within(dialog).getByRole('button', { name: 'Remove crew position 2' })).toBeInTheDocument();
    });
  });
});

describe('ApparatusBasicPage save validation', () => {
  beforeEach(() => {
    hasManagePermission = true;
    mockGetBasicApparatus.mockReset();
    mockGetBasicApparatus.mockResolvedValue([engine]);
    mockCreateBasicApparatus.mockReset();
    mockCreateBasicApparatus.mockResolvedValue({ id: 'app-2' });
    mockUpdateBasicApparatus.mockReset();
    mockUpdateBasicApparatus.mockResolvedValue({});
    mockToastError.mockReset();
  });

  const openAdd = async (user: ReturnType<typeof userEvent.setup>) => {
    await renderPage();
    await user.click(screen.getByRole('button', { name: /add apparatus/i }));
    const dialog = screen.getByRole('dialog', { name: 'Add Apparatus' });
    await user.type(within(dialog).getByRole('textbox', { name: /^Unit Number/ }), 'E-52');
    await user.type(within(dialog).getByRole('textbox', { name: /^Name/ }), 'Engine 52');
    return dialog;
  };

  it('will not send a cleared minimum staffing as 0', async () => {
    // Number('') is 0, which BasicApparatusCreate refuses with ge=1.
    const user = userEvent.setup();
    const dialog = await openAdd(user);

    await user.clear(within(dialog).getByRole('spinbutton', { name: /^Minimum Staffing/ }));
    await user.click(within(dialog).getByRole('button', { name: 'Add Apparatus' }));

    expect(mockToastError).toHaveBeenCalledWith('Minimum staffing must be a whole number from 1 to 50');
    expect(mockCreateBasicApparatus).not.toHaveBeenCalled();

    await user.type(within(dialog).getByRole('spinbutton', { name: /^Minimum Staffing/ }), '3');
    await user.click(within(dialog).getByRole('button', { name: 'Add Apparatus' }));

    await waitFor(() => expect(mockCreateBasicApparatus).toHaveBeenCalledTimes(1));
    expect(mockCreateBasicApparatus.mock.calls[0]?.[0]).toMatchObject({
      unit_number: 'E-52',
      name: 'Engine 52',
      min_staffing: 3,
    });
  });

  it('will not send a unit number longer than the backend accepts', async () => {
    const user = userEvent.setup();
    const dialog = await openAdd(user);

    fireEvent.change(within(dialog).getByRole('textbox', { name: /^Unit Number/ }), {
      target: { value: 'E'.repeat(21) },
    });
    await user.click(within(dialog).getByRole('button', { name: 'Add Apparatus' }));

    expect(mockToastError).toHaveBeenCalledWith('Unit number must be 20 characters or fewer');
    expect(mockCreateBasicApparatus).not.toHaveBeenCalled();
  });

  it("shows the server's reason when the save fails", async () => {
    mockCreateBasicApparatus.mockRejectedValue(
      Object.assign(new Error('Request failed with status code 409'), {
        isAxiosError: true,
        response: { status: 409, data: { detail: 'Unit number E-52 is already in use' } },
      })
    );
    const user = userEvent.setup();
    const dialog = await openAdd(user);

    await user.click(within(dialog).getByRole('button', { name: 'Add Apparatus' }));

    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('Unit number E-52 is already in use'));
  });
});

// A vehicle that templates, shifts or call records name is deactivated rather
// than deleted, so those records still resolve it. The dialog says which can
// happen, the toast says which did, and a failure carries the server's reason.
describe('ApparatusBasicPage delete', () => {
  beforeEach(() => {
    mockGetBasicApparatus.mockReset();
    mockGetBasicApparatus.mockResolvedValue([engine]);
    mockDeleteBasicApparatus.mockReset();
    mockDeleteBasicApparatus.mockResolvedValue('deleted');
    mockToastError.mockReset();
    mockToastSuccess.mockReset();
    hasManagePermission = true;
  });

  const confirmDelete = async () => {
    const user = userEvent.setup();
    await renderPage();
    await user.click(screen.getByRole('button', { name: 'Delete Engine 51' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
  };

  it('says a vehicle in use is deactivated rather than deleted', async () => {
    const user = userEvent.setup();
    await renderPage();
    await user.click(screen.getByRole('button', { name: 'Delete Engine 51' }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('it is deactivated instead of deleted');
  });

  it('reports a deactivation as one', async () => {
    mockDeleteBasicApparatus.mockResolvedValue('deactivated');
    await confirmDelete();

    await waitFor(() => expect(mockToastSuccess).toHaveBeenCalledTimes(1));
    expect(mockDeleteBasicApparatus).toHaveBeenCalledWith('app-1');
    expect(mockToastSuccess.mock.calls[0]?.[0]).toMatch(/Engine 51 is still named .* deactivated instead of deleted/);
  });

  it('reports a deletion as one', async () => {
    await confirmDelete();

    await waitFor(() => expect(mockToastSuccess).toHaveBeenCalledWith('Apparatus deleted'));
  });

  it("shows the server's reason when the delete fails", async () => {
    mockDeleteBasicApparatus.mockRejectedValue(
      Object.assign(new Error('Request failed with status code 404'), {
        isAxiosError: true,
        response: { status: 404, data: { detail: 'Apparatus not found' } },
      })
    );
    await confirmDelete();

    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('Apparatus not found'));
  });
});

// Deleting a vehicle in use deactivates it, which drops it from the list.
// "Show inactive" brings it back into view with a badge and a Reactivate
// action; reactivating restores the vehicle and nothing else.
describe('ApparatusBasicPage reactivate', () => {
  const retired = { ...engine, id: 'app-2', unit_number: 'E-9', name: 'Engine 9', is_active: false };

  beforeEach(() => {
    hasManagePermission = true;
    mockGetBasicApparatus.mockReset();
    mockGetBasicApparatus.mockImplementation((params?: { is_active?: boolean }) =>
      Promise.resolve(params?.is_active === false ? [retired] : [engine])
    );
    mockReactivateBasicApparatus.mockReset();
    mockReactivateBasicApparatus.mockResolvedValue({ ...retired, is_active: true });
    mockToastError.mockReset();
    mockToastSuccess.mockReset();
  });

  const showInactive = async (user: ReturnType<typeof userEvent.setup>) => {
    await renderPage();
    expect(screen.queryByText('Engine 9')).not.toBeInTheDocument();
    await user.click(screen.getByRole('checkbox', { name: 'Show inactive' }));
    await screen.findByText('Engine 9');
  };

  it('lists inactive vehicles with a badge only when asked', async () => {
    const user = userEvent.setup();
    await showInactive(user);

    expect(mockGetBasicApparatus).toHaveBeenCalledWith({ is_active: false });
    expect(screen.getAllByText('Inactive')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Reactivate Engine 9' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reactivate Engine 51' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete Engine 9' })).not.toBeInTheDocument();
  });

  it('confirms, reactivates, reports it and reloads the list', async () => {
    const user = userEvent.setup();
    await showInactive(user);
    const callsBefore = mockGetBasicApparatus.mock.calls.length;

    await user.click(screen.getByRole('button', { name: 'Reactivate Engine 9' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Reactivate "Engine 9" (E-9)?');
    expect(mockReactivateBasicApparatus).not.toHaveBeenCalled();
    await user.click(within(dialog).getByRole('button', { name: 'Reactivate' }));

    await waitFor(() => expect(mockReactivateBasicApparatus).toHaveBeenCalledWith('app-2'));
    await waitFor(() => expect(mockToastSuccess).toHaveBeenCalledWith('Engine 9 reactivated'));
    await waitFor(() => expect(mockGetBasicApparatus.mock.calls.length).toBeGreaterThan(callsBefore));
  });

  it('changes nothing when the officer leaves it inactive', async () => {
    const user = userEvent.setup();
    await showInactive(user);

    await user.click(screen.getByRole('button', { name: 'Reactivate Engine 9' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Leave inactive' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(mockReactivateBasicApparatus).not.toHaveBeenCalled();
  });

  it("shows the server's reason when reactivation fails", async () => {
    mockReactivateBasicApparatus.mockRejectedValue(
      Object.assign(new Error('Request failed with status code 404'), {
        isAxiosError: true,
        response: { status: 404, data: { detail: 'Apparatus not found' } },
      })
    );
    const user = userEvent.setup();
    await showInactive(user);

    await user.click(screen.getByRole('button', { name: 'Reactivate Engine 9' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Reactivate' }));

    await waitFor(() => expect(mockToastError).toHaveBeenCalledWith('Apparatus not found'));
    expect(mockToastSuccess).not.toHaveBeenCalled();
  });

  it('offers no inactive view without scheduling.manage', async () => {
    hasManagePermission = false;
    await renderPage();

    expect(screen.queryByRole('checkbox', { name: 'Show inactive' })).not.toBeInTheDocument();
    expect(mockGetBasicApparatus).not.toHaveBeenCalledWith({ is_active: false });
  });
});
