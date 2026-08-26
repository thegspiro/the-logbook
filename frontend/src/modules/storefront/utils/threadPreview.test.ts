import { describe, it, expect } from 'vitest';

import { hexLuminance, needsLightBackdrop, threadPreviewCaption, threadPreviewSurface } from './threadPreview';
import { EMBROIDERY_THREAD_COLORS } from '../types';

describe('hexLuminance', () => {
  it('reads the ends of the range', () => {
    expect(hexLuminance('#000000')).toBeCloseTo(0, 5);
    expect(hexLuminance('#ffffff')).toBeCloseTo(1, 5);
  });

  it('accepts shorthand and a missing hash', () => {
    expect(hexLuminance('#fff')).toBeCloseTo(hexLuminance('#ffffff'), 5);
    expect(hexLuminance('ffffff')).toBeCloseTo(hexLuminance('#ffffff'), 5);
  });

  it('treats an unparseable value as mid-tone rather than throwing', () => {
    // A bad value must not decide the layout, and must not take the card down.
    expect(hexLuminance('not-a-color')).toBe(0.5);
    expect(hexLuminance('')).toBe(0.5);
  });
});

describe('preview backdrop', () => {
  it('puts a dark thread on a light garment', () => {
    // Black stitching on the old fixed slate swatch was an empty box, which
    // reads as a broken preview rather than as a dark thread.
    expect(needsLightBackdrop('#1c1917')).toBe(true);
    expect(threadPreviewSurface('#1c1917')).toContain('bg-slate-100');
    expect(threadPreviewCaption('#1c1917')).toBe('text-slate-600');
  });

  it('keeps the historical dark swatch for a light thread', () => {
    expect(needsLightBackdrop('#f5f5f4')).toBe(false);
    expect(threadPreviewSurface('#f5f5f4')).toContain('bg-slate-800');
    expect(threadPreviewCaption('#f5f5f4')).toBe('text-slate-300');
  });

  it('keeps gold on the dark swatch it always used', () => {
    expect(needsLightBackdrop('#c8a02c')).toBe(false);
  });

  it('puts a mid-tone on whichever backdrop actually contrasts', () => {
    // Orange sits near the middle of the range: a fixed light/dark cutoff put
    // it on the dark swatch at 1.7:1. It belongs on the light one.
    expect(needsLightBackdrop('#c2570f')).toBe(true);
  });

  it('gives every palette colour a backdrop it is legible against', () => {
    for (const color of EMBROIDERY_THREAD_COLORS) {
      const backdrop = needsLightBackdrop(color.hex) ? 0.87 : 0.09;
      const thread = hexLuminance(color.hex);
      const lighter = Math.max(backdrop, thread);
      const darker = Math.min(backdrop, thread);
      const ratio = (lighter + 0.05) / (darker + 0.05);
      // 3:1 is the WCAG floor for large/bold text, which the preview is.
      expect(ratio, `${color.label} on its chosen backdrop`).toBeGreaterThan(3);
    }
  });
});
