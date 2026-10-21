import React from 'react';
import { useAuthStore } from '../../stores/authStore';
import { useEnabledModules } from '../../hooks/useEnabledModules';
import { operationsNavItems } from '../layout/operationsNavigation';
import { SectionPageHeader } from '../layout/SectionPageHeader';
import type { PageHeaderProps } from '../layout/SectionPageHeader';
import { isAdministrativeMember } from '../../utils/membership';

/**
 * The header every Operations page shares — `SectionPageHeader` with the
 * Operations sections. Rows come from `operationsNavItems`, the same list the
 * side and top navigation draw, so the strip cannot offer a section the
 * navigation hides.
 *
 * The pages under Operations grew one header each, with five title sizes,
 * back links pointing at four different places and one page with a band of
 * its own; the strip and the trail replace every one of those back links.
 */
export const OperationsPageHeader: React.FC<PageHeaderProps> = (props) => {
  // Read as unknown: a suite that stubs the store without honouring the
  // selector hands back its whole stub, which is not a string.
  const membershipType: unknown = useAuthStore((state) => state.user?.membership_type);
  const isAdministrative = typeof membershipType === 'string' && isAdministrativeMember(undefined, membershipType);
  const { isModuleOn } = useEnabledModules();

  return (
    <SectionPageHeader
      {...props}
      sections={operationsNavItems(isModuleOn, isAdministrative)}
      stripLabel="Operations sections"
    />
  );
};

export default OperationsPageHeader;
