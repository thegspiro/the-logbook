import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetTemplates = vi.fn();
const mockUpdateTemplate = vi.fn();
const mockPreviewTemplate = vi.fn();

vi.mock('../../../services/api', () => ({
  emailTemplatesService: {
    getTemplates: (...args: unknown[]) => mockGetTemplates(...args) as unknown,
    getTemplate: vi.fn(),
    updateTemplate: (...args: unknown[]) => mockUpdateTemplate(...args) as unknown,
    previewTemplate: (...args: unknown[]) => mockPreviewTemplate(...args) as unknown,
    uploadAttachment: vi.fn(),
    deleteAttachment: vi.fn(),
  },
}));

import { useEmailTemplatesStore } from './emailTemplatesStore';

const sampleTemplate = {
  id: 'tmpl-1',
  organization_id: 'org-1',
  template_type: 'welcome',
  name: 'Welcome Email',
  description: 'Sent to new members',
  subject: 'Welcome to {{organization_name}}',
  html_body: '<p>Hello {{first_name}}</p>',
  text_body: 'Hello {{first_name}}',
  css_styles: 'body { color: #333; }',
  allow_attachments: true,
  is_active: true,
  available_variables: [
    { name: 'first_name', description: "Recipient's first name" },
    { name: 'organization_name', description: 'Organization name' },
  ],
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  attachments: [],
};

describe('emailTemplatesStore', () => {
  beforeEach(() => {
    useEmailTemplatesStore.setState({
      templates: [],
      selectedTemplate: null,
      preview: null,
      isLoading: false,
      isSaving: false,
      isPreviewing: false,
      error: null,
    });
    vi.clearAllMocks();
  });

  it('fetches templates successfully', async () => {
    mockGetTemplates.mockResolvedValue([sampleTemplate]);

    await useEmailTemplatesStore.getState().fetchTemplates();

    const state = useEmailTemplatesStore.getState();
    expect(state.templates).toHaveLength(1);
    expect(state.templates[0]?.name).toBe('Welcome Email');
    expect(state.isLoading).toBe(false);
    expect(state.error).toBeNull();
  });

  it('handles fetch error', async () => {
    mockGetTemplates.mockRejectedValue(new Error('Network error'));

    await useEmailTemplatesStore.getState().fetchTemplates();

    const state = useEmailTemplatesStore.getState();
    expect(state.templates).toHaveLength(0);
    expect(state.error).toBe('Network error');
    expect(state.isLoading).toBe(false);
  });

  it('selects a template', () => {
    useEmailTemplatesStore.getState().selectTemplate(sampleTemplate);

    const state = useEmailTemplatesStore.getState();
    expect(state.selectedTemplate?.id).toBe('tmpl-1');
    expect(state.preview).toBeNull();
  });

  it('updates a template', async () => {
    const updated = { ...sampleTemplate, subject: 'New Subject' };
    mockUpdateTemplate.mockResolvedValue(updated);

    useEmailTemplatesStore.setState({
      templates: [sampleTemplate],
      selectedTemplate: sampleTemplate,
    });

    await useEmailTemplatesStore.getState().updateTemplate('tmpl-1', { subject: 'New Subject' });

    const state = useEmailTemplatesStore.getState();
    expect(state.templates[0]?.subject).toBe('New Subject');
    expect(state.selectedTemplate?.subject).toBe('New Subject');
    expect(state.isSaving).toBe(false);
  });

  it('handles update error', async () => {
    mockUpdateTemplate.mockRejectedValue(new Error('Save failed'));

    useEmailTemplatesStore.setState({
      templates: [sampleTemplate],
      selectedTemplate: sampleTemplate,
    });

    await expect(
      useEmailTemplatesStore.getState().updateTemplate('tmpl-1', { subject: 'New' }),
    ).rejects.toThrow();

    const state = useEmailTemplatesStore.getState();
    expect(state.error).toBe('Save failed');
    expect(state.isSaving).toBe(false);
  });

  it('previews a template', async () => {
    const previewData = {
      subject: 'Welcome to Sample Department',
      html_body: '<p>Hello John</p>',
      text_body: 'Hello John',
    };
    mockPreviewTemplate.mockResolvedValue(previewData);

    await useEmailTemplatesStore.getState().previewTemplate('tmpl-1', { first_name: 'John' });

    const state = useEmailTemplatesStore.getState();
    expect(state.preview).toEqual(previewData);
    expect(state.isPreviewing).toBe(false);
  });

  it('clears preview', () => {
    useEmailTemplatesStore.setState({
      preview: { subject: 'Test', html_body: '<p>Test</p>', text_body: 'Test' },
    });

    useEmailTemplatesStore.getState().clearPreview();
    expect(useEmailTemplatesStore.getState().preview).toBeNull();
  });

  it('clears error', () => {
    useEmailTemplatesStore.setState({ error: 'Some error' });

    useEmailTemplatesStore.getState().clearError();
    expect(useEmailTemplatesStore.getState().error).toBeNull();
  });
});
