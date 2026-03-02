import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock apiClient BEFORE importing the service
const mockGet = vi.fn();
const mockPost = vi.fn();
const mockPut = vi.fn();
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

// Import services AFTER mocks
import {
  notificationsService,
  emailTemplatesService,
  scheduledEmailsService,
  messagesService,
} from './communicationsServices';

beforeEach(() => {
  vi.clearAllMocks();
});

// ============================================
// notificationsService
// ============================================
describe('notificationsService', () => {
  // --- getRules ---
  describe('getRules', () => {
    it('should GET /notifications/rules with params', async () => {
      const data = { rules: [{ id: 'r1', name: 'Rule 1' }], total: 1 };
      mockGet.mockResolvedValueOnce({ data });

      const result = await notificationsService.getRules({ category: 'events', enabled: true });

      expect(mockGet).toHaveBeenCalledWith('/notifications/rules', {
        params: { category: 'events', enabled: true },
      });
      expect(result).toEqual(data);
    });

    it('should GET /notifications/rules without params', async () => {
      const data = { rules: [], total: 0 };
      mockGet.mockResolvedValueOnce({ data });

      const result = await notificationsService.getRules();

      expect(mockGet).toHaveBeenCalledWith('/notifications/rules', { params: undefined });
      expect(result).toEqual(data);
    });
  });

  // --- createRule ---
  describe('createRule', () => {
    it('should POST to /notifications/rules', async () => {
      const ruleData = { name: 'New Rule', category: 'events', channel: 'email' };
      const created = { id: 'r1', ...ruleData };
      mockPost.mockResolvedValueOnce({ data: created });

      const result = await notificationsService.createRule(ruleData);

      expect(mockPost).toHaveBeenCalledWith('/notifications/rules', ruleData);
      expect(result).toEqual(created);
    });

    it('should propagate errors', async () => {
      mockPost.mockRejectedValueOnce(new Error('Invalid rule'));

      await expect(notificationsService.createRule({})).rejects.toThrow('Invalid rule');
    });
  });

  // --- getRule ---
  describe('getRule', () => {
    it('should GET /notifications/rules/:id', async () => {
      const rule = { id: 'r1', name: 'Event Rule' };
      mockGet.mockResolvedValueOnce({ data: rule });

      const result = await notificationsService.getRule('r1');

      expect(mockGet).toHaveBeenCalledWith('/notifications/rules/r1');
      expect(result).toEqual(rule);
    });
  });

  // --- updateRule ---
  describe('updateRule', () => {
    it('should PATCH /notifications/rules/:id', async () => {
      const updateData = { name: 'Updated Rule' };
      const updated = { id: 'r1', name: 'Updated Rule' };
      mockPatch.mockResolvedValueOnce({ data: updated });

      const result = await notificationsService.updateRule('r1', updateData);

      expect(mockPatch).toHaveBeenCalledWith('/notifications/rules/r1', updateData);
      expect(result).toEqual(updated);
    });
  });

  // --- deleteRule ---
  describe('deleteRule', () => {
    it('should DELETE /notifications/rules/:id', async () => {
      mockDelete.mockResolvedValueOnce({});

      await notificationsService.deleteRule('r1');

      expect(mockDelete).toHaveBeenCalledWith('/notifications/rules/r1');
    });
  });

  // --- toggleRule ---
  describe('toggleRule', () => {
    it('should POST to /notifications/rules/:id/toggle with enabled param', async () => {
      const rule = { id: 'r1', enabled: false };
      mockPost.mockResolvedValueOnce({ data: rule });

      const result = await notificationsService.toggleRule('r1', false);

      expect(mockPost).toHaveBeenCalledWith('/notifications/rules/r1/toggle', null, { params: { enabled: false } });
      expect(result).toEqual(rule);
    });

    it('should enable a rule', async () => {
      const rule = { id: 'r1', enabled: true };
      mockPost.mockResolvedValueOnce({ data: rule });

      const result = await notificationsService.toggleRule('r1', true);

      expect(mockPost).toHaveBeenCalledWith('/notifications/rules/r1/toggle', null, { params: { enabled: true } });
      expect(result).toEqual(rule);
    });
  });

  // --- getLogs ---
  describe('getLogs', () => {
    it('should GET /notifications/logs with params', async () => {
      const data = { logs: [{ id: 'l1' }], total: 1, skip: 0, limit: 20 };
      mockGet.mockResolvedValueOnce({ data });

      const result = await notificationsService.getLogs({ channel: 'email', skip: 0, limit: 20 });

      expect(mockGet).toHaveBeenCalledWith('/notifications/logs', {
        params: { channel: 'email', skip: 0, limit: 20 },
      });
      expect(result).toEqual(data);
    });
  });

  // --- markAsRead ---
  describe('markAsRead', () => {
    it('should POST to /notifications/logs/:id/read', async () => {
      const log = { id: 'l1', read: true };
      mockPost.mockResolvedValueOnce({ data: log });

      const result = await notificationsService.markAsRead('l1');

      expect(mockPost).toHaveBeenCalledWith('/notifications/logs/l1/read');
      expect(result).toEqual(log);
    });
  });

  // --- getSummary ---
  describe('getSummary', () => {
    it('should GET /notifications/summary', async () => {
      const summary = { total_rules: 5, active_rules: 3, total_sent: 100 };
      mockGet.mockResolvedValueOnce({ data: summary });

      const result = await notificationsService.getSummary();

      expect(mockGet).toHaveBeenCalledWith('/notifications/summary');
      expect(result).toEqual(summary);
    });
  });

  // --- getMyNotifications ---
  describe('getMyNotifications', () => {
    it('should GET /notifications/my with params', async () => {
      const data = { logs: [{ id: 'l1' }], total: 1, skip: 0, limit: 20 };
      mockGet.mockResolvedValueOnce({ data });

      const result = await notificationsService.getMyNotifications({ include_read: true, skip: 0, limit: 20 });

      expect(mockGet).toHaveBeenCalledWith('/notifications/my', {
        params: { include_read: true, skip: 0, limit: 20 },
      });
      expect(result).toEqual(data);
    });
  });

  // --- getMyUnreadCount ---
  describe('getMyUnreadCount', () => {
    it('should GET /notifications/my/unread-count', async () => {
      const data = { unread_count: 7 };
      mockGet.mockResolvedValueOnce({ data });

      const result = await notificationsService.getMyUnreadCount();

      expect(mockGet).toHaveBeenCalledWith('/notifications/my/unread-count');
      expect(result).toEqual(data);
    });
  });

  // --- markMyNotificationRead ---
  describe('markMyNotificationRead', () => {
    it('should POST to /notifications/my/:id/read', async () => {
      const log = { id: 'l1', read: true };
      mockPost.mockResolvedValueOnce({ data: log });

      const result = await notificationsService.markMyNotificationRead('l1');

      expect(mockPost).toHaveBeenCalledWith('/notifications/my/l1/read');
      expect(result).toEqual(log);
    });
  });
});

