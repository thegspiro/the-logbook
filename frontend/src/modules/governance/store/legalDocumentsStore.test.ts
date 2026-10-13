import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGetOverview = vi.fn();
const mockCreateRevision = vi.fn();
const mockUpdateRevision = vi.fn();
const mockPublishRevision = vi.fn();
const mockListRevisions = vi.fn();

vi.mock('../services/api', () => ({
  legalDocumentsService: {
    getOverview: () => mockGetOverview() as unknown,
    createRevision: (...args: unknown[]) => mockCreateRevision(...args) as unknown,
    updateRevision: (...args: unknown[]) => mockUpdateRevision(...args) as unknown,
    deleteRevision: vi.fn(),
    publishRevision: (...args: unknown[]) => mockPublishRevision(...args) as unknown,
    revertToDefault: vi.fn(),
    listRevisions: (...args: unknown[]) => mockListRevisions(...args) as unknown,
  },
}));

import { useLegalDocumentsStore } from './legalDocumentsStore';

const emptyOverview = { organizationName: 'Test FD', canPublish: true, documents: [] };

describe('useLegalDocumentsStore', () => {
  beforeEach(() => {
    useLegalDocumentsStore.setState({
      overview: null,
      isLoading: false,
      isSaving: false,
      loadingMore: null,
      error: null,
    });
    vi.clearAllMocks();
    mockGetOverview.mockReset();
    mockGetOverview.mockResolvedValue(emptyOverview);
    mockListRevisions.mockReset();
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

  it('sends an explicit null when a field is cleared on update', async () => {
    // An omitted key means "leave this alone" on the backend, so a cleared
    // effective date has to travel as null or the old one survives the save.
    mockUpdateRevision.mockResolvedValue({ id: 'rev-1' });
    await useLegalDocumentsStore.getState().updateRevision('rev-1', {
      body: 'Revised.',
      changeNote: 'Per counsel.',
      effectiveDate: null,
    });
    expect(mockUpdateRevision).toHaveBeenCalledWith('rev-1', {
      body: 'Revised.',
      changeNote: 'Per counsel.',
      effectiveDate: null,
    });
  });

  it('rethrows a failed mutation so the caller can keep the editor open', async () => {
    mockPublishRevision.mockRejectedValue(new Error('403'));
    await expect(useLegalDocumentsStore.getState().publishRevision('rev-1')).rejects.toThrow();
    expect(useLegalDocumentsStore.getState().error).toBe('403');
    expect(useLegalDocumentsStore.getState().isSaving).toBe(false);
  });
  describe('loadMore', () => {
    const revision = (id: string) => ({
      id,
      documentType: 'privacy_policy' as const,
      status: 'archived' as const,
      body: 'Text.',
      changeNote: 'Why.',
    });
    const withHistory = {
      ...emptyOverview,
      documents: [
        {
          documentType: 'privacy_policy' as const,
          publicPath: '/privacy',
          usingPlatformDefault: false,
          drafts: [],
          draftsTotal: 0,
          history: [revision('h-1'), revision('h-2')],
          historyTotal: 4,
        },
      ],
    };

    it('asks for the page after what is shown and appends it', async () => {
      useLegalDocumentsStore.setState({ overview: withHistory });
      mockListRevisions.mockResolvedValue({
        items: [revision('h-3'), revision('h-4')],
        total: 4,
        offset: 2,
        limit: 10,
      });

      await useLegalDocumentsStore.getState().loadMore('privacy_policy', 'history');

      expect(mockListRevisions).toHaveBeenCalledWith('privacy_policy', 'history', 2);
      const doc = useLegalDocumentsStore.getState().overview?.documents[0];
      expect(doc?.history.map((r) => r.id)).toEqual(['h-1', 'h-2', 'h-3', 'h-4']);
      expect(useLegalDocumentsStore.getState().loadingMore).toBeNull();
    });

    it('does not repeat a revision a newer one pushed onto the next page', async () => {
      useLegalDocumentsStore.setState({ overview: withHistory });
      mockListRevisions.mockResolvedValue({
        items: [revision('h-2'), revision('h-3')],
        total: 5,
        offset: 2,
        limit: 10,
      });

      await useLegalDocumentsStore.getState().loadMore('privacy_policy', 'history');

      const doc = useLegalDocumentsStore.getState().overview?.documents[0];
      expect(doc?.history.map((r) => r.id)).toEqual(['h-1', 'h-2', 'h-3']);
      expect(doc?.historyTotal).toBe(5);
    });

    it('keeps what is shown and reports a failed page', async () => {
      useLegalDocumentsStore.setState({ overview: withHistory });
      mockListRevisions.mockRejectedValue(new Error('network'));

      await useLegalDocumentsStore.getState().loadMore('privacy_policy', 'history');

      expect(useLegalDocumentsStore.getState().error).toBe('network');
      expect(useLegalDocumentsStore.getState().overview?.documents[0]?.history).toHaveLength(2);
    });
  });
});
