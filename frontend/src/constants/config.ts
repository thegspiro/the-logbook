/**
 * App-wide configuration constants.
 *
 * Centralises magic numbers that were previously scattered across components
 * so they can be tuned in one place.
 */

// ============================================
// Network / API
// ============================================
export const API_TIMEOUT_MS = 30_000; // 30 seconds

// ============================================
// Pagination defaults
// ============================================
export const DEFAULT_PAGE_SIZE = 25;
export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;

// ============================================
// Auto-save
// ============================================
export const AUTO_SAVE_INTERVAL_MS = 30_000; // 30 seconds

/**
 * How long a settings field waits after the last keystroke before it writes.
 * Long enough that typing a department name is one save rather than twenty,
 * short enough that a member who types and immediately navigates away has
 * still had the write dispatched.
 */
export const SETTINGS_AUTOSAVE_DEBOUNCE_MS = 600;

/**
 * Minimum time the settings autosave pill stays on "Saving…". A write that
 * resolves in 40ms would otherwise flash the pill through two states too fast
 * to read, which looks like a glitch rather than a save.
 */
export const SETTINGS_SAVE_MIN_VISIBLE_MS = 700;

// ============================================
// File uploads
// ============================================
export const MAX_AVATAR_SIZE = 5 * 1024 * 1024; // 5 MB
// 10 MB

// ============================================
// Member lookup (skills testing)
// ============================================
// The member picker is a *search*, never a listing: GET
// /training/skills-testing/candidates requires a fragment and caps its results,
// so no request returns the roster. These mirror the server's own limits and
// are shared by every picker that uses it — a client floor below the server's
// would send searches the API refuses.

/** Must not be below the endpoint's CANDIDATE_SEARCH_MIN_CHARS. */
export const MEMBER_SEARCH_MIN_CHARS = 2;
/** Mirrors CANDIDATE_SEARCH_MAX_RESULTS — used only to tell the user their
 *  search was truncated, never to trim results client-side. */
export const MEMBER_SEARCH_MAX_RESULTS = 15;
/** Long enough that typing a name is one request, not one per keystroke. */
export const MEMBER_SEARCH_DEBOUNCE_MS = 300;

// ============================================
// Events list urgency
// ============================================
// How the /events list decides an event is close enough to need the member's
// attention now. Both windows are deliberately the same length so a card can
// never say "Tomorrow" while the band stays silent about its RSVP deadline.

/** Inside this window an event's time reads as "Tonight" / "Tomorrow". */
export const EVENT_RELATIVE_LABEL_WINDOW_MS = 48 * 60 * 60 * 1000; // 48 hours
/** An unanswered RSVP whose deadline falls inside this window is urgent. */
export const EVENT_RSVP_DEADLINE_SOON_MS = 48 * 60 * 60 * 1000; // 48 hours
/** How far back the list looks for mandatory events with no check-in. */
export const EVENT_MISSED_LOOKBACK_DAYS = 30;
/** Rows the "Needs You" band shows before collapsing the rest into a link. */
export const NEEDS_YOU_MAX_ROWS = 5;

// ============================================
// Training compliance
// ============================================

/**
 * A certification still valid but expiring inside this window reads as "Due
 * soon" rather than "Met" on the compliance matrix.
 *
 * Sixty days is a renewal lead time, not a display preference: it is roughly
 * how long a member needs to book a class and get the paperwork filed, so a
 * cert flagged here is still recoverable without a lapse in coverage.
 */
export const COMPLIANCE_EXPIRING_SOON_DAYS = 60;
