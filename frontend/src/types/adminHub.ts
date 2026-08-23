/**
 * Administration-page frame.
 *
 * Every admin page keeps the header, metrics row, attention queue and tab bar
 * in the same place, so an officer who works across Members, Training and
 * Inventory learns the page once. Only the queue's contents change module to
 * module — the shapes below are shared by all of them.
 */

/** Modules that render the administration frame. */
export const AdminHubModule = {
  MEMBERS: 'members',
  TRAINING: 'training',
  INVENTORY: 'inventory',
  EVENTS: 'events',
} as const;
export type AdminHubModule = (typeof AdminHubModule)[keyof typeof AdminHubModule];

/** One of the four cards in the metrics row. */
export interface AdminMetric {
  key: string;
  label: string;
  /** Pre-formatted by the API — the unit belongs with the number. */
  value: string;
  context: string;
  /** True for the fourth slot, which always reports the attention count. */
  fixed: boolean;
}

export type AdminAttentionSeverity = 'critical' | 'warning';

/** One exception the module wants an admin to end today. */
export interface AdminAttentionItem {
  key: string;
  title: string;
  detail: string;
  actionLabel: string;
  href: string;
  severity: AdminAttentionSeverity;
  count: number;
  oldestAgeDays: number | null;
}

export interface AdminHubSummary {
  moduleKey: string;
  generatedAt: string;
  timezone: string;
  metrics: AdminMetric[];
  attention: AdminAttentionItem[];
}

/** A metric a module could show, and whether it can be chosen right now. */
export interface AdminMetricOption {
  key: string;
  label: string;
  description: string;
  value: string | null;
  /**
   * Set when the metric cannot be selected. Shown rather than hidden, so an
   * admin can see what enabling a module would buy them.
   */
  unavailableReason: string | null;
  fixed: boolean;
}

export interface AdminMetricSettings {
  moduleKey: string;
  options: AdminMetricOption[];
  /** The three chosen open slots, in display order. */
  selected: string[];
  appliesToEveryone: boolean;
  isPersonal: boolean;
  departmentDefault: string[];
  builtInDefault: string[];
}

export interface AdminMetricSettingsUpdate {
  metricKeys: string[];
  appliesToEveryone: boolean;
}

/** Open slots an admin may choose. The fourth is fixed, so three. */
export const ADMIN_METRIC_OPEN_SLOTS = 3;

/** Key of the always-on fourth slot. */
export const ADMIN_ATTENTION_METRIC_KEY = 'needs_attention';
