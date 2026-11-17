import React from 'react';
import { useEnabledModules } from '../../hooks/useEnabledModules';
import { governanceNavItems } from '../layout/governanceNavigation';
import { useWaiverAttentionAnswer, WaiverAttentionKey } from '../../hooks/useWaiverAttention';
import { SectionPageHeader } from '../layout/SectionPageHeader';
import type { PageHeaderProps } from '../layout/SectionPageHeader';

/**
 * The header every Governance page shares — `SectionPageHeader` with the
 * Governance sections. Rows come from `governanceNavItems`, the same list the
 * side and top navigation draw, so the strip cannot offer a section the
 * navigation hides.
 */
export const GovernancePageHeader: React.FC<PageHeaderProps> = (props) => {
  const { isModuleOn } = useEnabledModules();
  // Asked for by the side or top navigation, which every page mounts.
  const waivers = { meetings: useWaiverAttentionAnswer(WaiverAttentionKey.BUSINESS_MEETING) };
  return (
    <SectionPageHeader
      {...props}
      sections={governanceNavItems(isModuleOn, waivers.meetings)}
      stripLabel="Governance sections"
    />
  );
};

export default GovernancePageHeader;
