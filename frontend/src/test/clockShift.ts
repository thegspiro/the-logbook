/**
 * Run the frontend tests as if it were another time of day.
 *
 * A test that builds "yesterday" from a UTC date passes all day in UTC and
 * fails every evening in a US timezone, where the UTC date is already tomorrow;
 * CI runs in UTC, so nothing in a normal run can see it. This setup file moves
 * the wall clock so a run can choose the hour:
 *
 *   TZ=America/New_York CLOCK_SHIFT_AT=19:30 npx vitest run --config vitest.clock-shift.config.ts
 *
 * `CLOCK_SHIFT_AT` is a local time of day in the process timezone. The clock
 * moves to the occurrence of it nearest the real one, so the jump is never more
 * than twelve hours, and keeps ticking. Without the variable nothing changes.
 * The nightly workflow (.github/workflows/clock-shift.yml) uses it.
 *
 * The global `Date` is replaced by a subclass whose `Date.now()` and argument-
 * less constructor read the moved clock; a date built from explicit values is
 * untouched. Vitest's own fake timers are not used: faking only `Date` with
 * them froze the clock and then dropped back to the real one between tests.
 * A test that installs fake timers of its own still pins its own time.
 */

// Read through import.meta.env, which Vitest fills from the environment: the
// app tsconfig that includes src/test has no Node types for `process`.
const raw: unknown = import.meta.env.CLOCK_SHIFT_AT;
const at = typeof raw === 'string' ? raw.trim() : '';

if (at) {
  const [hour = Number.NaN, minute = Number.NaN] = at.split(':').map(Number);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) {
    throw new Error(`CLOCK_SHIFT_AT must be HH:MM, not ${at}`);
  }
  const RealDate = Date;
  const realNow = RealDate.now();
  const today = new RealDate(realNow);
  const offset = [-1, 0, 1]
    .map(
      (days) =>
        new RealDate(today.getFullYear(), today.getMonth(), today.getDate() + days, hour, minute).getTime() - realNow
    )
    .reduce((best, candidate) => (Math.abs(candidate) < Math.abs(best) ? candidate : best));

  class ShiftedDate extends RealDate {
    constructor(...args: ConstructorParameters<DateConstructor> | []) {
      if (args.length === 0) {
        super(RealDate.now() + offset);
      } else {
        super(...args);
      }
    }

    static override now(): number {
      return RealDate.now() + offset;
    }
  }

  globalThis.Date = ShiftedDate as DateConstructor;
}
