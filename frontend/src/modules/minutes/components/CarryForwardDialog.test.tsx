import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockOpen = vi.fn();
const mockCarry = vi.fn();
const toastSuccess = vi.fn();
const toastError = vi.fn();

vi.mock('../services/api', () => ({
  minutesService: {
    getOpenActionItems: (...a: unknown[]) => mockOpen(...a) as unknown,
    carryForward: (...a: unknown[]) => mockCarry(...a) as unknown,
  },
}));

vi.mock('react-hot-toast', () => ({
  default: {
    success: (...a: unknown[]) => toastSuccess(...a) as unknown,
    error: (...a: unknown[]) => toastError(...a) as unknown,
  },
}));

vi.mock('../../../hooks/useTimezone', () => ({ useTimezone: () => 'America/Chicago' }));

import { CarryForwardDialog } from './CarryForwardDialog';
import { renderWithRouter } from '../../../test/utils';

const items = [
  {
    id: 'i1',
    minutes_id: 'm0',
    minutes_title: 'September business meeting',
    meeting_date: '2026-09-01T23:00:00Z',
    description: 'Order hose',
    assignee_name: 'Alex Adams',
    due_date: '2026-11-01T00:00:00Z',
    priority: 'high',
    status: 'pending',
  },
  {
    id: 'i2',
    minutes_id: 'm0',
    minutes_title: 'September business meeting',
    meeting_date: '2026-09-01T23:00:00Z',
    description: 'Paint the bay',
    priority: 'low',
    status: 'in_progress',
  },
];

describe('CarryForwardDialog', () => {
  const onClose = vi.fn();
  const onCarried = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockOpen.mockReset();
    mockCarry.mockReset();
    onClose.mockReset();
    onCarried.mockReset();
    mockOpen.mockResolvedValue(items);
    mockCarry.mockResolvedValue([]);
    onCarried.mockResolvedValue(undefined);
  });

  const open = () =>
    renderWithRouter(<CarryForwardDialog isOpen minutesId="m1" onClose={onClose} onCarried={onCarried} />);

  it('lists open items with who, when due and where they came from', async () => {
    open();

    expect(await screen.findByText('Order hose')).toBeInTheDocument();
    expect(screen.getByText(/Alex Adams · due Nov 1, 2026 · from September business meeting/)).toBeInTheDocument();
    expect(screen.getByText(/Unassigned · from September business meeting/)).toBeInTheDocument();
    expect(mockOpen).toHaveBeenCalledWith('m1', false);
  });

  it('cannot submit until something is picked, then carries exactly the picked items', async () => {
    const user = userEvent.setup();
    open();

    const submit = await screen.findByRole('button', { name: 'Carry forward' });
    expect(submit).toBeDisabled();
    await user.click(screen.getByRole('checkbox', { name: /Paint the bay/ }));
    await user.click(screen.getByRole('button', { name: 'Carry forward (1)' }));

    expect(mockCarry).toHaveBeenCalledWith('m1', ['i2'], false);
    expect(toastSuccess).toHaveBeenCalledWith('Carried 1 action item forward');
    expect(onCarried).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('asks again, with the wider scope, when other kinds of meeting are included', async () => {
    const user = userEvent.setup();
    open();

    await screen.findByText('Order hose');
    await user.click(screen.getByRole('checkbox', { name: 'Include items from other kinds of meetings' }));

    await waitFor(() => expect(mockOpen).toHaveBeenLastCalledWith('m1', true));
  });

  it('keeps the dialog open and reports the error when the server refuses', async () => {
    mockCarry.mockRejectedValue(new Error('One or more of those action items cannot be carried forward'));
    const user = userEvent.setup();
    open();

    await user.click(await screen.findByRole('checkbox', { name: /Order hose/ }));
    await user.click(screen.getByRole('button', { name: 'Carry forward (1)' }));

    expect(toastError).toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(onCarried).not.toHaveBeenCalled();
  });

  it('says so when nothing is open', async () => {
    mockOpen.mockResolvedValue([]);
    open();
    expect(await screen.findByText('There are no open action items from earlier meetings.')).toBeInTheDocument();
  });

  it('shows a load failure instead of an empty list', async () => {
    mockOpen.mockRejectedValue(new Error('boom'));
    open();
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('does not fetch while closed', () => {
    renderWithRouter(<CarryForwardDialog isOpen={false} minutesId="m1" onClose={onClose} onCarried={onCarried} />);
    expect(mockOpen).not.toHaveBeenCalled();
  });
});
