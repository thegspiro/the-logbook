/**
 * The shared administration-page frame.
 *
 * Every admin page keeps the header, metrics row, attention queue and tab bar
 * in the same place. Import from here rather than reaching for a file — a new
 * admin page should inherit the frame, not re-derive it.
 */

export { AdminHubFrame } from './AdminHubFrame';
export type { AdminHubTab, AdminHubAction } from './AdminHubFrame';
export { AdminAttentionQueue } from './AdminAttentionQueue';
export { AdminMetricsRow } from './AdminMetricsRow';
export { AdminMetricsSettings } from './AdminMetricsSettings';
