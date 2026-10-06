/**
 * The help popover flips below its trigger when it would open under the top
 * bar, and the elections topic links to its wiki page (W50-61).
 *
 * `/elections` renders the "?" in the page header; a popover positioned
 * above it landed behind the fixed mobile top bar, and its "View full
 * documentation" link went to the wiki root because no `elections` topic
 * was registered.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { HelpLink } from './HelpLink';

const rectAt = (top: number): DOMRect => ({
  top,
  bottom: top + 120,
  left: 0,
  right: 200,
  width: 200,
  height: 120,
  x: 0,
  y: top,
  toJSON: () => ({}),
});

// The popover panel is a plain positioned div around the text; the flip is a
// class on that div, which no role or label reaches.
const panelAround = (text: string) =>
  // eslint-disable-next-line testing-library/no-node-access -- see above
  screen.getByText(text).closest('.absolute');

describe('HelpLink popover placement and topic URL (W50-61)', () => {
  const originalRect = HTMLElement.prototype.getBoundingClientRect;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    HTMLElement.prototype.getBoundingClientRect = originalRect;
  });

  it('flips below the trigger when the popover would open under the top bar', async () => {
    HTMLElement.prototype.getBoundingClientRect = () => rectAt(12);
    render(<HelpLink topic="elections" tooltip="Create and manage department elections." />);

    await userEvent.click(screen.getByRole('button', { name: 'Help: elections' }));

    const panel = panelAround('Create and manage department elections.');
    expect(panel).toHaveClass('top-full');
    expect(panel).not.toHaveClass('bottom-full');
  });

  it('stays above the trigger when there is room', async () => {
    HTMLElement.prototype.getBoundingClientRect = () => rectAt(300);
    render(<HelpLink topic="elections" tooltip="Create and manage department elections." />);

    await userEvent.click(screen.getByRole('button', { name: 'Help: elections' }));

    const panel = panelAround('Create and manage department elections.');
    expect(panel).toHaveClass('bottom-full');
  });

  it('links the elections topic to its wiki page rather than the wiki root', async () => {
    HTMLElement.prototype.getBoundingClientRect = () => rectAt(300);
    render(<HelpLink topic="elections" tooltip="Create and manage department elections." />);

    await userEvent.click(screen.getByRole('button', { name: 'Help: elections' }));

    expect(screen.getByRole('link', { name: /View full documentation/ })).toHaveAttribute(
      'href',
      'https://github.com/thegspiro/the-logbook/wiki/Module-Elections'
    );
  });
});

// The on-screen re-drive found the popover ~100px wide, a word or two a line:
// the absolute panel sizes to its icon-wide containing block unless told to
// take its content width, which the card's max-w-xs then bounds.
describe('HelpLink popover width', () => {
  it('sizes the panel to its content rather than the icon', async () => {
    HTMLElement.prototype.getBoundingClientRect = () => rectAt(300);
    render(<HelpLink topic="elections" tooltip="Create and manage department elections." />);

    await userEvent.click(screen.getByRole('button', { name: 'Help: elections' }));

    expect(panelAround('Create and manage department elections.')).toHaveClass('w-max');
  });
});
