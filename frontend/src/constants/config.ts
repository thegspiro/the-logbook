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
export const MAX_FORM_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

// ============================================
// WebSocket reconnection
// ============================================
export const WS_MAX_RECONNECT_DELAY_MS = 30_000;
