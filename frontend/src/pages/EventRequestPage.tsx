/**
 * One outreach request on a page of its own, at /events/admin/requests/:requestId.
 *
 * Owner decision, 2026-11-21: a request opens as a page rather than a side
 * panel over the board, so it can be linked from a coordinator's email,
 * bookmarked, refreshed into and left with the back button. The board and the
 * page are one component (EventRequestsTab) so the two cannot drift apart.
 */

import React from 'react';
import { useParams } from 'react-router';
import EventRequestsTab from './EventRequestsTab';

const EventRequestPage: React.FC = () => {
  const { requestId } = useParams<{ requestId: string }>();
  return <EventRequestsTab requestId={requestId} />;
};

export default EventRequestPage;
