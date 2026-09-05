import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../test/utils';
import type { CallTypeOption } from '../types';
import { CallTypesCard } from './CallTypesCard';

const onSave = vi.fn<(types: CallTypeOption[]) => Promise<void>>();

const TYPES: CallTypeOption[] = [
  { slug: 'fire', label: 'Fire', active: true },
  { slug: 'ems', label: 'EMS', active: true },
  { slug: 'brush', label: 'Brush', active: false },
];

const renderCard = (over: Partial<React.ComponentProps<typeof CallTypesCard>> = {}) =>
  renderWithRouter(
    <CallTypesCard
      types={TYPES.map((t) => ({ ...t }))}
      usage={{ fire: 12 }}
      mode="count_only"
      saving={false}
      onSave={onSave}
      {...over}
    />
  );

const savedTypes = () => onSave.mock.calls[0]?.[0] ?? [];

// Each block installs its own default rather than inheriting whatever ran
// last: vi.clearAllMocks() clears calls but leaves implementations (and any
// queued *Once value) in place — pitfall #28.
beforeEach(() => {
  onSave.mockReset();
  onSave.mockResolvedValue(undefined);
});

describe('CallTypesCard', () => {
  it('shows each type with its permanent slug and what is filed under it', () => {
    renderCard();
    expect(screen.getByDisplayValue('Fire')).toBeInTheDocument();
    expect(screen.getByText('fire')).toBeInTheDocument();
    expect(screen.getByText(/12 calls on record/)).toBeInTheDocument();
    expect(screen.getAllByText(/no calls on record/)).toHaveLength(2);
  });

  it('counts only the types officers will actually be offered', () => {
    renderCard();
    // Brush is retired, so two of the three.
    expect(screen.getByText(/Officers see 2 types at close-out/)).toBeInTheDocument();
  });

  it('says close-out will ask for a total only when every type is off', () => {
    renderCard({ types: TYPES.map((t) => ({ ...t, active: false })) });
    expect(screen.getByText(/ask for a total only/)).toBeInTheDocument();
  });

  it('says so when the mode means none of this is in effect yet', () => {
    renderCard({ mode: 'detailed' });
    expect(screen.getByText(/Record a call count at close-out/)).toBeInTheDocument();
  });
});

