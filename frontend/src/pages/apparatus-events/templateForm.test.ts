import { describe, expect, it } from 'vitest';
import {
  ApparatusEventEvocMode,
  ApparatusEventSeatType,
  type ApparatusEventTemplate,
} from '../../types/apparatusEvent';
import {
  blankDraft,
  blankSeat,
  duplicateDraft,
  hoursWouldNotBeCredited,
  nightToSpec,
  toPayload,
  totalSeats,
  validateDraft,
  weeklyDates,
  withoutEmptySeats,
  type TemplateDraft,
} from './templateForm';
import { nth } from '../../test/utils';

const santa = (): TemplateDraft => {
  const draft = blankDraft('engine-1');
  draft.name = 'Santamobile — Full';
  const unit = nth(draft.units, 0);
  unit.seats = [
    { ...blankSeat('Driver', ApparatusEventSeatType.DRIVER) },
    { ...blankSeat('Santa') },
    { ...blankSeat('Elf'), count: '4' },
  ];
  return draft;
};

const template: ApparatusEventTemplate = {
  id: 'tpl-1',
  name: 'Santamobile — Full',
  description: null,
  event_type: 'public_education',
  default_start_time: '18:00',
  duration_minutes: 210,
  location: 'Station 1',
  admin_hours_category_id: 'cat-1',
  admin_hours_category_name: 'Community Outreach',
  evoc_mode: ApparatusEventEvocMode.ENFORCE,
  allow_self_signup: true,
  show_on_schedule: true,
  duplicated_from_id: null,
  duplicated_from_name: null,
  total_seats: 6,
  nights_scheduled: 0,
  last_scheduled_at: null,
  units: [
    {
      id: 'u1',
      apparatus_id: 'engine-1',
      unit_number: 'E1',
      apparatus_name: null,
      required_evoc_level_name: 'EVOC 3',
      seats: [
        { id: 's1', name: 'Driver', seat_type: ApparatusEventSeatType.DRIVER, count: 1, note: null },
        { id: 's2', name: 'Elf', seat_type: ApparatusEventSeatType.GENERAL, count: 4, note: 'Candy canes' },
      ],
    },
  ],
  created_at: '2026-11-01T00:00:00Z',
  updated_at: '2026-11-01T00:00:00Z',
};

describe('templateForm', () => {
  it('counts every seat a template opens', () => {
    expect(totalSeats(santa())).toBe(6);
  });

  it('omits blank optional text from the payload (pitfall #1)', () => {
    const payload = toPayload(santa());
    expect(payload.description).toBeUndefined();
    expect(payload.location).toBeUndefined();
    expect(payload.admin_hours_category_id).toBeUndefined();
    expect(payload.units[0]?.seats.map((s) => [s.name, s.count])).toEqual([
      ['Driver', 1],
      ['Santa', 1],
      ['Elf', 4],
    ]);
  });

  it('names what is wrong before anything is sent', () => {
    const draft = santa();
    draft.name = '  ';
    const unit = nth(draft.units, 0);
    unit.seats[2] = { ...blankSeat('Elf'), count: '0' };
    draft.units.push({ ...unit, key: 'second' });

    expect(validateDraft(draft)).toEqual([
      'Give the template a name.',
      'Each apparatus can appear only once.',
      '"Elf" needs a count from 1 to 20.',
    ]);
  });

  it('accepts a complete draft', () => {
    expect(validateDraft(santa())).toEqual([]);
  });

  it('starts a duplicate as the original under a new name, remembering its source', () => {
    const copy = duplicateDraft(template, 'Santamobile — Small');
    expect(copy.name).toBe('Santamobile — Small');
    expect(copy.duplicated_from_id).toBe('tpl-1');
    expect(copy.units[0]?.seats.map((s) => s.count)).toEqual(['1', '4']);
  });

  it('leaves a seat set to 0 off a copy, and an apparatus with none left', () => {
    const copy = duplicateDraft(template, 'Driver only');
    const elf = nth(nth(copy.units, 0).seats, 1);
    elf.count = '0';
    expect(withoutEmptySeats(copy).units[0]?.seats.map((s) => s.name)).toEqual(['Driver']);

    const driver = nth(nth(copy.units, 0).seats, 0);
    driver.count = '0';
    expect(withoutEmptySeats(copy).units).toEqual([]);
  });

  it('repeats a night weekly across a daylight-saving change', () => {
    expect(weeklyDates('2026-10-26', 3)).toEqual(['2026-10-26', '2026-11-02', '2026-11-09']);
  });

  it('reads a night’s start on the department’s clock', () => {
    // 6 PM in New York on Dec 7 (EST, UTC-5) is 23:00 UTC.
    const spec = nightToSpec(
      { key: 'n', date: '2026-12-07', start_time: '18:00', duration_minutes: '210', location: ' Route A ' },
      'America/New_York'
    );
    expect(spec).toEqual({
      start_datetime: '2026-12-07T23:00:00.000Z',
      end_datetime: '2026-12-08T02:30:00.000Z',
      location: 'Route A',
    });
  });

  it('holds back a night that is not filled in', () => {
    expect(
      nightToSpec({ key: 'n', date: '', start_time: '18:00', duration_minutes: '60', location: '' }, 'UTC')
    ).toBeNull();
  });
});

describe('hoursWouldNotBeCredited', () => {
  const options = (mapped: string[]) => ({ apparatus: [], categories: [], mapped_event_types: mapped });

  it('warns only when no category is chosen and the event type is unmapped', () => {
    expect(hoursWouldNotBeCredited('', 'public_education', options([]))).toBe(true);
    expect(hoursWouldNotBeCredited('cat-1', 'public_education', options([]))).toBe(false);
    expect(hoursWouldNotBeCredited('', 'public_education', options(['public_education']))).toBe(false);
  });

  it('says nothing before the options have loaded', () => {
    expect(hoursWouldNotBeCredited('', 'public_education', null)).toBe(false);
  });
});
