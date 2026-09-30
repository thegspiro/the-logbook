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
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
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

vi.mock('../modules/scheduling/services/api', () => ({
  schedulingService: {
    getBasicApparatus: (...args: unknown[]) => mockGetBasicApparatus(...args) as unknown,
    createBasicApparatus: (...args: unknown[]) => mockCreateBasicApparatus(...args) as unknown,
    updateBasicApparatus: (...args: unknown[]) => mockUpdateBasicApparatus(...args) as unknown,
    deleteBasicApparatus: (...args: unknown[]) => mockDeleteBasicApparatus(...args) as unknown,
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
      expect(within(dialog).getByRole('spinbutton', { name: 'Minimum Staffing' })).toBeInTheDocument();
      expect(within(dialog).getByRole('combobox', { name: 'Crew position 2' })).toBeInTheDocument();
      expect(within(dialog).getByRole('button', { name: 'Remove crew position 2' })).toBeInTheDocument();
    });
  });
});
