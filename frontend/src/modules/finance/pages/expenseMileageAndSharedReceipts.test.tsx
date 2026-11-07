/**
 * The owner's 2026-11-01 receipt decisions on the expense screens.
 *
 * - A mileage line records its trips instead of an amount and an uploaded log:
 *   the dialog previews the server's price and sends the trips, not a figure.
 *   With no rate set, the dialog says so and keeps the ordinary amount field.
 * - One receipt across several lines: a line offers the receipts already on
 *   the report's other lines, says which lines share one, and on a draft takes
 *   it off one line alone.
 * - The department's mileage rate is set beside the expense deadline.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ExpenseLineItem } from '../types';

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));
vi.mock('@/utils/dateFormatting', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/dateFormatting')>()),
  getTodayLocalDate: () => '2026-10-20',
}));
vi.mock('@/stores/authStore', () => ({
  useAuthStore: (selector: (s: { checkPermission: (p: string) => boolean }) => unknown) =>
    selector({ checkPermission: (p) => p === 'settings.manage' }),
}));
vi.mock('../hooks/useFundOptions', () => ({ useFundOptions: () => ({ funds: [], mode: 'warn' }) }));
vi.mock('../hooks/useLateLineWarning', () => ({ useLateLineWarning: () => () => null }));
vi.mock('../hooks/useRequestFormOptions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../hooks/useRequestFormOptions')>()),
  useRequestFormOptions: () => ({ fiscalYears: [], budgetOptions: [], fiscalYearsLoaded: true }),
}));

const mockGetSettings = vi.fn();
const mockAddLine = vi.fn();
const mockUpdateLine = vi.fn();
vi.mock('../services/api', () => ({
  financeSettingsService: { get: (...args: unknown[]) => mockGetSettings(...args) as unknown },
  expenseReportService: {
    addLineItem: (...args: unknown[]) => mockAddLine(...args) as unknown,
    updateLineItem: (...args: unknown[]) => mockUpdateLine(...args) as unknown,
  },
}));

const mockUpdateSettings = vi.fn();
vi.mock('@/services/api', () => ({
  organizationService: { updateSettings: (...args: unknown[]) => mockUpdateSettings(...args) as unknown },
}));

import { ExpenseLineDialog } from '../components/ExpenseLineDialog';
import { SharedReceiptActions } from '../components/SharedReceiptActions';
import { MileageRateSettingsCard } from '../components/MileageRateSettingsCard';

const settings = (mileageRate: string | null) => ({
  dualApprovalThreshold: null,
  substantiationMode: 'off',
  substantiationDays: 60,
  fundOverspendMode: 'warn',
  mileageRate,
});

beforeEach(() => {
  mockGetSettings.mockReset();
  mockGetSettings.mockResolvedValue(settings('0.700'));
  mockAddLine.mockReset();
  mockAddLine.mockResolvedValue({});
  mockUpdateLine.mockReset();
  mockUpdateLine.mockResolvedValue({});
  mockUpdateSettings.mockReset();
  mockUpdateSettings.mockResolvedValue({});
});

// ============================================
// The trip log
// ============================================

const fillTrip = (index: number, trip: { date: string; from: string; to: string; purpose: string; miles: string }) => {
  const group = within(screen.getByRole('group', { name: `Trip ${String(index + 1)}` }));
  fireEvent.change(group.getByLabelText('Date *'), { target: { value: trip.date } });
  fireEvent.change(group.getByLabelText('From *'), { target: { value: trip.from } });
  fireEvent.change(group.getByLabelText('To *'), { target: { value: trip.to } });
  fireEvent.change(group.getByLabelText('Purpose *'), { target: { value: trip.purpose } });
  fireEvent.change(group.getByLabelText('Miles *'), { target: { value: trip.miles } });
};

describe('a mileage line with a trip log', () => {
  it('previews the price and sends the trips instead of an amount', async () => {
    const user = userEvent.setup();
    render(<ExpenseLineDialog reportId="er-1" fiscalYearId="fy-1" onClose={vi.fn()} onSaved={vi.fn()} />);

    await user.type(screen.getByLabelText('Description *'), 'October mileage');
    await user.selectOptions(screen.getByLabelText('Type *'), 'mileage');
    await user.click(await screen.findByRole('button', { name: 'Add a trip' }));
    fillTrip(0, { date: '2026-10-01', from: 'Station 1', to: 'Supply house', purpose: 'Couplings', miles: '12.5' });
    await user.click(screen.getByRole('button', { name: 'Add a trip' }));
    fillTrip(1, { date: '2026-10-03', from: 'Station 1', to: 'Academy', purpose: 'Class', miles: '30.2' });

    expect(screen.getByRole('status')).toHaveTextContent('42.7 miles: $29.89');
    expect(screen.queryByLabelText('Amount *')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add line' }));

    await waitFor(() => expect(mockAddLine).toHaveBeenCalled());
    expect(mockAddLine).toHaveBeenCalledWith('er-1', {
      description: 'October mileage',
      expenseType: 'mileage',
      mileageTrips: [
        {
          tripDate: '2026-10-01',
          fromLocation: 'Station 1',
          toLocation: 'Supply house',
          purpose: 'Couplings',
          miles: '12.5',
        },
        { tripDate: '2026-10-03', fromLocation: 'Station 1', toLocation: 'Academy', purpose: 'Class', miles: '30.2' },
      ],
    });
  });

  it('says what an unfinished trip is missing rather than sending it', async () => {
    const user = userEvent.setup();
    render(<ExpenseLineDialog reportId="er-1" fiscalYearId="fy-1" onClose={vi.fn()} onSaved={vi.fn()} />);

    await user.type(screen.getByLabelText('Description *'), 'Mileage');
    await user.selectOptions(screen.getByLabelText('Type *'), 'mileage');
    await user.click(await screen.findByRole('button', { name: 'Add a trip' }));
    fillTrip(0, { date: '2026-10-01', from: 'Station 1', to: 'Academy', purpose: '', miles: '5' });
    await user.click(screen.getByRole('button', { name: 'Add line' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Each trip needs its purpose');
    expect(mockAddLine).not.toHaveBeenCalled();
  });

  it('with no rate set, says so and keeps the amount', async () => {
    mockGetSettings.mockResolvedValue(settings(null));
    const user = userEvent.setup();
    render(<ExpenseLineDialog reportId="er-1" fiscalYearId="fy-1" onClose={vi.fn()} onSaved={vi.fn()} />);

    await user.selectOptions(screen.getByLabelText('Type *'), 'mileage');

    expect(await screen.findByRole('note')).toHaveTextContent('has not set a mileage rate');
    expect(screen.queryByRole('button', { name: 'Add a trip' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Amount *')).toBeInTheDocument();
  });

  it('sends the log back on an edit, and null once it is emptied', async () => {
    const user = userEvent.setup();
    const line = {
      id: 'li-1',
      expenseReportId: 'er-1',
      description: 'Mileage',
      amount: '8.75',
      dateIncurred: '2026-10-01T12:00:00Z',
      expenseType: 'mileage',
      mileageTrips: [
        { tripDate: '2026-10-01', fromLocation: 'Station 1', toLocation: 'Depot', purpose: 'Fuel', miles: '12.5' },
      ],
      mileageRate: '0.700',
      createdAt: '2026-10-01T12:00:00Z',
    } as ExpenseLineItem;
    render(<ExpenseLineDialog reportId="er-1" fiscalYearId="fy-1" line={line} onClose={vi.fn()} onSaved={vi.fn()} />);

    await user.click(await screen.findByRole('button', { name: 'Remove trip 1' }));
    fireEvent.change(screen.getByLabelText('Amount *'), { target: { value: '9' } });
    await user.click(screen.getByRole('button', { name: 'Save line' }));

    await waitFor(() => expect(mockUpdateLine).toHaveBeenCalled());
    expect(mockUpdateLine.mock.calls[0]?.[2]).toMatchObject({ mileageTrips: null, amount: '9.00' });
  });
});

// ============================================
// One receipt across several lines
// ============================================

const lineOf = (id: string, description: string, receiptDocumentId: string | null) =>
  ({
    id,
    expenseReportId: 'er-1',
    description,
    amount: '10.00',
    dateIncurred: '2026-10-01T12:00:00Z',
    expenseType: 'general',
    receiptDocumentId,
    createdAt: '2026-10-01T12:00:00Z',
  }) as ExpenseLineItem;

describe('sharing a receipt between lines', () => {
  const lines = [
    lineOf('li-room', 'Room', 'doc-folio'),
    lineOf('li-parking', 'Parking', 'doc-folio'),
    lineOf('li-meals', 'Meals', 'doc-meals'),
    lineOf('li-fuel', 'Fuel', null),
  ];

  it('offers each receipt on the report once and uses the one chosen', async () => {
    const user = userEvent.setup();
    const onShare = vi.fn().mockResolvedValue(undefined);
    render(
      <SharedReceiptActions
        line={lines[3] as ExpenseLineItem}
        lines={lines}
        canShare
        canRemove
        onShare={onShare}
        onRemove={vi.fn()}
      />
    );

    const picker = screen.getByLabelText("Use another line's receipt for Fuel");
    expect(
      within(picker)
        .getAllByRole('option')
        .map((o) => o.textContent)
    ).toEqual(['Use the receipt from…', 'Room', 'Meals']);
    await user.selectOptions(picker, 'li-meals');

    await waitFor(() => expect(onShare).toHaveBeenCalledWith('li-meals'));
    expect(screen.queryByRole('button', { name: /Remove the receipt/ })).not.toBeInTheDocument();
  });

  it('names the lines a receipt is shared with and takes it off this one alone', async () => {
    const user = userEvent.setup();
    const onRemove = vi.fn().mockResolvedValue(undefined);
    render(
      <SharedReceiptActions
        line={lines[1] as ExpenseLineItem}
        lines={lines}
        canShare
        canRemove
        onShare={vi.fn()}
        onRemove={onRemove}
      />
    );

    expect(screen.getByText('Also the receipt for "Room"')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Remove the receipt from Parking' }));

    await waitFor(() => expect(onRemove).toHaveBeenCalledTimes(1));
  });

  it('offers nothing to change once the report is past changing', () => {
    render(
      <SharedReceiptActions
        line={lines[3] as ExpenseLineItem}
        lines={lines}
        canShare={false}
        canRemove={false}
        onShare={vi.fn()}
        onRemove={vi.fn()}
      />
    );

    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });
});

// ============================================
// The rate
// ============================================

describe('the mileage rate setting', () => {
  it('saves the rate as typed and re-reads it', async () => {
    mockGetSettings.mockResolvedValueOnce(settings(null)).mockResolvedValue(settings('0.725'));
    const user = userEvent.setup();
    render(<MileageRateSettingsCard />);

    expect(await screen.findByText(/Not set/)).toBeInTheDocument();
    await user.type(screen.getByLabelText('Dollars a mile'), '0.725');
    await user.click(screen.getByRole('button', { name: 'Save rate' }));

    await waitFor(() => expect(mockUpdateSettings).toHaveBeenCalledWith({ finance: { mileage_rate: '0.725' } }));
    expect(await screen.findByText(/a mile \(0\.725\)/)).toBeInTheDocument();
  });

  it('refuses a rate the server would', async () => {
    const user = userEvent.setup();
    render(<MileageRateSettingsCard />);

    await user.clear(await screen.findByLabelText('Dollars a mile'));
    await user.type(screen.getByLabelText('Dollars a mile'), '7');
    await user.click(screen.getByRole('button', { name: 'Save rate' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('at most 5');
    expect(mockUpdateSettings).not.toHaveBeenCalled();
  });

  it('clears the rate with an explicit null', async () => {
    const user = userEvent.setup();
    render(<MileageRateSettingsCard />);

    await user.click(await screen.findByRole('button', { name: 'Clear rate' }));

    await waitFor(() => expect(mockUpdateSettings).toHaveBeenCalledWith({ finance: { mileage_rate: null } }));
  });
});
