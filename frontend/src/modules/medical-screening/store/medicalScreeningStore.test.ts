import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockListRequirements = vi.fn();
const mockCreateRequirement = vi.fn();
const mockUpdateRequirement = vi.fn();
const mockDeleteRequirement = vi.fn();
const mockListRecords = vi.fn();
const mockCreateRecord = vi.fn();
const mockUpdateRecord = vi.fn();
const mockDeleteRecord = vi.fn();
const mockGetUserCompliance = vi.fn();
const mockGetExpiringScreenings = vi.fn();

vi.mock('../services/api', () => ({
  medicalScreeningService: {
    listRequirements: (...args: unknown[]) => mockListRequirements(...args) as unknown,
    createRequirement: (...args: unknown[]) => mockCreateRequirement(...args) as unknown,
    updateRequirement: (...args: unknown[]) => mockUpdateRequirement(...args) as unknown,
    deleteRequirement: (...args: unknown[]) => mockDeleteRequirement(...args) as unknown,
    listRecords: (...args: unknown[]) => mockListRecords(...args) as unknown,
    createRecord: (...args: unknown[]) => mockCreateRecord(...args) as unknown,
    updateRecord: (...args: unknown[]) => mockUpdateRecord(...args) as unknown,
    deleteRecord: (...args: unknown[]) => mockDeleteRecord(...args) as unknown,
    getUserCompliance: (...args: unknown[]) => mockGetUserCompliance(...args) as unknown,
    getExpiringScreenings: (...args: unknown[]) => mockGetExpiringScreenings(...args) as unknown,
  },
}));

import { useMedicalScreeningStore } from './medicalScreeningStore';

