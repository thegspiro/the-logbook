/**
 * Tests for the shift close-out wizard.
 *
 * These lean deliberately on the defects found while prototyping the flow,
 * because each one produced a plausible-looking wrong number rather than an
 * error:
 *   - count fields pre-filled with "0", so a typed "4" became "40";
 *   - a total that only ratcheted upward, so revising a count down left the
 *     old value on screen and saved it;
 *   - blank and zero collapsing together, which loses the difference between
 *     "not tracked" and "a quiet tour".
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../test/utils';

const mockGetState = vi.fn();
const mockSaveAttendance = vi.fn();
const mockSaveCalls = vi.fn();
const mockFinalize = vi.fn();

vi.mock('../../modules/scheduling/services/api', () => ({
  schedulingService: {
    getCloseoutState: (...a: unknown[]) => mockGetState(...a) as unknown,
    saveCloseoutAttendance: (...a: unknown[]) => mockSaveAttendance(...a) as unknown,
    saveCloseoutCalls: (...a: unknown[]) => mockSaveCalls(...a) as unknown,
    finalizeShift: (...a: unknown[]) => mockFinalize(...a) as unknown,
  },
}));

vi.mock('react-hot-toast', () => ({
  default: { success: vi.fn(), error: vi.fn() },
}));

import { ShiftCloseoutWizard } from './ShiftCloseoutWizard';
import { addHoursLocal, deriveCallTotal, hoursBetween, parseHoursEntry } from './closeoutMath';

const baseState = (over: Record<string, unknown> = {}) => ({
  shift_id: 'sh1',
  is_finalized: false,
  closeout_step: 0,
  call_tracking_mode: 'count_only',
  call_types: [
    { slug: 'ems', label: 'EMS', active: true },
    { slug: 'fire', label: 'Fire', active: true },
  ],
  members: [
    {
      user_id: 'u1',
      user_name: 'Capt. Morales',
      checked_in_at: '2026-08-19T12:00:00Z',
      checked_out_at: '2026-08-20T00:00:00Z',
      hours: 12,
      call_count: null,
      missing_checkout: false,
    },
    {
      user_id: 'u2',
      user_name: 'FF Okonjo',
      checked_in_at: '2026-08-19T18:00:00Z',
      checked_out_at: '2026-08-20T00:00:00Z',
      hours: 6,
      call_count: null,
      missing_checkout: true,
    },
  ],
  combined_hours: 18,
  reported_call_count: 0,
  reported_call_types: {},
  attachable_calls: [],
  ...over,
});

const renderWizard = (outstanding = 0, requireChecks = false) =>
  renderWithRouter(
    <ShiftCloseoutWizard
      shiftId="sh1"
      unitLabel="Engine 5"
      tz="UTC"
      outstandingChecks={outstanding}
      requireChecks={requireChecks}
      shiftStart="2026-08-19T12:00:00Z"
      shiftEnd="2026-08-20T00:00:00Z"
      onCancel={vi.fn()}
      onFinalized={vi.fn()}
    />
  );

const total = () => screen.getByTestId('call-total').textContent;

/**
 * Replace the value of a controlled number input.
 *
 * `userEvent.clear()` followed by `type()` races against React's controlled
 * re-render on `type="number"` and intermittently leaves the old digits in
 * place — flaky for harness reasons, not product ones. A change event is
 * deterministic and drives the same handler. Real keystroke typing is kept
 * wherever the field starts empty, because that is the path the digit
 * transposition bug lived on.
 */
const setValue = (el: HTMLElement, value: string) => {
  fireEvent.change(el, { target: { value } });
};

