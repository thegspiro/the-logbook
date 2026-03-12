import type { AxeResults } from 'axe-core';

declare module '@vitest/expect' {
  interface Matchers<T = unknown> {
    toHaveNoViolations(): T;
  }
}
