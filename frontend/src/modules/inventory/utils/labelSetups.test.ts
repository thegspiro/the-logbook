import { describe, it, expect } from 'vitest';
import { usableSetupLines } from './labelSetups';
import type { LabelSetup } from './labelSetups';

describe('usableSetupLines', () => {
  it('keeps the keys this page offers, once each, and drops the rest', () => {
    const setup = {
      id: 's1',
      name: 'Old',
      preset: 'letter',
      custom_width: null,
      custom_height: null,
      symbology: 'code128',
      extra_lines: ['size', 'no_name', 'size', 'retired_key'],
      copies: 1,
      printer_id: null,
    } satisfies LabelSetup;

    expect(usableSetupLines(setup)).toEqual(['size', 'no_name']);
  });
});
