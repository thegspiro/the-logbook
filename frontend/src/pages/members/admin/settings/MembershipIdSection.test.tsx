/**
 * The membership number pattern screen: which controls it offers, what it
 * writes, and that the number it shows comes from the server.
 *
 * The server is the only formatter. These tests never assert a number the
 * screen would have to compute; every "next" number is the mocked preview.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockGetSettings = vi.fn();
const mockUpdate = vi.fn();
const mockPreview = vi.fn();
vi.mock('../../../../services/userServices', () => ({
  organizationService: {
    getSettings: (...args: unknown[]) => mockGetSettings(...args) as unknown,
    updateMembershipIdSettings: (...args: unknown[]) => mockUpdate(...args) as unknown,
    previewNextMembershipId: (...args: unknown[]) => mockPreview(...args) as unknown,
  },
}));

import MembershipIdSection from './MembershipIdSection';
import type { MembershipIdSettings } from '../../../../types/user';

const STORED: MembershipIdSettings = {
  enabled: true,
  auto_generate: true,
  prefix: 'FD-',
  next_number: 7,
  pattern: '{PREFIX}{SEQ}',
  padding: 4,
  start_number: 1,
  reset_yearly: false,
  year_basis: 'calendar',
  fiscal_year_start_month: 1,
  fiscal_year_label: 'end',
};

// Both savers run at once: the page's queue and debounce are its own concern,
// tested in useSettingsAutosave.
const renderSection = () =>
  render(<MembershipIdSection save={(saver) => void saver()} saveDebounced={(_key, saver) => void saver()} />);

const lastWrite = (): MembershipIdSettings => {
  const { calls } = mockUpdate.mock;
  return calls[calls.length - 1]?.[0] as MembershipIdSettings;
};

describe('MembershipIdSection', () => {
  beforeEach(() => {
    mockGetSettings.mockReset();
    mockUpdate.mockReset();
    mockPreview.mockReset();
    mockGetSettings.mockResolvedValue({ membership_id: STORED });
    mockUpdate.mockImplementation((s: MembershipIdSettings) => Promise.resolve(s));
    mockPreview.mockResolvedValue({ enabled: true, next_id: 'FD-0007' });
  });

  it('shows the number the server says the next member receives', async () => {
    renderSection();

    expect(await screen.findByText('The next member will be numbered FD-0007.')).toBeInTheDocument();
    expect(screen.getByText('Next: FD-0007')).toBeInTheDocument();
  });

  it('re-reads the preview after a save, rather than rendering the pattern itself', async () => {
    const user = userEvent.setup();
    renderSection();
    await screen.findByText('The next member will be numbered FD-0007.');

    mockPreview.mockResolvedValue({ enabled: true, next_id: '2026-001' });
    await user.click(screen.getByRole('button', { name: /year and number/i }));

    expect(await screen.findByText('The next member will be numbered 2026-001.')).toBeInTheDocument();
    expect(lastWrite()).toMatchObject({ pattern: '{YYYY}-{SEQ}', padding: 3 });
  });

  it('says numbers are typed by hand when nothing is generated', async () => {
    mockGetSettings.mockResolvedValue({ membership_id: { ...STORED, auto_generate: false } });
    mockPreview.mockResolvedValue({ enabled: true, next_id: null });

    renderSection();

    expect(await screen.findByText('Numbers are typed in by hand when a member is added.')).toBeInTheDocument();
    expect(screen.queryByLabelText(/next id number/i)).not.toBeInTheDocument();
  });

  it('saves a pattern the department writes itself', async () => {
    const user = userEvent.setup();
    renderSection();
    const field = await screen.findByLabelText('Number pattern');

    await user.clear(field);
    await user.type(field, 'Station 4/{{SEQ}');

    await waitFor(() => expect(lastWrite().pattern).toBe('Station 4/{SEQ}'));
  });

  it('offers the prefix only when the pattern uses it', async () => {
    const user = userEvent.setup();
    renderSection();
    expect(await screen.findByLabelText('Prefix')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /plain number/i }));

    expect(screen.queryByLabelText('Prefix')).not.toBeInTheDocument();
    expect(lastWrite()).toMatchObject({ pattern: '{SEQ}', padding: 1 });
  });

  it('offers the yearly controls only when the pattern has a year', async () => {
    const user = userEvent.setup();
    renderSection();
    await screen.findByLabelText('Number pattern');

    expect(screen.queryByRole('switch', { name: /restart the count each year/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /year and number/i }));

    expect(screen.getByRole('switch', { name: /restart the count each year/i })).toBeInTheDocument();
    expect(screen.getByLabelText('The year follows')).toBeInTheDocument();
  });

  it('asks for the fiscal month, and how that year is named, only when it matters', async () => {
    const user = userEvent.setup();
    mockGetSettings.mockResolvedValue({ membership_id: { ...STORED, pattern: '{YYYY}-{SEQ}' } });
    renderSection();

    await user.selectOptions(await screen.findByLabelText('The year follows'), 'fiscal');
    expect(lastWrite().year_basis).toBe('fiscal');
    // A January fiscal year is the calendar year: nothing to name.
    expect(screen.queryByLabelText(/is named by/i)).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Fiscal year starts in'), 'July');
    expect(lastWrite().fiscal_year_start_month).toBe(7);

    const naming = screen.getByLabelText('A fiscal year starting in July is named by');
    await user.selectOptions(naming, 'start');
    expect(lastWrite().fiscal_year_label).toBe('start');
  });

  it('turns the yearly restart off when the year leaves the pattern', async () => {
    // The server refuses a restart with no year to restart; sending both
    // changes in one write keeps that save from failing.
    const user = userEvent.setup();
    mockGetSettings.mockResolvedValue({
      membership_id: { ...STORED, pattern: '{YYYY}-{SEQ}', reset_yearly: true },
    });
    renderSection();
    await screen.findByRole('switch', { name: /restart the count each year/i });

    await user.click(screen.getByRole('button', { name: /prefix and number/i }));

    expect(lastWrite()).toMatchObject({ pattern: '{PREFIX}{SEQ}', reset_yearly: false });
  });

  it('keeps the settings it did not load when an older server omits the new fields', async () => {
    // A block stored before patterns existed carries only the first four keys.
    mockGetSettings.mockResolvedValue({
      membership_id: { enabled: true, auto_generate: true, prefix: 'FD-', next_number: 7 },
    });
    renderSection();

    expect(await screen.findByLabelText('Number pattern')).toHaveValue('{PREFIX}{SEQ}');
    expect(screen.getByLabelText('Minimum digits')).toHaveValue(4);
  });
});
