import { describe, expect, it, vi } from 'vitest';
import { firstRefused, saveExceptRefused } from './saveExceptRefused';
import { mapServerFieldErrors } from './serverFieldErrors';

const FIELDS = { name: { label: 'Name', maxLength: 10 }, notes: { label: 'Notes' } } as const;
type Field = keyof typeof FIELDS;
const place = (err: unknown) => mapServerFieldErrors<Field>(err, FIELDS);

const refusal = (field: string, message = 'Value is too long.') => ({
  response: { status: 422, data: { detail: [{ field, message }] } },
});

describe('saveExceptRefused', () => {
  it('sends everything when nothing is refused', async () => {
    const send = vi.fn().mockResolvedValue('ok');
    const out = await saveExceptRefused<Field, string>({
      payload: { name: 'A', notes: 'B' },
      refused: {},
      send,
      place,
    });

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({ name: 'A', notes: 'B' });
    expect(out).toEqual({ result: 'ok', refused: {} });
  });

  it('leaves a locally refused field out of the first send', async () => {
    const send = vi.fn().mockResolvedValue('ok');
    await saveExceptRefused<Field, string>({
      payload: { name: '', notes: 'B' },
      refused: { name: 'Enter a name.' },
      send,
      place,
    });

    expect(send).toHaveBeenCalledWith({ notes: 'B' });
  });

  it('resends without a field the server refused, and reports it', async () => {
    const send = vi.fn().mockRejectedValueOnce(refusal('name')).mockResolvedValueOnce('ok');
    const out = await saveExceptRefused<Field, string>({
      payload: { name: 'A', notes: 'B' },
      refused: {},
      send,
      place,
    });

    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1]?.[0]).toEqual({ notes: 'B' });
    expect(out.refused).toEqual({ name: 'Name is too long — keep it to 10 characters.' });
  });

  it('drops every key a field writes', async () => {
    const send = vi.fn().mockRejectedValueOnce(refusal('notes')).mockResolvedValueOnce('ok');
    await saveExceptRefused<Field, string>({
      payload: { name: 'A', notes: 'B', notes_html: '<p>B</p>' },
      refused: {},
      keysFor: (f) => (f === 'notes' ? ['notes', 'notes_html'] : [f]),
      send,
      place,
    });

    expect(send.mock.calls[1]?.[0]).toEqual({ name: 'A' });
  });

  it('throws a refusal no field answers for, without resending', async () => {
    const err = refusal('mystery');
    const send = vi.fn().mockRejectedValueOnce(err);

    await expect(saveExceptRefused<Field, string>({ payload: { name: 'A' }, refused: {}, send, place })).rejects.toBe(
      err
    );
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('throws a failure that is not a 422', async () => {
    const err = new Error('offline');
    const send = vi.fn().mockRejectedValueOnce(err);

    await expect(saveExceptRefused<Field, string>({ payload: { name: 'A' }, refused: {}, send, place })).rejects.toBe(
      err
    );
  });

  it('names the first refused field in form order', () => {
    expect(firstRefused<Field>(['name', 'notes'], { notes: 'x', name: 'y' })).toBe('name');
    expect(firstRefused<Field>(['name', 'notes'], {})).toBeUndefined();
  });
});