describe('a fresh close-out, start to finish', () => {
  // Every other case here starts mid-flow with a count already stored. That
  // blind spot let a regression through in which credits seeded to 0 before
  // any count existed and stayed pinned there once one arrived, so the whole
  // crew was finalized with zero calls.
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetState.mockResolvedValue(baseState());
    mockSaveAttendance.mockResolvedValue(baseState({ closeout_step: 1 }));
    mockSaveCalls.mockImplementation((_id: string, body: { reported_call_count: number | null }) =>
      Promise.resolve(baseState({ closeout_step: 2, reported_call_count: body.reported_call_count ?? 0 }))
    );
    mockFinalize.mockResolvedValue({ id: 'sh1' });
  });

  it('credits the crew the count the officer entered', async () => {
    const user = userEvent.setup();
    renderWizard();
    await user.click(await screen.findByRole('button', { name: 'Next' }));
    await user.type(await screen.findByLabelText('EMS calls'), '4');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    expect(await screen.findByLabelText('Calls credited to Capt. Morales')).toHaveValue(4);
    await user.click(screen.getByRole('button', { name: 'Close out shift' }));
    await waitFor(() => {
      expect(mockFinalize).toHaveBeenCalledWith('sh1', undefined, {
        member_call_counts: [
          { user_id: 'u1', call_count: 4 },
          { user_id: 'u2', call_count: 4 },
        ],
      });
    });
  });
});

describe('close-out blockers the checklist used to own', () => {
  // The wizard replaces the finalize checklist for these departments, so it
  // has to carry everything the checklist could do. Without the override an
  // org that enforces end-of-shift checks could never close a shift at all.
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetState.mockResolvedValue(
      baseState({ closeout_step: 2, reported_call_count: 5, reported_call_types: { ems: 5 } })
    );
    mockFinalize.mockResolvedValue({ id: 'sh1' });
  });

  it('blocks close-out while enforced checks are outstanding', async () => {
    renderWizard(2, true);
    expect(await screen.findByText(/Complete the outstanding checks/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Close out shift/ })).toBeDisabled();
  });

  it('still blocks once overridden until a reason is given', async () => {
    const user = userEvent.setup();
    renderWizard(1, true);
    await user.click(await screen.findByRole('checkbox'));
    expect(screen.getByRole('button', { name: /Close out shift/ })).toBeDisabled();
    await user.type(screen.getByLabelText(/Reason for closing out/), 'Truck out of service');
    expect(screen.getByRole('button', { name: /Close out shift/ })).toBeEnabled();
  });

  it('sends the override and its reason', async () => {
    const user = userEvent.setup();
    renderWizard(1, true);
    await user.click(await screen.findByRole('checkbox'));
    await user.type(screen.getByLabelText(/Reason for closing out/), 'Truck out of service');
    await user.click(screen.getByRole('button', { name: /Close out shift/ }));
    await waitFor(() => {
      expect(mockFinalize).toHaveBeenCalledWith(
        'sh1',
        undefined,
        expect.objectContaining({
          override_incomplete_checks: true,
          override_reason: 'Truck out of service',
        })
      );
    });
  });

  it('does not block when the department does not enforce checks', async () => {
    renderWizard(3, false);
    await screen.findByText('Does this look right?');
    expect(screen.getByRole('button', { name: /Close out shift/ })).toBeEnabled();
  });

  it('carries the crew hand-off note', async () => {
    const user = userEvent.setup();
    renderWizard();
    await user.type(await screen.findByLabelText(/Pass-down to next crew/), 'Pump packing leaking');
    await user.click(screen.getByRole('button', { name: /Close out shift/ }));
    await waitFor(() => {
      expect(mockFinalize).toHaveBeenCalledWith(
        'sh1',
        undefined,
        expect.objectContaining({ pass_down_notes: 'Pump packing leaking' })
      );
    });
  });
});

