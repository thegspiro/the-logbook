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
