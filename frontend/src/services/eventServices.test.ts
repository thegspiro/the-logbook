import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGet = vi.fn();
const mockPost = vi.fn();
const mockPatch = vi.fn();
const mockDelete = vi.fn();

vi.mock('./apiClient', () => ({
  default: {
    get: (...args: unknown[]) => mockGet(...args) as unknown,
    post: (...args: unknown[]) => mockPost(...args) as unknown,
    put: (...args: unknown[]) => mockPut(...args) as unknown,
    patch: (...args: unknown[]) => mockPatch(...args) as unknown,
    delete: (...args: unknown[]) => mockDelete(...args) as unknown,
  },
}));
const mockPut = vi.fn();

import { eventService, eventRequestService } from './eventServices';

beforeEach(() => {
  vi.clearAllMocks();
});

// ============================================
// eventService
// ============================================
describe('eventService', () => {
  // --- getEvents ---
  describe('getEvents', () => {
    it('should fetch events without params', async () => {
      const mockEvents = [{ id: '1', title: 'Event 1' }];
      mockGet.mockResolvedValueOnce({ data: mockEvents });

      const result = await eventService.getEvents();

      expect(mockGet).toHaveBeenCalledWith('/events', { params: undefined });
      expect(result).toEqual(mockEvents);
    });

    it('should pass filter params to GET /events', async () => {
      mockGet.mockResolvedValueOnce({ data: [] });
      const params = { event_type: 'training', limit: 10 };

      await eventService.getEvents(params);

      expect(mockGet).toHaveBeenCalledWith('/events', { params });
    });
  });

  // --- createEvent ---
  describe('createEvent', () => {
    it('should POST event data to /events', async () => {
      const eventData = { title: 'New Event', event_type: 'training' };
      const created = { id: 'e1', ...eventData };
      mockPost.mockResolvedValueOnce({ data: created });

      const result = await eventService.createEvent(eventData as never);

      expect(mockPost).toHaveBeenCalledWith('/events', eventData);
      expect(result).toEqual(created);
    });

    it('should propagate errors', async () => {
      mockPost.mockRejectedValueOnce(new Error('Network error'));

      await expect(eventService.createEvent({} as never)).rejects.toThrow('Network error');
    });
  });

  // --- getEvent ---
  describe('getEvent', () => {
    it('should GET /events/:id', async () => {
      const event = { id: 'e1', title: 'Test Event' };
      mockGet.mockResolvedValueOnce({ data: event });

      const result = await eventService.getEvent('e1');

      expect(mockGet).toHaveBeenCalledWith('/events/e1');
      expect(result).toEqual(event);
    });
  });

  // --- updateEvent ---
  describe('updateEvent', () => {
    it('should PATCH /events/:id with update data', async () => {
      const updateData = { title: 'Updated Title' };
      const updated = { id: 'e1', title: 'Updated Title' };
      mockPatch.mockResolvedValueOnce({ data: updated });

      const result = await eventService.updateEvent('e1', updateData);

      expect(mockPatch).toHaveBeenCalledWith('/events/e1', updateData);
      expect(result).toEqual(updated);
    });
  });

  // --- deleteEvent ---
  describe('deleteEvent', () => {
    it('should DELETE /events/:id', async () => {
      mockDelete.mockResolvedValueOnce({});

      await eventService.deleteEvent('e1');

      expect(mockDelete).toHaveBeenCalledWith('/events/e1');
    });
  });

  // --- duplicateEvent ---
  describe('duplicateEvent', () => {
    it('should POST to /events/:id/duplicate', async () => {
      const duplicated = { id: 'e2', title: 'Duplicated' };
      mockPost.mockResolvedValueOnce({ data: duplicated });

      const result = await eventService.duplicateEvent('e1');

      expect(mockPost).toHaveBeenCalledWith('/events/e1/duplicate');
      expect(result).toEqual(duplicated);
    });
  });

  // --- cancelEvent ---
  describe('cancelEvent', () => {
    it('should POST cancel data to /events/:id/cancel', async () => {
      const cancelData = { reason: 'Weather' };
      const cancelled = { id: 'e1', status: 'cancelled' };
      mockPost.mockResolvedValueOnce({ data: cancelled });

      const result = await eventService.cancelEvent('e1', cancelData as never);

      expect(mockPost).toHaveBeenCalledWith('/events/e1/cancel', cancelData);
      expect(result).toEqual(cancelled);
    });
  });

  // --- createOrUpdateRSVP ---
  describe('createOrUpdateRSVP', () => {
    it('should POST RSVP data to /events/:id/rsvp', async () => {
      const rsvpData = { status: 'attending' };
      const rsvp = { id: 'r1', status: 'attending' };
      mockPost.mockResolvedValueOnce({ data: rsvp });

      const result = await eventService.createOrUpdateRSVP('e1', rsvpData as never);

      // Third arg is the axios config: undefined unless override=true
      expect(mockPost).toHaveBeenCalledWith('/events/e1/rsvp', rsvpData, undefined);
      expect(result).toEqual(rsvp);
    });
  });

  // --- getEventRSVPs ---
  describe('getEventRSVPs', () => {
    it('should GET /events/:id/rsvps without filter', async () => {
      const rsvps = [{ id: 'r1', status: 'attending' }];
      mockGet.mockResolvedValueOnce({ data: rsvps });

      const result = await eventService.getEventRSVPs('e1');

      expect(mockGet).toHaveBeenCalledWith('/events/e1/rsvps', { params: undefined });
      expect(result).toEqual(rsvps);
    });

    it('should pass status_filter param', async () => {
      mockGet.mockResolvedValueOnce({ data: [] });

      await eventService.getEventRSVPs('e1', 'attending');

      expect(mockGet).toHaveBeenCalledWith('/events/e1/rsvps', { params: { status_filter: 'attending' } });
    });
  });

  // --- checkInAttendee ---
  describe('checkInAttendee', () => {
    it('should POST check-in data', async () => {
      const checkInData = { user_id: 'u1' };
      const rsvp = { id: 'r1', checked_in: true };
      mockPost.mockResolvedValueOnce({ data: rsvp });

      const result = await eventService.checkInAttendee('e1', checkInData);

      expect(mockPost).toHaveBeenCalledWith('/events/e1/check-in', checkInData);
      expect(result).toEqual(rsvp);
    });
  });

  // --- getEventStats ---
  describe('getEventStats', () => {
    it('should GET /events/:id/stats', async () => {
      const stats = { total_rsvps: 10, checked_in: 5 };
      mockGet.mockResolvedValueOnce({ data: stats });

      const result = await eventService.getEventStats('e1');

      expect(mockGet).toHaveBeenCalledWith('/events/e1/stats');
      expect(result).toEqual(stats);
    });
  });

  // --- getEligibleMembers ---
  describe('getEligibleMembers', () => {
    it('should GET /events/:id/eligible-members', async () => {
      const members = [{ id: 'u1', first_name: 'John', last_name: 'Doe', email: 'john@test.com' }];
      mockGet.mockResolvedValueOnce({ data: members });

      const result = await eventService.getEligibleMembers('e1');

      expect(mockGet).toHaveBeenCalledWith('/events/e1/eligible-members');
      expect(result).toEqual(members);
    });
  });

  // --- recordActualTimes ---
  describe('recordActualTimes', () => {
    it('should POST times to /events/:id/record-times', async () => {
      const times = { actual_start: '2026-01-01T10:00:00Z' };
      const event = { id: 'e1', actual_start: times.actual_start };
      mockPost.mockResolvedValueOnce({ data: event });

      const result = await eventService.recordActualTimes('e1', times as never);

      expect(mockPost).toHaveBeenCalledWith('/events/e1/record-times', times);
      expect(result).toEqual(event);
    });
  });

  // --- selfCheckIn ---
  describe('selfCheckIn', () => {
    it('should POST self-check-in with default isCheckout=false', async () => {
      const rsvp = { id: 'r1', checked_in: true };
      mockPost.mockResolvedValueOnce({ data: rsvp });

      const result = await eventService.selfCheckIn('e1');

      // Third arg is the axios config: undefined unless override=true
      expect(mockPost).toHaveBeenCalledWith('/events/e1/self-check-in', { is_checkout: false }, undefined);
      expect(result).toEqual(rsvp);
    });

    it('should POST self-check-in with isCheckout=true', async () => {
      mockPost.mockResolvedValueOnce({ data: {} });

      await eventService.selfCheckIn('e1', true);

      expect(mockPost).toHaveBeenCalledWith('/events/e1/self-check-in', { is_checkout: true }, undefined);
    });
  });

  // --- getQRCheckInData ---
  describe('getQRCheckInData', () => {
    it('should bypass the GET cache so a window that opened is seen on the next poll', async () => {
      // Both callers poll this endpoint to notice the check-in window opening.
      // The shared client would answer from cache for 30s and answer stale for
      // a further 60s while revalidating behind the caller's back, so without
      // _skipCache the reveal could lag the server by up to 90 seconds.
      const qrData = { event_id: 'e1', is_valid: false, can_check_in: false };
      mockGet.mockResolvedValueOnce({ data: qrData });

      const result = await eventService.getQRCheckInData('e1');

      expect(mockGet).toHaveBeenCalledWith('/events/e1/qr-check-in-data', { _skipCache: true });
      expect(result).toEqual(qrData);
    });
  });

  // --- getCheckInMonitoring ---
  describe('getCheckInMonitoring', () => {
    it('should GET /events/:id/check-in-monitoring', async () => {
      const stats = { total: 20, checked_in: 15 };
      mockGet.mockResolvedValueOnce({ data: stats });

      const result = await eventService.getCheckInMonitoring('e1');

      expect(mockGet).toHaveBeenCalledWith('/events/e1/check-in-monitoring');
      expect(result).toEqual(stats);
    });
  });

  // --- addAttendee ---
  describe('addAttendee', () => {
    it('should POST to /events/:id/add-attendee', async () => {
      const data = { user_id: 'u1' };
      const rsvp = { id: 'r1', user_id: 'u1' };
      mockPost.mockResolvedValueOnce({ data: rsvp });

      const result = await eventService.addAttendee('e1', data);

      expect(mockPost).toHaveBeenCalledWith('/events/e1/add-attendee', data);
      expect(result).toEqual(rsvp);
    });
  });

  // --- overrideAttendance ---
  describe('overrideAttendance', () => {
    it('should PATCH /events/:eventId/rsvps/:userId/override', async () => {
      const data = { status: 'excused' };
      const rsvp = { id: 'r1', status: 'excused' };
      mockPatch.mockResolvedValueOnce({ data: rsvp });

      const result = await eventService.overrideAttendance('e1', 'u1', data as never);

      expect(mockPatch).toHaveBeenCalledWith('/events/e1/rsvps/u1/override', data);
      expect(result).toEqual(rsvp);
    });
  });

  // --- removeAttendee ---
  describe('removeAttendee', () => {
    it('should DELETE /events/:eventId/rsvps/:userId', async () => {
      mockDelete.mockResolvedValueOnce({});

      await eventService.removeAttendee('e1', 'u1');

      expect(mockDelete).toHaveBeenCalledWith('/events/e1/rsvps/u1');
    });
  });

  // --- Templates ---
  describe('getTemplates', () => {
    it('should GET /events/templates without params', async () => {
      const templates = [{ id: 't1', name: 'Template 1' }];
      mockGet.mockResolvedValueOnce({ data: templates });

      const result = await eventService.getTemplates();

      expect(mockGet).toHaveBeenCalledWith('/events/templates', { params: undefined });
      expect(result).toEqual(templates);
    });

    it('should pass include_inactive param', async () => {
      mockGet.mockResolvedValueOnce({ data: [] });

      await eventService.getTemplates(true);

      expect(mockGet).toHaveBeenCalledWith('/events/templates', { params: { include_inactive: true } });
    });
  });

  describe('createTemplate', () => {
    it('should POST to /events/templates', async () => {
      const data = { name: 'New Template' };
      const template = { id: 't1', name: 'New Template' };
      mockPost.mockResolvedValueOnce({ data: template });

      const result = await eventService.createTemplate(data);

      expect(mockPost).toHaveBeenCalledWith('/events/templates', data);
      expect(result).toEqual(template);
    });
  });

  describe('deleteTemplate', () => {
    it('should DELETE /events/templates/:id', async () => {
      mockDelete.mockResolvedValueOnce({});

      await eventService.deleteTemplate('t1');

      expect(mockDelete).toHaveBeenCalledWith('/events/templates/t1');
    });
  });

  // --- Recurring Events ---
  describe('createRecurringEvent', () => {
    it('should POST to /events/recurring', async () => {
      const data = { title: 'Weekly Meeting', recurrence: 'weekly' };
      const events = [{ id: 'e1' }, { id: 'e2' }];
      mockPost.mockResolvedValueOnce({ data: events });

      const result = await eventService.createRecurringEvent(data as never);

      expect(mockPost).toHaveBeenCalledWith('/events/recurring', data);
      expect(result).toEqual(events);
    });
  });

  // --- Module Settings ---
  describe('getModuleSettings', () => {
    it('should GET /events/settings', async () => {
      const settings = { default_event_type: 'training' };
      mockGet.mockResolvedValueOnce({ data: settings });

      const result = await eventService.getModuleSettings();

      expect(mockGet).toHaveBeenCalledWith('/events/settings');
      expect(result).toEqual(settings);
    });
  });

  describe('updateModuleSettings', () => {
    it('should PATCH /events/settings', async () => {
      const data = { default_event_type: 'meeting' };
      mockPatch.mockResolvedValueOnce({ data });

      const result = await eventService.updateModuleSettings(data as never);

      expect(mockPatch).toHaveBeenCalledWith('/events/settings', data);
      expect(result).toEqual(data);
    });
  });

  describe('getVisibleEventTypes', () => {
    it('should GET visible_event_types from /events/visible-event-types', async () => {
      const types = ['training', 'meeting'];
      mockGet.mockResolvedValueOnce({ data: { visible_event_types: types } });

      const result = await eventService.getVisibleEventTypes();

      expect(mockGet).toHaveBeenCalledWith('/events/visible-event-types');
      expect(result).toEqual(types);
    });
  });

  describe('getVisibleEventTypesWithCategories', () => {
    it('should GET full visibility data from /events/visible-event-types', async () => {
      const data = {
        visible_event_types: ['training', 'meeting'],
        custom_event_categories: [{ value: 'drill', label: 'Drill', color: 'bg-blue-100 text-blue-800' }],
        visible_custom_categories: ['drill'],
        membership_types: [{ value: 'active', label: 'Active Member' }],
      };
      mockGet.mockResolvedValueOnce({ data });

      const result = await eventService.getVisibleEventTypesWithCategories();

      expect(mockGet).toHaveBeenCalledWith('/events/visible-event-types');
      expect(result).toEqual(data);
    });
  });

  // --- External Attendees ---
  describe('getExternalAttendees', () => {
    it('should GET /events/:id/external-attendees', async () => {
      const attendees = [{ id: 'ea1', name: 'External Person' }];
      mockGet.mockResolvedValueOnce({ data: attendees });

      const result = await eventService.getExternalAttendees('e1');

      expect(mockGet).toHaveBeenCalledWith('/events/e1/external-attendees');
      expect(result).toEqual(attendees);
    });
  });

  describe('addExternalAttendee', () => {
    it('should POST to /events/:id/external-attendees', async () => {
      const data = { name: 'External Person' };
      mockPost.mockResolvedValueOnce({ data: { id: 'ea1', ...data } });

      const result = await eventService.addExternalAttendee('e1', data);

      expect(mockPost).toHaveBeenCalledWith('/events/e1/external-attendees', data);
      expect(result).toEqual({ id: 'ea1', ...data });
    });
  });

  describe('removeExternalAttendee', () => {
    it('should DELETE /events/:id/external-attendees/:attendeeId', async () => {
      mockDelete.mockResolvedValueOnce({});

      await eventService.removeExternalAttendee('e1', 'ea1');

      expect(mockDelete).toHaveBeenCalledWith('/events/e1/external-attendees/ea1');
    });
  });
});