describe('deriveCallTotal', () => {
  it('returns null when nothing has been entered', () => {
    expect(deriveCallTotal({ ems: '', fire: '' })).toBeNull();
  });

  it('distinguishes a deliberate zero from not-tracked', () => {
    // A quiet tour is data; an untouched form is a gap. Collapsing them would
    // understate the department's quiet nights as missing.
    expect(deriveCallTotal({ ems: '0', fire: '' })).toBe(0);
  });

  it('sums across rows', () => {
    expect(deriveCallTotal({ ems: '3', fire: '1', other: '2' })).toBe(6);
  });

  it('falls when a row is revised down', () => {
    expect(deriveCallTotal({ ems: '40' })).toBe(40);
    expect(deriveCallTotal({ ems: '4' })).toBe(4);
  });

  it('treats rubbish as zero rather than NaN', () => {
    expect(deriveCallTotal({ ems: 'abc', fire: '2' })).toBe(2);
  });

  it('ignores negatives', () => {
    expect(deriveCallTotal({ ems: '-5', fire: '3' })).toBe(3);
  });
});

describe('hoursBetween', () => {
  it('computes a normal span', () => {
    expect(hoursBetween('2026-08-19T08:00', '2026-08-19T20:00')).toBe(12);
  });

  it('handles a span crossing midnight', () => {
    // Night shifts are why these are datetime-local and not time-only inputs.
    expect(hoursBetween('2026-08-19T20:00', '2026-08-20T08:00')).toBe(12);
  });

  it('returns 0 when the end is before the start', () => {
    expect(hoursBetween('2026-08-19T20:00', '2026-08-19T08:00')).toBe(0);
  });

  it('returns 0 when a time is missing', () => {
    expect(hoursBetween('2026-08-19T08:00', '')).toBe(0);
  });
});

describe('parseHoursEntry', () => {
  it('accepts quarter and decimal hours', () => {
    expect(parseHoursEntry('11.75')).toBe(11.75);
    expect(parseHoursEntry('12')).toBe(12);
  });

  it('refuses blanks, zero, rubbish and anything over the server cap', () => {
    expect(parseHoursEntry('')).toBeNull();
    expect(parseHoursEntry('0')).toBeNull();
    expect(parseHoursEntry('-3')).toBeNull();
    expect(parseHoursEntry('abc')).toBeNull();
    expect(parseHoursEntry('48.5')).toBeNull();
  });
});

describe('addHoursLocal', () => {
  it('crosses midnight', () => {
    expect(addHoursLocal('2026-08-19T20:00', 12, 'UTC')).toBe('2026-08-20T08:00');
  });

  it('adds fractional hours to the minute', () => {
    expect(addHoursLocal('2026-08-19T07:00', 11.75, 'UTC')).toBe('2026-08-19T18:45');
  });

  it('adds real hours across a DST change, not wall-clock hours', () => {
    // US clocks fall back at 02:00 on 2026-11-01: twelve elapsed hours from
    // 20:00 the night before end at 07:00 on the wall, not 08:00 — and the
    // server credits elapsed time.
    expect(addHoursLocal('2026-10-31T20:00', 12, 'America/New_York')).toBe('2026-11-01T07:00');
  });

  it('returns blank when there is no start', () => {
    expect(addHoursLocal('', 4, 'UTC')).toBe('');
  });
});

