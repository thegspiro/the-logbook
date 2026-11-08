import { describe, it, expect } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useFieldErrors, type FieldSpecs } from './useFieldErrors';

type Field = 'first_name' | 'start_date';

const FIELDS: FieldSpecs<Field> = {
  first_name: { id: 'first-name', label: 'First name' },
  start_date: { id: 'start-date', label: 'Start date', apiKeys: ['shift_date'] },
};

const unprocessable = (detail: unknown) => ({ response: { status: 422, data: { detail, code: 'LB-VAL-001' } } });

describe('useFieldErrors', () => {
  it('puts each 422 entry on the field it names, by name or by api key', () => {
    const { result } = renderHook(() => useFieldErrors(FIELDS));

    let matched = {};
    act(() => {
      matched = result.current.setFromApiError(
        unprocessable([
          { field: 'first_name', message: 'Value is too long.' },
          { loc: ['body', 'shift_date'], msg: 'Invalid date' },
        ])
      );
    });

    const expected = { first_name: 'Value is too long.', start_date: 'Invalid date.' };
    expect(matched).toEqual(expected);
    expect(result.current.errors).toEqual(expected);
    expect(result.current.formError).toBeNull();
  });

  it('keeps an entry for a field the form does not show, as the form-level message', () => {
    const { result } = renderHook(() => useFieldErrors(FIELDS));

    act(() => {
      result.current.setFromApiError(
        unprocessable([
          { field: 'positions', message: 'Too many seats.' },
          { field: 'request', message: 'End must be after start.' },
        ])
      );
    });

    expect(result.current.errors).toEqual({});
    expect(result.current.formError).toBe('positions: Too many seats. End must be after start.');
  });

  it('turns a failure that is not a 422 into the form-level message, with its code', () => {
    const { result } = renderHook(() => useFieldErrors(FIELDS));

    let matched: object = { stale: true };
    act(() => {
      matched = result.current.setFromApiError({
        response: { status: 409, data: { detail: 'A shift already exists then.', code: 'LB-API-409' } },
      });
    });

    expect(matched).toEqual({});
    expect(result.current.formError).toBe('A shift already exists then. (Error code: LB-API-409)');
  });

  it('lists the summary in the order the form declares its fields', () => {
    const { result } = renderHook(() => useFieldErrors(FIELDS));

    act(() => result.current.setErrors({ start_date: 'Enter a date.', first_name: 'Enter a name.' }));

    expect(result.current.summary).toEqual([
      { id: 'first-name', label: 'First name', message: 'Enter a name.' },
      { id: 'start-date', label: 'Start date', message: 'Enter a date.' },
    ]);
    expect(result.current.hasErrors).toBe(true);
  });

  it('clears one field, then everything', () => {
    const { result } = renderHook(() => useFieldErrors(FIELDS));

    act(() => result.current.setErrors({ start_date: 'Enter a date.', first_name: 'Enter a name.' }));
    act(() => result.current.setError('first_name', null));
    expect(result.current.errors).toEqual({ start_date: 'Enter a date.' });

    act(() => result.current.clear());
    expect(result.current.errors).toEqual({});
    expect(result.current.hasErrors).toBe(false);
  });

  it('focuses the first flagged field, using errors passed in the same tick', () => {
    const first = document.createElement('input');
    first.id = 'first-name';
    const date = document.createElement('input');
    date.id = 'start-date';
    document.body.append(first, date);
    const { result } = renderHook(() => useFieldErrors(FIELDS));

    act(() => result.current.focusFirst({ start_date: 'Enter a date.' }));
    expect(document.activeElement).toBe(date);

    first.remove();
    date.remove();
  });
});
