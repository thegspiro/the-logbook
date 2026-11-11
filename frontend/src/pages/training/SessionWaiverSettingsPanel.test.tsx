import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../test/utils';
import type { AttendanceWaiverPolicy } from '../../types/attendanceWaiver';

const mockGetPolicy = vi.fn();
const mockSavePolicy = vi.fn();
vi.mock('../../services/attendanceWaiverService', () => ({
  attendanceWaiverService: {
    getPolicy: (...args: unknown[]) => mockGetPolicy(...args) as unknown,
    savePolicy: (...args: unknown[]) => mockSavePolicy(...args) as unknown,
  },
}));
const mockPositions = vi.fn();
vi.mock('../../services/trainingServices', () => ({
  complianceConfigService: { getAvailablePositions: (...args: unknown[]) => mockPositions(...args) as unknown },
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import SessionWaiverSettingsPanel from './SessionWaiverSettingsPanel';

const policy = (over: Partial<AttendanceWaiverPolicy> = {}): AttendanceWaiverPolicy => ({
  enabled: false,
  deadline: 'before_start',
  cap: null,
  cap_period: 'calendar_year',
  categories: [],
  category_required: false,
  reason_text: 'optional',
  approver_position_ids: [],
  ...over,
});

const save = () => screen.getByRole('button', { name: /^Save$/ });

describe('SessionWaiverSettingsPanel', () => {
  beforeEach(() => {
    mockGetPolicy.mockReset();
    mockSavePolicy.mockReset();
    mockPositions.mockReset();
    mockGetPolicy.mockResolvedValue(policy());
    mockPositions.mockResolvedValue({
      positions: [
        { id: 'pos-to', name: 'Training Officer' },
        { id: 'pos-lt', name: 'Lieutenant' },
      ],
    });
    mockSavePolicy.mockImplementation((p: AttendanceWaiverPolicy) => Promise.resolve(p));
  });

  it('saves every field the policy owns', async () => {
    const user = userEvent.setup();
    renderWithRouter(<SessionWaiverSettingsPanel />);

    await user.click(await screen.findByLabelText(/Members may ask to be excused/));
    await user.click(screen.getByLabelText('Up to 7 days after it ends'));
    await user.click(screen.getByLabelText('Limit how many waivers a member can have'));
    await user.clear(screen.getByLabelText(/Most waivers per member/));
    await user.type(screen.getByLabelText(/Most waivers per member/), '4');
    await user.selectOptions(screen.getByLabelText('Counted over'), 'rolling_12_months');
    await user.click(screen.getByRole('button', { name: 'Add a category' }));
    await user.type(screen.getByLabelText('Category 1'), ' Work ');
    await user.click(screen.getByLabelText('A member must choose a category'));
    await user.click(screen.getByLabelText('Required'));
    await user.click(screen.getByLabelText('Training Officer'));
    await user.click(save());

    expect(mockSavePolicy).toHaveBeenCalledWith({
      enabled: true,
      deadline: '7d_after_end',
      cap: 4,
      cap_period: 'rolling_12_months',
      categories: ['Work'],
      category_required: true,
      reason_text: 'required',
      approver_position_ids: ['pos-to'],
    });
  });

  it('sends a null cap when the limit is turned off', async () => {
    mockGetPolicy.mockResolvedValue(policy({ enabled: true, cap: 3 }));
    const user = userEvent.setup();
    renderWithRouter(<SessionWaiverSettingsPanel />);
    await user.click(await screen.findByLabelText('Limit how many waivers a member can have'));
    await user.click(save());
    expect(mockSavePolicy).toHaveBeenCalledWith(expect.objectContaining({ cap: null }));
  });

  it('flags a cap out of range and does not save', async () => {
    mockGetPolicy.mockResolvedValue(policy({ cap: 3 }));
    const user = userEvent.setup();
    renderWithRouter(<SessionWaiverSettingsPanel />);
    const cap = await screen.findByLabelText(/Most waivers per member/);
    await user.clear(cap);
    await user.type(cap, '400');
    await user.click(save());
    expect(screen.getByText('Enter a whole number from 1 to 365.', { selector: 'p' })).toBeInTheDocument();
    expect(mockSavePolicy).not.toHaveBeenCalled();
  });

  it('flags a blank and a duplicate category', async () => {
    const user = userEvent.setup();
    renderWithRouter(<SessionWaiverSettingsPanel />);
    await user.click(await screen.findByRole('button', { name: 'Add a category' }));
    await user.click(save());
    expect(
      screen.getByText('A category cannot be blank. Remove it or give it a name.', { selector: 'p' })
    ).toBeInTheDocument();

    await user.type(screen.getByLabelText('Category 1'), 'Work');
    await user.click(screen.getByRole('button', { name: 'Add a category' }));
    await user.type(screen.getByLabelText('Category 2'), 'work');
    await user.click(save());
    expect(screen.getByText('"work" is listed twice.', { selector: 'p' })).toBeInTheDocument();
    expect(mockSavePolicy).not.toHaveBeenCalled();
  });

  it('turns the category requirement off when the last category is removed', async () => {
    mockGetPolicy.mockResolvedValue(policy({ categories: ['Work'], category_required: true }));
    const user = userEvent.setup();
    renderWithRouter(<SessionWaiverSettingsPanel />);
    await user.click(await screen.findByRole('button', { name: 'Remove category Work' }));
    expect(screen.getByLabelText('A member must choose a category')).not.toBeChecked();
    await user.click(save());
    expect(mockSavePolicy).toHaveBeenCalledWith(expect.objectContaining({ categories: [], category_required: false }));
  });

  it('drops a chosen position that no longer exists, and says so first', async () => {
    mockGetPolicy.mockResolvedValue(policy({ approver_position_ids: ['pos-to', 'pos-gone'] }));
    const user = userEvent.setup();
    renderWithRouter(<SessionWaiverSettingsPanel />);
    expect(
      await screen.findByText('One chosen position no longer exists and is removed when you save.')
    ).toBeInTheDocument();
    await user.click(save());
    expect(mockSavePolicy).toHaveBeenCalledWith(expect.objectContaining({ approver_position_ids: ['pos-to'] }));
  });

  it('keeps the chosen positions as they are when the list cannot load', async () => {
    mockGetPolicy.mockResolvedValue(policy({ approver_position_ids: ['pos-to'] }));
    mockPositions.mockRejectedValue(new Error('403'));
    const user = userEvent.setup();
    renderWithRouter(<SessionWaiverSettingsPanel />);
    expect(await screen.findByText(/Positions could not be loaded/)).toBeInTheDocument();
    await user.click(screen.getByLabelText(/Members may ask to be excused/));
    await user.click(save());
    expect(mockSavePolicy).toHaveBeenCalledWith(expect.objectContaining({ approver_position_ids: ['pos-to'] }));
  });

  it('says attachments arrive later rather than offering a setting', async () => {
    renderWithRouter(<SessionWaiverSettingsPanel />);
    expect(await screen.findByText(/arrives in a later update/)).toBeInTheDocument();
  });

  it('shows the server’s refusal', async () => {
    mockSavePolicy.mockRejectedValue({
      response: { status: 400, data: { detail: 'Position not found' } },
      isAxiosError: true,
    });
    const user = userEvent.setup();
    renderWithRouter(<SessionWaiverSettingsPanel />);
    await user.click(await screen.findByLabelText(/Members may ask to be excused/));
    await user.click(save());
    expect(await screen.findByText('Position not found')).toBeInTheDocument();
  });
});
