import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import TagChip from './TagChip';
import { ChevronUp, X } from 'lucide-react';

/**
 * The chip's phone layout hides its actions until the chip is pressed, which is
 * what keeps four 44px targets out of one small pill. The mobile ratchet can
 * only tell you that nothing under 44px is on screen — a chip whose actions had
 * stopped rendering altogether would satisfy it just as well. These pin the
 * behaviour the ratchet cannot see: the actions exist, they are reachable, and
 * they still do what they say.
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

const renderChip = (onRemove = vi.fn(), onMoveUp = vi.fn()) => {
  render(
    <TagChip
      item="Structure Fire"
      actions={[
        { icon: ChevronUp, onClick: onMoveUp, label: 'Move Structure Fire up' },
        { icon: X, onClick: onRemove, label: 'Remove Structure Fire' },
      ]}
    />
  );
  return { onRemove, onMoveUp };
};

describe('TagChip on a phone', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', { writable: true, value: matchMedia(true) });
  });

  it('keeps the actions off the chip until it is pressed', async () => {
    const user = userEvent.setup();
    const { onRemove } = renderChip();

    expect(screen.queryByRole('button', { name: 'Remove Structure Fire' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Actions for Structure Fire' }));

    await user.click(screen.getByRole('button', { name: 'Remove Structure Fire' }));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('reports whether it is open, so the trigger is not a button that says nothing', async () => {
    const user = userEvent.setup();
    renderChip();
    const trigger = screen.getByRole('button', { name: 'Actions for Structure Fire' });

    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await user.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
  });

  it('closes after an action, so the next chip starts from the same place', async () => {
    const user = userEvent.setup();
    const { onMoveUp } = renderChip();

    await user.click(screen.getByRole('button', { name: 'Actions for Structure Fire' }));
    await user.click(screen.getByRole('button', { name: 'Move Structure Fire up' }));

    expect(onMoveUp).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: 'Move Structure Fire up' })).not.toBeInTheDocument();
  });
});

describe('TagChip on a pointer', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'matchMedia', { writable: true, value: matchMedia(false) });
  });

  // Desktop keeps the icons inline, and there is no reveal step to get wrong.
  it('shows the actions without a reveal step', async () => {
    const user = userEvent.setup();
    const { onRemove } = renderChip();

    expect(screen.queryByRole('button', { name: 'Actions for Structure Fire' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Remove Structure Fire' }));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });
});
