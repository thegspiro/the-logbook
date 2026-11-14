import React from 'react';
import { Navigate, useLocation, useParams } from 'react-router';
import { ElectionDetailPage } from '../../pages/ElectionDetailPage';
import { electionSectionPath, isElectionSection } from './electionSections';

/**
 * Forwards an election link written against the `?tab=` contract to the
 * section's own path, then renders the page.
 *
 * Kept indefinitely, not as a migration aid: the backend has put
 * `/elections/{id}?tab=nominations` in notification emails (and bookmarks and
 * chat messages hold the rest), and a link in an inbox cannot be updated. An
 * unknown tab — or the old `?tab=overview` — opens the Overview. Any other
 * query parameter is carried along.
 */
export const ElectionDetailRoute: React.FC = () => {
  const { electionId } = useParams<{ electionId: string }>();
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  const tab = params.get('tab');

  if (electionId && tab !== null) {
    params.delete('tab');
    const rest = params.toString();
    const target = electionSectionPath(electionId, isElectionSection(tab) ? tab : null);
    return <Navigate to={`${target}${rest ? `?${rest}` : ''}${location.hash}`} replace />;
  }

  return <ElectionDetailPage />;
};

export default ElectionDetailRoute;
