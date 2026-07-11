import { describe, it, expect, vi } from 'vitest';
import { trackSupportsFlashlight, setTrackFlashlight } from './cameraTorch';

function makeTrack(capabilities: unknown, applyConstraints = vi.fn().mockResolvedValue(undefined)) {
  return {
    getCapabilities: capabilities === undefined ? undefined : () => capabilities,
    applyConstraints,
  } as unknown as MediaStreamTrack;
}

describe('trackSupportsFlashlight', () => {
  it('returns true when the track reports a torch capability', () => {
    expect(trackSupportsFlashlight(makeTrack({ torch: true }))).toBe(true);
  });

  it('returns false when torch is absent or false', () => {
    expect(trackSupportsFlashlight(makeTrack({ torch: false }))).toBe(false);
    expect(trackSupportsFlashlight(makeTrack({}))).toBe(false);
  });

  it('returns false for a null track or one without getCapabilities', () => {
    expect(trackSupportsFlashlight(null)).toBe(false);
    expect(trackSupportsFlashlight(makeTrack(undefined))).toBe(false);
  });

  it('returns false when getCapabilities throws', () => {
    const track = {
      getCapabilities: () => {
        throw new Error('not supported');
      },
    } as unknown as MediaStreamTrack;
    expect(trackSupportsFlashlight(track)).toBe(false);
  });
});

describe('setTrackFlashlight', () => {
  it('applies the torch constraint', async () => {
    const applyConstraints = vi.fn().mockResolvedValue(undefined);
    const track = makeTrack({ torch: true }, applyConstraints);
    await setTrackFlashlight(track, true);
    expect(applyConstraints).toHaveBeenCalledWith({ advanced: [{ torch: true }] });
  });
});
