import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../test/utils';
import type { AttendanceWaiverAlternateOptions, AttendanceWaiverPolicy } from '../../types/attendanceWaiver';

const mockGetPolicy = vi.fn();
const mockPositions = vi.fn();
const mockSavePolicy = vi.fn();
const mockGetAlternateOptions = vi.fn();
vi.mock('../../services/attendanceWaiverService', () => ({
  attendanceWaiverService: {
    getPolicy: (...args: unknown[]) => mockGetPolicy(...args) as unknown,
    savePolicy: (...args: unknown[]) => mockSavePolicy(...args) as unknown,
    getAlternateOptions: (...args: unknown[]) => mockGetAlternateOptions(...args) as unknown,
    // The panel reads positions from the waiver API now; the fixtures keep
    // the `{ positions }` shape the compliance endpoint returned.
    getPositions: async (...args: unknown[]) => ((await mockPositions(...args)) as { positions: unknown[] }).positions,
  },
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import SessionWaiverSettingsPanel from './SessionWaiverSettingsPanel';

const policy = (over: Partial<AttendanceWaiverPolicy> = {}): AttendanceWaiverPolicy => ({
  enabled: true,
  deadline: 'before_start',
  cap: null,
  cap_period: 'calendar_year',
  categories: [],
  category_required: false,
  reason_text: 'optional',
  attachment: 'off',
  attachment_retention_days: 365,
  approver_position_ids: [],
  cc_position_ids: [],
  chief_alternate_user_id: null,
  ...over,
});

const options = (over: Partial<AttendanceWaiverAlternateOptions> = {}): AttendanceWaiverAlternateOptions => ({
  members: [
    { id: 'u-ann', name: 'Ann Able' },
    { id: 'u-bob', name: 'Bob Baker' },
  ],
  alternate: null,
  ...over,
});

const ALTERNATE = /Who decides the Chief's or President's own request/;
const save = () => screen.getByRole('button', { name: /^Save$/ });

describe('SessionWaiverSettingsPanel — the Chief and President alternate', () => {
  beforeEach(() => {
    mockGetPolicy.mockReset();
    mockSavePolicy.mockReset();
    mockGetAlternateOptions.mockReset();
    mockPositions.mockReset();
    mockGetPolicy.mockResolvedValue(policy());
    mockGetAlternateOptions.mockResolvedValue(options());
    mockPositions.mockResolvedValue({ positions: [] });
    mockSavePolicy.mockImplementation((p: AttendanceWaiverPolicy) => Promise.resolve(p));
  });

  it('names a current member and saves them', async () => {
    const user = userEvent.setup();
    renderWithRouter(<SessionWaiverSettingsPanel />);

    await user.selectOptions(await screen.findByLabelText(ALTERNATE), 'u-bob');
    await user.click(save());

    expect(mockSavePolicy).toHaveBeenCalledWith(expect.objectContaining({ chief_alternate_user_id: 'u-bob' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('loads the stored alternate and clears it on "No one named"', async () => {
    mockGetPolicy.mockResolvedValue(policy({ chief_alternate_user_id: 'u-ann' }));
    mockGetAlternateOptions.mockResolvedValue(options({ alternate: { id: 'u-ann', name: 'Ann Able', current: true } }));
    const user = userEvent.setup();
    renderWithRouter(<SessionWaiverSettingsPanel />);

    const select = await screen.findByLabelText(ALTERNATE);
    expect(select).toHaveValue('u-ann');
    await user.selectOptions(select, '');
    await user.click(save());

    expect(mockSavePolicy).toHaveBeenCalledWith(expect.objectContaining({ chief_alternate_user_id: null }));
  });

  it('warns when the stored alternate is no longer a member, and a save clears them', async () => {
    mockGetPolicy.mockResolvedValue(policy({ chief_alternate_user_id: 'u-gone' }));
    mockGetAlternateOptions.mockResolvedValue(
      options({ alternate: { id: 'u-gone', name: 'Gus Gone', current: false } })
    );
    const user = userEvent.setup();
    renderWithRouter(<SessionWaiverSettingsPanel />);

    const warning = await screen.findByRole('alert');
    expect(warning).toHaveTextContent('Gus Gone is no longer a current member');
    expect(screen.getByLabelText(ALTERNATE)).toHaveValue('u-gone');
    // Nothing else changed, but the lapsed choice is worth a save.
    expect(save()).toBeEnabled();
    await user.click(save());

    expect(mockSavePolicy).toHaveBeenCalledWith(expect.objectContaining({ chief_alternate_user_id: null }));
  });

  it('a new choice replaces the lapsed one and the warning goes', async () => {
    mockGetPolicy.mockResolvedValue(policy({ chief_alternate_user_id: 'u-gone' }));
    mockGetAlternateOptions.mockResolvedValue(
      options({ alternate: { id: 'u-gone', name: 'Gus Gone', current: false } })
    );
    const user = userEvent.setup();
    renderWithRouter(<SessionWaiverSettingsPanel />);

    await user.selectOptions(await screen.findByLabelText(ALTERNATE), 'u-ann');
    expect(screen.queryByText(/no longer a current member/)).not.toBeInTheDocument();
    await user.click(save());

    expect(mockSavePolicy).toHaveBeenCalledWith(expect.objectContaining({ chief_alternate_user_id: 'u-ann' }));
  });

  it('keeps the stored alternate when the members cannot be loaded', async () => {
    mockGetPolicy.mockResolvedValue(policy({ chief_alternate_user_id: 'u-ann' }));
    mockGetAlternateOptions.mockRejectedValue(new Error('offline'));
    const user = userEvent.setup();
    renderWithRouter(<SessionWaiverSettingsPanel />);

    expect(await screen.findByText(/Members could not be loaded/)).toBeInTheDocument();
    expect(screen.queryByLabelText(ALTERNATE)).not.toBeInTheDocument();
    await user.click(screen.getByLabelText(/Members may ask to be excused/));
    await user.click(save());

    expect(mockSavePolicy).toHaveBeenCalledWith(expect.objectContaining({ chief_alternate_user_id: 'u-ann' }));
  });
});
