import React from 'react';
import { SectionPageHeader } from '../layout/SectionPageHeader';
import type { PageHeaderProps } from '../layout/SectionPageHeader';
import type { SectionNavItem } from '../layout/sectionNavigation';

interface SchedulingPageHeaderProps extends PageHeaderProps {
  /**
   * The member page's views, drawn as the strip. Scheduling has one member
   * page, so only `/scheduling` passes them; the administration pages carry a
   * trail back to their hub and no strip.
   */
  sections?: SectionNavItem[] | undefined;
}

/**
 * The header every Scheduling page shares — `SectionPageHeader` in
 * Scheduling's violet. It replaces `SchedulingHeader`, whose back arrow and
 * icon tile were the one header in the app drawn that way.
 */
export const SchedulingPageHeader: React.FC<SchedulingPageHeaderProps> = ({ sections, ...props }) => (
  <SectionPageHeader {...props} sections={sections ?? []} stripLabel="Scheduling views" accent="violet" />
);

export default SchedulingPageHeader;
