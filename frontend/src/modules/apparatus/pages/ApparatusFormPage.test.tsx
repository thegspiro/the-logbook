import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../test/utils';

interface RankLike {
  rank_code: string;
  display_name: string;
  eligible_positions?: string[];
}

let ranksState: { ranks: RankLike[]; loading: boolean } = { ranks: [], loading: false };

vi.mock('@/hooks/useRanks', () => ({
  useRanks: () => ranksState,
}));

// Department-configured scheduling positions: three built-ins plus one custom.
vi.mock('@/modules/scheduling/components/shiftTemplateTypes', () => ({
  getPositionOptions: () => [
    { value: 'officer', label: 'Officer' },
    { value: 'driver', label: 'Driver/Operator' },
    { value: 'firefighter', label: 'Firefighter' },
    { value: 'rescue_tech', label: 'Rescue Technician' },
  ],
}));

vi.mock('@/modules/scheduling/services/shiftSettingsApi', () => ({
  ensureShiftSettingsLoaded: () => Promise.resolve({}),
  // positionLabel() reads the same custom seats from here, so the department's
  // own label reaches a seat wherever it is shown, not only this dropdown.
  getCachedShiftSettings: () => ({
    customPositions: [{ value: 'rescue_tech', label: 'Rescue Technician' }],
  }),
}));

let nfpaDepartmentEnabled = false;

vi.mock('../hooks/useApparatusNfpaSettings', () => ({
  useApparatusNfpaSettings: () => ({ enabled: nfpaDepartmentEnabled }),
}));

const store = {
  currentApparatus: null,
  types: [],
  statuses: [],
  isLoading: false,
  fetchApparatus: vi.fn(),
  fetchTypes: vi.fn(),
  fetchStatuses: vi.fn(),
};

vi.mock('../store/apparatusStore', () => ({
  useApparatusStore: () => store,
}));

vi.mock('../services/api', () => ({
  apparatusService: {
    createApparatus: vi.fn(),
    updateApparatus: vi.fn(),
  },
  evocLevelService: {
    getLevels: () => Promise.resolve([]),
  },
}));

import ApparatusFormPage from './ApparatusFormPage';
import { apparatusService } from '../services/api';

const addSeatAndGetSelect = async () => {
  await userEvent.click(screen.getByRole('button', { name: /Add Seat/i }));
  return screen.getByRole('combobox', { name: 'Crew seat 1 position' });
};

describe('ApparatusFormPage crew seat pickers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ranksState = { ranks: [], loading: false };
    localStorage.setItem('has_session', 'true');
  });

  it('offers department custom positions alongside the built-in codes', async () => {
    renderWithRouter(<ApparatusFormPage />);

    const select = await addSeatAndGetSelect();
    expect(within(select).getByRole('option', { name: 'Officer' })).toBeInTheDocument();
    expect(within(select).getByRole('option', { name: 'Rescue Technician' })).toBeInTheDocument();

    // Selecting the custom position must not degrade it to a legacy entry.
    await userEvent.selectOptions(select, 'rescue_tech');
    expect(within(select).queryByRole('option', { name: /legacy position/i })).not.toBeInTheDocument();
  });

  it('keeps the seat selects enabled while ranks are still loading', async () => {
    ranksState = { ranks: [], loading: true };
    renderWithRouter(<ApparatusFormPage />);

    const select = await addSeatAndGetSelect();
    expect(select).toBeEnabled();
    expect(within(select).getByRole('option', { name: 'Firefighter' })).toBeInTheDocument();
  });

  it('appends rank-eligibility labels to built-in codes once ranks arrive', async () => {
    ranksState = {
      ranks: [{ rank_code: 'chauffeur', display_name: 'Chauffeur', eligible_positions: ['driver', 'rescue_tech'] }],
      loading: false,
    };
    renderWithRouter(<ApparatusFormPage />);

    const select = await addSeatAndGetSelect();
    expect(within(select).getByRole('option', { name: 'Driver/Operator — Chauffeur' })).toBeInTheDocument();
    // Custom positions get the same eligibility treatment.
    expect(within(select).getByRole('option', { name: 'Rescue Technician — Chauffeur' })).toBeInTheDocument();
    expect(within(select).getByRole('option', { name: 'Officer' })).toBeInTheDocument();
  });
});

