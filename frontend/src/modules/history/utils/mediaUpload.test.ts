import { describe, expect, it } from 'vitest';
import { precheck } from './mediaUpload';

const file = (name: string, megabytes: number) => {
  const f = new File(['x'], name);
  Object.defineProperty(f, 'size', { value: megabytes * 1024 * 1024 });
  return f;
};

describe('precheck', () => {
  it('lets through what the server accepts', () => {
    expect(precheck(file('photo.JPG', 19))).toBeNull();
    expect(precheck(file('interview.m4a', 54))).toBeNull();
  });

  it('refuses a photo over 20 MB and a recording over 55 MB', () => {
    expect(precheck(file('photo.png', 21))).toBe('Over the 20 MB limit for photos');
    expect(precheck(file('parade.mp4', 56))).toBe('Over the 55 MB limit for audio and video');
  });

  it('refuses a type the archive does not take', () => {
    expect(precheck(file('letter.pdf', 1))).toBe('Not an accepted type');
    // TIFF is refused (owner decision): scans are converted first.
    expect(precheck(file('scan.TIF', 1))).toBe('Not an accepted type');
    expect(precheck(file('scan.tiff', 1))).toBe('Not an accepted type');
    expect(precheck(file('noextension', 1))).toBe('Not an accepted type');
  });
});
