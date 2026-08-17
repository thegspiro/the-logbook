import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
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
