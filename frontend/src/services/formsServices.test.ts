import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock apiClient BEFORE importing the service
const mockGet = vi.fn();
const mockPost = vi.fn();
const mockPatch = vi.fn();
const mockDelete = vi.fn();

vi.mock('./apiClient', () => ({
  default: {
    get: (...args: unknown[]) => mockGet(...args) as unknown,
    post: (...args: unknown[]) => mockPost(...args) as unknown,
    patch: (...args: unknown[]) => mockPatch(...args) as unknown,
    delete: (...args: unknown[]) => mockDelete(...args) as unknown,
  },
}));

// Mock bare axios for publicFormsService
const mockAxiosGet = vi.fn();
const mockAxiosPost = vi.fn();

vi.mock('axios', () => ({
  default: {
    get: (...args: unknown[]) => mockAxiosGet(...args) as unknown,
    post: (...args: unknown[]) => mockAxiosPost(...args) as unknown,
  },
}));

// Import services AFTER mocks
import { formsService, publicFormsService } from './formsServices';

beforeEach(() => {
  vi.clearAllMocks();
});

// ============================================
// formsService
// ============================================
describe('formsService', () => {
  // --- getSummary ---
  describe('getSummary', () => {
    it('should GET /forms/summary', async () => {
      const summary = { total_forms: 10, published: 5, draft: 3, archived: 2 };
      mockGet.mockResolvedValueOnce({ data: summary });

      const result = await formsService.getSummary();

      expect(mockGet).toHaveBeenCalledWith('/forms/summary');
      expect(result).toEqual(summary);
    });
  });

  // --- getForms ---
  describe('getForms', () => {
    it('should GET /forms without params', async () => {
      const data = { forms: [{ id: 'f1', title: 'Form 1' }], total: 1 };
      mockGet.mockResolvedValueOnce({ data });

      const result = await formsService.getForms();

      expect(mockGet).toHaveBeenCalledWith('/forms', { params: undefined });
      expect(result).toEqual(data);
    });

    it('should pass filter params to GET /forms', async () => {
      const data = { forms: [], total: 0 };
      mockGet.mockResolvedValueOnce({ data });
      const params = { status: 'published', category: 'intake', limit: 10 };

      await formsService.getForms(params);

      expect(mockGet).toHaveBeenCalledWith('/forms', { params });
    });
  });

  // --- getForm ---
  describe('getForm', () => {
    it('should GET /forms/:id', async () => {
      const form = { id: 'f1', title: 'Test Form', fields: [] };
      mockGet.mockResolvedValueOnce({ data: form });

      const result = await formsService.getForm('f1');

      expect(mockGet).toHaveBeenCalledWith('/forms/f1');
      expect(result).toEqual(form);
    });
  });

  // --- createForm ---
  describe('createForm', () => {
    it('should POST to /forms', async () => {
      const formData = { title: 'New Form', description: 'Desc' };
      const created = { id: 'f1', ...formData };
      mockPost.mockResolvedValueOnce({ data: created });

      const result = await formsService.createForm(formData as never);

      expect(mockPost).toHaveBeenCalledWith('/forms', formData);
      expect(result).toEqual(created);
    });

    it('should propagate errors', async () => {
      mockPost.mockRejectedValueOnce(new Error('Validation error'));

      await expect(formsService.createForm({} as never)).rejects.toThrow('Validation error');
    });
  });

  // --- updateForm ---
  describe('updateForm', () => {
    it('should PATCH /forms/:id', async () => {
      const updateData = { title: 'Updated Form' };
      const updated = { id: 'f1', title: 'Updated Form' };
      mockPatch.mockResolvedValueOnce({ data: updated });

      const result = await formsService.updateForm('f1', updateData as never);

      expect(mockPatch).toHaveBeenCalledWith('/forms/f1', updateData);
      expect(result).toEqual(updated);
    });
  });

  // --- deleteForm ---
  describe('deleteForm', () => {
    it('should DELETE /forms/:id', async () => {
      mockDelete.mockResolvedValueOnce({});

      await formsService.deleteForm('f1');

      expect(mockDelete).toHaveBeenCalledWith('/forms/f1');
    });
  });

  // --- publishForm ---
  describe('publishForm', () => {
    it('should POST to /forms/:id/publish', async () => {
      const published = { id: 'f1', status: 'published' };
      mockPost.mockResolvedValueOnce({ data: published });

      const result = await formsService.publishForm('f1');

      expect(mockPost).toHaveBeenCalledWith('/forms/f1/publish');
      expect(result).toEqual(published);
    });
  });

  // --- archiveForm ---
  describe('archiveForm', () => {
    it('should POST to /forms/:id/archive', async () => {
      const archived = { id: 'f1', status: 'archived' };
      mockPost.mockResolvedValueOnce({ data: archived });

      const result = await formsService.archiveForm('f1');

      expect(mockPost).toHaveBeenCalledWith('/forms/f1/archive');
      expect(result).toEqual(archived);
    });
  });

  // --- addField ---
  describe('addField', () => {
    it('should POST to /forms/:id/fields', async () => {
      const fieldData = { label: 'Name', field_type: 'text' };
      const field = { id: 'field1', ...fieldData };
      mockPost.mockResolvedValueOnce({ data: field });

      const result = await formsService.addField('f1', fieldData as never);

      expect(mockPost).toHaveBeenCalledWith('/forms/f1/fields', fieldData);
      expect(result).toEqual(field);
    });
  });

  // --- updateField ---
  describe('updateField', () => {
    it('should PATCH /forms/:formId/fields/:fieldId', async () => {
      const updateData = { label: 'Updated Label' };
      const updated = { id: 'field1', label: 'Updated Label' };
      mockPatch.mockResolvedValueOnce({ data: updated });

      const result = await formsService.updateField('f1', 'field1', updateData as never);

      expect(mockPatch).toHaveBeenCalledWith('/forms/f1/fields/field1', updateData);
      expect(result).toEqual(updated);
    });
  });

  // --- deleteField ---
  describe('deleteField', () => {
    it('should DELETE /forms/:formId/fields/:fieldId', async () => {
      mockDelete.mockResolvedValueOnce({});

      await formsService.deleteField('f1', 'field1');

      expect(mockDelete).toHaveBeenCalledWith('/forms/f1/fields/field1');
    });
  });

  // --- submitForm ---
  describe('submitForm', () => {
    it('should POST submission data to /forms/:id/submit', async () => {
      const submissionData = { name: 'John Doe', email: 'john@example.com' };
      const submission = { id: 's1', data: submissionData };
      mockPost.mockResolvedValueOnce({ data: submission });

      const result = await formsService.submitForm('f1', submissionData);

      expect(mockPost).toHaveBeenCalledWith('/forms/f1/submit', { data: submissionData });
      expect(result).toEqual(submission);
    });
  });

  // --- getSubmissions ---
  describe('getSubmissions', () => {
    it('should GET /forms/:id/submissions with params', async () => {
      const data = { submissions: [{ id: 's1' }], total: 1 };
      mockGet.mockResolvedValueOnce({ data });
      const params = { skip: 0, limit: 20 };

      const result = await formsService.getSubmissions('f1', params);

      expect(mockGet).toHaveBeenCalledWith('/forms/f1/submissions', { params });
      expect(result).toEqual(data);
    });

    it('should GET /forms/:id/submissions without params', async () => {
      const data = { submissions: [], total: 0 };
      mockGet.mockResolvedValueOnce({ data });

      await formsService.getSubmissions('f1');

      expect(mockGet).toHaveBeenCalledWith('/forms/f1/submissions', { params: undefined });
    });
  });

  // --- deleteSubmission ---
  describe('deleteSubmission', () => {
    it('should DELETE /forms/:formId/submissions/:submissionId', async () => {
      mockDelete.mockResolvedValueOnce({});

      await formsService.deleteSubmission('f1', 's1');

      expect(mockDelete).toHaveBeenCalledWith('/forms/f1/submissions/s1');
    });
  });

  // --- addIntegration ---
  describe('addIntegration', () => {
    it('should POST to /forms/:id/integrations', async () => {
      const integrationData = { type: 'webhook', url: 'https://example.com/hook' };
      const integration = { id: 'i1', ...integrationData };
      mockPost.mockResolvedValueOnce({ data: integration });

      const result = await formsService.addIntegration('f1', integrationData as never);

      expect(mockPost).toHaveBeenCalledWith('/forms/f1/integrations', integrationData);
      expect(result).toEqual(integration);
    });
  });

  // --- updateIntegration ---
  describe('updateIntegration', () => {
    it('should PATCH /forms/:formId/integrations/:integrationId', async () => {
      const updateData = { url: 'https://example.com/new-hook' };
      const updated = { id: 'i1', ...updateData };
      mockPatch.mockResolvedValueOnce({ data: updated });

      const result = await formsService.updateIntegration('f1', 'i1', updateData as never);

      expect(mockPatch).toHaveBeenCalledWith('/forms/f1/integrations/i1', updateData);
      expect(result).toEqual(updated);
    });
  });

  // --- deleteIntegration ---
  describe('deleteIntegration', () => {
    it('should DELETE /forms/:formId/integrations/:integrationId', async () => {
      mockDelete.mockResolvedValueOnce({});

      await formsService.deleteIntegration('f1', 'i1');

      expect(mockDelete).toHaveBeenCalledWith('/forms/f1/integrations/i1');
    });
  });

  // --- memberLookup ---
  describe('memberLookup', () => {
    it('should GET /forms/member-lookup with query and default limit', async () => {
      const data = { members: [{ id: 'u1', name: 'John Doe' }] };
      mockGet.mockResolvedValueOnce({ data });

      const result = await formsService.memberLookup('john');

      expect(mockGet).toHaveBeenCalledWith('/forms/member-lookup', {
        params: { q: 'john', limit: 20 },
      });
      expect(result).toEqual(data);
    });

    it('should pass custom limit', async () => {
      mockGet.mockResolvedValueOnce({ data: { members: [] } });

      await formsService.memberLookup('jane', 5);

      expect(mockGet).toHaveBeenCalledWith('/forms/member-lookup', {
        params: { q: 'jane', limit: 5 },
      });
    });
  });

  // --- reorderFields ---
  describe('reorderFields', () => {
    it('should POST field IDs to /forms/:id/fields/reorder', async () => {
      mockPost.mockResolvedValueOnce({});
      const fieldIds = ['field3', 'field1', 'field2'];

      await formsService.reorderFields('f1', fieldIds);

      expect(mockPost).toHaveBeenCalledWith('/forms/f1/fields/reorder', fieldIds);
    });
  });
});