// ============================================
// emailTemplatesService
// ============================================
describe('emailTemplatesService', () => {
  // --- getTemplates ---
  describe('getTemplates', () => {
    it('should GET /email-templates', async () => {
      const templates = [{ id: 't1', name: 'Welcome Email' }];
      mockGet.mockResolvedValueOnce({ data: templates });

      const result = await emailTemplatesService.getTemplates();

      expect(mockGet).toHaveBeenCalledWith('/email-templates');
      expect(result).toEqual(templates);
    });
  });

  // --- getTemplate ---
  describe('getTemplate', () => {
    it('should GET /email-templates/:id', async () => {
      const template = { id: 't1', name: 'Welcome Email', html_body: '<p>Hi</p>' };
      mockGet.mockResolvedValueOnce({ data: template });

      const result = await emailTemplatesService.getTemplate('t1');

      expect(mockGet).toHaveBeenCalledWith('/email-templates/t1');
      expect(result).toEqual(template);
    });
  });

  // --- updateTemplate ---
  describe('updateTemplate', () => {
    it('should PUT /email-templates/:id', async () => {
      const updateData = { subject: 'Updated Subject', html_body: '<p>Updated</p>' };
      const updated = { id: 't1', ...updateData };
      mockPut.mockResolvedValueOnce({ data: updated });

      const result = await emailTemplatesService.updateTemplate('t1', updateData as never);

      expect(mockPut).toHaveBeenCalledWith('/email-templates/t1', updateData);
      expect(result).toEqual(updated);
    });
  });

  // --- previewTemplate ---
  describe('previewTemplate', () => {
    it('should POST preview request to /email-templates/:id/preview', async () => {
      const preview = { subject: 'Rendered Subject', html: '<p>Rendered</p>' };
      mockPost.mockResolvedValueOnce({ data: preview });

      const result = await emailTemplatesService.previewTemplate('t1', { org_name: 'FD' });

      expect(mockPost).toHaveBeenCalledWith('/email-templates/t1/preview', {
        context: { org_name: 'FD' },
      });
      expect(result).toEqual(preview);
    });

    it('should include overrides and memberId when provided', async () => {
      mockPost.mockResolvedValueOnce({ data: {} });

      await emailTemplatesService.previewTemplate(
        't1',
        { org_name: 'FD' },
        { subject: 'Custom Subject', html_body: '<p>Custom</p>' },
        'member-1',
      );

      expect(mockPost).toHaveBeenCalledWith('/email-templates/t1/preview', {
        context: { org_name: 'FD' },
        subject: 'Custom Subject',
        html_body: '<p>Custom</p>',
        member_id: 'member-1',
      });
    });

    it('should use empty context when none provided', async () => {
      mockPost.mockResolvedValueOnce({ data: {} });

      await emailTemplatesService.previewTemplate('t1');

      expect(mockPost).toHaveBeenCalledWith('/email-templates/t1/preview', {
        context: {},
      });
    });
  });

  // --- uploadAttachment ---
  describe('uploadAttachment', () => {
    it('should POST FormData to /email-templates/:id/attachments with multipart header', async () => {
      const file = new File(['content'], 'doc.pdf', { type: 'application/pdf' });
      const attachment = { id: 'a1', filename: 'doc.pdf' };
      mockPost.mockResolvedValueOnce({ data: attachment });

      const result = await emailTemplatesService.uploadAttachment('t1', file);

      expect(mockPost).toHaveBeenCalledWith(
        '/email-templates/t1/attachments',
        expect.any(FormData),
        { headers: { 'Content-Type': 'multipart/form-data' } },
      );
      expect(result).toEqual(attachment);
    });
  });

  // --- deleteAttachment ---
  describe('deleteAttachment', () => {
    it('should DELETE /email-templates/:templateId/attachments/:attachmentId', async () => {
      mockDelete.mockResolvedValueOnce({});

      await emailTemplatesService.deleteAttachment('t1', 'a1');

      expect(mockDelete).toHaveBeenCalledWith('/email-templates/t1/attachments/a1');
    });
  });
});

