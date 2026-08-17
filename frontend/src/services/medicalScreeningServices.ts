/**
 * medicalScreeningServices — the member's own screening compliance.
 *
 * Only the self-service read lives here. Managing requirements and records is
 * an officer surface behind `medical_screening.view` / `.manage` and is not
 * wired into the frontend yet.
 */

import api from './apiClient';

/**
 * The caller's own screening compliance, as counts.
 *
 * Carries no requirement names, screening types, dates or statuses by design —
 * the dashboard renders this on tablets left at stations, where naming a
 * screening discloses it to whoever walks past. See the backend
 * `MyComplianceSummary` schema.
 */
export interface MyComplianceSummary {
  total_requirements: number;
  compliant_count: number;
  non_compliant_count: number;
  expiring_soon_count: number;
  is_fully_compliant: boolean;
  /** Days until the soonest still-valid screening lapses; null when none is due. */
  days_until_next_expiration: number | null;
}

export const medicalScreeningService = {
  /**
   * Compliance counts for the signed-in member.
   *
   * Not de-duplicated and never cached: `/medical-screening/` is in
   * UNCACHEABLE_PREFIXES because the module carries PHI, and this read is
   * cheap enough that it does not need an exception carved for it.
   */
  async getMyCompliance(): Promise<MyComplianceSummary> {
    const response = await api.get<MyComplianceSummary>('/medical-screening/compliance/me');
    return response.data;
  },
};
