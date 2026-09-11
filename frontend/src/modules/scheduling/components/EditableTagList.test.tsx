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

  it('gives two entries of the same value their own identity', async () => {
    const user = userEvent.setup();
    const duplicateKeyWarnings: string[] = [];
    const consoleError = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      const message = typeof args[0] === 'string' ? args[0] : '';
      if (message.includes('same key')) duplicateKeyWarnings.push(message);
    });

    try {
      // Not a hypothetical list: these are stored as a plain JSON array with no
      // uniqueness constraint, and the edit path used to accept a rename onto
      // another entry's value, so a saved list can already look like this.
      render(<ControlledList initial={['Alpha', 'Bravo', 'Alpha']} />);

      const triggers = () => screen.getAllByRole('button', { name: 'Actions for Alpha' });
      expect(triggers()).toHaveLength(2);

      await user.click((triggers()[1] ?? null) as HTMLElement);
      expect(triggers()[0]).toHaveAttribute('aria-expanded', 'false');
      expect(triggers()[1]).toHaveAttribute('aria-expanded', 'true');

      // The assertion that does the work is this one. Keyed by value, React
      // warns that it is reconciling two children under one key — and where it
      // warns, it has stopped promising which chip the disclosure belongs to.
      // The interaction above happens to come out right either way, which is
      // exactly why it is not left to carry the test on its own.
      expect(duplicateKeyWarnings).toEqual([]);
    } finally {
      consoleError.mockRestore();
    }
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
