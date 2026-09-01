import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithRouter } from '../../../test/utils';

const updateFacility = vi.fn();

vi.mock('../store/facilitiesStore', () => ({
  useFacilitiesStore: () => ({ updateFacility: (...args: unknown[]) => updateFacility(...args) as unknown }),
}));

import OverviewSection from './OverviewSection';

const facility = {
  id: 'f1',
  organizationId: 'org-1',
  name: 'Station 1',
  facilityNumber: 'S-1',
  facilityTypeId: 'type-1',
  statusId: 'status-1',
  addressLine1: '1 Main St',
  city: 'Falls Church',
  state: 'VA',
  zipCode: '22046',
  phone: '555-0100',
  yearBuilt: 1974,
  notes: 'Roof replaced 2019',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
} as unknown as Parameters<typeof OverviewSection>[0]['facility'];

const types = [{ id: 'type-1', name: 'Fire Station' }] as never;
const statuses = [{ id: 'status-1', name: 'Active' }] as never;

const renderEditing = async (user: ReturnType<typeof userEvent.setup>) => {
  renderWithRouter(<OverviewSection facility={facility} facilityTypes={types} facilityStatuses={statuses} canManage />);
  await user.click(screen.getByRole('button', { name: /Edit/ }));
};

const save = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('button', { name: /Save/ }));
  await waitFor(() => expect(updateFacility).toHaveBeenCalled());
  return updateFacility.mock.calls[0]?.[1] as Record<string, unknown>;
};

describe('OverviewSection — clearing a field', () => {
  beforeEach(() => {
    updateFacility.mockReset();
    updateFacility.mockResolvedValue(undefined);
  });

  it('sends an explicit null for a cleared text field', async () => {
    // `undefined` is dropped by JSON.stringify, so the key never leaves the
    // browser and the backend's exclude_unset dump reads the absence as
    // "leave this alone" — the old phone number survives behind a success
    // toast. Only an explicit null clears it.
    const user = userEvent.setup();
    await renderEditing(user);

    await user.clear(screen.getByDisplayValue('555-0100'));
    const payload = await save(user);

    expect(payload.phone).toBeNull();
    expect(JSON.parse(JSON.stringify(payload))).toHaveProperty('phone', null);
  });

  it('sends an explicit null for a cleared numeric field', async () => {
    const user = userEvent.setup();
    await renderEditing(user);

    await user.clear(screen.getByDisplayValue('1974'));
    const payload = await save(user);

    expect(payload.year_built).toBeNull();
  });

  it('keeps an edited value rather than nulling everything', async () => {
    const user = userEvent.setup();
    await renderEditing(user);

    const notes = screen.getByDisplayValue('Roof replaced 2019');
    await user.clear(notes);
    await user.type(notes, 'Bay door serviced');
    const payload = await save(user);

    expect(payload.notes).toBe('Bay door serviced');
    expect(payload.name).toBe('Station 1');
  });

  it('keeps a stored zero rather than clearing it on an unrelated edit', async () => {
    // A station with no bays, no bunks, no second floor stores 0, which is an
    // answer. Seeding the form with `||` turned it into '', and handleSave
    // sends '' as an explicit null — so opening the editor to change the
    // phone number wiped every zero on the record.
    const withZeros = { ...(facility as object), numBays: 0, sleepingQuarters: 0 } as typeof facility;
    const user = userEvent.setup();
    renderWithRouter(
      <OverviewSection facility={withZeros} facilityTypes={types} facilityStatuses={statuses} canManage />
    );
    await user.click(screen.getByRole('button', { name: /Edit/ }));

    const payload = await save(user);

    expect(payload.num_bays).toBe(0);
    expect(payload.sleeping_quarters).toBe(0);
  });

  it('keeps a deactivated type selectable on the facility that still uses it', async () => {
    // The store loads active lookups only, so deactivating a type on the
    // settings screen actually stops it being chosen. An existing station
    // still references it, though, and dropping the option left the select
    // blank against a NOT NULL column: an unrelated edit either could not be
    // saved or quietly re-filed the station under something else.
    const retired = {
      ...(facility as object),
      facilityTypeId: 'type-old',
      facilityType: { id: 'type-old', name: 'Substation' },
    } as typeof facility;
    const user = userEvent.setup();
    renderWithRouter(
      <OverviewSection facility={retired} facilityTypes={types} facilityStatuses={statuses} canManage />
    );
    await user.click(screen.getByRole('button', { name: /Edit/ }));

    expect(screen.getByRole('option', { name: 'Substation (inactive)' })).toBeInTheDocument();
    const payload = await save(user);
    expect(payload.facility_type_id).toBe('type-old');
  });

  it('refuses a blank required select instead of sending a null the column cannot hold', async () => {
    // Both selects offer a blank option on a NOT NULL column, so the form can
    // present a value the row cannot store.
    const user = userEvent.setup();
    await renderEditing(user);

    await user.selectOptions(screen.getByDisplayValue('Fire Station'), '');
    await user.click(screen.getByRole('button', { name: /Save/ }));

    expect(updateFacility).not.toHaveBeenCalled();
  });
});
