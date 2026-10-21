import React from 'react';
import { useEnabledModules } from '../../hooks/useEnabledModules';
import { governanceNavItems } from '../layout/governanceNavigation';
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
  return <SectionPageHeader {...props} sections={governanceNavItems(isModuleOn)} stripLabel="Governance sections" />;
};

export default GovernancePageHeader;
