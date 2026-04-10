import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGet = vi.fn();
const mockPost = vi.fn();
const mockPatch = vi.fn();
const mockPut = vi.fn();
const mockDelete = vi.fn();

vi.mock('./apiClient', () => ({
  default: {
    get: (...args: unknown[]) => mockGet(...args) as unknown,
    post: (...args: unknown[]) => mockPost(...args) as unknown,
    patch: (...args: unknown[]) => mockPatch(...args) as unknown,
    put: (...args: unknown[]) => mockPut(...args) as unknown,
    delete: (...args: unknown[]) => mockDelete(...args) as unknown,
    defaults: { baseURL: '/api/v1' },
  },
}));

import { inventoryService } from './inventoryService';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('inventoryService', () => {
  // ── Categories ──────────────────────────────────────────────────────

  describe('getCategories', () => {
    it('should GET /inventory/categories with default params', async () => {
      const categories = [{ id: 'c1', name: 'PPE' }];
      mockGet.mockResolvedValueOnce({ data: categories });

      const result = await inventoryService.getCategories();

      expect(mockGet).toHaveBeenCalledWith('/inventory/categories', {
        params: { item_type: undefined, active_only: true },
      });
      expect(result).toEqual(categories);
    });

    it('should pass itemType and activeOnly params', async () => {
      mockGet.mockResolvedValueOnce({ data: [] });

      await inventoryService.getCategories('consumable', false);

      expect(mockGet).toHaveBeenCalledWith('/inventory/categories', {
        params: { item_type: 'consumable', active_only: false },
      });
    });
  });

  describe('createCategory', () => {
    it('should POST to /inventory/categories', async () => {
      const data = { name: 'Turnout Gear', item_type: 'equipment' };
      const created = { id: 'c1', ...data };
      mockPost.mockResolvedValueOnce({ data: created });

      const result = await inventoryService.createCategory(data as never);

      expect(mockPost).toHaveBeenCalledWith('/inventory/categories', data);
      expect(result).toEqual(created);
    });
  });

  describe('updateCategory', () => {
    it('should PATCH /inventory/categories/:id', async () => {
      const updated = { id: 'c1', name: 'Updated PPE' };
      mockPatch.mockResolvedValueOnce({ data: updated });

      const result = await inventoryService.updateCategory('c1', { name: 'Updated PPE' });

      expect(mockPatch).toHaveBeenCalledWith('/inventory/categories/c1', { name: 'Updated PPE' });
      expect(result).toEqual(updated);
    });
  });

  // ── Items CRUD ──────────────────────────────────────────────────────

  describe('getItems', () => {
    it('should GET /inventory/items with filter params', async () => {
      const response = { items: [{ id: 'i1' }], total: 1 };
      mockGet.mockResolvedValueOnce({ data: response });

      const params = { category_id: 'c1', status: 'available', search: 'helmet' };
      const result = await inventoryService.getItems(params);

      expect(mockGet).toHaveBeenCalledWith('/inventory/items', { params });
      expect(result).toEqual(response);
    });

    it('should GET /inventory/items without params', async () => {
      mockGet.mockResolvedValueOnce({ data: { items: [], total: 0 } });

      await inventoryService.getItems();

      expect(mockGet).toHaveBeenCalledWith('/inventory/items', { params: undefined });
    });
  });

  describe('getItem', () => {
    it('should GET /inventory/items/:id', async () => {
      const item = { id: 'i1', name: 'SCBA Tank' };
      mockGet.mockResolvedValueOnce({ data: item });

      const result = await inventoryService.getItem('i1');

      expect(mockGet).toHaveBeenCalledWith('/inventory/items/i1');
      expect(result).toEqual(item);
    });
  });

  describe('createItem', () => {
    it('should POST to /inventory/items', async () => {
      const data = { name: 'New Helmet', category_id: 'c1' };
      const created = { id: 'i1', ...data };
      mockPost.mockResolvedValueOnce({ data: created });

      const result = await inventoryService.createItem(data as never);

      expect(mockPost).toHaveBeenCalledWith('/inventory/items', data);
      expect(result).toEqual(created);
    });
  });

  describe('updateItem', () => {
    it('should PATCH /inventory/items/:id', async () => {
      const updated = { id: 'i1', name: 'Updated Helmet' };
      mockPatch.mockResolvedValueOnce({ data: updated });

      const result = await inventoryService.updateItem('i1', { name: 'Updated Helmet' } as never);

      expect(mockPatch).toHaveBeenCalledWith('/inventory/items/i1', { name: 'Updated Helmet' });
      expect(result).toEqual(updated);
    });
  });

  describe('retireItem', () => {
    it('should POST to /inventory/items/:id/retire with notes', async () => {
      mockPost.mockResolvedValueOnce({});

      await inventoryService.retireItem('i1', 'End of life');

      expect(mockPost).toHaveBeenCalledWith('/inventory/items/i1/retire', { notes: 'End of life' });
    });

    it('should POST to /inventory/items/:id/retire without notes', async () => {
      mockPost.mockResolvedValueOnce({});

      await inventoryService.retireItem('i1');

      expect(mockPost).toHaveBeenCalledWith('/inventory/items/i1/retire', { notes: undefined });
    });
  });

  describe('getItemHistory', () => {
    it('should GET /inventory/items/:id/history', async () => {
      const history = { events: [{ id: 'e1', event_type: 'created' }] };
      mockGet.mockResolvedValueOnce({ data: history });

      const result = await inventoryService.getItemHistory('i1');

      expect(mockGet).toHaveBeenCalledWith('/inventory/items/i1/history');
      expect(result).toEqual(history);
    });
  });

  // ── Assignment operations ───────────────────────────────────────────

  describe('assignItem', () => {
    it('should POST to /inventory/items/:id/assign with default assignment_type', async () => {
      const response = { id: 'a1', item_id: 'i1', user_id: 'u1', is_active: true };
      mockPost.mockResolvedValueOnce({ data: response });

      const result = await inventoryService.assignItem('i1', 'u1');

      expect(mockPost).toHaveBeenCalledWith('/inventory/items/i1/assign', {
        item_id: 'i1',
        user_id: 'u1',
        assignment_type: 'permanent',
        assignment_reason: undefined,
      });
      expect(result).toEqual(response);
    });

    it('should pass custom assignment options', async () => {
      const response = { id: 'a1', item_id: 'i1', user_id: 'u1', is_active: true };
      mockPost.mockResolvedValueOnce({ data: response });

      await inventoryService.assignItem('i1', 'u1', {
        assignment_type: 'temporary',
        assignment_reason: 'Training exercise',
      });

      expect(mockPost).toHaveBeenCalledWith('/inventory/items/i1/assign', {
        item_id: 'i1',
        user_id: 'u1',
        assignment_type: 'temporary',
        assignment_reason: 'Training exercise',
      });
    });
  });

  describe('unassignItem', () => {
    it('should POST to /inventory/items/:id/unassign', async () => {
      const response = { message: 'Item unassigned' };
      mockPost.mockResolvedValueOnce({ data: response });

      const result = await inventoryService.unassignItem('i1', {
        return_condition: 'good',
        return_notes: 'No damage',
      });

      expect(mockPost).toHaveBeenCalledWith('/inventory/items/i1/unassign', {
        return_condition: 'good',
        return_notes: 'No damage',
      });
      expect(result).toEqual(response);
    });

    it('should work without options', async () => {
      mockPost.mockResolvedValueOnce({ data: { message: 'Item unassigned' } });

      await inventoryService.unassignItem('i1');

      expect(mockPost).toHaveBeenCalledWith('/inventory/items/i1/unassign', {
        return_condition: undefined,
        return_notes: undefined,
      });
    });
  });

  // ── Checkout operations ─────────────────────────────────────────────

  describe('checkoutItem', () => {
    it('should POST to /inventory/checkout', async () => {
      const data = { item_id: 'i1', user_id: 'u1', checkout_reason: 'Field deployment' };
      const response = { id: 'co1' };
      mockPost.mockResolvedValueOnce({ data: response });

      const result = await inventoryService.checkoutItem(data);

      expect(mockPost).toHaveBeenCalledWith('/inventory/checkout', data);
      expect(result).toEqual(response);
    });
  });

  describe('checkInItem', () => {
    it('should POST to /inventory/checkout/:id/checkin', async () => {
      mockPost.mockResolvedValueOnce({});

      await inventoryService.checkInItem('co1', 'good', 'Minor scuff');

      expect(mockPost).toHaveBeenCalledWith('/inventory/checkout/co1/checkin', {
        return_condition: 'good',
        damage_notes: 'Minor scuff',
      });
    });

    it('should POST without damage notes', async () => {
      mockPost.mockResolvedValueOnce({});

      await inventoryService.checkInItem('co1', 'good');

      expect(mockPost).toHaveBeenCalledWith('/inventory/checkout/co1/checkin', {
        return_condition: 'good',
        damage_notes: undefined,
      });
    });
  });

  describe('extendCheckout', () => {
    it('should PATCH /inventory/checkout/:id/extend', async () => {
      const response = { message: 'Extended', expected_return_at: '2026-05-01T00:00:00Z' };
      mockPatch.mockResolvedValueOnce({ data: response });

      const result = await inventoryService.extendCheckout('co1', '2026-05-01T00:00:00Z');

      expect(mockPatch).toHaveBeenCalledWith('/inventory/checkout/co1/extend', {
        expected_return_at: '2026-05-01T00:00:00Z',
      });
      expect(result).toEqual(response);
    });
  });

  describe('getActiveCheckouts', () => {
    it('should GET /inventory/checkout/active', async () => {
      const data = { checkouts: [{ id: 'co1' }], total: 1 };
      mockGet.mockResolvedValueOnce({ data });

      const result = await inventoryService.getActiveCheckouts();

      expect(mockGet).toHaveBeenCalledWith('/inventory/checkout/active');
      expect(result).toEqual(data);
    });
  });

  describe('getOverdueCheckouts', () => {
    it('should GET /inventory/checkout/overdue', async () => {
      const data = { checkouts: [], total: 0 };
      mockGet.mockResolvedValueOnce({ data });

      const result = await inventoryService.getOverdueCheckouts();

      expect(mockGet).toHaveBeenCalledWith('/inventory/checkout/overdue');
      expect(result).toEqual(data);
    });
  });

  // ── Maintenance ─────────────────────────────────────────────────────

  describe('getItemMaintenanceHistory', () => {
    it('should GET /inventory/items/:id/maintenance', async () => {
      const records = [{ id: 'm1', type: 'inspection' }];
      mockGet.mockResolvedValueOnce({ data: records });

      const result = await inventoryService.getItemMaintenanceHistory('i1');

      expect(mockGet).toHaveBeenCalledWith('/inventory/items/i1/maintenance');
      expect(result).toEqual(records);
    });
  });

  describe('createMaintenanceRecord', () => {
    it('should POST to /inventory/maintenance', async () => {
      const data = { item_id: 'i1', maintenance_type: 'inspection', notes: 'Passed' };
      const created = { id: 'm1', ...data };
      mockPost.mockResolvedValueOnce({ data: created });

      const result = await inventoryService.createMaintenanceRecord(data as never);

      expect(mockPost).toHaveBeenCalledWith('/inventory/maintenance', data);
      expect(result).toEqual(created);
    });
  });

  describe('updateMaintenanceRecord', () => {
    it('should PATCH /inventory/items/:itemId/maintenance/:recordId', async () => {
      const updated = { id: 'm1', notes: 'Updated notes' };
      mockPatch.mockResolvedValueOnce({ data: updated });

      const result = await inventoryService.updateMaintenanceRecord('i1', 'm1', { notes: 'Updated notes' } as never);

      expect(mockPatch).toHaveBeenCalledWith('/inventory/items/i1/maintenance/m1', { notes: 'Updated notes' });
      expect(result).toEqual(updated);
    });
  });

  describe('getMaintenanceDueItems', () => {
    it('should GET /inventory/maintenance/due with default daysAhead', async () => {
      mockGet.mockResolvedValueOnce({ data: [] });

      await inventoryService.getMaintenanceDueItems();

      expect(mockGet).toHaveBeenCalledWith('/inventory/maintenance/due', { params: { days_ahead: 30 } });
    });

    it('should pass custom daysAhead', async () => {
      mockGet.mockResolvedValueOnce({ data: [] });

      await inventoryService.getMaintenanceDueItems(60);

      expect(mockGet).toHaveBeenCalledWith('/inventory/maintenance/due', { params: { days_ahead: 60 } });
    });
  });

  // ── Summary / Dashboard ─────────────────────────────────────────────

  describe('getSummary', () => {
    it('should GET /inventory/summary', async () => {
      const summary = { total_items: 100, available: 80 };
      mockGet.mockResolvedValueOnce({ data: summary });

      const result = await inventoryService.getSummary();

      expect(mockGet).toHaveBeenCalledWith('/inventory/summary');
      expect(result).toEqual(summary);
    });
  });

  describe('getSummaryByLocation', () => {
    it('should GET /inventory/summary/by-location', async () => {
      const data = [{ location_id: 'l1', total: 50 }];
      mockGet.mockResolvedValueOnce({ data });

      const result = await inventoryService.getSummaryByLocation();

      expect(mockGet).toHaveBeenCalledWith('/inventory/summary/by-location');
      expect(result).toEqual(data);
    });
  });

  describe('getMembersSummary', () => {
    it('should GET /inventory/members-summary without search', async () => {
      const data = { members: [], total: 0 };
      mockGet.mockResolvedValueOnce({ data });

      const result = await inventoryService.getMembersSummary();

      expect(mockGet).toHaveBeenCalledWith('/inventory/members-summary', {
        params: undefined,
      });
      expect(result).toEqual(data);
    });

    it('should pass search param', async () => {
      mockGet.mockResolvedValueOnce({ data: { members: [], total: 0 } });

      await inventoryService.getMembersSummary('Smith');

      expect(mockGet).toHaveBeenCalledWith('/inventory/members-summary', {
        params: { search: 'Smith' },
      });
    });
  });

  describe('getUserInventory', () => {
    it('should GET /inventory/users/:id/inventory', async () => {
      const data = { items: [], checkouts: [] };
      mockGet.mockResolvedValueOnce({ data });

      const result = await inventoryService.getUserInventory('u1');

      expect(mockGet).toHaveBeenCalledWith('/inventory/users/u1/inventory');
      expect(result).toEqual(data);
    });
  });

  // ── Pool Issuance ───────────────────────────────────────────────────

  describe('issueFromPool', () => {
    it('should POST to /inventory/items/:id/issue with defaults', async () => {
      const response = { id: 'iss1', item_id: 'i1', user_id: 'u1' };
      mockPost.mockResolvedValueOnce({ data: response });

      const result = await inventoryService.issueFromPool('i1', 'u1');

      expect(mockPost).toHaveBeenCalledWith('/inventory/items/i1/issue', {
        user_id: 'u1',
        quantity: 1,
        issue_reason: undefined,
      });
      expect(result).toEqual(response);
    });

    it('should pass custom quantity and reason', async () => {
      mockPost.mockResolvedValueOnce({ data: { id: 'iss1' } });

      await inventoryService.issueFromPool('i1', 'u1', 5, 'Annual resupply');

      expect(mockPost).toHaveBeenCalledWith('/inventory/items/i1/issue', {
        user_id: 'u1',
        quantity: 5,
        issue_reason: 'Annual resupply',
      });
    });
  });

  describe('returnToPool', () => {
    it('should POST to /inventory/issuances/:id/return', async () => {
      const response = { message: 'Returned' };
      mockPost.mockResolvedValueOnce({ data: response });

      const result = await inventoryService.returnToPool('iss1', {
        return_condition: 'good',
        quantity_returned: 2,
      });

      expect(mockPost).toHaveBeenCalledWith('/inventory/issuances/iss1/return', {
        return_condition: 'good',
        return_notes: undefined,
        quantity_returned: 2,
      });
      expect(result).toEqual(response);
    });
  });

  // ── Storage Areas ───────────────────────────────────────────────────

  describe('getStorageAreas', () => {
    it('should GET /inventory/storage-areas with params', async () => {
      const areas = [{ id: 'sa1', name: 'Bay 1' }];
      mockGet.mockResolvedValueOnce({ data: areas });

      const result = await inventoryService.getStorageAreas({ location_id: 'l1' });

      expect(mockGet).toHaveBeenCalledWith('/inventory/storage-areas', { params: { location_id: 'l1' } });
      expect(result).toEqual(areas);
    });
  });

  describe('createStorageArea', () => {
    it('should POST to /inventory/storage-areas', async () => {
      const data = { name: 'Bay 2', location_id: 'l1' };
      const created = { id: 'sa2', ...data };
      mockPost.mockResolvedValueOnce({ data: created });

      const result = await inventoryService.createStorageArea(data as never);

      expect(mockPost).toHaveBeenCalledWith('/inventory/storage-areas', data);
      expect(result).toEqual(created);
    });
  });

  describe('updateStorageArea', () => {
    it('should PUT /inventory/storage-areas/:id', async () => {
      const updated = { id: 'sa1', name: 'Updated Bay' };
      mockPut.mockResolvedValueOnce({ data: updated });

      const result = await inventoryService.updateStorageArea('sa1', { name: 'Updated Bay' } as never);

      expect(mockPut).toHaveBeenCalledWith('/inventory/storage-areas/sa1', { name: 'Updated Bay' });
      expect(result).toEqual(updated);
    });
  });

  describe('deleteStorageArea', () => {
    it('should DELETE /inventory/storage-areas/:id', async () => {
      mockDelete.mockResolvedValueOnce({});

      await inventoryService.deleteStorageArea('sa1');

      expect(mockDelete).toHaveBeenCalledWith('/inventory/storage-areas/sa1');
    });
  });

  // ── Barcode / Scan ──────────────────────────────────────────────────

  describe('lookupByCode', () => {
    it('should GET /inventory/lookup with code param', async () => {
      const data = { item_id: 'i1', name: 'Helmet' };
      mockGet.mockResolvedValueOnce({ data });

      const result = await inventoryService.lookupByCode('BC-12345');

      expect(mockGet).toHaveBeenCalledWith('/inventory/lookup', { params: { code: 'BC-12345' } });
      expect(result).toEqual(data);
    });
  });

  describe('batchCheckout', () => {
    it('should POST to /inventory/batch-checkout', async () => {
      const data = { user_id: 'u1', item_codes: ['BC-1', 'BC-2'] };
      const response = { successful: 2, failed: 0 };
      mockPost.mockResolvedValueOnce({ data: response });

      const result = await inventoryService.batchCheckout(data as never);

      expect(mockPost).toHaveBeenCalledWith('/inventory/batch-checkout', data);
      expect(result).toEqual(response);
    });
  });

  describe('batchReturn', () => {
    it('should POST to /inventory/batch-return', async () => {
      const data = { item_codes: ['BC-1'], return_condition: 'good' };
      const response = { successful: 1, failed: 0 };
      mockPost.mockResolvedValueOnce({ data: response });

      const result = await inventoryService.batchReturn(data as never);

      expect(mockPost).toHaveBeenCalledWith('/inventory/batch-return', data);
      expect(result).toEqual(response);
    });
  });

  // ── Equipment Requests ──────────────────────────────────────────────

  describe('createEquipmentRequest', () => {
    it('should POST to /inventory/requests', async () => {
      const data = { item_name: 'New Radio', quantity: 2, priority: 'high', reason: 'Broken unit' };
      const response = { id: 'r1', item_name: 'New Radio', status: 'pending', message: 'Created' };
      mockPost.mockResolvedValueOnce({ data: response });

      const result = await inventoryService.createEquipmentRequest(data);

      expect(mockPost).toHaveBeenCalledWith('/inventory/requests', data);
      expect(result).toEqual(response);
    });
  });

  describe('getEquipmentRequests', () => {
    it('should GET /inventory/requests with params', async () => {
      const data = { requests: [], total: 0 };
      mockGet.mockResolvedValueOnce({ data });

      const result = await inventoryService.getEquipmentRequests({ status: 'pending' });

      expect(mockGet).toHaveBeenCalledWith('/inventory/requests', { params: { status: 'pending' } });
      expect(result).toEqual(data);
    });
  });

  describe('reviewEquipmentRequest', () => {
    it('should PUT /inventory/requests/:id/review', async () => {
      const reviewData = { status: 'approved', review_notes: 'Approved for purchase' };
      const response = { id: 'r1', status: 'approved', message: 'Reviewed' };
      mockPut.mockResolvedValueOnce({ data: response });

      const result = await inventoryService.reviewEquipmentRequest('r1', reviewData);

      expect(mockPut).toHaveBeenCalledWith('/inventory/requests/r1/review', reviewData);
      expect(result).toEqual(response);
    });
  });

  // ── Write-Off Requests ──────────────────────────────────────────────

  describe('createWriteOffRequest', () => {
    it('should POST to /inventory/write-offs', async () => {
      const data = { item_id: 'i1', reason: 'damaged', description: 'Fire damage' };
      const created = { id: 'w1', ...data, status: 'pending' };
      mockPost.mockResolvedValueOnce({ data: created });

      const result = await inventoryService.createWriteOffRequest(data);

      expect(mockPost).toHaveBeenCalledWith('/inventory/write-offs', data);
      expect(result).toEqual(created);
    });
  });

  describe('reviewWriteOff', () => {
    it('should PUT /inventory/write-offs/:id/review', async () => {
      const data = { status: 'approved' };
      const response = { id: 'w1', status: 'approved', message: 'Approved' };
      mockPut.mockResolvedValueOnce({ data: response });

      const result = await inventoryService.reviewWriteOff('w1', data);

      expect(mockPut).toHaveBeenCalledWith('/inventory/write-offs/w1/review', data);
      expect(result).toEqual(response);
    });
  });

  // ── NFPA Compliance ─────────────────────────────────────────────────

  describe('getNFPACompliance', () => {
    it('should GET /inventory/items/:id/nfpa-compliance', async () => {
      const data = { item_id: 'i1', manufacture_date: '2024-01-01' };
      mockGet.mockResolvedValueOnce({ data });

      const result = await inventoryService.getNFPACompliance('i1');

      expect(mockGet).toHaveBeenCalledWith('/inventory/items/i1/nfpa-compliance');
      expect(result).toEqual(data);
    });
  });

  describe('createNFPACompliance', () => {
    it('should POST to /inventory/items/:id/nfpa-compliance', async () => {
      const data = { manufacture_date: '2024-01-01' };
      const response = { item_id: 'i1', ...data };
      mockPost.mockResolvedValueOnce({ data: response });

      const result = await inventoryService.createNFPACompliance('i1', data as never);

      expect(mockPost).toHaveBeenCalledWith('/inventory/items/i1/nfpa-compliance', data);
      expect(result).toEqual(response);
    });
  });

  describe('getNFPASummary', () => {
    it('should GET /inventory/nfpa/summary', async () => {
      const data = { compliant: 50, non_compliant: 5 };
      mockGet.mockResolvedValueOnce({ data });

      const result = await inventoryService.getNFPASummary();

      expect(mockGet).toHaveBeenCalledWith('/inventory/nfpa/summary');
      expect(result).toEqual(data);
    });
  });

  describe('getNFPARetirementDue', () => {
    it('should GET /inventory/nfpa/retirement-due with default daysAhead', async () => {
      const data = { items: [], total: 0 };
      mockGet.mockResolvedValueOnce({ data });

      const result = await inventoryService.getNFPARetirementDue();

      expect(mockGet).toHaveBeenCalledWith('/inventory/nfpa/retirement-due', { params: { days_ahead: 180 } });
      expect(result).toEqual(data);
    });
  });

  // ── Equipment Kits ──────────────────────────────────────────────────

  describe('getEquipmentKits', () => {
    it('should GET /inventory/kits with activeOnly default', async () => {
      mockGet.mockResolvedValueOnce({ data: [] });

      await inventoryService.getEquipmentKits();

      expect(mockGet).toHaveBeenCalledWith('/inventory/kits', { params: { active_only: true } });
    });
  });

  describe('createEquipmentKit', () => {
    it('should POST to /inventory/kits', async () => {
      const data = { name: 'New Hire Kit', items: [] };
      const response = { id: 'k1', ...data };
      mockPost.mockResolvedValueOnce({ data: response });

      const result = await inventoryService.createEquipmentKit(data as never);

      expect(mockPost).toHaveBeenCalledWith('/inventory/kits', data);
      expect(result).toEqual(response);
    });
  });

  describe('issueKitToMember', () => {
    it('should POST to /inventory/kits/:kitId/issue/:userId', async () => {
      const response = { message: 'Kit issued', items_issued: 5 };
      mockPost.mockResolvedValueOnce({ data: response });

      const result = await inventoryService.issueKitToMember('k1', 'u1');

      expect(mockPost).toHaveBeenCalledWith('/inventory/kits/k1/issue/u1');
      expect(result).toEqual(response);
    });
  });

  // ── Reorder Requests ────────────────────────────────────────────────

  describe('getReorderRequests', () => {
    it('should GET /inventory/reorder-requests with params', async () => {
      mockGet.mockResolvedValueOnce({ data: [] });

      await inventoryService.getReorderRequests({ status: 'pending', urgency: 'high' });

      expect(mockGet).toHaveBeenCalledWith('/inventory/reorder-requests', {
        params: { status: 'pending', urgency: 'high' },
      });
    });
  });

  describe('createReorderRequest', () => {
    it('should POST to /inventory/reorder-requests', async () => {
      const data = { item_id: 'i1', quantity: 10 };
      const response = { id: 'ro1', ...data };
      mockPost.mockResolvedValueOnce({ data: response });

      const result = await inventoryService.createReorderRequest(data as never);

      expect(mockPost).toHaveBeenCalledWith('/inventory/reorder-requests', data);
      expect(result).toEqual(response);
    });
  });

  describe('deleteReorderRequest', () => {
    it('should DELETE /inventory/reorder-requests/:id', async () => {
      mockDelete.mockResolvedValueOnce({});

      await inventoryService.deleteReorderRequest('ro1');

      expect(mockDelete).toHaveBeenCalledWith('/inventory/reorder-requests/ro1');
    });
  });

  // ── Member Size Preferences ─────────────────────────────────────────

  describe('getMemberSizePreferences', () => {
    it('should GET /inventory/members/:userId/size-preferences', async () => {
      const data = { user_id: 'u1', sizes: {} };
      mockGet.mockResolvedValueOnce({ data });

      const result = await inventoryService.getMemberSizePreferences('u1');

      expect(mockGet).toHaveBeenCalledWith('/inventory/members/u1/size-preferences');
      expect(result).toEqual(data);
    });
  });

  describe('upsertMemberSizePreferences', () => {
    it('should PUT /inventory/members/:userId/size-preferences', async () => {
      const data = { shirt_size: 'L', pant_size: '32' };
      const response = { user_id: 'u1', ...data };
      mockPut.mockResolvedValueOnce({ data: response });

      const result = await inventoryService.upsertMemberSizePreferences('u1', data as never);

      expect(mockPut).toHaveBeenCalledWith('/inventory/members/u1/size-preferences', data);
      expect(result).toEqual(response);
    });
  });

  describe('getMySizePreferences', () => {
    it('should GET /inventory/my/size-preferences', async () => {
      const data = { sizes: {} };
      mockGet.mockResolvedValueOnce({ data });

      const result = await inventoryService.getMySizePreferences();

      expect(mockGet).toHaveBeenCalledWith('/inventory/my/size-preferences');
      expect(result).toEqual(data);
    });
  });

  // ── Low Stock ───────────────────────────────────────────────────────

  describe('getLowStockItems', () => {
    it('should GET /inventory/low-stock', async () => {
      const alerts = [{ item_id: 'i1', current_quantity: 2, min_quantity: 5 }];
      mockGet.mockResolvedValueOnce({ data: alerts });

      const result = await inventoryService.getLowStockItems();

      expect(mockGet).toHaveBeenCalledWith('/inventory/low-stock');
      expect(result).toEqual(alerts);
    });
  });

  // ── Error Propagation ───────────────────────────────────────────────

  describe('error propagation', () => {
    it('should propagate API errors from GET requests', async () => {
      mockGet.mockRejectedValueOnce(new Error('Network Error'));

      await expect(inventoryService.getSummary()).rejects.toThrow('Network Error');
    });

    it('should propagate API errors from POST requests', async () => {
      mockPost.mockRejectedValueOnce(new Error('403 Forbidden'));

      await expect(inventoryService.createItem({} as never)).rejects.toThrow('403 Forbidden');
    });

    it('should propagate API errors from PATCH requests', async () => {
      mockPatch.mockRejectedValueOnce(new Error('404 Not Found'));

      await expect(inventoryService.updateItem('bad-id', {} as never)).rejects.toThrow('404 Not Found');
    });

    it('should propagate API errors from PUT requests', async () => {
      mockPut.mockRejectedValueOnce(new Error('Validation Error'));

      await expect(
        inventoryService.updateStorageArea('bad-id', {} as never),
      ).rejects.toThrow('Validation Error');
    });

    it('should propagate API errors from DELETE requests', async () => {
      mockDelete.mockRejectedValueOnce(new Error('Server Error'));

      await expect(inventoryService.deleteStorageArea('bad-id')).rejects.toThrow('Server Error');
    });
  });
});
