import { describe, it, expect } from 'vitest';
import { friendlyFieldMessage, mapServerFieldErrors } from './serverFieldErrors';

const err422 = (detail: unknown, status = 422) => ({ response: { status, data: { detail } } });

describe('mapServerFieldErrors', () => {
  const fields = {
    firstName: { label: 'First name', maxLength: 100 },
    email: { label: 'Email' },
    emergencyPhone1: { label: 'Emergency phone', maxLength: 20, api: 'emergency_contacts.0.phone' },
  };

  it('puts the API handler’s snake_case field on the camelCase form key, in the field’s own words', () => {
    const result = mapServerFieldErrors(err422([{ field: 'first_name', message: 'Value is too long.' }]), fields);
    expect(result?.fieldErrors).toEqual({ firstName: 'First name is too long — keep it to 100 characters.' });
    expect(result?.unmatched).toEqual([]);
  });

  it('reads Pydantic’s own {loc, msg} spelling, dropping the body prefix', () => {
    const result = mapServerFieldErrors(
      err422([{ loc: ['body', 'emergency_contacts', 0, 'phone'], msg: 'String should have at most 20 characters' }]),
      fields
    );
    expect(result?.fieldErrors.emergencyPhone1).toBe('Emergency phone is too long — keep it to 20 characters.');
  });

  it('matches a camelCase module’s field name too', () => {
    const result = mapServerFieldErrors(err422([{ field: 'firstName', message: 'This field is required.' }]), fields);
    expect(result?.fieldErrors.firstName).toBe('First name is required.');
  });

  it('keeps a validator’s own message, which is already written for the member', () => {
    const message = 'Enter a phone number using digits, spaces, dashes or parentheses.';
    const result = mapServerFieldErrors(err422([{ field: 'email', message }]), fields);
    expect(result?.fieldErrors.email).toBe(message);
  });

  it('reports an entry the form has no field for without naming the API field', () => {
    const result = mapServerFieldErrors(err422([{ field: 'username', message: 'Value is too short.' }]), fields);
    expect(result?.fieldErrors).toEqual({});
    expect(result?.unmatched).toEqual(['Value is too short.']);
  });

  it('keeps the first error per field', () => {
    const result = mapServerFieldErrors(
      err422([
        { field: 'email', message: 'Invalid value.' },
        { field: 'email', message: 'Value is too long.' },
      ]),
      fields
    );
    expect(result?.fieldErrors.email).toBe("Email isn't a value this form accepts.");
  });

  it('is null for anything that is not a 422 with a list', () => {
    expect(mapServerFieldErrors(err422('Username already exists', 400), fields)).toBeNull();
    expect(mapServerFieldErrors(err422('Bad', 422), fields)).toBeNull();
    expect(mapServerFieldErrors(new Error('network'), fields)).toBeNull();
  });
});

describe('friendlyFieldMessage', () => {
  it('words the server’s generic messages with the label', () => {
    expect(friendlyFieldMessage('Value is too short.', { label: 'Title' })).toBe("Title can't be blank.");
    expect(friendlyFieldMessage('Invalid date format.', { label: 'Date' })).toBe('Date needs a valid date.');
    expect(friendlyFieldMessage('Expected a number.', { label: 'Hours' })).toBe('Hours needs a number.');
    expect(friendlyFieldMessage('Value is too long.', { label: 'Notes' })).toBe('Notes is too long.');
  });
});
