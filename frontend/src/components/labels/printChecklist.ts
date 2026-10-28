/** "Don't show again" for the label print checklist, shared by every label page. */

// Per browser: the computer at the label printer is the one that remembers the
// driver's paper size, so "I've set this up" is a fact about that browser.
// The key keeps its original inventory: prefix so choices already made carry
// over; the driver setting it records is the same whichever page prints.
const SKIP_STORAGE_KEY = 'inventory:labelPrintChecklistSkip';
// Bounded so a stream of custom sizes cannot grow the entry without limit.
const MAX_SKIPPED_SIZES = 20;

function loadSkipped(): string[] {
  try {
    const raw = localStorage.getItem(SKIP_STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

/** Whether the member asked not to see the checklist again for this size. */
export function isPrintChecklistSkipped(sizeKey: string): boolean {
  return loadSkipped().includes(sizeKey);
}

export function rememberPrintChecklistSkipped(sizeKey: string): void {
  try {
    const next = [sizeKey, ...loadSkipped().filter((k) => k !== sizeKey)].slice(0, MAX_SKIPPED_SIZES);
    localStorage.setItem(SKIP_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Unavailable storage only means the checklist shows again next time.
  }
}
