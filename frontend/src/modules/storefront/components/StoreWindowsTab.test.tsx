/**
 * Opening a window does not put the store online: ordering also needs "Store
 * is live for members". The Open ordering dialog promised "Members can place
 * orders as soon as you open it" either way, and with the store off they were
 * told it was closed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { StoreOrderWindow } from '../types';

const mockGetWindows = vi.fn();
const mockGetProducts = vi.fn();

vi.mock('../services/api', () => ({
  storefrontService: {
    getWindows: (...args: unknown[]) => mockGetWindows(...args) as unknown,
    getProducts: (...args: unknown[]) => mockGetProducts(...args) as unknown,
  },
}));
vi.mock('../../../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));
vi.mock('react-hot-toast', () => ({ default: { error: vi.fn(), success: vi.fn() } }));

import { StoreWindowsTab } from './StoreWindowsTab';

const scheduled = {
  id: 'window-1',
  organizationId: 'org-1',
  name: 'Fall shirt order',
  status: 'scheduled',
  opensAt: '2026-10-16T08:00:00Z',
  closesAt: '2026-10-30T20:00:00Z',
  autoOpen: false,
  autoClose: false,
  includeAllProducts: true,
  notifyOnOpen: false,
  orderCount: 0,
  totalSales: '0',
  outstandingBalance: '0',
  offerings: [],
} as unknown as StoreOrderWindow;

const openTheDialog = async (props: { storeIsLive?: boolean; onOpenSettings?: () => void }) => {
  const user = userEvent.setup();
  render(<StoreWindowsTab onChanged={vi.fn()} {...props} />);
  await user.click(await screen.findByRole('button', { name: /Open ordering/ }));
  return { user, dialog: screen.getByRole('dialog', { name: 'Open ordering' }) };
};

describe('StoreWindowsTab — opening a window', () => {
  beforeEach(() => {
    mockGetWindows.mockReset();
    mockGetWindows.mockResolvedValue([scheduled]);
    mockGetProducts.mockReset();
    mockGetProducts.mockResolvedValue([]);
  });

  it('warns that members cannot order while the store is switched off', async () => {
    const onOpenSettings = vi.fn();
    const { user, dialog } = await openTheDialog({ storeIsLive: false, onOpenSettings });

    expect(within(dialog).getByText(/members can.t order until the store is switched on/)).toBeInTheDocument();
    expect(within(dialog).queryByText('Members can place orders as soon as you open it.')).not.toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Turn it on in Settings' }));
    expect(onOpenSettings).toHaveBeenCalledTimes(1);
  });

  it('keeps the plain promise when the store is live', async () => {
    const { dialog } = await openTheDialog({ storeIsLive: true });

    expect(within(dialog).getByText('Members can place orders as soon as you open it.')).toBeInTheDocument();
  });

  it('does not warn before it knows the store is off', async () => {
    const { dialog } = await openTheDialog({});

    expect(within(dialog).queryByText(/switched on/)).not.toBeInTheDocument();
  });
});
