import toast from 'react-hot-toast';

import type { PatternGenerateResponse } from '../types';

/**
 * What an officer is told after generating shifts from a pattern.
 *
 * Both generate screens (the Patterns section and the templates page's modal)
 * go through here, so neither can drop the half of the response the other
 * shows.
 */
export function generationSummary(result: PatternGenerateResponse): string {
  const count = Number(result.shifts_created ?? 0);
  if (count === 0) {
    // Zero is the normal answer to re-running a range, and it reads as a
    // failure unless it says why.
    return 'No new shifts. Dates already on the schedule are skipped, as are dates outside the pattern’s own start and end.';
  }
  return `Generated ${String(count)} shift${count === 1 ? '' : 's'}`;
}

export function reportGeneration(result: PatternGenerateResponse): void {
  toast.success(generationSummary(result));
  // The backend leaves a driver seat empty rather than assign a member without
  // the apparatus's EVOC level, and reports it for exactly this screen: an
  // unfilled seat the officer never hears about is the worse outcome.
  const warnings = result.driver_warnings ?? [];
  if (warnings.length > 0) {
    const seats = warnings.length === 1 ? 'One driver seat was' : `${String(warnings.length)} driver seats were`;
    toast.error(`${seats} left unfilled: ${warnings.join('; ')}`, { duration: 8000 });
  }
}
