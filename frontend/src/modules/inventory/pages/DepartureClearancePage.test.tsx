import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Routes, Route } from 'react-router';
import type { DepartureClearance } from '../types/clearance';

const mockGetClearance = vi.fn();
const mockResolve = vi.fn();
const mockComplete = vi.fn();

vi.mock('../../../services/api', () => ({
  inventoryService: {
    getDepartureClearance: (...a: unknown[]) => mockGetClearance(...a) as unknown,
    resolveClearanceItem: (...a: unknown[]) => mockResolve(...a) as unknown,
    completeClearance: (...a: unknown[]) => mockComplete(...a) as unknown,
  },
}));
vi.mock('../../../hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import { ConfirmProvider } from '../../../contexts/ConfirmContext';
import DepartureClearancePage from './DepartureClearancePage';

const line = (overrides: Partial<DepartureClearance['line_items'][number]> = {}) => ({
  id: 'line-1',
  clearance_id: 'clr-1',
  source_type: 'assignment' as const,
  source_id: 'asg-1',
  item_id: 'item-1',
  item_name: 'Turnout coat',
  item_serial_number: 'SN-44',
  item_value: 1800,
  quantity: 1,
  disposition: 'pending' as const,
  created_at: '2026-10-01T12:00:00Z',
  ...overrides,
});

const clearance = (overrides: Partial<DepartureClearance> = {}): DepartureClearance => ({
  id: 'clr-1',
  organization_id: 'org-1',
  user_id: 'u-1',
  member_name: 'Dana Reyes',
  status: 'initiated',
  total_items: 2,
  items_cleared: 0,
  items_outstanding: 2,
  total_value: 1830,
  value_outstanding: 1830,
  initiated_at: '2026-10-01T12:00:00Z',
  return_deadline: '2026-10-15T12:00:00Z',
  line_items: [
    line(),
    line({ id: 'line-2', source_type: 'issuance', item_name: 'Gloves', item_serial_number: null, item_value: 30 }),
  ],
  ...overrides,
});

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/inventory/admin/clearances/clr-1']}>
      <ConfirmProvider>
        <Routes>
          <Route path="/inventory/admin/clearances/:clearanceId" element={<DepartureClearancePage />} />
        </Routes>
      </ConfirmProvider>
    </MemoryRouter>
  );

describe('DepartureClearancePage', () => {
  beforeEach(() => {
    mockGetClearance.mockReset();
    mockResolve.mockReset();
    mockComplete.mockReset();
    mockGetClearance.mockResolvedValue(clearance());
    mockResolve.mockResolvedValue(line({ disposition: 'returned' }));
    mockComplete.mockResolvedValue(clearance({ status: 'completed' }));
  });

  it('shows the member, totals and every line with its disposition', async () => {
    renderPage();

    expect(await screen.findByRole('heading', { name: 'Departure clearance — Dana Reyes' })).toBeInTheDocument();
    expect(mockGetClearance).toHaveBeenCalledWith('clr-1');
    expect(screen.getByText('Turnout coat')).toBeInTheDocument();
    expect(screen.getByText('Issuance')).toBeInTheDocument();
    expect(screen.getAllByText('Outstanding').length).toBeGreaterThan(1);
    expect(screen.getByRole('button', { name: 'Resolve Turnout coat' })).toBeInTheDocument();
  });

  it('resolves a line as returned with its condition and re-reads the record', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Resolve Turnout coat' }));
    const dialog = screen.getByRole('dialog');
    await user.selectOptions(within(dialog).getByLabelText('Condition'), 'fair');
    await user.type(within(dialog).getByLabelText('Notes'), 'Collar worn');
    await user.click(within(dialog).getByRole('button', { name: 'Resolve' }));

    await waitFor(() =>
      expect(mockResolve).toHaveBeenCalledWith('clr-1', 'line-1', {
        disposition: 'returned',
        return_condition: 'fair',
        resolution_notes: 'Collar worn',
      })
    );
    await waitFor(() => expect(mockGetClearance).toHaveBeenCalledTimes(2));
  });

  it('sends no condition for a write-off', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Resolve Gloves' }));
    const dialog = screen.getByRole('dialog');
    await user.click(within(dialog).getByRole('radio', { name: 'Written off' }));
    expect(within(dialog).queryByLabelText('Condition')).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole('button', { name: 'Resolve' }));

    await waitFor(() =>
      expect(mockResolve).toHaveBeenCalledWith('clr-1', 'line-2', {
        disposition: 'written_off',
        return_condition: undefined,
        resolution_notes: undefined,
      })
    );
  });

  it('closes incomplete only after confirming what stays unresolved', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(await screen.findByRole('button', { name: 'Close incomplete' }));
    expect(await screen.findByText(/2 items \(\$1,830\.00\) will stay unresolved/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Keep it open' }));
    expect(mockComplete).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Close incomplete' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Close incomplete' }));

    await waitFor(() => expect(mockComplete).toHaveBeenCalledWith('clr-1', { force_close: true, notes: undefined }));
  });

  it('completes a fully resolved clearance', async () => {
    mockGetClearance.mockResolvedValue(
      clearance({
        items_cleared: 1,
        items_outstanding: 0,
        value_outstanding: 0,
        line_items: [line({ disposition: 'returned', resolved_at: '2026-10-02T12:00:00Z' })],
      })
    );
    const user = userEvent.setup();
    renderPage();

    await user.type(await screen.findByLabelText('Closing notes'), 'All gear back');
    await user.click(screen.getByRole('button', { name: 'Complete clearance' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Complete clearance' }));

    await waitFor(() =>
      expect(mockComplete).toHaveBeenCalledWith('clr-1', { force_close: false, notes: 'All gear back' })
    );
    expect(screen.queryByRole('button', { name: /Resolve/ })).not.toBeInTheDocument();
  });

  it('offers no actions on a closed clearance', async () => {
    mockGetClearance.mockResolvedValue(
      clearance({ status: 'closed_incomplete', completed_at: '2026-10-05T12:00:00Z' })
    );
    renderPage();

    expect(await screen.findByText(/This record is closed/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Resolve/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Close incomplete' })).not.toBeInTheDocument();
  });
});
