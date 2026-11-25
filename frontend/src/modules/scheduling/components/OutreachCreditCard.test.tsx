import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../test/utils';

const mockPreview = vi.fn();
const mockRun = vi.fn();

vi.mock('../services/api', () => ({
  schedulingService: {
    previewOutreachCredit: (...args: unknown[]) => mockPreview(...args) as unknown,
    runOutreachCredit: (...args: unknown[]) => mockRun(...args) as unknown,
  },
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

import { OutreachCreditCard } from './OutreachCreditCard';

const preview = {
  applied: false,
  sheets: 3,
  sheets_waiting_for_event: 1,
  sheets_awaiting_finalize: 1,
  volunteers: 4,
  attendance_updated: 4,
  entries_credited: 2,
  hours: 7.5,
};

describe('OutreachCreditCard', () => {
  beforeEach(() => {
    mockPreview.mockReset();
    mockPreview.mockResolvedValue(preview);
    mockRun.mockReset();
    mockRun.mockResolvedValue({ ...preview, applied: true });
  });

  it('asks the server for nothing until the officer checks', () => {
    renderWithRouter(<OutreachCreditCard />);

    expect(mockPreview).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Credit the hours' })).not.toBeInTheDocument();
  });

  it('shows what there is to credit, and what cannot be credited yet', async () => {
    const user = userEvent.setup();
    renderWithRouter(<OutreachCreditCard />);

    await user.click(screen.getByRole('button', { name: 'Check past outreach sheets' }));

    // One of the three sheets has no event, so two can be credited.
    expect(await screen.findByText(/To credit: 4 volunteers on 2 sheets/)).toBeInTheDocument();
    expect(screen.getByText(/1 sheet for an event that is still open/)).toBeInTheDocument();
    expect(screen.getByText(/1 sheet with no event yet/)).toBeInTheDocument();
  });

  it('credits only after the officer confirms', async () => {
    const user = userEvent.setup();
    renderWithRouter(<OutreachCreditCard />);
    await user.click(screen.getByRole('button', { name: 'Check past outreach sheets' }));
    await user.click(await screen.findByRole('button', { name: 'Credit the hours' }));

    expect(mockRun).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('Credit past outreach sheets?');

    await user.click(screen.getByRole('button', { name: 'Not now' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(mockRun).not.toHaveBeenCalled();
  });

  it('reports what a run credited and stops offering it', async () => {
    const user = userEvent.setup();
    renderWithRouter(<OutreachCreditCard />);
    await user.click(screen.getByRole('button', { name: 'Check past outreach sheets' }));
    await user.click(await screen.findByRole('button', { name: 'Credit the hours' }));
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'Credit the hours' }));

    await waitFor(() => expect(mockRun).toHaveBeenCalledTimes(1));
    expect(await screen.findByText(/Credited: 4 volunteers on 2 sheets/)).toBeInTheDocument();
    expect(screen.getByText(/2 Admin Hours entries written\s+or corrected/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Credit the hours' })).not.toBeInTheDocument();
  });

  it('says so when no sheet has recorded time', async () => {
    mockPreview.mockResolvedValue({ ...preview, sheets: 0, sheets_waiting_for_event: 0, volunteers: 0, hours: 0 });
    const user = userEvent.setup();
    renderWithRouter(<OutreachCreditCard />);

    await user.click(screen.getByRole('button', { name: 'Check past outreach sheets' }));

    expect(await screen.findByText('No outreach sheet has recorded time.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Credit the hours' })).not.toBeInTheDocument();
  });
});