describe('medicalScreeningStore', () => {
  beforeEach(() => {
    useMedicalScreeningStore.setState({
      requirements: [],
      records: [],
      compliance: null,
      expiringScreenings: [],
      isLoading: false,
      error: null,
    });
    vi.clearAllMocks();
  });

  // =========================================================================
  // Requirements
  // =========================================================================

  describe('fetchRequirements', () => {
    it('loads requirements into state', async () => {
      const mockData = [
        { id: 'req-1', name: 'Annual Physical', screening_type: 'physical_exam', is_active: true },
      ];
      mockListRequirements.mockResolvedValue(mockData);

      await useMedicalScreeningStore.getState().fetchRequirements();

      expect(mockListRequirements).toHaveBeenCalledWith();
      expect(useMedicalScreeningStore.getState().requirements).toEqual(mockData);
      expect(useMedicalScreeningStore.getState().isLoading).toBe(false);
      expect(useMedicalScreeningStore.getState().error).toBeNull();
    });

    it('sets error on failure', async () => {
      mockListRequirements.mockRejectedValue(new Error('Network error'));

      await useMedicalScreeningStore.getState().fetchRequirements();

      expect(useMedicalScreeningStore.getState().requirements).toEqual([]);
      expect(useMedicalScreeningStore.getState().error).toBe('Failed to load requirements');
      expect(useMedicalScreeningStore.getState().isLoading).toBe(false);
    });

    it('passes filter params to service', async () => {
      mockListRequirements.mockResolvedValue([]);

      await useMedicalScreeningStore.getState().fetchRequirements({
        is_active: true,
        screening_type: 'drug_screening',
      });

      expect(mockListRequirements).toHaveBeenCalledWith({
        is_active: true,
        screening_type: 'drug_screening',
      });
    });
  });

  describe('createRequirement', () => {
    it('adds new requirement to state', async () => {
      const newReq = { id: 'req-new', name: 'Drug Test', screening_type: 'drug_screening' };
      mockCreateRequirement.mockResolvedValue(newReq);

      const result = await useMedicalScreeningStore.getState().createRequirement({
        name: 'Drug Test',
        screening_type: 'drug_screening',
        is_active: true,
        grace_period_days: 30,
      });

      expect(result).toEqual(newReq);
      expect(useMedicalScreeningStore.getState().requirements).toContainEqual(newReq);
    });
  });

  describe('updateRequirement', () => {
    it('replaces updated requirement in state', async () => {
      useMedicalScreeningStore.setState({
        requirements: [
          { id: 'req-1', name: 'Old Name', screening_type: 'physical_exam', is_active: true } as never,
        ],
      });
      const updated = { id: 'req-1', name: 'New Name', screening_type: 'physical_exam', is_active: true };
      mockUpdateRequirement.mockResolvedValue(updated);

      await useMedicalScreeningStore.getState().updateRequirement('req-1', { name: 'New Name' });

      expect(useMedicalScreeningStore.getState().requirements[0]).toEqual(updated);
    });
  });

  describe('deleteRequirement', () => {
    it('removes requirement from state', async () => {
      useMedicalScreeningStore.setState({
        requirements: [
          { id: 'req-1', name: 'Physical', screening_type: 'physical_exam', is_active: true } as never,
          { id: 'req-2', name: 'Drug Test', screening_type: 'drug_screening', is_active: true } as never,
        ],
      });
      mockDeleteRequirement.mockResolvedValue(undefined);

      await useMedicalScreeningStore.getState().deleteRequirement('req-1');

      expect(useMedicalScreeningStore.getState().requirements).toHaveLength(1);
      expect(useMedicalScreeningStore.getState().requirements[0]?.id).toBe('req-2');
    });
  });

  // =========================================================================
  // Records
  // =========================================================================

  describe('fetchRecords', () => {
    it('loads records into state', async () => {
      const mockData = [
        { id: 'rec-1', screening_type: 'physical_exam', status: 'passed' },
      ];
      mockListRecords.mockResolvedValue(mockData);

      await useMedicalScreeningStore.getState().fetchRecords();

      expect(useMedicalScreeningStore.getState().records).toEqual(mockData);
      expect(useMedicalScreeningStore.getState().isLoading).toBe(false);
    });

    it('sets error on failure', async () => {
      mockListRecords.mockRejectedValue(new Error('Server error'));

      await useMedicalScreeningStore.getState().fetchRecords();

      expect(useMedicalScreeningStore.getState().error).toBe('Failed to load records');
    });
  });

  describe('createRecord', () => {
    it('adds new record to state', async () => {
      const newRec = { id: 'rec-new', screening_type: 'drug_screening', status: 'scheduled' };
      mockCreateRecord.mockResolvedValue(newRec);

      const result = await useMedicalScreeningStore.getState().createRecord({
        screening_type: 'drug_screening',
        status: 'scheduled',
      });

      expect(result).toEqual(newRec);
      expect(useMedicalScreeningStore.getState().records).toContainEqual(newRec);
    });
  });

  describe('deleteRecord', () => {
    it('removes record from state', async () => {
      useMedicalScreeningStore.setState({
        records: [
          { id: 'rec-1', screening_type: 'physical_exam', status: 'passed' } as never,
        ],
      });
      mockDeleteRecord.mockResolvedValue(undefined);

      await useMedicalScreeningStore.getState().deleteRecord('rec-1');

      expect(useMedicalScreeningStore.getState().records).toHaveLength(0);
    });
  });

  // =========================================================================
  // Compliance & Expiring
  // =========================================================================

  describe('fetchUserCompliance', () => {
    it('loads compliance data into state', async () => {
      const mockCompliance = {
        subject_id: 'user-1',
        subject_name: '',
        subject_type: 'user',
        total_requirements: 2,
        compliant_count: 1,
        non_compliant_count: 1,
        expiring_soon_count: 0,
        is_fully_compliant: false,
        items: [],
      };
      mockGetUserCompliance.mockResolvedValue(mockCompliance);

      await useMedicalScreeningStore.getState().fetchUserCompliance('user-1');

      expect(useMedicalScreeningStore.getState().compliance).toEqual(mockCompliance);
      expect(useMedicalScreeningStore.getState().isLoading).toBe(false);
    });
  });

  describe('fetchExpiringScreenings', () => {
    it('loads expiring screenings into state', async () => {
      const mockExpiring = [
        {
          record_id: 'rec-1',
          screening_type: 'physical_exam',
          days_until_expiration: 15,
          expiration_date: '2026-04-01',
        },
      ];
      mockGetExpiringScreenings.mockResolvedValue(mockExpiring);

      await useMedicalScreeningStore.getState().fetchExpiringScreenings(60);

      expect(mockGetExpiringScreenings).toHaveBeenCalledWith(60);
      expect(useMedicalScreeningStore.getState().expiringScreenings).toEqual(mockExpiring);
    });

    it('sets error on failure', async () => {
      mockGetExpiringScreenings.mockRejectedValue(new Error('fail'));

      await useMedicalScreeningStore.getState().fetchExpiringScreenings();

      expect(useMedicalScreeningStore.getState().error).toBe('Failed to load expiring screenings');
    });
  });
});
