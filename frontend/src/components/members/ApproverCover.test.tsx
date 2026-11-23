/**
 * Approver cover: an approver away names an officer to decide in their place.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../test/utils';

const getCovers = vi.fn();
const setCover = vi.fn();
const clearCover = vi.fn();

vi.mock('../../services/leaveRequestService', () => ({
  leaveRequestService: {
    getCovers: (...a: unknown[]) => getCovers(...a) as unknown,
    setCover: (...a: unknown[]) => setCover(...a) as unknown,
    clearCover: (...a: unknown[]) => clearCover(...a) as unknown,
  },
}));
const toastSuccess = vi.fn();
vi.mock('react-hot-toast', () => ({
  default: { success: (...a: unknown[]) => toastSuccess(...a) as unknown, error: vi.fn() },
}));
const currentUser = { id: 'me' };
vi.mock('../../stores/authStore', () => ({
  useAuthStore: (selector: (s: { user: { id: string } }) => unknown) => selector({ user: currentUser }),
}));

import ApproverCover from './ApproverCover';

const TODAY = '2027-03-01';
const board = (overrides: Record<string, unknown> = {}) => ({
  covers: [],
  approvers: [],
  stand_ins: [],
  suggested: [],
  today: TODAY,
  ...overrides,
});
const cover = {
  id: 'c1',
  approver_id: 'me',
  approver_name: 'Blake Board',
  stand_in_id: 'o1',
  stand_in_name: 'Olive Officer',
  start_date: TODAY,
  end_date: '2027-03-07',
  active: true,
  can_clear: true,
};

describe('ApproverCover', () => {
  beforeEach(() => {
    for (const mock of [getCovers, setCover, clearCover, toastSuccess]) mock.mockReset();
    currentUser.id = 'me';
    getCovers.mockResolvedValue(board());
    setCover.mockResolvedValue(board({ covers: [cover] }));
    clearCover.mockResolvedValue(board());
  });

  it('shows nothing to a member who is neither an approver nor named in a cover', async () => {
    const { container } = renderWithRouter(<ApproverCover />);
    await vi.waitFor(() => expect(getCovers).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('an approver sets their own cover', async () => {
    const user = userEvent.setup();
    getCovers.mockResolvedValue(
      board({
        approvers: [{ id: 'me', name: 'Blake Board' }],
        stand_ins: [
          { id: 'o1', name: 'Olive Officer' },
          { id: 'me', name: 'Blake Board' },
        ],
      })
    );
    renderWithRouter(<ApproverCover />);

    const section = await screen.findByRole('region', { name: 'Approver cover' });
    expect(within(section).getByText(/Set cover for yourself/)).toBeInTheDocument();
    expect(within(section).queryByLabelText('Approver who is away')).not.toBeInTheDocument();
    // An approver cannot stand in for themself, so they are not offered.
    const standIn = within(section).getByLabelText('Stand-in');
    expect(within(standIn).queryByRole('option', { name: 'Blake Board' })).not.toBeInTheDocument();
    await user.selectOptions(standIn, 'o1');
    await user.type(within(section).getByLabelText('First day away'), TODAY);
    await user.type(within(section).getByLabelText('Last day away'), '2027-03-07');
    await user.click(within(section).getByRole('button', { name: 'Set cover' }));

    expect(setCover).toHaveBeenCalledWith({
      approver_id: 'me',
      stand_in_id: 'o1',
      start_date: TODAY,
      end_date: '2027-03-07',
    });
    expect(await within(section).findByText('Olive Officer')).toBeInTheDocument();
  });

  it('an officer chooses whose cover to set, even with one approver', async () => {
    const user = userEvent.setup();
    currentUser.id = 'o1';
    getCovers.mockResolvedValue(
      board({ approvers: [{ id: 'b1', name: 'Blake Board' }], stand_ins: [{ id: 'o1', name: 'Olive Officer' }] })
    );
    renderWithRouter(<ApproverCover />);

    const section = await screen.findByRole('region', { name: 'Approver cover' });
    expect(within(section).queryByText(/Set cover for yourself/)).not.toBeInTheDocument();
    await user.selectOptions(within(section).getByLabelText('Approver who is away'), 'b1');
    await user.selectOptions(within(section).getByLabelText('Stand-in'), 'o1');
    await user.type(within(section).getByLabelText('First day away'), TODAY);
    await user.type(within(section).getByLabelText('Last day away'), TODAY);
    await user.click(within(section).getByRole('button', { name: 'Set cover' }));

    expect(setCover).toHaveBeenCalledWith({
      approver_id: 'b1',
      stand_in_id: 'o1',
      start_date: TODAY,
      end_date: TODAY,
    });
  });

  it('ending a cover is confirmed first', async () => {
    const user = userEvent.setup();
    getCovers.mockResolvedValue(board({ covers: [cover] }));
    renderWithRouter(<ApproverCover />);

    const section = await screen.findByRole('region', { name: 'Approver cover' });
    expect(within(section).getByText(/in effect now/)).toBeInTheDocument();
    await user.click(within(section).getByRole('button', { name: 'End cover' }));
    expect(clearCover).not.toHaveBeenCalled();
    const dialog = await screen.findByRole('dialog');
    await user.click(within(dialog).getByRole('button', { name: 'End the cover' }));

    expect(clearCover).toHaveBeenCalledWith('c1');
    expect(toastSuccess).toHaveBeenCalledWith('Cover ended.');
  });

  it('keeping a cover leaves it in place', async () => {
    const user = userEvent.setup();
    getCovers.mockResolvedValue(board({ covers: [cover] }));
    renderWithRouter(<ApproverCover />);

    const section = await screen.findByRole('region', { name: 'Approver cover' });
    await user.click(within(section).getByRole('button', { name: 'End cover' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Keep it' }));

    expect(clearCover).not.toHaveBeenCalled();
  });

  it('a stand-in sees the cover but cannot end it', async () => {
    getCovers.mockResolvedValue(board({ covers: [{ ...cover, can_clear: false }] }));
    renderWithRouter(<ApproverCover />);

    const section = await screen.findByRole('region', { name: 'Approver cover' });
    expect(within(section).queryByRole('button', { name: 'End cover' })).not.toBeInTheDocument();
    expect(within(section).queryByRole('button', { name: 'Set cover' })).not.toBeInTheDocument();
  });

  describe('asking an approver going on leave to name a stand-in', () => {
    const suggestion = { leave_id: 'l1', start_date: '2027-03-05', end_date: '2027-03-12' };

    it('says nothing when no leave of theirs wants one', async () => {
      getCovers.mockResolvedValue(
        board({ approvers: [{ id: 'me', name: 'Blake Board' }], stand_ins: [{ id: 'o1', name: 'Olive Officer' }] })
      );
      renderWithRouter(<ApproverCover />);

      await screen.findByRole('region', { name: 'Approver cover' });
      expect(screen.queryByRole('button', { name: 'Use these dates' })).not.toBeInTheDocument();
    });

    it("fills the form with the leave's dates and moves to the stand-in", async () => {
      const user = userEvent.setup();
      getCovers.mockResolvedValue(
        board({
          approvers: [{ id: 'me', name: 'Blake Board' }],
          stand_ins: [{ id: 'o1', name: 'Olive Officer' }],
          suggested: [suggestion],
        })
      );
      renderWithRouter(<ApproverCover />);

      const section = await screen.findByRole('region', { name: 'Approver cover' });
      expect(within(section).getByRole('status')).toHaveTextContent(
        'you are on leave from Mar 5, 2027 to Mar 12, 2027'
      );
      await user.click(within(section).getByRole('button', { name: 'Use these dates' }));

      expect(within(section).getByLabelText('First day away')).toHaveValue('2027-03-05');
      expect(within(section).getByLabelText('Last day away')).toHaveValue('2027-03-12');
      expect(within(section).getByLabelText('Stand-in')).toHaveFocus();
      await user.selectOptions(within(section).getByLabelText('Stand-in'), 'o1');
      await user.click(within(section).getByRole('button', { name: 'Set cover' }));
      expect(setCover).toHaveBeenCalledWith({
        approver_id: 'me',
        stand_in_id: 'o1',
        start_date: '2027-03-05',
        end_date: '2027-03-12',
      });
    });

    it('an officer on leave is filled in as the approver who is away', async () => {
      const user = userEvent.setup();
      currentUser.id = 'o1';
      getCovers.mockResolvedValue(
        board({
          approvers: [
            { id: 'b1', name: 'Blake Board' },
            { id: 'o1', name: 'Olive Officer' },
          ],
          stand_ins: [
            { id: 'o1', name: 'Olive Officer' },
            { id: 'o2', name: 'Oscar Officer' },
          ],
          suggested: [{ ...suggestion, end_date: null }],
        })
      );
      renderWithRouter(<ApproverCover />);

      const section = await screen.findByRole('region', { name: 'Approver cover' });
      expect(within(section).getByRole('status')).toHaveTextContent('with no end date set');
      await user.click(within(section).getByRole('button', { name: 'Use these dates' }));

      expect(within(section).getByLabelText('Approver who is away')).toHaveValue('o1');
      expect(within(section).getByLabelText('First day away')).toHaveValue('2027-03-05');
      expect(within(section).getByLabelText('Last day away')).toHaveValue('');
    });
  });
});
