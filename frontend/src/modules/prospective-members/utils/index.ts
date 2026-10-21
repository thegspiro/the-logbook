/**
 * Prospective Members Module Utilities
 *
 * Pure utility functions extracted from types/index.ts. These deal with
 * runtime logic (validation, formatting) rather than type definitions.
 */

import type { InactivityConfig, PipelineStage } from '../types';
import { TIMEOUT_PRESET_DAYS } from '../types';

/**
 * Compute effective timeout days from an InactivityConfig.
 * Returns null if the timeout is disabled ('never').
 */
export function getEffectiveTimeoutDays(config: InactivityConfig): number | null {
  if (config.timeout_preset === 'never') return null;
  if (config.timeout_preset === 'custom') {
    const days = config.custom_timeout_days;
    if (days == null || days <= 0 || !Number.isFinite(days)) return null;
    return days;
  }
  return TIMEOUT_PRESET_DAYS[config.timeout_preset];
}

/** Validate that a URL uses a safe protocol (http/https only). */
export function isSafeUrl(url: string): boolean {
  try {
    const parsed = new URL(url, window.location.origin);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * How to name a multi-approval stage's approver role on screen.
 *
 * The labels come from the backend's office catalog (the step response's
 * `approver_labels`), which is also what decides who may sign — so this does
 * not keep a second catalog. A role with no label, from a response that
 * predates the field or a department's own free-text role, is humanized the
 * way the backend's own fallback is ("hose_master" -> "Hose Master").
 */
export function approverRoleLabel(role: string, labels?: Record<string, string>): string {
  return (
    labels?.[role] ||
    role
      .trim()
      .split('_')
      .filter(Boolean)
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ')
  );
}

/** Safe initials extraction that handles empty strings. */
export function getInitials(firstName: string, lastName: string): string {
  const f = firstName?.trim();
  const l = lastName?.trim();
  return `${f ? f[0] : '?'}${l ? l[0] : '?'}`.toUpperCase();
}

/** Basic email format validation. */
export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/**
 * Whether the drawer's primary action on this stage is **Convert** rather than
 * **Advance**.
 *
 * The backend decides conversion from `is_final_step`, not from the order, and
 * a flagged stage can sit anywhere (a stage can be created flagged, and a
 * reorder only moves the flag in a pipeline that already has one). Labelling
 * by order let completing a flagged mid-pipeline stage convert the applicant
 * under a button that said Advance. So the flag decides; a pipeline with no
 * flagged stage keeps Convert on its highest stage, because the manual
 * transfer it calls works regardless of the flag and those pipelines would
 * otherwise have no Convert at all (owner decision).
 */
export function isConvertStage(stages: readonly PipelineStage[], stageId: string | undefined): boolean {
  if (!stageId || stages.length === 0) return false;
  if (stages.some((s) => s.is_final_step === true)) {
    return stages.some((s) => s.id === stageId && s.is_final_step === true);
  }
  const highest = stages.reduce((top, s) => (s.sort_order > top.sort_order ? s : top));
  return highest.id === stageId;
}
