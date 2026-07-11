import { describe, it, expect, afterEach } from 'vitest';
import { getCameraUnavailableReason } from './camera';

describe('getCameraUnavailableReason', () => {
  const original = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');

  afterEach(() => {
    if (original) {
      Object.defineProperty(navigator, 'mediaDevices', original);
    }
  });

  it('returns null when a camera API is present (secure context)', () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: () => Promise.resolve(null) },
    });
    expect(getCameraUnavailableReason()).toBeNull();
  });

  it('returns an HTTPS message when mediaDevices is absent (insecure origin)', () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: undefined,
    });
    const reason = getCameraUnavailableReason();
    expect(reason).toMatch(/HTTPS/i);
  });
});