// ============================================
// eventRequestService
// ============================================
describe('eventRequestService', () => {
  describe('getForms', () => {
    it('should GET the event-scoped outreach forms endpoint', async () => {
      const forms = { forms: [], total: 0, skip: 0, limit: 50 };
      mockGet.mockResolvedValueOnce({ data: forms });

      const result = await eventRequestService.getForms({ limit: 50 });

      expect(mockGet).toHaveBeenCalledWith('/event-requests/forms', { params: { limit: 50 } });
      expect(result).toEqual(forms);
    });
  });

  describe('listRequests', () => {
    it('should GET /event-requests with params', async () => {
      const requests = [{ id: 'r1', status: 'pending' }];
      mockGet.mockResolvedValueOnce({ data: requests });

      const result = await eventRequestService.listRequests({ status: 'pending' });

      expect(mockGet).toHaveBeenCalledWith('/event-requests', { params: { status: 'pending' } });
      expect(result).toEqual(requests);
    });
  });

  describe('getRequest', () => {
    it('should GET /event-requests/:id', async () => {
      const request = { id: 'r1', title: 'Event Request' };
      mockGet.mockResolvedValueOnce({ data: request });

      const result = await eventRequestService.getRequest('r1');

      expect(mockGet).toHaveBeenCalledWith('/event-requests/r1');
      expect(result).toEqual(request);
    });
  });

  describe('getStaffing', () => {
    it('should GET the volunteer staffing state for a request', async () => {
      const staffing = { shift_id: 's1', slots_total: 3, slots_filled: 1, volunteers: [] };
      mockGet.mockResolvedValueOnce({ data: staffing });

      const result = await eventRequestService.getStaffing('r1');

      expect(mockGet).toHaveBeenCalledWith('/event-requests/r1/staffing');
      expect(result).toEqual(staffing);
    });
  });

  describe('getOutreachRoles', () => {
    it('should unwrap the department outreach role vocabulary', async () => {
      const roles = [{ value: 'tour_guide', label: 'Tour Guide' }];
      mockGet.mockResolvedValueOnce({ data: { roles } });

      const result = await eventRequestService.getOutreachRoles();

      expect(mockGet).toHaveBeenCalledWith('/event-requests/outreach-roles');
      expect(result).toEqual(roles);
    });
  });

  describe('openStaffing', () => {
    it('should POST the roles needed, not a bare headcount', async () => {
      const staffing = { shift_id: 's1', slots_total: 3, slots_filled: 0, roles: [], volunteers: [] };
      mockPost.mockResolvedValueOnce({ data: staffing });

      const roles = [
        { role: 'tour_guide', count: 2 },
        { role: 'educator', count: 1 },
      ];
      const result = await eventRequestService.openStaffing('r1', { roles });

      expect(mockPost).toHaveBeenCalledWith('/event-requests/r1/staffing', { roles });
      expect(result).toEqual(staffing);
    });
  });

  describe('sendVolunteerCall', () => {
    it('should POST the coordinator note to the volunteer-call endpoint', async () => {
      const response = {
        message: 'Volunteer call emailed to 12 members.',
        recipients: 12,
        skipped_opted_out: 1,
        volunteer_call_sent_at: '2026-09-01T12:00:00Z',
      };
      mockPost.mockResolvedValueOnce({ data: response });

      const result = await eventRequestService.sendVolunteerCall('r1', {
        message: 'Bring the smoke trailer.',
      });

      expect(mockPost).toHaveBeenCalledWith('/event-requests/r1/volunteer-call', {
        message: 'Bring the smoke trailer.',
      });
      expect(result).toEqual(response);
    });

    it('should omit an empty note rather than sending a blank message', async () => {
      mockPost.mockResolvedValueOnce({ data: { message: 'ok', recipients: 1, skipped_opted_out: 0 } });

      await eventRequestService.sendVolunteerCall('r1', { message: undefined });

      expect(mockPost).toHaveBeenCalledWith('/event-requests/r1/volunteer-call', { message: undefined });
    });
  });

  describe('updateRequestStatus', () => {
    it('should PATCH /event-requests/:id/status', async () => {
      const data = { status: 'approved', notes: 'Looks good' };
      const response = { message: 'Updated', status: 'approved' };
      mockPatch.mockResolvedValueOnce({ data: response });

      const result = await eventRequestService.updateRequestStatus('r1', data);

      expect(mockPatch).toHaveBeenCalledWith('/event-requests/r1/status', data);
      expect(result).toEqual(response);
    });
  });

  describe('checkPublicStatus', () => {
    it('should GET /event-requests/status/:token', async () => {
      const status = { status: 'approved', title: 'Test Request' };
      mockGet.mockResolvedValueOnce({ data: status });

      const result = await eventRequestService.checkPublicStatus('abc123');

      expect(mockGet).toHaveBeenCalledWith('/event-requests/status/abc123');
      expect(result).toEqual(status);
    });
  });

  describe('addComment', () => {
    it('should POST comment to /event-requests/:id/comments', async () => {
      const data = { message: 'A comment' };
      const activity = { id: 'a1', message: 'A comment' };
      mockPost.mockResolvedValueOnce({ data: activity });

      const result = await eventRequestService.addComment('r1', data);

      expect(mockPost).toHaveBeenCalledWith('/event-requests/r1/comments', data);
      expect(result).toEqual(activity);
    });
  });

  describe('scheduleRequest', () => {
    it('should PATCH /event-requests/:id/schedule', async () => {
      const data = { event_date: '2026-06-01' };
      const response = { message: 'Scheduled', status: 'scheduled', event_date: '2026-06-01' };
      mockPatch.mockResolvedValueOnce({ data: response });

      const result = await eventRequestService.scheduleRequest('r1', data);

      expect(mockPatch).toHaveBeenCalledWith('/event-requests/r1/schedule', data);
      expect(result).toEqual(response);
    });
  });

  describe('assignRequest', () => {
    it('should PATCH /event-requests/:id/assign', async () => {
      const data = { assigned_to: 'u1' };
      const response = { message: 'Assigned', assigned_to: 'u1', assignee_name: 'John' };
      mockPatch.mockResolvedValueOnce({ data: response });

      const result = await eventRequestService.assignRequest('r1', data);

      expect(mockPatch).toHaveBeenCalledWith('/event-requests/r1/assign', data);
      expect(result).toEqual(response);
    });
  });

  describe('generateForm', () => {
    it('should POST to /event-requests/generate-form', async () => {
      const response = {
        message: 'Generated',
        form_id: 'f1',
        public_slug: 'abc',
        public_url: 'http://example.com/abc',
      };
      mockPost.mockResolvedValueOnce({ data: response });

      const result = await eventRequestService.generateForm();

      expect(mockPost).toHaveBeenCalledWith('/event-requests/generate-form');
      expect(result).toEqual(response);
    });
  });

  describe('listEmailTemplates', () => {
    it('should GET /event-requests/email-templates', async () => {
      const templates = [{ id: 't1', name: 'Welcome' }];
      mockGet.mockResolvedValueOnce({ data: templates });

      const result = await eventRequestService.listEmailTemplates();

      expect(mockGet).toHaveBeenCalledWith('/event-requests/email-templates');
      expect(result).toEqual(templates);
    });
  });

  describe('deleteEmailTemplate', () => {
    it('should DELETE /event-requests/email-templates/:id', async () => {
      mockDelete.mockResolvedValueOnce({ data: { message: 'Deleted' } });

      const result = await eventRequestService.deleteEmailTemplate('t1');

      expect(mockDelete).toHaveBeenCalledWith('/event-requests/email-templates/t1');
      expect(result).toEqual({ message: 'Deleted' });
    });
  });

  describe('publicCancelRequest', () => {
    it('should POST to /event-requests/status/:token/cancel', async () => {
      const data = { reason: 'Changed plans' };
      const response = { message: 'Cancelled', status: 'cancelled' };
      mockPost.mockResolvedValueOnce({ data: response });

      const result = await eventRequestService.publicCancelRequest('tok123', data);

      expect(mockPost).toHaveBeenCalledWith('/event-requests/status/tok123/cancel', data);
      expect(result).toEqual(response);
    });
  });
});
