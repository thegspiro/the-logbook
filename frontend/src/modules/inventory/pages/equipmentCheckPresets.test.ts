import { describe, expect, it } from 'vitest';

import { EQUIPMENT_PRESETS, VEHICLE_PRESETS, type PresetItem } from './equipmentCheckPresets';

/**
 * "Is it on the truck?" lines in the built-in presets are Present lines.
 *
 * They were written as Works lines with an "in place" instruction before the
 * Present type existed (2026-10-18). A preset that still did so would hand
 * every new checklist the lines the builder's "Switch 'in place' checks to
 * Present" action exists to convert.
 */
const allPresetItems = (): PresetItem[] => [
  ...Object.values(VEHICLE_PRESETS).flatMap((preset) => preset.compartments.flatMap((c) => c.items)),
  ...Object.values(EQUIPMENT_PRESETS).flatMap((preset) => preset.items),
];

describe('built-in checklist presets', () => {
  it('ask "is it in place" as Present lines, never as Works lines', () => {
    const inPlace = allPresetItems().filter((item) => item.description === 'Confirm the item is in place.');
    expect(inPlace.length).toBeGreaterThan(0);
    expect(inPlace.filter((item) => item.checkType !== 'presence').map((item) => item.name)).toEqual([]);
  });

  it('keep Works for lines that are switched on and tested', () => {
    const tested = allPresetItems().filter((item) => item.description === 'Switch it on and confirm it works.');
    expect(tested.length).toBeGreaterThan(0);
    expect(tested.every((item) => item.checkType === 'function')).toBe(true);
  });
});
