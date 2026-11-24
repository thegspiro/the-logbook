/**
 * A member's graded requirements, as the server evaluated them, for screens
 * that show a member's certifications outside My Training: the member profile
 * and the digital ID card.
 *
 * On one's own record they come from My Training's endpoint, which applies the
 * department's visibility settings to the member; for another member they
 * come from the officer's member endpoint, behind training.manage. Callers
 * pass `enabled` only when the viewer may read that member's training, so a
 * viewer without it never asks. A failed load reads as no requirements, which
 * hides what depends on them rather than showing a guess.
 */

import { useEffect, useState } from 'react';
import { trainingModuleConfigService } from '../services/api';
import type { RequirementDetail } from '../types/training';

export const useMemberRequirements = (
  userId: string | undefined,
  enabled: boolean,
  self: boolean
): RequirementDetail[] => {
  const [requirements, setRequirements] = useState<RequirementDetail[]>([]);

  useEffect(() => {
    if (!userId || !enabled) {
      setRequirements([]);
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const details = self
          ? ((await trainingModuleConfigService.getMyTraining()).requirements_detail ?? [])
          : (await trainingModuleConfigService.getMemberRequirements(userId)).requirements_detail;
        if (!cancelled) setRequirements(details);
      } catch {
        if (!cancelled) setRequirements([]);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [userId, enabled, self]);

  return requirements;
};
