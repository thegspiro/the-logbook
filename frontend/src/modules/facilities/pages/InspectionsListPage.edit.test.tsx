/**
 * FAC2-8, the inspection half: the cross-facility Inspections list offered a
 * Facility picker on edit that the update schema ignores.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../test/utils';
import type { Inspection } from '../types';

const inspection: Inspection = {
  id: 'insp-1',
  facilityId: 'fac-2',
  inspectionType: 'fire',
  title: 'Annual fire inspection',
  inspectionDate: '2026-11-01',
  createdAt: '2026-11-01T00:00:00Z',
  updatedAt: '2026-11-01T00:00:00Z',
};

vi.mock('../store/facilitiesStore', () => ({
  useFacilitiesStore: () => ({
    facilities: [
      { id: 'fac-1', name: 'Station 1', isArchived: false },
      { id: 'fac-2', name: 'Old Station', isArchived: true },
    ],
    loadFacilities: vi.fn(),
    loadLookupData: vi.fn(),
  }),
}));
vi.mock('../hooks/useFacilitiesAccess', () => ({
  useFacilitiesAccess: () => ({ canEdit: true, canDelete: true }),
}));
vi.mock('../../../services/api', () => ({
  organizationService: {
    getEnabledModules: vi.fn(() => Promise.resolve({ configured: false, enabled_modules: [] })),
  },
  facilitiesService: {
    getInspectionsPage: vi.fn(() => Promise.resolve({ items: [inspection], total: 1, skip: 0, limit: 50 })),
    updateInspection: vi.fn(),
    createInspection: vi.fn(),
    deleteInspection: vi.fn(),
  },
}));
vi.mock('../../../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));

import InspectionsListPage from './InspectionsListPage';

describe('InspectionsListPage editing an inspection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the inspection’s facility instead of offering to move it', async () => {
    const user = userEvent.setup();
    renderWithRouter(<InspectionsListPage />);
    await user.click(await screen.findByRole('button', { name: 'Edit inspection' }));

    const dialog = await screen.findByRole('dialog', { name: 'Edit Inspection' });
    expect(within(dialog).queryByRole('combobox', { name: /^Facility/ })).not.toBeInTheDocument();
    expect(within(dialog).getByText('Old Station')).toBeInTheDocument();
  });

  it('still offers the picker when creating', async () => {
    const user = userEvent.setup();
    renderWithRouter(<InspectionsListPage />);
    await user.click(await screen.findByRole('button', { name: /New Inspection/ }));

    const dialog = await screen.findByRole('dialog', { name: 'New Inspection' });
    expect(within(dialog).getByRole('combobox', { name: /^Facility/ })).toBeInTheDocument();
  });
});
