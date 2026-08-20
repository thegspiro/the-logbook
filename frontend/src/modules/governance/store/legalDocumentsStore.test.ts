import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetOverview = vi.fn();
const mockCreateRevision = vi.fn();
const mockPublishRevision = vi.fn();

vi.mock('../services/api', () => ({
  legalDocumentsService: {
    getOverview: () => mockGetOverview() as unknown,
    createRevision: (...args: unknown[]) => mockCreateRevision(...args) as unknown,
    updateRevision: vi.fn(),
    deleteRevision: vi.fn(),
    publishRevision: (...args: unknown[]) => mockPublishRevision(...args) as unknown,
    revertToDefault: vi.fn(),
  },
}));

import { useLegalDocumentsStore } from './legalDocumentsStore';

const emptyOverview = { organizationName: 'Test FD', canPublish: true, documents: [] };

describe('useLegalDocumentsStore', () => {
  beforeEach(() => {
    useLegalDocumentsStore.setState({ overview: null, isLoading: false, isSaving: false, error: null });
    vi.clearAllMocks();
    mockGetOverview.mockResolvedValue(emptyOverview);
  });

  it('loads the overview', async () => {
    await useLegalDocumentsStore.getState().fetchOverview();
    expect(useLegalDocumentsStore.getState().overview).toEqual(emptyOverview);
    expect(useLegalDocumentsStore.getState().isLoading).toBe(false);
  });

  it('surfaces a load failure instead of showing an empty screen', async () => {
    mockGetOverview.mockRejectedValue(new Error('network'));
    await useLegalDocumentsStore.getState().fetchOverview();
    expect(useLegalDocumentsStore.getState().error).toBe('network');
    expect(useLegalDocumentsStore.getState().overview).toBeNull();
  });

  it('refetches after a mutation so the screen matches what the public page serves', async () => {
    mockCreateRevision.mockResolvedValue({ id: 'rev-1' });
    await useLegalDocumentsStore.getState().createRevision({
      documentType: 'privacy_policy',
      body: 'Text.',
      changeNote: 'Why.',
    });
    expect(mockCreateRevision).toHaveBeenCalledWith({
      documentType: 'privacy_policy',
      body: 'Text.',
      changeNote: 'Why.',
    });
    expect(mockGetOverview).toHaveBeenCalled();
  });

  it('rethrows a failed mutation so the caller can keep the editor open', async () => {
    mockPublishRevision.mockRejectedValue(new Error('403'));
    await expect(useLegalDocumentsStore.getState().publishRevision('rev-1')).rejects.toThrow();
    expect(useLegalDocumentsStore.getState().error).toBe('403');
    expect(useLegalDocumentsStore.getState().isSaving).toBe(false);
  });
});
