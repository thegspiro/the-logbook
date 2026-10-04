/**
 * W50-49 — "Max Proxies Per Person" keeps what the member types, sends only a
 * whole number from 1 to 10, is reachable by its label, and reports the API's
 * 422 as a failed save rather than "All changes saved".
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test/utils';

const mockGetSettings = vi.fn();
const mockGetElections = vi.fn();
const mockUpdateSettings = vi.fn();

vi.mock('../services/api', () => ({
  electionService: {
    getSettings: (...a: unknown[]) => mockGetSettings(...a) as unknown,
    getElections: (...a: unknown[]) => mockGetElections(...a) as unknown,
    updateSettings: (...a: unknown[]) => mockUpdateSettings(...a) as unknown,
    sendTestBallot: vi.fn(),
  },
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import toast from 'react-hot-toast';
import { ElectionsSettingsPage } from './ElectionsSettingsPage';

const stored = {
  proxy_voting_enabled: true,
  max_proxies_per_person: 1,
};

const validationError = (field: string, msg: string) =>
  Object.assign(new Error('Request failed with status code 422'), {
    response: {
      status: 422,
      statusText: 'Unprocessable Entity',
      data: { detail: [{ loc: ['body', field], msg, type: 'less_than_equal' }] },
    },
  });

// The debounce (600ms) and the pill's minimum "Saving…" hold (700ms) are real
// timers here, so anything awaiting a write outcome needs more than the
// default 1s.
const SETTLE = { timeout: 4000 };

describe('ElectionsSettingsPage — max proxies per person (W50-49)', () => {
  beforeEach(() => {
    mockGetSettings.mockReset();
    mockGetElections.mockReset();
    mockUpdateSettings.mockReset();
    vi.mocked(toast.error).mockReset();
    vi.mocked(toast.success).mockReset();
    mockGetSettings.mockResolvedValue({ ...stored });
    mockGetElections.mockResolvedValue([]);
    mockUpdateSettings.mockImplementation((data: unknown) => Promise.resolve(data));
    window.history.pushState({}, '', '/elections/settings');
  });

  it('binds the label to the input and bounds it to the server range', async () => {
    renderWithRouter(<ElectionsSettingsPage />);

    const input = await screen.findByLabelText('Max Proxies Per Person');
    expect(input).toHaveAttribute('type', 'number');
    expect(input).toHaveAttribute('min', '1');
    expect(input).toHaveAttribute('max', '10');
    expect(input).toHaveValue(1);
    expect(input).toHaveAccessibleDescription(/from 1 to 10/);
  });

  it('keeps an emptied box empty and writes nothing until a valid number is typed', async () => {
    const user = userEvent.setup();
    renderWithRouter(<ElectionsSettingsPage />);

    const input = await screen.findByLabelText('Max Proxies Per Person');
    await user.clear(input);

    expect(input).toHaveValue(null);
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('Enter a whole number from 1 to 10. It is still saved as 1.');

    // Long enough for a debounced write to have fired had one been scheduled.
    await act(() => new Promise((resolve) => setTimeout(resolve, 900)));
    expect(mockUpdateSettings).not.toHaveBeenCalled();
    expect(screen.queryByText('All changes saved')).not.toBeInTheDocument();

    await user.type(input, '3');

    expect(input).toHaveValue(3);
    expect(input).not.toHaveAttribute('aria-invalid', 'true');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    await waitFor(() => expect(mockUpdateSettings).toHaveBeenCalledTimes(1), SETTLE);
    expect(mockUpdateSettings).toHaveBeenCalledWith({ ...stored, max_proxies_per_person: 3 });
  });

  it('shows "11" as typed instead of "111", and never sends an out-of-range value', async () => {
    const user = userEvent.setup();
    renderWithRouter(<ElectionsSettingsPage />);

    const input = await screen.findByLabelText('Max Proxies Per Person');
    await user.clear(input);
    await user.type(input, '11');

    expect(input).toHaveValue(11);
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toBeInTheDocument();

    // The first "1" was valid and is written; the "11" that followed is not.
    await waitFor(() => expect(mockUpdateSettings).toHaveBeenCalledTimes(1), SETTLE);
    expect(mockUpdateSettings).toHaveBeenCalledWith({ ...stored, max_proxies_per_person: 1 });
    await act(() => new Promise((resolve) => setTimeout(resolve, 900)));
    expect(mockUpdateSettings).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('alert')).toHaveTextContent('It is still saved as 1.');
  });

  it('reports a 422 from the API as a failed save, not "All changes saved"', async () => {
    const user = userEvent.setup();
    mockUpdateSettings.mockRejectedValue(
      validationError('max_proxies_per_person', 'Input should be less than or equal to 10')
    );
    renderWithRouter(<ElectionsSettingsPage />);

    const input = await screen.findByLabelText('Max Proxies Per Person');
    await user.clear(input);
    await user.type(input, '5');

    expect(await screen.findByText(/Couldn't save/, {}, SETTLE)).toBeInTheDocument();
    expect(screen.queryByText('All changes saved')).not.toBeInTheDocument();
    expect(toast.error).toHaveBeenCalledWith('max_proxies_per_person: Input should be less than or equal to 10.');
    // The failure never rolls the field back to the stored value.
    expect(input).toHaveValue(5);
  });
});
