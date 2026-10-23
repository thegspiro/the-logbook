/**
 * Marks a deactivated prerequisite pipeline or training requirement that a
 * pipeline still lists. The backend skips it while it is inactive — nobody is
 * blocked by an inactive prerequisite, and an inactive requirement does not
 * count toward finishing a pipeline — but keeps it stored, so it applies again
 * the day it is reactivated. Shown rather than hidden so an officer can see
 * why a listed item is not being enforced.
 */
import React from 'react';

export const INACTIVE_NOT_REQUIRED_LABEL = 'Inactive — not currently required';

export const InactiveNotRequiredBadge: React.FC = () => (
  <span className="badge bg-theme-surface text-theme-text-secondary">{INACTIVE_NOT_REQUIRED_LABEL}</span>
);

export default InactiveNotRequiredBadge;