describe('CallTypesCard renaming', () => {
  beforeEach(() => {
    onSave.mockReset();
    onSave.mockResolvedValue(undefined);
  });

  it('renames the label and leaves the slug alone', async () => {
    const user = userEvent.setup();
    renderCard();

    const input = screen.getByLabelText('Name for ems');
    await user.clear(input);
    await user.type(input, 'EMS / Medical');
    await user.click(screen.getByRole('button', { name: 'Save call types' }));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    // The slug is what every historical call is filed under; renaming the
    // display label must not touch it or that history is orphaned.
    expect(savedTypes()).toContainEqual({ slug: 'ems', label: 'EMS / Medical', active: true });
  });

  it('writes the whole list, so the built-in defaults are materialised', async () => {
    const user = userEvent.setup();
    renderCard();

    const input = screen.getByLabelText('Name for fire');
    await user.type(input, 's');
    await user.click(screen.getByRole('button', { name: 'Save call types' }));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(savedTypes().map((t) => t.slug)).toEqual(['fire', 'ems', 'brush']);
  });

  it('refuses to save a type with no name', async () => {
    const user = userEvent.setup();
    renderCard();

    await user.clear(screen.getByLabelText('Name for fire'));
    await user.click(screen.getByRole('button', { name: 'Save call types' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Every call type needs a name');
    expect(onSave).not.toHaveBeenCalled();
  });

  it('keeps the Save button inert until something changes', async () => {
    const user = userEvent.setup();
    renderCard();

    expect(screen.getByRole('button', { name: 'Save call types' })).toBeDisabled();
    await user.type(screen.getByLabelText('Name for fire'), 's');
    expect(screen.getByRole('button', { name: 'Save call types' })).toBeEnabled();
  });

  it('reset restores what the server holds', async () => {
    const user = userEvent.setup();
    renderCard();

    await user.type(screen.getByLabelText('Name for fire'), 'storm');
    await user.click(screen.getByRole('button', { name: 'Reset' }));

    expect(screen.getByDisplayValue('Fire')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save call types' })).toBeDisabled();
  });
});

describe('CallTypesCard retiring', () => {
  beforeEach(() => {
    onSave.mockReset();
    onSave.mockResolvedValue(undefined);
  });

  it('retires a type in place rather than dropping it from the list', async () => {
    const user = userEvent.setup();
    renderCard();

    await user.click(screen.getByRole('switch', { name: 'Offer Fire at close-out' }));
    await user.click(screen.getByRole('button', { name: 'Save call types' }));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    // Still stored — its 12 calls need the label to keep resolving.
    expect(savedTypes()).toContainEqual({ slug: 'fire', label: 'Fire', active: false });
  });

  it('brings a retired type back', async () => {
    const user = userEvent.setup();
    renderCard();

    await user.click(screen.getByRole('switch', { name: 'Offer Brush at close-out' }));
    await user.click(screen.getByRole('button', { name: 'Save call types' }));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(savedTypes()).toContainEqual({ slug: 'brush', label: 'Brush', active: true });
  });

  it('will not delete a type that has calls filed under it', () => {
    renderCard();
    // Deleting it would leave those 12 calls pointing at a slug nothing can
    // label; retiring is the only way out, and the button says why.
    const del = screen.getByRole('button', { name: 'Delete Fire' });
    expect(del).toBeDisabled();
    expect(del).toHaveAttribute('title', expect.stringContaining('Turn it off to retire it instead'));
  });

  it('deletes an unused type once confirmed', async () => {
    const user = userEvent.setup();
    renderCard();

    await user.click(screen.getByRole('button', { name: 'Delete Brush' }));
    await user.click(await screen.findByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(screen.queryByLabelText('Name for brush')).not.toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Save call types' }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(savedTypes().map((t) => t.slug)).toEqual(['fire', 'ems']);
  });

  it('keeps the type when the confirmation is declined', async () => {
    const user = userEvent.setup();
    renderCard();

    await user.click(screen.getByRole('button', { name: 'Delete Brush' }));
    await user.click(await screen.findByRole('button', { name: 'Keep it' }));

    expect(screen.getByLabelText('Name for brush')).toBeInTheDocument();
  });

  it('refuses to save an empty list, because the backend would reseed the defaults', async () => {
    const user = userEvent.setup();
    renderCard({ types: [{ slug: 'brush', label: 'Brush', active: true }], usage: {} });

    await user.click(screen.getByRole('button', { name: 'Delete Brush' }));
    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    await user.click(screen.getByRole('button', { name: 'Save call types' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('turn every type off instead');
    expect(onSave).not.toHaveBeenCalled();
  });
});

describe('CallTypesCard adding', () => {
  beforeEach(() => {
    onSave.mockReset();
    onSave.mockResolvedValue(undefined);
  });

  it('derives a slug from the name', async () => {
    const user = userEvent.setup();
    renderCard();

    await user.type(screen.getByLabelText('Add a call type'), 'Water Rescue');
    await user.click(screen.getByRole('button', { name: 'Add' }));

    expect(screen.getByText('water_rescue')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Save call types' }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(savedTypes()).toContainEqual({ slug: 'water_rescue', label: 'Water Rescue', active: true });
  });

  it('suffixes a slug that is already taken rather than colliding', async () => {
    const user = userEvent.setup();
    renderCard();

    // Duplicate slugs make the stored value ambiguous; the backend rejects
    // them outright, so the card must not be able to produce one.
    await user.type(screen.getByLabelText('Add a call type'), 'Fire');
    await user.click(screen.getByRole('button', { name: 'Add' }));

    expect(screen.getByText('fire_2')).toBeInTheDocument();
  });

  it('rejects a name with nothing sluggable in it', async () => {
    const user = userEvent.setup();
    renderCard();

    await user.type(screen.getByLabelText('Add a call type'), '???');
    await user.click(screen.getByRole('button', { name: 'Add' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('letters or numbers');
  });

  it('adds on Enter without submitting anything else', async () => {
    const user = userEvent.setup();
    renderCard();

    await user.type(screen.getByLabelText('Add a call type'), 'Standby{Enter}');
    expect(screen.getByText('standby')).toBeInTheDocument();
  });
});

describe('CallTypesCard ordering', () => {
  beforeEach(() => {
    onSave.mockReset();
    onSave.mockResolvedValue(undefined);
  });

  it('moves a type and saves the new order', async () => {
    const user = userEvent.setup();
    renderCard();

    await user.click(screen.getByRole('button', { name: 'Move EMS up' }));
    await user.click(screen.getByRole('button', { name: 'Save call types' }));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(savedTypes().map((t) => t.slug)).toEqual(['ems', 'fire', 'brush']);
  });

  it('cannot move the ends off the list', () => {
    renderCard();
    expect(screen.getByRole('button', { name: 'Move Fire up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move Brush down' })).toBeDisabled();
  });
});

describe('CallTypesCard draft survival', () => {
  beforeEach(() => {
    onSave.mockReset();
    onSave.mockResolvedValue(undefined);
  });

  it('keeps an in-progress edit when an unrelated save re-renders it', async () => {
    const user = userEvent.setup();
    // Every toggle in the settings panel saves the whole settings object and
    // hands back a fresh array. Re-seeding on identity would wipe half-typed
    // edits the moment somebody flipped an unrelated switch.
    const { rerender } = renderCard();

    await user.clear(screen.getByLabelText('Name for ems'));
    await user.type(screen.getByLabelText('Name for ems'), 'Medical');

    rerender(
      <CallTypesCard
        types={TYPES.map((t) => ({ ...t }))}
        usage={{ fire: 12 }}
        mode="count_only"
        saving={false}
        onSave={onSave}
      />
    );

    expect(screen.getByDisplayValue('Medical')).toBeInTheDocument();
  });

  it('takes up a genuinely changed server list', async () => {
    const { rerender } = renderCard();

    rerender(
      <CallTypesCard
        types={[{ slug: 'fire', label: 'Structure Fire', active: true }]}
        usage={{ fire: 12 }}
        mode="count_only"
        saving={false}
        onSave={onSave}
      />
    );

    expect(await screen.findByDisplayValue('Structure Fire')).toBeInTheDocument();
    expect(screen.queryByLabelText('Name for ems')).not.toBeInTheDocument();
  });
});

describe('CallTypesCard while saving', () => {
  beforeEach(() => {
    onSave.mockReset();
    onSave.mockResolvedValue(undefined);
  });

  it('blocks a second save while one is in flight', async () => {
    const user = userEvent.setup();
    const { rerender } = renderCard();
    await user.type(screen.getByLabelText('Name for fire'), 's');

    rerender(
      <CallTypesCard
        types={TYPES.map((t) => ({ ...t }))}
        usage={{ fire: 12 }}
        mode="count_only"
        saving
        onSave={onSave}
      />
    );

    const save = screen.getByRole('button', { name: /Saving/ });
    expect(save).toBeDisabled();
    expect(within(save).queryByText('Save call types')).not.toBeInTheDocument();
  });
});
