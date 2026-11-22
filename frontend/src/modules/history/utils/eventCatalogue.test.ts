import { describe, expect, it } from 'vitest';
import { EMPTY_EVENT_FORM, eventForCreate, eventForUpdate, type EventForm } from './eventCatalogue';

const filled = (overrides: Partial<EventForm> = {}): EventForm => ({
  ...EMPTY_EVENT_FORM,
  title: ' Mill fire ',
  start_date: '1911-03-04',
  place: '  ',
  members: [{ member_id: 'p1', display_name: 'John Smith', role: ' commanded ' }],
  apparatus: [{ id: 'a1', label: 'Engine 1' }],
  ...overrides,
});

describe('eventForCreate', () => {
  it('omits blanks and trims each role', () => {
    const payload = eventForCreate(filled());
    expect(payload?.title).toBe('Mill fire');
    expect(payload?.place).toBeUndefined();
    expect(payload?.members).toEqual([{ member_id: 'p1', role: 'commanded' }]);
    expect(payload?.apparatus_ids).toEqual(['a1']);
  });

  it('has nothing to send without a start date', () => {
    expect(eventForCreate(filled({ start_date: null }))).toBeNull();
  });
});

describe('eventForUpdate', () => {
  it('sends a cleared field as null and every link set, emptied ones too', () => {
    const payload = eventForUpdate(
      filled({ description: '', station_id: '', members: [], apparatus: [], media: [], documents: [] })
    );
    expect(payload.description).toBeNull();
    expect(payload.station_id).toBeNull();
    expect(payload.end_date).toBeNull();
    expect(payload.members).toEqual([]);
    expect(payload.apparatus_ids).toEqual([]);
    expect(payload.media_ids).toEqual([]);
    expect(payload.document_ids).toEqual([]);
  });

  it('sends a blank role as null', () => {
    const payload = eventForUpdate(filled({ members: [{ member_id: 'p1', display_name: 'J', role: '  ' }] }));
    expect(payload.members).toEqual([{ member_id: 'p1', role: null }]);
  });
});
