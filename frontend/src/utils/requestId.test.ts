import { describe, it, expect, afterEach } from 'vitest';
import { newRequestId } from './requestId';

// What the server accepts (TrainingSubmissionCreate.client_request_id).
const SERVER_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;

describe('newRequestId', () => {
  const original = Object.getOwnPropertyDescriptor(crypto, 'randomUUID');

  afterEach(() => {
    if (original) Object.defineProperty(crypto, 'randomUUID', original);
    else Reflect.deleteProperty(crypto, 'randomUUID');
  });

  it('produces an id the server accepts, different each time', () => {
    const first = newRequestId();

    expect(first).toMatch(SERVER_PATTERN);
    expect(newRequestId()).not.toBe(first);
  });

  it('still works where randomUUID is missing, as on a station served over plain HTTP', () => {
    Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true });

    const id = newRequestId();

    expect(id).toMatch(SERVER_PATTERN);
    expect(id).toHaveLength(32);
  });
});
