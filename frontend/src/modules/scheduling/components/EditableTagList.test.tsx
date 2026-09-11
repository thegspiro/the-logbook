import { useState } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import EditableTagList from './EditableTagList';

/**
 * These drive the real EditableTagList, and that is the point of them.
 *
 * The first version of this regression test rendered a local fixture that
 * hard-coded the fixed key itself, so it passed whatever EditableTagList did —
 * a test that states a guarantee it cannot check. Every assertion below has
 * been confirmed to fail against the implementation it describes.
 */
const matchMedia = (matches: boolean) =>
  vi.fn().mockImplementation((query: string) => ({
    matches,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));

const originalMatchMedia = window.matchMedia;
afterEach(() => {
  Object.defineProperty(window, 'matchMedia', { writable: true, value: originalMatchMedia });
});

/** The list is controlled, so the test has to own the state the page owns. */
const ControlledList = ({ initial }: { initial: string[] }) => {
  const [items, setItems] = useState(initial);
  return <EditableTagList items={items} onItemsChange={setItems} />;
};

describe('EditableTagList disclosure state', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', { writable: true, value: matchMedia(true) });
  });

  it('keeps the open row on the chip it was opened on when an earlier chip goes', async () => {
    const user = userEvent.setup();
    render(<ControlledList initial={['Alpha', 'Bravo', 'Charlie']} />);

    // Open Bravo, then remove Alpha from in front of it.
    await user.click(screen.getByRole('button', { name: 'Actions for Bravo' }));
    await user.click(screen.getByRole('button', { name: 'Actions for Alpha' }));
    await user.click(screen.getByRole('button', { name: 'Remove Alpha' }));

    // Bravo is still the open one, and Charlie — which has taken Bravo's old
    // index — has not inherited its disclosure. With an index key it does.
    expect(screen.getByRole('button', { name: 'Actions for Bravo' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('button', { name: 'Actions for Charlie' })).toHaveAttribute('aria-expanded', 'false');
  });

  /**
   * Not a hypothetical list: these are stored as a plain JSON array with no
   * uniqueness constraint, and the edit path used to accept a rename onto
   * another entry's value, so a saved list can already look like this.
   */
  it('removes one copy of a repeated value and renders what is left', async () => {
    const user = userEvent.setup();
    render(<ControlledList initial={['Alpha', 'Bravo', 'Alpha']} />);

    const alphas = () => screen.getAllByRole('button', { name: 'Actions for Alpha' });
    expect(alphas()).toHaveLength(2);

    await user.click((alphas()[1] ?? null) as HTMLElement);
    await user.click((alphas()[0] ?? null) as HTMLElement);
    await user.click((screen.getAllByRole('button', { name: 'Remove Alpha' })[0] ?? null) as HTMLElement);

    // One Alpha left, and Bravo untouched. Keyed by value alone React has two
    // children under one key: it leaves *both* Alphas on screen, so the list
    // shows an entry the data no longer holds.
    expect(alphas()).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Actions for Bravo' })).toBeInTheDocument();
  });

  it('closes the survivor of a repeated value rather than moving its row somewhere else', async () => {
    const user = userEvent.setup();
    render(<ControlledList initial={['Alpha', 'Bravo', 'Alpha']} />);

    const alphas = () => screen.getAllByRole('button', { name: 'Actions for Alpha' });
    await user.click((alphas()[1] ?? null) as HTMLElement);
    await user.click((alphas()[0] ?? null) as HTMLElement);
    await user.click((screen.getAllByRole('button', { name: 'Remove Alpha' })[0] ?? null) as HTMLElement);

    // Pinned because it is the ceiling, not because it is desirable: a string[]
    // says nothing about which of two identical entries was removed, so the
    // survivor is remounted and its open row closes. See tagChipKeys. If this
    // ever needs to survive, the fix is identity in the data, not a cleverer
    // key — and this assertion is where that change will announce itself.
    expect(alphas()[0]).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('EditableTagList editing', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', { writable: true, value: matchMedia(false) });
  });

  it('refuses a rename onto another entry, the way adding a duplicate is refused', async () => {
    const user = userEvent.setup();
    render(<ControlledList initial={['Alpha', 'Bravo']} />);

    await user.click(screen.getByRole('button', { name: 'Edit Alpha' }));
    const input = screen.getByDisplayValue('Alpha');
    await user.clear(input);
    await user.type(input, 'Bravo{Enter}');

    // The editor closes and the entry keeps what it had, which is what an empty
    // rename has always done. Accepting it is how a list ends up holding one
    // value twice in the first place.
    expect(screen.getByRole('button', { name: 'Edit Alpha' })).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Edit Bravo' })).toHaveLength(1);
  });

  it('still accepts a rename to a value the list does not already hold', async () => {
    const user = userEvent.setup();
    render(<ControlledList initial={['Alpha', 'Bravo']} />);

    await user.click(screen.getByRole('button', { name: 'Edit Alpha' }));
    const input = screen.getByDisplayValue('Alpha');
    await user.clear(input);
    await user.type(input, 'Charlie{Enter}');

    expect(screen.getByRole('button', { name: 'Edit Charlie' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Edit Alpha' })).not.toBeInTheDocument();
  });
});
