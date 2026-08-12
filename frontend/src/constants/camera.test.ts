import { describe, it, expect, afterEach, vi } from 'vitest';
import { acquirePreferredCameraStream, describeCameraError, getCameraUnavailableReason } from './camera';

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

describe('describeCameraError', () => {
  // `getUserMedia` rejects with a DOMException, which is an Error carrying its
  // own message — so the `getErrorMessage(err, 'friendly fallback…')` these
  // call sites used never reached the fallback, and the browser's own wording
  // went to the screen instead. A laptop with no webcam said "Requested device
  // not found", which names no cause and suggests no action.
  const domException = (name: string, message: string) => {
    const error = new Error(message);
    error.name = name;
    return error;
  };

  it('does not pass the browser wording through', () => {
    const message = describeCameraError(domException('NotFoundError', 'Requested device not found'));
    expect(message).not.toContain('Requested device not found');
  });

  it('sends a blocked permission to browser settings', () => {
    expect(describeCameraError(domException('NotAllowedError', 'Permission denied'))).toMatch(/browser settings/);
  });

  it('does not send a device with no camera to browser settings', () => {
    // The distinguishing case: no permission dialog will ever appear here, so
    // telling this member to go and grant one sends them somewhere with
    // nothing to do.
    const message = describeCameraError(domException('NotFoundError', 'Requested device not found'));
    expect(message).toMatch(/No camera was found/);
    expect(message).not.toMatch(/browser settings/);
  });

  it('names the conflict when another app holds the camera', () => {
    expect(describeCameraError(domException('NotReadableError', 'Could not start source'))).toMatch(
      /in use by another app/
    );
  });

  it('handles a DOMException that is not on the Error prototype chain', () => {
    const exceptionLike = Object.create(null) as { name: string; message: string };
    exceptionLike.name = 'NotReadableError';
    exceptionLike.message = 'Could not start source';
    expect(describeCameraError(exceptionLike)).toMatch(/in use by another app/);
  });

  it('falls back to something actionable for an unrecognised failure', () => {
    expect(describeCameraError(new Error('boom'))).toMatch(/could not be started/);
    expect(describeCameraError('not an error at all')).toMatch(/could not be started/);
  });
});

describe('acquirePreferredCameraStream', () => {
  const original = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');

  afterEach(() => {
    if (original) Object.defineProperty(navigator, 'mediaDevices', original);
  });

  it('requests a video-only stream and prefers the rear mobile camera', async () => {
    const stream = {} as MediaStream;
    const getUserMedia = vi.fn().mockResolvedValue(stream);
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia },
    });

    await expect(acquirePreferredCameraStream()).resolves.toBe(stream);
    expect(getUserMedia).toHaveBeenCalledExactlyOnceWith({
      video: { facingMode: { ideal: 'environment' } },
      audio: false,
    });
  });

  it('preserves the original camera error without making a front-camera retry', async () => {
    const permissionError = new DOMException('Permission denied', 'NotAllowedError');
    const getUserMedia = vi.fn().mockRejectedValue(permissionError);
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia },
    });

    await expect(acquirePreferredCameraStream()).rejects.toBe(permissionError);
    expect(getUserMedia).toHaveBeenCalledExactlyOnceWith({
      video: { facingMode: { ideal: 'environment' } },
      audio: false,
    });
  });
});