describe('typing hours for a member who forgot to check in or out', () => {
  // Assigned members with no attendance row arrive with null times; a member
  // who checked in but never out arrives with only a start.
  const forgetful = () =>
    baseState({
      members: [
        {
          user_id: 'u1',
          user_name: 'Capt. Morales',
          checked_in_at: '2026-08-19T12:00:00Z',
          checked_out_at: '2026-08-20T00:00:00Z',
          hours: 12,
          call_count: null,
          missing_checkout: false,
        },
        {
          user_id: 'u2',
          user_name: 'FF Okonjo',
          checked_in_at: '2026-08-19T13:30:00Z',
          checked_out_at: null,
          hours: 0,
          call_count: null,
          missing_checkout: true,
        },
        {
          user_id: 'u3',
          user_name: 'FF Reyes',
          checked_in_at: null,
          checked_out_at: null,
          hours: 0,
          call_count: null,
          missing_checkout: true,
        },
      ],
    });

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetState.mockReset();
    mockSaveAttendance.mockReset();
    mockGetState.mockResolvedValue(forgetful());
    mockSaveAttendance.mockResolvedValue(baseState({ closeout_step: 1 }));
  });

  it('labels which time is missing and counts who has no hours', async () => {
    renderWizard();
    expect(await screen.findByText('no check-in recorded')).toBeInTheDocument();
    expect(screen.getByText('no check-out recorded')).toBeInTheDocument();
    expect(screen.getByText(/2 with no hours/)).toBeInTheDocument();
  });

  it('counts typed hours from the shift start when nobody checked in', async () => {
    const user = userEvent.setup();
    renderWizard();
    await user.type(await screen.findByLabelText('Hours for FF Reyes'), '11.5');
    // The decimal survives typing — the box holds what was typed.
    expect(screen.getByLabelText('Hours for FF Reyes')).toHaveValue(11.5);
    expect(screen.getByLabelText('Start time for FF Reyes')).toHaveValue('2026-08-19T12:00');
    expect(screen.getByLabelText('End time for FF Reyes')).toHaveValue('2026-08-19T23:30');
    expect(screen.getByText('no check-in recorded')).toBeInTheDocument();
    expect(screen.getByText(/entered at close-out/)).toBeInTheDocument();
  });

  it('counts typed hours from the check-in a member did record', async () => {
    const user = userEvent.setup();
    renderWizard();
    await user.type(await screen.findByLabelText('Hours for FF Okonjo'), '6');
    expect(screen.getByLabelText('Start time for FF Okonjo')).toHaveValue('2026-08-19T13:30');
    expect(screen.getByLabelText('End time for FF Okonjo')).toHaveValue('2026-08-19T19:30');
  });

  it('fills a forgotten check-out to the end of the shift in one tap', async () => {
    const user = userEvent.setup();
    renderWizard();
    await user.click(await screen.findByRole('button', { name: 'Until shift end for FF Okonjo' }));
    expect(screen.getByLabelText('End time for FF Okonjo')).toHaveValue('2026-08-20T00:00');
    expect(screen.getByLabelText('Hours for FF Okonjo')).toHaveValue(10.5);
  });

  it('fills a member who never checked in with the whole shift', async () => {
    const user = userEvent.setup();
    renderWizard();
    await user.click(await screen.findByRole('button', { name: 'Full shift for FF Reyes' }));
    expect(screen.getByLabelText('Hours for FF Reyes')).toHaveValue(12);
  });

  it('does not offer the fill to a member whose times were recorded', async () => {
    renderWizard();
    await screen.findByLabelText('Hours for Capt. Morales');
    expect(screen.queryByRole('button', { name: /for Capt\. Morales/ })).not.toBeInTheDocument();
  });

  it('refuses an entry the server would reject, and holds Next until it is fixed', async () => {
    renderWizard();
    const box = await screen.findByLabelText('Hours for FF Reyes');
    // One change, not keystrokes: typing passes through a valid "6" first.
    setValue(box, '60');
    expect(screen.getByRole('alert')).toHaveTextContent('Enter between 0.25 and 48 hours.');
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    // The times were not moved by an entry that cannot be recorded.
    expect(screen.getByLabelText('End time for FF Reyes')).toHaveValue('');
    setValue(box, '12');
    expect(screen.getByRole('button', { name: 'Next' })).toBeEnabled();
  });

  it('saves typed hours as times the server can derive duration from', async () => {
    const user = userEvent.setup();
    renderWizard();
    await user.type(await screen.findByLabelText('Hours for FF Reyes'), '8');
    await user.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => {
      expect(mockSaveAttendance).toHaveBeenCalledWith(
        'sh1',
        expect.arrayContaining([
          {
            user_id: 'u3',
            checked_in_at: '2026-08-19T12:00:00.000Z',
            checked_out_at: '2026-08-19T20:00:00.000Z',
          },
        ])
      );
    });
  });

  it('flags a member still without hours on the confirm step', async () => {
    mockGetState.mockResolvedValue({ ...forgetful(), closeout_step: 2 });
    renderWizard();
    expect(await screen.findAllByText('no hours recorded')).toHaveLength(2);
  });
});

