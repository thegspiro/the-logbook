import { describe, it, expect } from 'vitest';
import { MIN_POPOVER_HEIGHT_PX, cssLengthToPx, placePopover } from './popoverPlacement';

const LAPTOP = { width: 1440, height: 900 };
const PHONE = { width: 390, height: 844 };
const PANEL = { preferredWidth: 448 };

/** A 160x36 button whose top is at `top` and right edge at `right`. */
function trigger(top: number, right = 1060) {
  return { top, bottom: top + 36, left: right - 160, right };
}

describe('placePopover — side and height', () => {
  it('caps an upward panel at the room above, so its top stays on screen', () => {
    // The template picker's button on the election ballot page sits ~470px
    // down a 900px window. Its panel used to be 70% of the window tall and
    // ran ~160px past the top edge, where nothing could scroll to it.
    const placement = placePopover(trigger(473), LAPTOP, PANEL);
    expect(placement.side).toBe('above');
    expect(placement.maxHeight).toBe(473 - 8 - 16);
    expect(473 - 8 - placement.maxHeight).toBe(16);
  });

  it('opens downward when there is more room below', () => {
    const placement = placePopover(trigger(300), LAPTOP, PANEL);
    expect(placement.side).toBe('below');
    expect(placement.maxHeight).toBe(900 - 336 - 8 - 16);
  });

  it('caps the panel at 70% of the window when there is more room than that', () => {
    const placement = placePopover(trigger(800), LAPTOP, PANEL);
    expect(placement.side).toBe('above');
    expect(placement.maxHeight).toBe(630);
  });

  it('counts the mobile bottom bar as unavailable room below', () => {
    expect(placePopover(trigger(380, 300), PHONE, PANEL).side).toBe('below');
    expect(placePopover(trigger(380, 300), PHONE, { ...PANEL, bottomInset: 120 }).side).toBe('above');
  });

  it('counts the fixed phone header as unavailable room above', () => {
    // A 64px header covered the panel's heading when only the window's own
    // top edge was kept clear.
    const placement = placePopover(trigger(450, 300), PHONE, { ...PANEL, topInset: 64, bottomInset: 56 });
    expect(placement.side).toBe('above');
    expect(450 - 8 - placement.maxHeight).toBe(64 + 16);
  });

  it('opens downward when neither side has usable room', () => {
    const placement = placePopover(trigger(150), { width: 1440, height: 330 }, PANEL);
    expect(placement.side).toBe('below');
    expect(placement.maxHeight).toBe(MIN_POPOVER_HEIGHT_PX);
  });
});

describe('placePopover — width and horizontal position', () => {
  it('lines up with the trigger’s right edge where that fits', () => {
    const placement = placePopover(trigger(300, 1060), LAPTOP, PANEL);
    expect(placement.width).toBe(448);
    // Right edges level: the panel starts 448 - 160 = 288px left of the button.
    expect(placement.offsetLeft).toBe(-288);
  });

  it('shifts right to keep a phone panel off the left edge', () => {
    // On a phone the toolbar wraps and the button sits at the left of the row.
    // Right-aligned, a 358px panel started at -173px.
    const button = { top: 400, bottom: 444, left: 40, right: 185 };
    const placement = placePopover(button, PHONE, PANEL);
    expect(placement.width).toBe(390 - 32);
    const panelLeft = button.left + placement.offsetLeft;
    expect(panelLeft).toBe(16);
    expect(panelLeft + placement.width).toBe(390 - 16);
  });

  it('shifts left to keep the panel off the right edge', () => {
    const button = { top: 300, bottom: 336, left: 1400, right: 1440 };
    const placement = placePopover(button, LAPTOP, PANEL);
    expect(button.left + placement.offsetLeft + placement.width).toBe(1440 - 16);
  });
});

describe('cssLengthToPx', () => {
  it('converts rem by the root font size, and passes px through', () => {
    // --bottom-nav-height is 3.5rem; read as a bare number it was 3.5px.
    expect(cssLengthToPx(' 3.5rem', 16)).toBe(56);
    expect(cssLengthToPx('56px', 16)).toBe(56);
  });

  it('reads an unset or unknown value as zero', () => {
    expect(cssLengthToPx('', 16)).toBe(0);
    expect(cssLengthToPx('2em', 16)).toBe(0);
  });
});
