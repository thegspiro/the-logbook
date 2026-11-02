/**
 * Deleting a screening record names whose record it is.
 *
 * Deep-dive review 2026-11-02: the confirmation read "Delete this Vision &
 * Hearing record? You can't undo this." — the same sentence for every member
 * holding that screening type, on a delete that cannot be undone. The row's
 * button already named the member (W71-3); the dialog the officer actually
 * decides in did not.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import type { ScreeningRecord } from '../types';

const listRequirements = vi.fn();
const listRecords = vi.fn();
const getExpiringScreenings = vi.fn();

vi.mock('../services/api', () => ({
  medicalScreeningService: {
    listRequirements: (...a: unknown[]) => listRequirements(...a) as unknown,
    listRecords: (...a: unknown[]) => listRecords(...a) as unknown,
    getExpiringScreenings: (...a: unknown[]) => getExpiringScreenings(...a) as unknown,
  },
}));

import { MedicalScreeningPage } from './MedicalScreeningPage';

const record = (overrides: Partial<ScreeningRecord>): ScreeningRecord => ({
  id: 'rec-1',
  organization_id: 'org-1',
  user_id: 'u-1',
  user_name: 'Devon Ellis',
  screening_type: 'vision_hearing',
  status: 'scheduled',
  scheduled_date: '2026-11-20',
  self_recorded: false,
  created_at: '2026-11-02T00:00:00Z',
  updated_at: '2026-11-02T00:00:00Z',
  ...overrides,
});

describe('MedicalScreeningPage — deleting a record', () => {
  beforeEach(() => {
    listRequirements.mockReset();
    listRecords.mockReset();
    getExpiringScreenings.mockReset();
    listRequirements.mockResolvedValue([]);
    listRecords.mockResolvedValue([
      record({}),
      record({
        id: 'rec-2',
        user_id: undefined,
        user_name: undefined,
        prospect_id: 'p-1',
        prospect_name: 'Rowan Vale',
      }),
    ]);
    getExpiringScreenings.mockResolvedValue([]);
  });

  it.each([
    ['Devon Ellis', 'Delete Devon Ellis Vision & Hearing record'],
    ['Rowan Vale', 'Delete Rowan Vale Vision & Hearing record'],
  ])('names %s in the confirmation', async (name, button) => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/medical-screening?tab=records']}>
        <MedicalScreeningPage />
      </MemoryRouter>
    );

    await user.click(await screen.findByRole('button', { name: button }));

    const dialog = screen.getByRole('dialog');
    expect(
      within(dialog).getByText(`Delete ${name}'s Vision & Hearing record? You can't undo this.`)
    ).toBeInTheDocument();
  });
});
