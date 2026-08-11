/**
 * Wiring an existing checklist to the catalog in one reviewed pass.
 *
 * The safety property under test is what is *not* pre-selected: a close match
 * that a person has to arbitrate must never be applied on their behalf.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../test/utils';

const mockGetInventoryMatches = vi.fn();
const mockLinkInventoryItems = vi.fn();

vi.mock('@/modules/scheduling', () => ({
  schedulingService: {
    getInventoryMatches: (...a: unknown[]) => mockGetInventoryMatches(...a) as unknown,
    linkInventoryItems: (...a: unknown[]) => mockLinkInventoryItems(...a) as unknown,
  },
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

import InventoryMatchModal from './InventoryMatchModal';

const match = (over: Record<string, unknown> = {}) => ({
  templateItemId: 'ti-1',
  itemName: '4x4 Gauze',
  checkType: 'quantity',
  suggestions: [{ id: 'inv-1', name: '4x4 Gauze', score: 1, confidence: 'exact' }],
  ...over,
});

describe('InventoryMatchModal', () => {
  const onClose = vi.fn();
  const onLinked = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetInventoryMatches.mockResolvedValue({
      coverage: { linkable: 10, linked: 3, unlinked: 7 },
      matches: [match()],
    });
    mockLinkInventoryItems.mockResolvedValue({
      linked: 1,
      coverage: { linkable: 10, linked: 4, unlinked: 6 },
    });
  });

  const open = () =>
    renderWithRouter(<InventoryMatchModal templateId="tmpl-1" isOpen onClose={onClose} onLinked={onLinked} />);

  it('says how much of the checklist is tracked at all', async () => {
    open();

    expect(await screen.findByText(/3 of 10 items are linked to inventory/)).toBeInTheDocument();
  });

  it('pre-selects an exact name match', async () => {
    open();

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Link 1 item/ })).toBeEnabled();
    });
  });

  it('leaves a close match for the reviewer to decide', async () => {
    mockGetInventoryMatches.mockResolvedValue({
      coverage: { linkable: 2, linked: 0, unlinked: 2 },
      matches: [
        match({
          templateItemId: 'ti-2',
          itemName: 'Oxygen Mask',
          suggestions: [
            { id: 'inv-a', name: 'Oxygen Mask Adult', score: 0.75, confidence: 'strong' },
            { id: 'inv-p', name: 'Oxygen Mask Pediatric', score: 0.75, confidence: 'strong' },
          ],
        }),
      ],
    });
    open();

    // Both score the same and only one is right; picking either on the
    // reviewer's behalf would put the wrong expiry on a truck.
    await screen.findByText('Oxygen Mask Adult');
    expect(screen.getByRole('button', { name: /Link 0 items/ })).toBeDisabled();
  });

  it('writes only the links the reviewer selected', async () => {
    const user = userEvent.setup();
    open();

    await user.click(await screen.findByRole('button', { name: /Link 1 item/ }));

    await waitFor(() => {
      expect(mockLinkInventoryItems).toHaveBeenCalledWith('tmpl-1', { 'ti-1': 'inv-1' });
    });
    expect(onLinked).toHaveBeenCalledWith({ linkable: 10, linked: 4, unlinked: 6 });
  });

  it('lets a pre-selected match be unselected', async () => {
    const user = userEvent.setup();
    open();
    const suggestion = await screen.findByRole('button', { name: /4x4 Gauze/ });

    await user.click(suggestion);

    expect(screen.getByRole('button', { name: /Link 0 items/ })).toBeDisabled();
  });

  it('names the items nothing in inventory resembles', async () => {
    mockGetInventoryMatches.mockResolvedValue({
      coverage: { linkable: 1, linked: 0, unlinked: 1 },
      matches: [match({ itemName: 'Halligan Bar', suggestions: [] })],
    });
    open();

    expect(await screen.findByText(/1 item has nothing like them in inventory/)).toBeInTheDocument();
    expect(screen.getByText('Halligan Bar')).toBeInTheDocument();
  });

  it('says so plainly when there is nothing left to link', async () => {
    mockGetInventoryMatches.mockResolvedValue({
      coverage: { linkable: 4, linked: 4, unlinked: 0 },
      matches: [],
    });
    open();

    expect(await screen.findByText(/Everything is already linked/)).toBeInTheDocument();
  });

  it('does not fetch matches while it is closed', () => {
    renderWithRouter(<InventoryMatchModal templateId="tmpl-1" isOpen={false} onClose={onClose} onLinked={onLinked} />);

    expect(mockGetInventoryMatches).not.toHaveBeenCalled();
  });
});