describe('ShiftCloseoutWizard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetState.mockResolvedValue(baseState());
    mockSaveAttendance.mockImplementation((_id: string) => Promise.resolve(baseState({ closeout_step: 1 })));
    mockSaveCalls.mockImplementation((_id: string) => Promise.resolve(baseState({ closeout_step: 2 })));
    mockFinalize.mockResolvedValue({ id: 'sh1' });
  });

  it('starts on step 1 for an untouched shift', async () => {
    renderWizard();
    expect(await screen.findByText('When was everyone on?')).toBeInTheDocument();
  });

  it('resumes on the calls step when attendance was already saved', async () => {
    mockGetState.mockResolvedValue(baseState({ closeout_step: 1 }));
    renderWizard();
    expect(await screen.findByText(/How many calls did Engine 5 run\?/)).toBeInTheDocument();
  });

  it('resumes on the confirm step when calls were already saved', async () => {
    mockGetState.mockResolvedValue(baseState({ closeout_step: 2 }));
    renderWizard();
    expect(await screen.findByText('Does this look right?')).toBeInTheDocument();
  });

  it('flags a member with no recorded check-out', async () => {
    renderWizard();
    expect(await screen.findByText('no check-out recorded')).toBeInTheDocument();
  });

  it('shows combined hours, not a bare total', async () => {
    renderWizard();
    // 12h + 6h across two members on a 12-hour shift — the word is what stops
    // "18" reading as the shift's length.
    expect(await screen.findByText(/18 combined hours/)).toBeInTheDocument();
  });

  describe('the call count', () => {
    beforeEach(() => {
      mockGetState.mockResolvedValue(baseState({ closeout_step: 1 }));
    });

    it('starts every type box empty, never at zero', async () => {
      renderWizard();
      const ems = await screen.findByLabelText('EMS calls');
      const fire = screen.getByLabelText('Fire calls');
      const other = screen.getByLabelText('Not categorised calls');
      // A pre-filled "0" is what turned a typed "4" into "40".
      expect(ems.value).toBe('');
      expect(fire.value).toBe('');
      expect(other.value).toBe('');
    });

    it('reads as not-tracked until something is entered', async () => {
      renderWizard();
      await screen.findByLabelText('EMS calls');
      expect(total()).toBe('—');
    });

    it('drives the total up as rows are filled', async () => {
      const user = userEvent.setup();
      renderWizard();
      await user.type(await screen.findByLabelText('EMS calls'), '3');
      expect(total()).toBe('3');
      await user.type(screen.getByLabelText('Fire calls'), '1');
      expect(total()).toBe('4');
    });

    it('drives the total back DOWN when a row is revised', async () => {
      const user = userEvent.setup();
      renderWizard();
      const ems = await screen.findByLabelText('EMS calls');
      await user.type(ems, '40');
      expect(total()).toBe('40');
      setValue(ems, '4');
      // The defect this replaces: the total only ratcheted upward, so it stayed
      // at 40 and 40 is what got saved.
      expect(total()).toBe('4');
    });

    it('accepts multi-digit entry without transposing it', async () => {
      const user = userEvent.setup();
      renderWizard();
      await user.type(await screen.findByLabelText('EMS calls'), '12');
      expect(total()).toBe('12');
    });

    it('sends the derived total and the typed breakdown', async () => {
      const user = userEvent.setup();
      renderWizard();
      await user.type(await screen.findByLabelText('EMS calls'), '3');
      await user.type(screen.getByLabelText('Not categorised calls'), '2');
      await user.click(screen.getByRole('button', { name: 'Next' }));
      await waitFor(() => {
        expect(mockSaveCalls).toHaveBeenCalledWith('sh1', {
          reported_call_count: 5,
          reported_call_types: { ems: 3 },
        });
      });
    });

    it('sends a null count when the officer tracked nothing', async () => {
      const user = userEvent.setup();
      renderWizard();
      await screen.findByLabelText('EMS calls');
      await user.click(screen.getByRole('button', { name: 'Next' }));
      await waitFor(() => {
        expect(mockSaveCalls).toHaveBeenCalledWith('sh1', {
          reported_call_count: null,
          reported_call_types: undefined,
        });
      });
    });
  });

  describe('member credit', () => {
    beforeEach(() => {
      const withCalls = () => baseState({ closeout_step: 2, reported_call_count: 5, reported_call_types: { ems: 5 } });
      mockGetState.mockResolvedValue(withCalls());
      // The real endpoint echoes what it stored, so the mock must too —
      // returning a bare state would collapse the total to zero and make
      // these assertions test the mock rather than the component.
      mockSaveCalls.mockImplementation(() => Promise.resolve(withCalls()));
    });

    it('defaults everyone to the apparatus count', async () => {
      renderWizard();
      const a = await screen.findByLabelText('Calls credited to Capt. Morales');
      const b = screen.getByLabelText('Calls credited to FF Okonjo');
      expect(a.value).toBe('5');
      expect(b.value).toBe('5');
    });

    it('warns when nobody was on every call', async () => {
      renderWizard();
      const a = await screen.findByLabelText('Calls credited to Capt. Morales');
      setValue(a, '3');
      const b = screen.getByLabelText('Calls credited to FF Okonjo');
      setValue(b, '2');
      expect(await screen.findByText(/Nobody is credited with all 5 calls/)).toBeInTheDocument();
    });

    it('does not warn when someone was on every call', async () => {
      renderWizard();
      const b = await screen.findByLabelText('Calls credited to FF Okonjo');
      setValue(b, '2');
      expect(screen.queryByText(/Nobody is credited with all/)).not.toBeInTheDocument();
    });

    it('clamps an over-cap credit down to the apparatus count on blur', async () => {
      renderWizard();
      const a = await screen.findByLabelText('Calls credited to Capt. Morales');
      setValue(a, '99');
      fireEvent.blur(a);
      expect(a.value).toBe('5');
    });

    it('keeps an adjustment made before stepping back and saving again', async () => {
      // Per-member credit is only persisted at finalize, so the server reports
      // null for it throughout the wizard. Re-seeding from that response wiped
      // the one member the officer had singled out — silently, and only for
      // them, which is the kind of loss nobody notices until the record is
      // wrong.
      const user = userEvent.setup();
      renderWizard();
      const okonjo = await screen.findByLabelText('Calls credited to FF Okonjo');
      setValue(okonjo, '2');

      await user.click(screen.getByRole('button', { name: 'Back' }));
      await user.click(screen.getByRole('button', { name: 'Next' }));

      await waitFor(() => {
        expect(screen.getByLabelText('Calls credited to FF Okonjo')).toHaveValue(2);
      });
      expect(screen.getByLabelText('Calls credited to Capt. Morales')).toHaveValue(5);
    });

    it('never sends a member more calls than the apparatus ran', async () => {
      const user = userEvent.setup();
      renderWizard();
      const a = await screen.findByLabelText('Calls credited to Capt. Morales');
      setValue(a, '99');
      await user.click(screen.getByRole('button', { name: 'Close out shift' }));
      await waitFor(() => {
        expect(mockFinalize).toHaveBeenCalledWith('sh1', undefined, {
          member_call_counts: [
            { user_id: 'u1', call_count: 5 },
            { user_id: 'u2', call_count: 5 },
          ],
        });
      });
    });
  });
});

