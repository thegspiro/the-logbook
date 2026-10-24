/**
 * The outline prepares a section's motion with the minutes; the secretary fills
 * it in. The motion that accepts the previous minutes names them and records
 * how they were accepted.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
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
import { renderWithRouter } from '../../../test/utils';
import type { AttendeeEntry, Motion, SectionEntry } from '../types/minutes';

const roll: AttendeeEntry[] = [
  { name: 'Pat Chief', status: 'present', present: true },
  { name: 'Lee Treasurer', status: 'present', present: true },
];

const approval: SectionEntry = {
  order: 2,
  key: 'approval_of_previous',
  title: 'Approval of Previous Minutes',
  content: '',
  needs_motion: true,
  motion_text: 'Motion to approve the minutes of the previous meeting.',
};

const prepared: Motion = {
  id: 'pm1',
  minutes_id: 'm2',
  order: 2,
  motion_text: 'Motion to accept the minutes of the September 3, 2026 business meeting.',
  section_key: 'approval_of_previous',
  status: 'pending',
  previous_minutes_id: 'm1',
  previous_minutes_title: 'September business',
  previous_minutes_status: 'submitted',
  created_at: '',
  updated_at: '',
};

describe('SectionMotion with a prepared motion', () => {
  const onRecorded = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockAddMotion.mockReset();
    mockAddMotion.mockResolvedValue({});
    mockUpdateMotion.mockReset();
    mockUpdateMotion.mockResolvedValue({});
    onRecorded.mockReset();
    onRecorded.mockResolvedValue(undefined);
  });

  const show = (motions: Motion[], canRecord = true, section = approval) =>
    renderWithRouter(
      <SectionMotion
        minutesId="m2"
        section={section}
        motions={motions}
        attendees={roll}
        canRecord={canRecord}
        onRecorded={onRecorded}
      />
    );

  it('opens the form on the prepared wording, not on an empty one', () => {
    show([prepared]);

    expect(screen.getByLabelText('Motion')).toHaveValue(prepared.motion_text);
    expect(screen.getByText('Needs a motion and a second')).toBeInTheDocument();
  });

  it('names and links the minutes it accepts', () => {
    show([prepared]);

    expect(screen.getByRole('link', { name: 'September business' })).toHaveAttribute('href', '/minutes/m1');
  });

  it('records into the prepared motion rather than adding a second', async () => {
    const user = userEvent.setup();
    show([prepared]);

    await user.click(screen.getByRole('radio', { name: 'As revised' }));
    await user.click(screen.getByRole('button', { name: 'Record motion' }));

    expect(mockAddMotion).not.toHaveBeenCalled();
    expect(mockUpdateMotion).toHaveBeenCalledWith(
      'm2',
      'pm1',
      expect.objectContaining({ status: 'passed', acceptance: 'as_revised' })
    );
    expect(onRecorded).toHaveBeenCalled();
  });

  it('will not record a passed acceptance without saying how', async () => {
    const user = userEvent.setup();
    show([prepared]);

    await user.click(screen.getByRole('button', { name: 'Record motion' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('as submitted or as revised');
    expect(mockUpdateMotion).not.toHaveBeenCalled();
  });

  it('does not ask how it was accepted when the motion failed', async () => {
    const user = userEvent.setup();
    show([prepared]);

    await user.selectOptions(screen.getByLabelText('Result'), 'failed');

    expect(screen.queryByRole('radio', { name: 'As revised' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Record motion' }));
    expect(mockUpdateMotion).toHaveBeenCalledWith(
      'm2',
      'pm1',
      expect.not.objectContaining({ acceptance: 'as_revised' })
    );
  });

  it('does not ask for an acceptance on a motion that accepts nothing', () => {
    const adjourn: SectionEntry = { ...approval, key: 'adjournment', title: 'Adjournment' };
    show([{ ...prepared, section_key: 'adjournment', previous_minutes_id: null }], true, adjourn);

    expect(screen.queryByRole('radio', { name: 'As revised' })).not.toBeInTheDocument();
  });

  it('shows how it was accepted and that the adoption waits for another officer', () => {
    show([
      {
        ...prepared,
        status: 'passed',
        acceptance: 'as_revised',
        moved_by: 'Pat Chief',
        seconded_by: 'Lee Treasurer',
      },
    ]);

    expect(screen.getByText(/Accepted as revised/)).toBeInTheDocument();
    expect(screen.getByText(/waiting for an officer other than the one who circulated them/)).toBeInTheDocument();
  });

  it('says the minutes are adopted once they are', () => {
    show([
      {
        ...prepared,
        status: 'passed',
        acceptance: 'as_submitted',
        previous_minutes_status: 'approved',
      },
    ]);

    expect(screen.getByText(/Accepted as submitted/)).toBeInTheDocument();
    expect(screen.getByText(/\(adopted\)/)).toBeInTheDocument();
  });

  it('shows a reader nothing to fill in for a motion not yet acted on', () => {
    show([prepared], false);

    expect(screen.getByText('No motion was recorded for this section.')).toBeInTheDocument();
    expect(screen.queryByLabelText('Motion')).not.toBeInTheDocument();
  });
});