// ============================================
// scheduledEmailsService
// ============================================
describe('scheduledEmailsService', () => {
  // --- create ---
  describe('create', () => {
    it('should POST to /email-templates/schedule', async () => {
      const data = {
        template_type: 'event_reminder',
        to_emails: ['user@example.com'],
        context: { event_name: 'Training' },
        scheduled_at: '2026-06-01T10:00:00Z',
      };
      const created = { id: 'se1', ...data, status: 'pending' };
      mockPost.mockResolvedValueOnce({ data: created });

      const result = await scheduledEmailsService.create(data);

      expect(mockPost).toHaveBeenCalledWith('/email-templates/schedule', data);
      expect(result).toEqual(created);
    });
  });

  // --- list ---
  describe('list', () => {
    it('should GET /email-templates/scheduled with status filter', async () => {
      const emails = [{ id: 'se1', status: 'pending' }];
      mockGet.mockResolvedValueOnce({ data: emails });

      const result = await scheduledEmailsService.list('pending');

      expect(mockGet).toHaveBeenCalledWith('/email-templates/scheduled', { params: { status_filter: 'pending' } });
      expect(result).toEqual(emails);
    });

    it('should GET /email-templates/scheduled without filter', async () => {
      mockGet.mockResolvedValueOnce({ data: [] });

      const result = await scheduledEmailsService.list();

      expect(mockGet).toHaveBeenCalledWith('/email-templates/scheduled', { params: {} });
      expect(result).toEqual([]);
    });
  });

  // --- update ---
  describe('update', () => {
    it('should PATCH /email-templates/scheduled/:id', async () => {
      const data = { scheduled_at: '2026-07-01T10:00:00Z' };
      const updated = { id: 'se1', ...data };
      mockPatch.mockResolvedValueOnce({ data: updated });

      const result = await scheduledEmailsService.update('se1', data);

      expect(mockPatch).toHaveBeenCalledWith('/email-templates/scheduled/se1', data);
      expect(result).toEqual(updated);
    });
  });

  // --- cancel ---
  describe('cancel', () => {
    it('should DELETE /email-templates/scheduled/:id', async () => {
      mockDelete.mockResolvedValueOnce({});

      await scheduledEmailsService.cancel('se1');

      expect(mockDelete).toHaveBeenCalledWith('/email-templates/scheduled/se1');
    });
  });
});

