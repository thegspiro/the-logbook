import React from 'react';
import { offersSkillsTesting, usePracticalSkillsMethod } from '../../stores/practicalSkillsStore';
import { trainingNavItems } from '../layout/trainingNavigation';
import { SectionPageHeader } from '../layout/SectionPageHeader';
import type { PageHeaderProps } from '../layout/SectionPageHeader';

/**
 * The header every Training page shares — `SectionPageHeader` with the
 * Training sections. Rows come from `trainingNavItems`, the same list the side
 * and top navigation draw, so the strip cannot offer a section the navigation
 * hides.
 */
export const TrainingPageHeader: React.FC<PageHeaderProps> = (props) => {
  const practicalSkillsMethod = usePracticalSkillsMethod();
  return (
    <SectionPageHeader
      {...props}
      sections={trainingNavItems(offersSkillsTesting(practicalSkillsMethod))}
      stripLabel="Training sections"
    />
  );
};

export default TrainingPageHeader;