// Every label sat beside its field without naming it, so most fields were
// announced by their placeholder ("E-1", "Old Reliable", "2024") and the
// selects, license plate, asset tag and every date by nothing at all.
describe('ApparatusFormPage field names', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ranksState = { ranks: [], loading: false };
    localStorage.setItem('has_session', 'true');
  });

  it.each([
    [/^Unit Number/, 'textbox'],
    ['Name/Nickname', 'textbox'],
    [/^Apparatus Type/, 'combobox'],
    [/^Status/, 'combobox'],
    ['Year', 'spinbutton'],
    ['License Plate', 'textbox'],
    ['Asset Tag', 'textbox'],
    [/^Minimum Staffing/, 'spinbutton'],
    ['Fuel Type', 'combobox'],
    ['Purchase Price', 'spinbutton'],
    ['Description', 'textbox'],
    ['Additional Notes', 'textbox'],
  ] as const)('names %s by its label', async (label, role) => {
    renderWithRouter(<ApparatusFormPage />);
    expect(await screen.findByRole(role, { name: label })).toBeInTheDocument();
  });

  it('names the date fields by their labels', async () => {
    renderWithRouter(<ApparatusFormPage />);
    await screen.findByRole('heading', { name: 'Add Apparatus' });
    for (const label of ['Purchase Date', 'In Service Date', 'Registration Expiration', 'Warranty Expiration']) {
      expect(screen.getByLabelText(label)).toHaveAttribute('type', 'date');
    }
  });
});

describe('ApparatusFormPage required-field errors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ranksState = { ranks: [], loading: false };
    localStorage.setItem('has_session', 'true');
  });

  // Submitting empty showed the three errors in red under each field, but
  // nothing tied them to the field: a screen reader on Unit Number heard no
  // error and nothing marked it invalid.
  it('ties each required-field error to its field', async () => {
    renderWithRouter(<ApparatusFormPage />);
    const unit = await screen.findByRole('textbox', { name: /^Unit Number/ });
    expect(unit).not.toHaveAttribute('aria-invalid', 'true');

    await userEvent.click(screen.getByRole('button', { name: 'Add Apparatus' }));

    expect(unit).toHaveAttribute('aria-invalid', 'true');
    expect(unit).toHaveAccessibleDescription('Unit number is required');
    expect(screen.getByRole('combobox', { name: /^Apparatus Type/ })).toHaveAccessibleDescription(
      'Apparatus type is required'
    );
    expect(screen.getByRole('combobox', { name: /^Status/ })).toHaveAccessibleDescription('Status is required');
  });
});

describe('ApparatusFormPage clearing a field on edit', () => {
  const existing = {
    id: 'app-1',
    unitNumber: 'E-2',
    name: 'W48 Pumper',
    apparatusTypeId: 'type-1',
    statusId: 'status-1',
    minStaffing: 3,
    year: 2019,
    currentMileage: 0,
    make: 'Pierce',
    crewPositions: [],
    isFinanced: false,
    nfpaTrackingEnabled: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    ranksState = { ranks: [], loading: false };
    localStorage.setItem('has_session', 'true');
    Object.assign(store, { currentApparatus: existing });
    vi.mocked(apparatusService.updateApparatus).mockReset();
    vi.mocked(apparatusService.updateApparatus).mockResolvedValue(existing as never);
  });

  afterEach(() => {
    Object.assign(store, { currentApparatus: null });
  });

  // The update is applied with exclude_unset, so an omitted key means "leave
  // it". Emptied fields were turned into undefined and dropped, and the old
  // value survived behind "Apparatus updated" (CLAUDE.md pitfall 1).
  it('sends an emptied field as null and leaves untouched ones alone', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/apparatus/app-1/edit']}>
        <Routes>
          <Route path="/apparatus/:id/edit" element={<ApparatusFormPage />} />
        </Routes>
      </MemoryRouter>
    );

    await user.clear(await screen.findByRole('textbox', { name: 'Name/Nickname' }));
    await user.clear(screen.getByRole('spinbutton', { name: 'Year' }));
    await user.click(screen.getByRole('button', { name: /Save|Update/ }));

    await waitFor(() => expect(apparatusService.updateApparatus).toHaveBeenCalled());
    const [, payload] = vi.mocked(apparatusService.updateApparatus).mock.calls[0] ?? [];
    expect(payload).toMatchObject({ name: null, year: null, make: 'Pierce', unitNumber: 'E-2', minStaffing: 3 });
    // A stored 0 the form loaded as blank is not a clear.
    expect(payload).not.toHaveProperty('currentMileage', null);
  });
});

describe('ApparatusFormPage NFPA tracking checkbox', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ranksState = { ranks: [], loading: false };
    localStorage.setItem('has_session', 'true');
  });

  afterEach(() => {
    nfpaDepartmentEnabled = false;
  });

  it('is hidden when the department does not track NFPA compliance', () => {
    nfpaDepartmentEnabled = false;
    renderWithRouter(<ApparatusFormPage />);
    expect(screen.queryByLabelText('Enable NFPA compliance tracking')).not.toBeInTheDocument();
  });

  it('is offered when the department tracks NFPA compliance', () => {
    nfpaDepartmentEnabled = true;
    renderWithRouter(<ApparatusFormPage />);
    expect(screen.getByLabelText('Enable NFPA compliance tracking')).toBeInTheDocument();
  });
});