// ============================================
// messagesService
// ============================================
describe('messagesService', () => {
  // --- getMessages ---
  describe('getMessages', () => {
    it('should GET /messages with params', async () => {
      const data = { messages: [{ id: 'm1', title: 'Announcement' }], total: 1 };
      mockGet.mockResolvedValueOnce({ data });

      const result = await messagesService.getMessages({ include_inactive: true, skip: 0, limit: 20 });

      expect(mockGet).toHaveBeenCalledWith('/messages', {
        params: { include_inactive: true, skip: 0, limit: 20 },
      });
      expect(result).toEqual(data);
    });

    it('should GET /messages without params', async () => {
      const data = { messages: [], total: 0 };
      mockGet.mockResolvedValueOnce({ data });

      const result = await messagesService.getMessages();

      expect(mockGet).toHaveBeenCalledWith('/messages', { params: undefined });
      expect(result).toEqual(data);
    });
  });

  // --- createMessage ---
  describe('createMessage', () => {
    it('should POST to /messages', async () => {
      const messageData = { title: 'Important Notice', body: 'Please read this.', priority: 'high' };
      const created = { id: 'm1', ...messageData };
      mockPost.mockResolvedValueOnce({ data: created });

      const result = await messagesService.createMessage(messageData);

      expect(mockPost).toHaveBeenCalledWith('/messages', messageData);
      expect(result).toEqual(created);
    });

    it('should propagate errors', async () => {
      mockPost.mockRejectedValueOnce(new Error('Forbidden'));

      await expect(
        messagesService.createMessage({ title: 'X', body: 'Y' })
      ).rejects.toThrow('Forbidden');
    });
  });

  // --- getMessage ---
  describe('getMessage', () => {
    it('should GET /messages/:id', async () => {
      const message = { id: 'm1', title: 'Notice', body: 'Content' };
      mockGet.mockResolvedValueOnce({ data: message });

      const result = await messagesService.getMessage('m1');

      expect(mockGet).toHaveBeenCalledWith('/messages/m1');
      expect(result).toEqual(message);
    });
  });

  // --- updateMessage ---
  describe('updateMessage', () => {
    it('should PATCH /messages/:id', async () => {
      const updateData = { title: 'Updated Notice' };
      const updated = { id: 'm1', title: 'Updated Notice' };
      mockPatch.mockResolvedValueOnce({ data: updated });

      const result = await messagesService.updateMessage('m1', updateData);

      expect(mockPatch).toHaveBeenCalledWith('/messages/m1', updateData);
      expect(result).toEqual(updated);
    });
  });

  // --- deleteMessage ---
  describe('deleteMessage', () => {
    it('should DELETE /messages/:id', async () => {
      mockDelete.mockResolvedValueOnce({});

      await messagesService.deleteMessage('m1');

      expect(mockDelete).toHaveBeenCalledWith('/messages/m1');
    });
  });

  // --- getAvailableRoles ---
  describe('getAvailableRoles', () => {
    it('should GET /messages/roles', async () => {
      const roles = [{ id: 'role1', name: 'Admin' }, { id: 'role2', name: 'Member' }];
      mockGet.mockResolvedValueOnce({ data: roles });

      const result = await messagesService.getAvailableRoles();

      expect(mockGet).toHaveBeenCalledWith('/messages/roles');
      expect(result).toEqual(roles);
    });
  });

  // --- getMessageStats ---
  describe('getMessageStats', () => {
    it('should GET /messages/:id/stats', async () => {
      const stats = { total_recipients: 50, read_count: 30, acknowledgment_count: 25 };
      mockGet.mockResolvedValueOnce({ data: stats });

      const result = await messagesService.getMessageStats('m1');

      expect(mockGet).toHaveBeenCalledWith('/messages/m1/stats');
      expect(result).toEqual(stats);
    });
  });

  // --- getInbox ---
  describe('getInbox', () => {
    it('should GET /messages/inbox with params', async () => {
      const messages = [{ id: 'm1', title: 'Inbox Message' }];
      mockGet.mockResolvedValueOnce({ data: messages });

      const result = await messagesService.getInbox({ include_read: true, skip: 0, limit: 20 });

      expect(mockGet).toHaveBeenCalledWith('/messages/inbox', {
        params: { include_read: true, skip: 0, limit: 20 },
      });
      expect(result).toEqual(messages);
    });

    it('should GET /messages/inbox without params', async () => {
      mockGet.mockResolvedValueOnce({ data: [] });

      const result = await messagesService.getInbox();

      expect(mockGet).toHaveBeenCalledWith('/messages/inbox', { params: undefined });
      expect(result).toEqual([]);
    });
  });

  // --- getUnreadCount ---
  describe('getUnreadCount', () => {
    it('should GET /messages/inbox/unread-count', async () => {
      const data = { unread_count: 3 };
      mockGet.mockResolvedValueOnce({ data });

      const result = await messagesService.getUnreadCount();

      expect(mockGet).toHaveBeenCalledWith('/messages/inbox/unread-count');
      expect(result).toEqual(data);
    });
  });

  // --- markAsRead ---
  describe('markAsRead', () => {
    it('should POST to /messages/:id/read', async () => {
      mockPost.mockResolvedValueOnce({});

      await messagesService.markAsRead('m1');

      expect(mockPost).toHaveBeenCalledWith('/messages/m1/read');
    });
  });

  // --- acknowledge ---
  describe('acknowledge', () => {
    it('should POST to /messages/:id/acknowledge', async () => {
      mockPost.mockResolvedValueOnce({});

      await messagesService.acknowledge('m1');

      expect(mockPost).toHaveBeenCalledWith('/messages/m1/acknowledge');
    });
  });
});
