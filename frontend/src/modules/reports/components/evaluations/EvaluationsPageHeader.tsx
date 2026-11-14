import React, { useEffect, useState } from 'react';
import { evaluationsNavItems } from '../../../../components/layout/evaluationsNavigation';
import { SectionPageHeader } from '../../../../components/layout/SectionPageHeader';
import type { PageHeaderProps } from '../../../../components/layout/SectionPageHeader';
import { useSectionPermission } from '../../../../components/layout/useSectionPermission';
import { evaluationsService } from '../../services/evaluationsApi';
import type { AttentionCounts } from '../../types/evaluations';

/**
 * The header every Evaluations section page shares — `SectionPageHeader` with
 * the Evaluations sections. The navigation has a single Evaluations entry, so
 * this strip is where an evaluator reaches the evaluations they conduct and an
 * administrator reaches templates and review periods. A member who holds
 * neither sees one section, and the strip draws nothing for one.
 *
 * The strip names the open page, so on a wide enough screen its heading is
 * drawn for screen readers only while the strip shows (`titleInStrip`). Its links carry the server's
 * counts of what waits there; a failed request leaves them unbadged rather
 * than holding up the page.
 */
export const EvaluationsPageHeader: React.FC<PageHeaderProps> = (props) => {
  const checkPermission = useSectionPermission();
  const [counts, setCounts] = useState<AttentionCounts | null>(null);

  useEffect(() => {
    let cancelled = false;
    evaluationsService
      .attention()
      .then((result) => {
        if (!cancelled) setCounts(result);
      })
      .catch(() => {
        if (!cancelled) setCounts(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <SectionPageHeader
      titleInStrip
      {...props}
      sections={evaluationsNavItems(checkPermission, counts)}
      stripLabel="Evaluations sections"
    />
  );
};

export default EvaluationsPageHeader;
