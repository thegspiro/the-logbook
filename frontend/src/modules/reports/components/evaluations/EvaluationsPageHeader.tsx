import React from 'react';
import { evaluationsNavItems } from '../../../../components/layout/evaluationsNavigation';
import { SectionPageHeader } from '../../../../components/layout/SectionPageHeader';
import type { PageHeaderProps } from '../../../../components/layout/SectionPageHeader';
import { useSectionPermission } from '../../../../components/layout/useSectionPermission';

/**
 * The header every Evaluations section page shares — `SectionPageHeader` with
 * the Evaluations sections. The navigation has a single Evaluations entry, so
 * this strip is where an evaluator reaches the evaluations they conduct and an
 * administrator reaches templates and review periods. A member who holds
 * neither sees one section, and the strip draws nothing for one.
 */
export const EvaluationsPageHeader: React.FC<PageHeaderProps> = (props) => {
  const checkPermission = useSectionPermission();
  return (
    <SectionPageHeader {...props} sections={evaluationsNavItems(checkPermission)} stripLabel="Evaluations sections" />
  );
};

export default EvaluationsPageHeader;
