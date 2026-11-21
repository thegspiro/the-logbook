/**
 * A member's optional requirements, after the graded ones.
 *
 * The backend sends them as their own list (`optional_requirements_detail`)
 * because they count toward nothing: no standing, no percentage, no reminder
 * (owner decision 2026-11-21). Shared by My Training and the officer's view
 * of the member so the two show them the same way.
 */

import React from 'react';
import { RequirementDetailCard } from './RequirementDetailCard';
import type { RequirementDetail } from '../../types/training';

interface OptionalRequirementsGroupProps {
  requirements: RequirementDetail[];
  timezone: string;
  audience?: 'self' | 'officer';
}

export const OptionalRequirementsGroup: React.FC<OptionalRequirementsGroupProps> = ({
  requirements,
  timezone,
  audience = 'self',
}) => {
  if (requirements.length === 0) return null;
  return (
    <div className="mt-4">
      <h3 className="text-theme-text-primary text-sm font-semibold">Optional</h3>
      <p className="text-theme-text-muted mb-2 text-xs">
        {audience === 'self'
          ? 'Your department lists these for you. They do not count toward your compliance.'
          : 'Listed for this member by their compliance profile. They do not count toward compliance.'}
      </p>
      <div className="space-y-3">
        {requirements.map((req) => (
          <RequirementDetailCard key={req.id} requirement={req} timezone={timezone} audience={audience} optional />
        ))}
      </div>
    </div>
  );
};