// ============================================
// publicFormsService
// ============================================
describe('publicFormsService', () => {
  describe('getForm', () => {
    it('should GET public form by slug using bare axios', async () => {
      const form = { id: 'f1', title: 'Public Form', fields: [] };
      mockAxiosGet.mockResolvedValueOnce({ data: form });

      const result = await publicFormsService.getForm('my-form-slug');

      expect(mockAxiosGet).toHaveBeenCalledWith('/api/public/v1/forms/my-form-slug');
      expect(result).toEqual(form);
    });
  });

  describe('submitForm', () => {
    it('should POST submission data to public endpoint using bare axios', async () => {
      const response = { id: 's1', message: 'Submitted' };
      mockAxiosPost.mockResolvedValueOnce({ data: response });
      const data = { name: 'Jane' };

      const result = await publicFormsService.submitForm('my-form-slug', data, 'Jane Doe', 'jane@example.com');

      expect(mockAxiosPost).toHaveBeenCalledWith(
        '/api/public/v1/forms/my-form-slug/submit',
        { data, submitter_name: 'Jane Doe', submitter_email: 'jane@example.com' },
      );
      expect(result).toEqual(response);
    });

    it('should include honeypot field when provided (bot detection)', async () => {
      mockAxiosPost.mockResolvedValueOnce({ data: {} });

      await publicFormsService.submitForm('slug', {}, undefined, undefined, 'bot-value');

      expect(mockAxiosPost).toHaveBeenCalledWith(
        '/api/public/v1/forms/slug/submit',
        expect.objectContaining({ website: 'bot-value' }),
      );
    });

    it('should not include honeypot field when empty', async () => {
      mockAxiosPost.mockResolvedValueOnce({ data: {} });

      await publicFormsService.submitForm('slug', {});

      const payload = mockAxiosPost.mock.calls[0]?.[1] as Record<string, unknown>;
      expect(payload.website).toBeUndefined();
    });
  });
});
