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
    // present a value the row cannot store. Under the owner's single-save rule
    // (2026-11-05) the rest of the edit still saves, without the type, and the
    // type is flagged on its field.
    const user = userEvent.setup();
    await renderEditing(user);

    await user.selectOptions(screen.getByDisplayValue('Fire Station'), '');
    const payload = await save(user);

    expect(payload).not.toHaveProperty('facility_type_id');
    expect(payload.name).toBe('Station 1');
    expect(screen.getByRole('combobox', { name: /^Type/ })).toHaveAccessibleDescription('Choose the facility type.');
  });
});

describe('OverviewSection — a lookup that was deactivated after the fact', () => {
  beforeEach(() => {
    updateFacility.mockReset();
    updateFacility.mockResolvedValue(undefined);
  });

  const retained = {
    ...facility,
    facilityTypeId: 'type-retired',
    facilityType: { id: 'type-retired', name: 'Substation' },
    statusId: 'status-retired',
    statusRecord: { id: 'status-retired', name: 'Mothballed' },
  } as unknown as Parameters<typeof OverviewSection>[0]['facility'];

  const renderRetained = async (user: ReturnType<typeof userEvent.setup>) => {
    renderWithRouter(
      <OverviewSection facility={retained} facilityTypes={types} facilityStatuses={statuses} canManage />
    );
    await user.click(screen.getByRole('button', { name: /Edit/ }));
  };

  it("keeps the facility's own type selectable even though it is no longer offered", async () => {
    // The store loads lookups active-only. Without the retained option the
    // select falls back to its blank placeholder while `facility_type_id`
    // still holds the id, so the field reads as unset and an unrelated edit
    // looks like the moment to pick a replacement.
    const user = userEvent.setup();
    await renderRetained(user);

    const option = screen.getByRole<HTMLOptionElement>('option', { name: 'Substation (inactive)' });
    expect(option.value).toBe('type-retired');
    expect(screen.getByRole('option', { name: 'Fire Station' })).toBeInTheDocument();
  });

  it('keeps the retained status too, marked as inactive', async () => {
    const user = userEvent.setup();
    await renderRetained(user);

    expect(screen.getByRole('option', { name: 'Mothballed (inactive)' })).toBeInTheDocument();
  });

  it('leaves the retained value in place when an unrelated field is saved', async () => {
    const user = userEvent.setup();
    await renderRetained(user);

    const notes = screen.getByDisplayValue('Roof replaced 2019');
    await user.clear(notes);
    await user.type(notes, 'Roof inspected 2026');
    const payload = await save(user);

    expect(payload.facility_type_id).toBe('type-retired');
    expect(payload.status_id).toBe('status-retired');
  });

  it('offers only the active lookups when nothing inactive is referenced', async () => {
    const user = userEvent.setup();
    await renderEditing(user);

    expect(screen.queryByRole('option', { name: /\(inactive\)/ })).not.toBeInTheDocument();
  });
});

describe('OverviewSection — the edit form', () => {
  beforeEach(() => {
    updateFacility.mockReset();
    updateFacility.mockResolvedValue(undefined);
  });

  // Every label sat beside its field without naming it: Name, the selects,
  // the address, contacts and every number were announced as bare boxes.
  it('names each field by its label', async () => {
    const user = userEvent.setup();
    await renderEditing(user);
    expect(screen.getByRole('textbox', { name: /^Name/ })).toHaveValue('Station 1');
    expect(screen.getByRole('combobox', { name: /^Type/ })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'City' })).toHaveValue('Falls Church');
    expect(screen.getByRole('textbox', { name: 'Email' })).toBeInTheDocument();
    expect(screen.getByRole('spinbutton', { name: 'Year Built' })).toHaveValue(1974);
    expect(screen.getByRole('textbox', { name: 'Notes' })).toHaveValue('Roof replaced 2019');
  });

  // The server accepts any string, so "not-an-email" was saved as a station's
  // address from the add dialog and then shown on its overview.
  it('refuses an email address without an @ and says why', async () => {
    const user = userEvent.setup();
    await renderEditing(user);
    const email = screen.getByRole('textbox', { name: 'Email' });
    await user.type(email, 'not-an-email');
    expect(email).toHaveAttribute('aria-invalid', 'true');
    expect(email).toHaveAccessibleDescription(/Enter an email address/);

    // The rest of the edit saves without the email, which stays flagged
    // (owner rule, 2026-11-05).
    const payload = await save(user);
    expect(payload).not.toHaveProperty('email');
    expect(screen.getByRole('alert')).toHaveTextContent('Facility saved, except email.');
  });
});

describe('OverviewSection — refusals and leaving the form', () => {
  beforeEach(() => {
    updateFacility.mockReset();
    updateFacility.mockResolvedValue(undefined);
  });

  // Forms review F-2: a refusal from the server was a toast that named the
  // reason but not the field, and the form gave no clue which box to fix.
  it("puts the server's refusal on its field and saves the rest", async () => {
    updateFacility
      .mockRejectedValueOnce({
        response: { status: 422, data: { detail: [{ field: 'zip_code', message: 'Zip code is too long.' }] } },
      })
      .mockResolvedValueOnce(undefined);
    const user = userEvent.setup();
    await renderEditing(user);
    await user.clear(screen.getByRole('textbox', { name: 'Notes' }));
    await user.type(screen.getByRole('textbox', { name: 'Notes' }), 'Bay door serviced');

    await user.click(screen.getByRole('button', { name: /Save/ }));

    await waitFor(() => expect(updateFacility).toHaveBeenCalledTimes(2));
    const second = updateFacility.mock.calls[1]?.[1] as Record<string, unknown>;
    expect(second).not.toHaveProperty('zip_code');
    expect(second.notes).toBe('Bay door serviced');
    expect(
      await screen.findByRole('textbox', { name: 'Zip Code', description: 'Zip code is too long.' })
    ).toHaveFocus();
  });

  // Forms review F-6: Cancel threw every typed change away without a word.
  it('asks before Cancel throws typed changes away', async () => {
    const user = userEvent.setup();
    await renderEditing(user);
    await user.type(screen.getByRole('textbox', { name: 'City' }), ' Heights');

    await user.click(screen.getByRole('button', { name: /Cancel/ }));
    await user.click(await screen.findByRole('button', { name: 'Keep editing' }));

    expect(screen.getByRole('textbox', { name: 'City' })).toHaveValue('Falls Church Heights');
    expect(updateFacility).not.toHaveBeenCalled();
  });

  it('names a whole number out of range on its field before saving', async () => {
    const user = userEvent.setup();
    await renderEditing(user);
    const floors = screen.getByRole('spinbutton', { name: 'Floors' });
    await user.type(floors, '0');

    const payload = await save(user);

    expect(payload).not.toHaveProperty('num_floors');
    expect(floors).toHaveAccessibleDescription('Enter a whole number, 1 or more, or leave it empty.');
  });
});
