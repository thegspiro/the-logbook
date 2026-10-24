import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockAddMotion = vi.fn();
const mockUpdateMotion = vi.fn();

vi.mock('../services/api', () => ({
  minutesService: {
    addMotion: (...a: unknown[]) => mockAddMotion(...a) as unknown,
    updateMotion: (...a: unknown[]) => mockUpdateMotion(...a) as unknown,
  },
}));
vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));

import { SectionMotion } from './SectionMotion';
import type { AttendeeEntry, Motion, SectionEntry } from '../types/minutes';

const roll: AttendeeEntry[] = [
  { name: 'Pat Chief', status: 'present', present: true },
  { name: 'Lee Treasurer', status: 'present', present: true },
];

const adjourn: SectionEntry = {
  order: 10,
  key: 'adjournment',
  title: 'Adjournment',
  content: '',
  needs_motion: true,
  motion_text: 'Motion to adjourn the meeting.',
};

const recorded: Motion = {
  id: 'mo1',
  minutes_id: 'm1',
  order: 0,
  motion_text: 'Motion to adjourn the meeting.',
  moved_by: 'Pat Chief',
  seconded_by: 'Lee Treasurer',
  section_key: 'adjournment',
  status: 'passed',
  created_at: '',
  updated_at: '',
};

describe('SectionMotion', () => {
  const onRecorded = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockAddMotion.mockReset();
    mockAddMotion.mockResolvedValue(recorded);
    mockUpdateMotion.mockReset();
    mockUpdateMotion.mockResolvedValue(recorded);
    onRecorded.mockReset();
    onRecorded.mockResolvedValue(undefined);
  });

  const show = (section = adjourn, motions: Motion[] = [], canRecord = true) =>
    render(
      <SectionMotion
        minutesId="m1"
        section={section}
        motions={motions}
        attendees={roll}
        canRecord={canRecord}
        onRecorded={onRecorded}
      />
    );

  it('shows nothing for a section that needs no motion and has none', () => {
    const { container } = show({ ...adjourn, needs_motion: false });
    expect(container).toBeEmptyDOMElement();
  });

  it('arrives with the motion written and a reminder that it is needed', () => {
    show();
    expect(screen.getByLabelText('Motion')).toHaveValue('Motion to adjourn the meeting.');
    expect(screen.getByText('Needs a motion and a second')).toBeInTheDocument();
  });

  it('records the motion against its section with who moved and seconded', async () => {
    const user = userEvent.setup();
    show();

    await user.selectOptions(screen.getByLabelText('Moved by'), 'Pat Chief');
    await user.selectOptions(screen.getByLabelText('Seconded by'), 'Lee Treasurer');
    await user.click(screen.getByRole('button', { name: 'Record motion' }));

    expect(mockAddMotion).toHaveBeenCalledWith('m1', {
      motion_text: 'Motion to adjourn the meeting.',
      moved_by: 'Pat Chief',
      seconded_by: 'Lee Treasurer',
      status: 'passed',
      section_key: 'adjournment',
      order: 0,
    });
    expect(onRecorded).toHaveBeenCalledTimes(1);
  });

  it('lets the secretary reword the motion and set the result', async () => {
    const user = userEvent.setup();
    show();

    const text = screen.getByLabelText('Motion');
    await user.clear(text);
    await user.type(text, 'Motion to adjourn at 9:15 pm.');
    await user.selectOptions(screen.getByLabelText('Result'), 'tabled');
    await user.click(screen.getByRole('button', { name: 'Record motion' }));

    expect(mockAddMotion).toHaveBeenCalledWith(
      'm1',
      expect.objectContaining({ motion_text: 'Motion to adjourn at 9:15 pm.', status: 'tabled' })
    );
  });

  it('records a motion with no mover named rather than blocking the section', async () => {
    const user = userEvent.setup();
    show();
    await user.click(screen.getByRole('button', { name: 'Record motion' }));

    const sent = mockAddMotion.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(sent.moved_by).toBeUndefined();
    expect(sent.seconded_by).toBeUndefined();
  });

  it('refuses an empty motion', async () => {
    const user = userEvent.setup();
    show();
    await user.clear(screen.getByLabelText('Motion'));
    await user.click(screen.getByRole('button', { name: 'Record motion' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Write the motion first');
    expect(mockAddMotion).not.toHaveBeenCalled();
  });

  it('refuses the same person moving and seconding', async () => {
    const user = userEvent.setup();
    show();
    await user.selectOptions(screen.getByLabelText('Moved by'), 'Pat Chief');
    await user.selectOptions(screen.getByLabelText('Seconded by'), 'Someone else (type a name)');
    await user.type(screen.getByLabelText('Seconded by, typed name'), 'pat chief');
    await user.click(screen.getByRole('button', { name: 'Record motion' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('cannot also second');
    expect(mockAddMotion).not.toHaveBeenCalled();
  });

  it('shows the server’s reason when recording fails, and keeps the form', async () => {
    mockAddMotion.mockRejectedValue(new Error('Can only add motions to draft or rejected minutes'));
    const user = userEvent.setup();
    show();
    await user.click(screen.getByRole('button', { name: 'Record motion' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Can only add motions');
    expect(screen.getByRole('button', { name: 'Record motion' })).toBeEnabled();
    expect(onRecorded).not.toHaveBeenCalled();
  });

  it('shows a recorded motion instead of the form', () => {
    show(adjourn, [recorded]);

    expect(screen.getByText('Moved by: Pat Chief')).toBeInTheDocument();
    expect(screen.getByText('Seconded by: Lee Treasurer')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Record motion' })).toBeNull();
    expect(screen.queryByText('Needs a motion and a second')).toBeNull();
  });

  it('shows only the motions made from this section', () => {
    const elsewhere: Motion = { ...recorded, id: 'mo2', section_key: 'new_business', motion_text: 'Buy hose.' };
    show(adjourn, [elsewhere]);

    expect(screen.queryByText('Buy hose.')).toBeNull();
    expect(screen.getByRole('button', { name: 'Record motion' })).toBeInTheDocument();
  });

  it('shows a motion recorded on a section the outline no longer flags', () => {
    show({ ...adjourn, needs_motion: false }, [recorded]);
    expect(screen.getByText('Moved by: Pat Chief')).toBeInTheDocument();
  });

  it('is read-only for someone who cannot record', () => {
    show(adjourn, [], false);

    expect(screen.queryByRole('button', { name: 'Record motion' })).toBeNull();
    expect(screen.queryByText('Needs a motion and a second')).toBeNull();
    expect(screen.getByText('No motion was recorded for this section.')).toBeInTheDocument();
  });

  it('says who is not recorded when a motion has no mover', () => {
    const { moved_by: _moved, seconded_by: _seconded, ...unnamed } = recorded;
    show(adjourn, [unnamed]);
    expect(screen.getByText('Moved by: not recorded')).toBeInTheDocument();
    expect(screen.getByText('Seconded by: not recorded')).toBeInTheDocument();
  });

  describe('how the vote was taken', () => {
    it('records a roll call with the threshold, and sends no totals of its own', async () => {
      const user = userEvent.setup();
      show();

      await user.selectOptions(screen.getByLabelText('Needed to carry'), 'two_thirds');
      await user.click(screen.getByRole('radio', { name: 'Roll call' }));
      await user.click(
        within(screen.getByRole('radiogroup', { name: "Pat Chief's vote" })).getByRole('radio', { name: 'Yes' })
      );
      await user.click(
        within(screen.getByRole('radiogroup', { name: "Lee Treasurer's vote" })).getByRole('radio', { name: 'No' })
      );
      await user.click(screen.getByRole('button', { name: 'Record motion' }));

      const sent = mockAddMotion.mock.calls[0]?.[1] as Record<string, unknown>;
      expect(sent.threshold).toBe('two_thirds');
      expect(sent.roll_call).toEqual([
        { name: 'Pat Chief', vote: 'yes' },
        { name: 'Lee Treasurer', vote: 'no' },
      ]);
      expect(sent.votes_for).toBeUndefined();
    });

    it('records totals typed in', async () => {
      const user = userEvent.setup();
      show();

      await user.type(screen.getByLabelText('For'), '6');
      await user.type(screen.getByLabelText('Against'), '1');
      await user.click(screen.getByRole('button', { name: 'Record motion' }));

      expect(mockAddMotion).toHaveBeenCalledWith(
        'm1',
        expect.objectContaining({ votes_for: 6, votes_against: 1, status: 'passed' })
      );
    });

    it('shows the recorded vote and lets the secretary take the counts’ result', async () => {
      const user = userEvent.setup();
      show(adjourn, [{ ...recorded, votes_for: 1, votes_against: 3, suggested_status: 'failed' }]);

      expect(screen.getByText('Vote: 1-3')).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Change it to failed' }));

      expect(mockUpdateMotion).toHaveBeenCalledWith('m1', 'mo1', { status: 'failed' });
      expect(onRecorded).toHaveBeenCalled();
    });

    it('does not offer to change a result when it cannot be edited', () => {
      show(adjourn, [{ ...recorded, votes_for: 1, votes_against: 3, suggested_status: 'failed' }], false);
      expect(screen.queryByRole('button', { name: /Change it to/ })).toBeNull();
    });
  });
});