describe('ApparatusFormPage newcomer guidance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ranksState = { ranks: [], loading: false };
    localStorage.setItem('has_session', 'true');
  });

  afterEach(() => {
    nfpaDepartmentEnabled = false;
  });

  it('says only the starred fields are needed when adding', () => {
    renderWithRouter(<ApparatusFormPage />);
    expect(screen.getByText(/Only the fields marked \* are needed to start/)).toBeInTheDocument();
  });

  // The department switch reads "on", but each vehicle is opted in separately
  // and stored off, so a new unit showed no NFPA tab with nothing saying why.
  it('describes the NFPA checkbox as a per-apparatus choice', () => {
    nfpaDepartmentEnabled = true;
    renderWithRouter(<ApparatusFormPage />);
    expect(screen.getByLabelText('Enable NFPA compliance tracking')).toHaveAccessibleDescription(
      /Each apparatus is turned on separately/
    );
  });

  it('labels compressed natural gas as CNG', () => {
    renderWithRouter(<ApparatusFormPage />);
    const fuel = screen.getByRole('combobox', { name: 'Fuel Type' });
    expect(within(fuel).getByRole('option', { name: 'CNG' })).toBeInTheDocument();
    expect(within(fuel).queryByRole('option', { name: 'Cng' })).not.toBeInTheDocument();
  });
});

// Out of Service is seeded with requires_reason, which POST /apparatus/{id}/status
// enforces. This form saves through the plain update, which does not, and had
// no reason field at all, so a rig went out of service with no record of why.
describe('ApparatusFormPage status reason', () => {
  const statusRow = (id: string, name: string, requiresReason: boolean) => ({
    id,
    organizationId: null,
    name,
    code: id,
    description: null,
    isSystem: true,
    defaultStatus: null,
    isAvailable: !requiresReason,
    isOperational: !requiresReason,
    requiresReason,
    isArchivedStatus: false,
    color: null,
    icon: null,
    sortOrder: 1,
    isActive: true,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  });
  const existing = {
    id: 'app-1',
    unitNumber: 'E-2',
    name: 'Pumper',
    apparatusTypeId: 'type-1',
    statusId: 'st-oos',
    statusReason: 'Radio dead',
    minStaffing: 3,
    crewPositions: [],
    isFinanced: false,
    nfpaTrackingEnabled: false,
  };

  const renderEdit = () =>
    render(
      <MemoryRouter initialEntries={['/apparatus/app-1/edit']}>
        <Routes>
          <Route path="/apparatus/:id/edit" element={<ApparatusFormPage />} />
        </Routes>
      </MemoryRouter>
    );

  beforeEach(() => {
    vi.clearAllMocks();
    ranksState = { ranks: [], loading: false };
    localStorage.setItem('has_session', 'true');
    Object.assign(store, {
      currentApparatus: existing,
      statuses: [statusRow('st-in', 'In Service', false), statusRow('st-oos', 'Out of Service', true)],
    });
    vi.mocked(apparatusService.updateApparatus).mockReset();
    vi.mocked(apparatusService.updateApparatus).mockResolvedValue(existing as never);
  });

  afterEach(() => {
    Object.assign(store, { currentApparatus: null, statuses: [] });
  });

  it('loads the saved reason and marks it required for Out of Service', async () => {
    renderEdit();
    const reason = await screen.findByRole('textbox', { name: /Reason/ });
    expect(reason).toHaveValue('Radio dead');
    expect(screen.getByText('*', { selector: 'label[for="apparatus-statusReason"] span' })).toBeInTheDocument();
  });

  it('refuses to save Out of Service without a reason', async () => {
    const user = userEvent.setup();
    renderEdit();
    await user.clear(await screen.findByRole('textbox', { name: /Reason/ }));
    await user.click(screen.getByRole('button', { name: /Save|Update/ }));
    expect(await screen.findByText('Give a reason for Out of Service')).toBeInTheDocument();
    expect(apparatusService.updateApparatus).not.toHaveBeenCalled();
  });

  it('drops the old reason when the status changes, and clears it on the server', async () => {
    const user = userEvent.setup();
    renderEdit();
    await screen.findByRole('textbox', { name: /Reason/ });
    await user.selectOptions(screen.getByRole('combobox', { name: /Status/ }), 'st-in');
    expect(screen.getByRole('textbox', { name: /Reason/ })).toHaveValue('');
    await user.click(screen.getByRole('button', { name: /Save|Update/ }));
    await waitFor(() => expect(apparatusService.updateApparatus).toHaveBeenCalled());
    const [, payload] = vi.mocked(apparatusService.updateApparatus).mock.calls[0] ?? [];
    expect(payload).toMatchObject({ statusId: 'st-in', statusReason: null });
  });

  it('sends a typed reason with the status', async () => {
    const user = userEvent.setup();
    renderEdit();
    const reason = await screen.findByRole('textbox', { name: /Reason/ });
    await user.clear(reason);
    await user.type(reason, 'Pump seal leaking');
    await user.click(screen.getByRole('button', { name: /Save|Update/ }));
    await waitFor(() => expect(apparatusService.updateApparatus).toHaveBeenCalled());
    const [, payload] = vi.mocked(apparatusService.updateApparatus).mock.calls[0] ?? [];
    expect(payload).toMatchObject({ statusId: 'st-oos', statusReason: 'Pump seal leaking' });
  });
});