describe('the shared-call picker (SCHED-10)', () => {
  // An MVA Medic 1 logged that Engine 5 also ran. Ticking it claims the call
  // instead of logging a second one, so the department counts it once.
  const mva = {
    id: 'call-mva',
    call_date: '2026-08-19',
    call_type: 'ems',
    source: 'manual',
    apparatus_ids: ['medic-1'],
    unit_labels: ['Medic 1'],
    attached: false,
  };

  beforeEach(() => {
    mockGetState.mockReset();
    mockSaveAttendance.mockReset();
    mockSaveCalls.mockReset();
    mockFinalize.mockReset();
    mockGetState.mockResolvedValue(baseState({ closeout_step: 1, attachable_calls: [mva] }));
    mockSaveCalls.mockResolvedValue(baseState({ closeout_step: 2, attachable_calls: [mva] }));
    mockFinalize.mockResolvedValue({ id: 'sh1' });
  });

  it('lists the other unit’s call by unit, type and date', async () => {
    renderWizard();
    expect(await screen.findByRole('checkbox', { name: 'Medic 1 · EMS · Aug 19' })).not.toBeChecked();
  });

  it('counts a ticked call in the total and sends it as an attachment, not a typed call', async () => {
    const user = userEvent.setup();
    renderWizard();
    await user.click(await screen.findByRole('checkbox', { name: 'Medic 1 · EMS · Aug 19' }));
    await user.type(screen.getByLabelText('Fire calls'), '2');
    expect(total()).toBe('3');

    await user.click(screen.getByRole('button', { name: 'Next' }));

    await waitFor(() => {
      expect(mockSaveCalls).toHaveBeenCalledWith('sh1', {
        reported_call_count: 3,
        reported_call_types: { fire: 2 },
        attach_call_ids: ['call-mva'],
        detach_call_ids: undefined,
      });
    });
  });

  it('a tick alone answers the question — the total is not left blank', async () => {
    const user = userEvent.setup();
    renderWizard();
    const box = await screen.findByRole('checkbox', { name: 'Medic 1 · EMS · Aug 19' });
    expect(total()).toBe('—');
    await user.click(box);
    expect(total()).toBe('1');
  });

  it('shows a claimed call ticked and keeps its type out of the typed rows', async () => {
    // The server's tally includes the claimed EMS call. Seeding it into the
    // EMS row as well would show it twice and save it as two calls.
    mockGetState.mockResolvedValue(
      baseState({
        closeout_step: 1,
        reported_call_count: 3,
        reported_call_types: { ems: 2, fire: 1 },
        attachable_calls: [{ ...mva, attached: true }],
      })
    );
    renderWizard();
    expect(await screen.findByRole('checkbox', { name: 'Medic 1 · EMS · Aug 19' })).toBeChecked();
    expect(screen.getByLabelText('EMS calls')).toHaveValue(1);
    expect(screen.getByLabelText('Fire calls')).toHaveValue(1);
    expect(total()).toBe('3');
  });

  it('unticking a claimed call detaches it', async () => {
    const user = userEvent.setup();
    mockGetState.mockResolvedValue(
      baseState({
        closeout_step: 1,
        reported_call_count: 1,
        reported_call_types: { ems: 1 },
        attachable_calls: [{ ...mva, attached: true }],
      })
    );
    renderWizard();
    await user.click(await screen.findByRole('checkbox', { name: 'Medic 1 · EMS · Aug 19' }));
    // Nothing typed and nothing ticked reads as unanswered, the same as a
    // fresh close-out; the server records it as no calls.
    expect(total()).toBe('—');

    await user.click(screen.getByRole('button', { name: 'Next' }));

    await waitFor(() => {
      expect(mockSaveCalls).toHaveBeenCalledWith('sh1', {
        reported_call_count: null,
        reported_call_types: undefined,
        attach_call_ids: undefined,
        detach_call_ids: ['call-mva'],
      });
    });
  });

  it('shows no picker when no other unit logged a call', async () => {
    mockGetState.mockResolvedValue(baseState({ closeout_step: 1 }));
    renderWizard();
    await screen.findByLabelText('EMS calls');
    expect(screen.queryByText('Already logged by another unit')).not.toBeInTheDocument();
  });
});
