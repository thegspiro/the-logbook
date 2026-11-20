import { mergeConfig } from 'vitest/config';

import base from './vitest.config';

// The normal configuration plus src/test/clockShift.ts, which moves the wall
// clock to CLOCK_SHIFT_AT. Used by the nightly clock-shift workflow; kept out
// of vitest.config.ts so an everyday run never loads it.
export default mergeConfig(base, {
  test: {
    setupFiles: ['./src/test/clockShift.ts'],
  },
});
