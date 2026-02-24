import React, { useEffect, useState, useCallback } from 'react';
import {
  Package,
  Plus,
  Search,
  Filter,
  RefreshCw,
  AlertCircle,
  X,
  Tag,
  Layers,
  Barcode,
  Printer,
  Pencil,
  Archive,
  ArrowLeft,
  ChevronDown,
  Download,
  Send,
  ClipboardList,
  Check,
  XCircle,
  Loader2,
  Wrench,
  Calendar,
  CheckCircle2,
  Clock,
  FileX,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import {
  inventoryService,
  locationsService,
  type InventoryItem,
  type InventoryCategory,
  type EquipmentRequestItem,
  type WriteOffRequestItem,
  type InventorySummary,
  type InventoryItemCreate,
  type InventoryCategoryCreate,
  type LabelFormat,
  type Location,
  type MaintenanceRecord,
  type MaintenanceRecordCreate,
  type StorageAreaResponse,
} from '../services/api';
import { useAuthStore } from '../stores/authStore';
import { getErrorMessage } from '../utils/errorHandling';
import { ITEM_CONDITION_OPTIONS } from '../constants/enums';
import { useInventoryWebSocket } from '../hooks/useInventoryWebSocket';
import toast from 'react-hot-toast';

const ITEM_TYPES = [
  { value: 'uniform', label: 'Uniform' },
  { value: 'ppe', label: 'PPE' },
  { value: 'tool', label: 'Tool' },
  { value: 'equipment', label: 'Equipment' },
  { value: 'vehicle', label: 'Vehicle' },
  { value: 'electronics', label: 'Electronics' },
  { value: 'consumable', label: 'Consumable' },
  { value: 'other', label: 'Other' },
];

const STATUS_OPTIONS = [
  { value: 'available', label: 'Available', color: 'bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/30' },
  { value: 'assigned', label: 'Assigned', color: 'bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-500/30' },
  { value: 'checked_out', label: 'Checked Out', color: 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 border-yellow-500/30' },
  { value: 'in_maintenance', label: 'In Maintenance', color: 'bg-orange-500/10 text-orange-700 dark:text-orange-400 border-orange-500/30' },
  { value: 'lost', label: 'Lost', color: 'bg-red-500/10 text-red-700 dark:text-red-400 border-red-500/30' },
  { value: 'retired', label: 'Retired', color: 'bg-theme-surface-secondary text-theme-text-muted border-theme-surface-border' },
];

const CONDITION_OPTIONS = ITEM_CONDITION_OPTIONS;

const getStatusStyle = (status: string) => {
  const found = STATUS_OPTIONS.find(s => s.value === status);
  return found?.color || 'bg-theme-surface-secondary text-theme-text-muted border-theme-surface-border';
};

const getConditionColor = (condition: string) => {
  switch (condition) {
    case 'excellent': return 'text-green-700 dark:text-green-400';
    case 'good': return 'text-emerald-700 dark:text-emerald-400';
    case 'fair': return 'text-yellow-700 dark:text-yellow-400';
    case 'poor': return 'text-orange-700 dark:text-orange-400';
    case 'damaged': return 'text-red-700 dark:text-red-400';
    case 'out_of_service': return 'text-red-700 dark:text-red-500';
    default: return 'text-theme-text-muted';
  }
};

type Tab = 'items' | 'categories' | 'maintenance';

const InventoryPage: React.FC = () => {
  const { checkPermission } = useAuthStore();
  const canManage = checkPermission('inventory.manage');

  const [activeTab, setActiveTab] = useState<Tab>('items');
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [categories, setCategories] = useState<InventoryCategory[]>([]);
  const [summary, setSummary] = useState<InventorySummary | null>(null);
  const [totalItems, setTotalItems] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [filterLoading, setFilterLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Rooms (locations with room_number or building set) for storage location dropdown
  const [rooms, setRooms] = useState<Location[]>([]);

  // Structured storage areas
  const [storageAreas, setStorageAreas] = useState<StorageAreaResponse[]>([]);

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [categoryFilter, setCategoryFilter] = useState<string>('');

  // Modals
  const [showAddItem, setShowAddItem] = useState(false);
  const [showAddCategory, setShowAddCategory] = useState(false);

  // Label printing
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const [printingLabels, setPrintingLabels] = useState(false);
  const [labelFormat, setLabelFormat] = useState('letter');
  const [labelFormats, setLabelFormats] = useState<LabelFormat[]>([]);
  const [showLabelMenu, setShowLabelMenu] = useState(false);

  // Add item form
  const defaultItemForm: InventoryItemCreate = {
    name: '',
    description: '',
    category_id: '',
    tracking_type: 'individual',
    manufacturer: '',
    model_number: '',
    serial_number: '',
    asset_tag: '',
    barcode: '',
    location_id: '',
    storage_location: '',
    storage_area_id: '',
    station: '',
    size: '',
    color: '',
    condition: 'good',
    status: 'available',
    quantity: 1,
    unit_of_measure: '',
    purchase_price: undefined,
    purchase_date: '',
    vendor: '',
    warranty_expiration: '',
    inspection_interval_days: undefined,
    notes: '',
  };
  const [itemForm, setItemForm] = useState<InventoryItemCreate>(defaultItemForm);

  // Add category form
  const [categoryForm, setCategoryForm] = useState<InventoryCategoryCreate>({
    name: '',
    description: '',
    item_type: 'equipment',
    requires_serial_number: false,
    requires_maintenance: false,
    requires_assignment: false,
  });

  const [formError, setFormError] = useState<string | null>(null);

  // Edit/Detail/Retire state
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
  const [editForm, setEditForm] = useState<Partial<InventoryItemCreate>>({});
  const [showEditModal, setShowEditModal] = useState(false);
  const [showRetireConfirm, setShowRetireConfirm] = useState<InventoryItem | null>(null);
  const [retireNotes, setRetireNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Confirmation dialog for batch submit in scan modal
  const [showBatchConfirm, setShowBatchConfirm] = useState(false);

  // Bulk operations
  const [showBulkMenu, setShowBulkMenu] = useState(false);
  const [bulkStatus, setBulkStatus] = useState('');
  const [showBulkStatusModal, setShowBulkStatusModal] = useState(false);
  const [showBulkRetireModal, setShowBulkRetireModal] = useState(false);

  // Category edit
  const [editingCategory, setEditingCategory] = useState<InventoryCategory | null>(null);
  const [editCategoryForm, setEditCategoryForm] = useState<Partial<InventoryCategoryCreate>>({});

  // Pool issuance
  const [showPoolIssueModal, setShowPoolIssueModal] = useState(false);
  const [poolIssueItem, setPoolIssueItem] = useState<InventoryItem | null>(null);
  const [poolIssueForm, setPoolIssueForm] = useState({ member_id: '', quantity: 1, reason: '' });
  const [members, setMembers] = useState<Array<{ id: string; name: string }>>([]);

  // Low stock alerts
  const [lowStockAlerts, setLowStockAlerts] = useState<Array<{ category_id: string; category_name: string; item_type: string; current_stock: number; threshold: number; items?: Array<{ name: string; quantity: number }> }>>([]);

  // Equipment requests (admin view)
  const [pendingRequests, setPendingRequests] = useState<EquipmentRequestItem[]>([]);
  const [showRequestsPanel, setShowRequestsPanel] = useState(false);
  const [reviewingRequest, setReviewingRequest] = useState<EquipmentRequestItem | null>(null);
  const [reviewNotes, setReviewNotes] = useState('');
  const [showApproveConfirm, setShowApproveConfirm] = useState<EquipmentRequestItem | null>(null);

  // Maintenance tracking
  const [maintenanceDueItems, setMaintenanceDueItems] = useState<InventoryItem[]>([]);
  const [maintenanceRecords, setMaintenanceRecords] = useState<MaintenanceRecord[]>([]);
  const [maintenanceLoading, setMaintenanceLoading] = useState(false);
  const [showMaintenanceModal, setShowMaintenanceModal] = useState(false);
  const [maintenanceItem, setMaintenanceItem] = useState<InventoryItem | null>(null);
  const [maintenanceForm, setMaintenanceForm] = useState<Partial<MaintenanceRecordCreate>>({
    maintenance_type: 'inspection',
    description: '',
    notes: '',
    is_completed: false,
  });

  // Write-off requests
  const [writeOffRequests, setWriteOffRequests] = useState<WriteOffRequestItem[]>([]);
  const [showWriteOffsPanel, setShowWriteOffsPanel] = useState(false);
  const [showWriteOffModal, setShowWriteOffModal] = useState(false);
  const [writeOffItem, setWriteOffItem] = useState<InventoryItem | null>(null);
  const [writeOffForm, setWriteOffForm] = useState({ reason: 'lost', description: '' });
  const [reviewingWriteOff, setReviewingWriteOff] = useState<WriteOffRequestItem | null>(null);
  const [writeOffReviewNotes, setWriteOffReviewNotes] = useState('');

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (!loading) {
      loadItems();
    }
  }, [searchQuery, statusFilter, categoryFilter]);

  // Close label format menu on outside click
  useEffect(() => {
    if (!showLabelMenu) return;
    const handler = () => setShowLabelMenu(false);
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [showLabelMenu]);

  // Real-time updates via WebSocket
  useInventoryWebSocket({
    onEvent: useCallback(() => {
      // Refresh item list and summary when another user makes a change
      loadItems();
      inventoryService.getSummary().then(setSummary).catch(() => { /* non-critical refresh */ });
    }, [searchQuery, statusFilter, categoryFilter]),
  });

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [summaryData, categoriesData, itemsData, formatsData, locationsData, storageAreasData] = await Promise.all([
        inventoryService.getSummary(),
        inventoryService.getCategories(),
        inventoryService.getItems({ limit: 50 }),
        inventoryService.getLabelFormats(),
        locationsService.getLocations({ is_active: true }),
        inventoryService.getStorageAreas({ flat: true }).catch(() => [] as StorageAreaResponse[]),
      ]);
      setSummary(summaryData);
      setCategories(categoriesData);
      setStorageAreas(storageAreasData);
      setItems(itemsData.items);
      setTotalItems(itemsData.total);
      setLabelFormats(formatsData.formats);
      // Rooms are locations that have a room_number or a building (parent station) set
      setRooms(locationsData.filter(l => l.room_number || l.building));
      // Low stock alerts (non-critical)
      inventoryService.getLowStockItems().then(setLowStockAlerts).catch(() => { /* non-critical */ });
      // Load members for pool issuance and pending requests (non-critical)
      if (canManage) {
        inventoryService.getMembersSummary().then(data => {
          setMembers((data.members || []).map(m => ({ id: m.user_id, name: m.full_name || `${m.first_name || ''} ${m.last_name || ''}`.trim() || m.username || 'Unknown' })));
        }).catch(() => { /* non-critical */ });
        inventoryService.getEquipmentRequests({ status: 'pending' }).then(data => {
          setPendingRequests(data.requests || []);
        }).catch(() => { /* non-critical */ });
        inventoryService.getWriteOffRequests({ status: 'pending' }).then(data => {
          setWriteOffRequests(data || []);
        }).catch(() => { /* non-critical */ });
      }
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Unable to load inventory data. Please check your connection and refresh the page.'));
    } finally {
      setLoading(false);
    }
  };

  const loadItems = async () => {
    setFilterLoading(true);
    try {
      const data = await inventoryService.getItems({
        search: searchQuery || undefined,
        status: statusFilter || undefined,
        category_id: categoryFilter || undefined,
        limit: 50,
      });
      setItems(data.items);
      setTotalItems(data.total);
      setSelectedItemIds(new Set());
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to refresh items'));
    } finally {
      setFilterLoading(false);
    }
  };

  const loadMaintenanceData = async () => {
    setMaintenanceLoading(true);
    try {
      const dueItems = await inventoryService.getMaintenanceDueItems(90);
      setMaintenanceDueItems(dueItems);
      // Also load items currently in maintenance status
      const inMaintenanceData = await inventoryService.getItems({ status: 'in_maintenance', limit: 100 });
      // Merge: due items + in-maintenance items (deduplicated)
      const dueIds = new Set(dueItems.map(i => i.id));
      const combined = [...dueItems, ...inMaintenanceData.items.filter(i => !dueIds.has(i.id))];
      setMaintenanceDueItems(combined);
    } catch {
      toast.error('Failed to load maintenance data');
    } finally {
      setMaintenanceLoading(false);
    }
  };

  const loadItemMaintenanceHistory = async (itemId: string) => {
    try {
      const records = await inventoryService.getItemMaintenanceHistory(itemId);
      setMaintenanceRecords(records);
    } catch {
      setMaintenanceRecords([]);
    }
  };

  const handleCreateMaintenanceRecord = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!maintenanceItem) return;
    setSubmitting(true);
    try {
      await inventoryService.createMaintenanceRecord({
        item_id: maintenanceItem.id,
        maintenance_type: maintenanceForm.maintenance_type || 'inspection',
        description: maintenanceForm.description || undefined,
        notes: maintenanceForm.notes || undefined,
        completed_date: maintenanceForm.is_completed ? new Date().toISOString().split('T')[0] : undefined,
        is_completed: maintenanceForm.is_completed || false,
        condition_after: maintenanceForm.condition_after || undefined,
        next_due_date: maintenanceForm.next_due_date || undefined,
      } as MaintenanceRecordCreate);
      toast.success('Maintenance record created');
      setShowMaintenanceModal(false);
      setMaintenanceForm({ maintenance_type: 'inspection', description: '', notes: '', is_completed: false });
      loadMaintenanceData();
      loadData();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to create maintenance record'));
    } finally {
      setSubmitting(false);
    }
  };

  const loadMoreItems = async () => {
    setLoadingMore(true);
    try {
      const data = await inventoryService.getItems({
        search: searchQuery || undefined,
        status: statusFilter || undefined,
        category_id: categoryFilter || undefined,
        skip: items.length,
        limit: 50,
      });
      setItems(prev => [...prev, ...data.items]);
      setTotalItems(data.total);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to load more items'));
    } finally {
      setLoadingMore(false);
    }
  };

  const handleCreateItem = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    try {
      // Strip empty strings so the backend only receives fields with real values
      const payload: Partial<InventoryItemCreate> = {};
      for (const [key, value] of Object.entries(itemForm)) {
        if (value !== '' && value !== undefined && value !== null) {
          (payload as Record<string, unknown>)[key] = value;
        }
      }
      await inventoryService.createItem(payload as unknown as InventoryItemCreate);
      setShowAddItem(false);
      setItemForm(defaultItemForm);
      loadData();
      toast.success('Item added successfully');
    } catch (err: unknown) {
      setFormError(getErrorMessage(err, 'Unable to create the item. Please check your input and try again.'));
    }
  };

  const handleCreateCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    try {
      await inventoryService.createCategory(categoryForm);
      setShowAddCategory(false);
      setCategoryForm({
        name: '', description: '', item_type: 'equipment',
        requires_serial_number: false, requires_maintenance: false, requires_assignment: false,
      });
      loadData();
      toast.success('Category created successfully');
    } catch (err: unknown) {
      setFormError(getErrorMessage(err, 'Unable to create the category. Please check your input and try again.'));
    }
  };

  const openEditModal = (item: InventoryItem) => {
    setEditingItem(item);
    setEditForm({
      name: item.name,
      description: item.description || '',
      category_id: item.category_id || '',
      tracking_type: item.tracking_type,
      manufacturer: item.manufacturer || '',
      model_number: item.model_number || '',
      serial_number: item.serial_number || '',
      asset_tag: item.asset_tag || '',
      barcode: item.barcode || '',
      location_id: item.location_id || '',
      storage_location: item.storage_location || '',
      storage_area_id: item.storage_area_id || '',
      station: item.station || '',
      condition: item.condition,
      status: item.status,
      quantity: item.quantity,
      size: item.size || '',
      color: item.color || '',
      unit_of_measure: item.unit_of_measure || '',
      purchase_date: item.purchase_date || '',
      purchase_price: item.purchase_price,
      vendor: item.vendor || '',
      warranty_expiration: item.warranty_expiration || '',
      inspection_interval_days: item.inspection_interval_days,
      notes: item.notes || '',
    });
    setFormError(null);
    setShowEditModal(true);
  };

  const handleUpdateItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingItem) return;
    setFormError(null);
    setSubmitting(true);
    try {
      const payload: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(editForm)) {
        if (value !== '' && value !== undefined && value !== null) {
          payload[key] = value;
        }
      }
      await inventoryService.updateItem(editingItem.id, payload as Partial<InventoryItemCreate>);
      setShowEditModal(false);
      setEditingItem(null);
      loadData();
      toast.success('Item updated successfully');
    } catch (err: unknown) {
      setFormError(getErrorMessage(err, 'Unable to update the item.'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleRetireItem = async () => {
    if (!showRetireConfirm) return;
    setSubmitting(true);
    try {
      await inventoryService.retireItem(showRetireConfirm.id, retireNotes || undefined);
      setShowRetireConfirm(null);
      setRetireNotes('');
      loadData();
      toast.success('Item retired successfully');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Unable to retire item.'));
    } finally {
      setSubmitting(false);
    }
  };

  // Client-side validation helper
  const getSelectedCategory = useCallback(() => {
    const catId = itemForm.category_id;
    if (!catId) return null;
    return categories.find(c => c.id === catId) || null;
  }, [itemForm.category_id, categories]);

  const getCategoryName = (categoryId?: string) => {
    if (!categoryId) return '-';
    const cat = categories.find(c => c.id === categoryId);
    return cat?.name || '-';
  };

  const toggleItemSelection = (itemId: string) => {
    setSelectedItemIds(prev => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedItemIds.size === items.length) {
      setSelectedItemIds(new Set());
    } else {
      setSelectedItemIds(new Set(items.map(i => i.id)));
    }
  };

  const handlePrintLabels = async () => {
    if (selectedItemIds.size === 0) {
      toast.error('Select at least one item to print labels');
      return;
    }
    setPrintingLabels(true);
    setShowLabelMenu(false);
    try {
      const blob = await inventoryService.generateBarcodeLabels(
        Array.from(selectedItemIds),
        labelFormat,
      );
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      const fmt = labelFormats.find(f => f.id === labelFormat);
      toast.success(`Generated ${fmt?.description || labelFormat} labels for ${selectedItemIds.size} item(s)`);
      // Refresh items so auto-populated barcode values are visible in edit form
      loadData();
    } catch {
      toast.error('Failed to generate barcode labels');
    } finally {
      setPrintingLabels(false);
    }
  };

  // Bulk status update
  const handleBulkStatusUpdate = async () => {
    if (selectedItemIds.size === 0 || !bulkStatus) return;
    setSubmitting(true);
    try {
      let successCount = 0;
      for (const itemId of selectedItemIds) {
        try {
          await inventoryService.updateItem(itemId, { status: bulkStatus } as Partial<InventoryItemCreate>);
          successCount++;
        } catch { /* skip failed */ }
      }
      setShowBulkStatusModal(false);
      setBulkStatus('');
      setSelectedItemIds(new Set());
      loadData();
      toast.success(`Updated status for ${successCount} item(s)`);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Bulk update failed'));
    } finally {
      setSubmitting(false);
    }
  };

  // Bulk retire
  const handleBulkRetire = async () => {
    if (selectedItemIds.size === 0) return;
    setSubmitting(true);
    try {
      let successCount = 0;
      for (const itemId of selectedItemIds) {
        try {
          await inventoryService.retireItem(itemId);
          successCount++;
        } catch { /* skip failed */ }
      }
      setShowBulkRetireModal(false);
      setSelectedItemIds(new Set());
      loadData();
      toast.success(`Retired ${successCount} item(s)`);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Bulk retire failed'));
    } finally {
      setSubmitting(false);
    }
  };

  // Category edit
  const openEditCategory = (cat: InventoryCategory) => {
    setEditingCategory(cat);
    setEditCategoryForm({
      name: cat.name,
      description: cat.description || '',
      item_type: cat.item_type,
      requires_serial_number: cat.requires_serial_number,
      requires_maintenance: cat.requires_maintenance,
      requires_assignment: cat.requires_assignment,
      low_stock_threshold: cat.low_stock_threshold ?? undefined,
    });
    setFormError(null);
  };

  const handleUpdateCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingCategory) return;
    setSubmitting(true);
    try {
      await inventoryService.updateCategory(editingCategory.id, editCategoryForm);
      setEditingCategory(null);
      loadData();
      toast.success('Category updated');
    } catch (err: unknown) {
      setFormError(getErrorMessage(err, 'Unable to update category.'));
    } finally {
      setSubmitting(false);
    }
  };

  // CSV export
  const handleExportCsv = async () => {
    try {
      const blob = await inventoryService.exportItemsCsv({
        category_id: categoryFilter || undefined,
        status: statusFilter || undefined,
        search: searchQuery || undefined,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'inventory_export.csv';
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Inventory exported');
    } catch {
      toast.error('Failed to export inventory');
    }
  };

  // Pool issuance
  const openPoolIssueModal = (item: InventoryItem) => {
    setPoolIssueItem(item);
    setPoolIssueForm({ member_id: '', quantity: 1, reason: '' });
    setShowPoolIssueModal(true);
  };

  const handlePoolIssue = async () => {
    if (!poolIssueItem || !poolIssueForm.member_id) return;
    setSubmitting(true);
    try {
      await inventoryService.issueFromPool(poolIssueItem.id, poolIssueForm.member_id, poolIssueForm.quantity, poolIssueForm.reason || undefined);
      toast.success(`Issued ${poolIssueForm.quantity} ${poolIssueItem.name} successfully`);
      setShowPoolIssueModal(false);
      setPoolIssueItem(null);
      loadData();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to issue item'));
    } finally {
      setSubmitting(false);
    }
  };

  // Equipment request review
  const handleReviewRequest = async (requestId: string, decision: 'approved' | 'denied') => {
    setSubmitting(true);
    try {
      await inventoryService.reviewEquipmentRequest(requestId, { status: decision, review_notes: reviewNotes || undefined });
      toast.success(`Request ${decision}`);
      setPendingRequests(prev => prev.filter(r => r.id !== requestId));
      setReviewingRequest(null);
      setReviewNotes('');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to review request'));
    } finally {
      setSubmitting(false);
    }
  };

  // Write-off handlers
  const openWriteOffModal = (item: InventoryItem) => {
    setWriteOffItem(item);
    setWriteOffForm({ reason: 'lost', description: '' });
    setFormError(null);
    setShowWriteOffModal(true);
  };

  const handleCreateWriteOff = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!writeOffItem) return;
    setSubmitting(true);
    setFormError(null);
    try {
      await inventoryService.createWriteOffRequest({
        item_id: writeOffItem.id,
        reason: writeOffForm.reason,
        description: writeOffForm.description,
      });
      toast.success('Write-off request submitted for approval');
      setShowWriteOffModal(false);
      setWriteOffItem(null);
      // Refresh write-off list
      inventoryService.getWriteOffRequests({ status: 'pending' }).then(data => {
        setWriteOffRequests(data || []);
      }).catch(() => { /* non-critical refresh */ });
    } catch (err: unknown) {
      setFormError(getErrorMessage(err, 'Failed to create write-off request'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleReviewWriteOff = async (writeOffId: string, decision: 'approved' | 'denied') => {
    setSubmitting(true);
    try {
      await inventoryService.reviewWriteOff(writeOffId, {
        status: decision,
        review_notes: writeOffReviewNotes || undefined,
      });
      toast.success(`Write-off ${decision}`);
      setWriteOffRequests(prev => prev.filter(w => w.id !== writeOffId));
      setReviewingWriteOff(null);
      setWriteOffReviewNotes('');
      if (decision === 'approved') loadData();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to review write-off'));
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen">
        <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
          <div className="bg-theme-surface backdrop-blur-sm rounded-lg p-12 border border-theme-surface-border text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto mb-4"></div>
            <p className="text-theme-text-secondary" role="status" aria-live="polite">Loading inventory...</p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
        {/* Page Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
          <div className="flex items-center space-x-3 min-w-0">
            <div className="bg-emerald-600 rounded-lg p-2 flex-shrink-0">
              <Package className="w-6 h-6 text-theme-text-primary" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <h1 className="text-theme-text-primary text-xl sm:text-2xl font-bold">Equipment & Inventory</h1>
              <p className="text-theme-text-muted text-sm hidden sm:block">
                Manage equipment, track maintenance schedules, and monitor inventory levels
              </p>
            </div>
          </div>
          {canManage && (
            <div className="flex items-center space-x-2 sm:space-x-3 flex-shrink-0">
              {selectedItemIds.size > 0 && (
                <div className="relative">
                  <div className="flex items-center">
                    <button
                      onClick={handlePrintLabels}
                      disabled={printingLabels}
                      className="flex items-center space-x-2 px-3 sm:px-4 py-2 bg-theme-surface-hover hover:bg-theme-surface text-theme-text-primary rounded-l-lg border border-theme-surface-border transition-colors text-sm disabled:opacity-50"
                    >
                      <Printer className="w-4 h-4" aria-hidden="true" />
                      <span className="hidden sm:inline">Print Labels ({selectedItemIds.size})</span>
                      <span className="sm:hidden">Labels ({selectedItemIds.size})</span>
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); setShowLabelMenu(!showLabelMenu); }}
                      className="px-2 py-2 bg-theme-surface-hover hover:bg-theme-surface text-theme-text-primary rounded-r-lg border border-l-0 border-theme-surface-border transition-colors"
                      aria-label="Select label format"
                    >
                      <ChevronDown className="w-4 h-4" aria-hidden="true" />
                    </button>
                  </div>
                  {showLabelMenu && (
                    <div className="absolute right-0 top-full mt-1 w-72 bg-theme-surface-modal rounded-lg shadow-xl border border-theme-surface-border z-50 py-1">
                      <div className="px-3 py-2 border-b border-theme-surface-border">
                        <p className="text-xs font-medium text-theme-text-muted uppercase">Label Format</p>
                      </div>
                      {labelFormats.map((fmt) => (
                        <button
                          key={fmt.id}
                          onClick={() => { setLabelFormat(fmt.id); setShowLabelMenu(false); }}
                          className={`w-full text-left px-3 py-2 text-sm hover:bg-theme-surface-hover flex items-center justify-between ${
                            labelFormat === fmt.id ? 'text-blue-600 dark:text-blue-400 bg-blue-500/5' : 'text-theme-text-primary'
                          }`}
                        >
                          <div>
                            <span className="block">{fmt.description}</span>
                            {fmt.type === 'thermal' && fmt.width && fmt.height && (
                              <span className="text-xs text-theme-text-muted">{fmt.width}" x {fmt.height}" — Thermal</span>
                            )}
                            {fmt.type === 'sheet' && (
                              <span className="text-xs text-theme-text-muted">8.5" x 11" — Standard printer</span>
                            )}
                          </div>
                          {labelFormat === fmt.id && (
                            <span className="text-blue-600 dark:text-blue-400 text-xs font-medium">Selected</span>
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <Link
                to="/inventory/storage-areas"
                className="flex items-center space-x-2 px-3 sm:px-4 py-2 bg-theme-surface-hover hover:bg-theme-surface text-theme-text-primary rounded-lg transition-colors text-sm"
              >
                <Layers className="w-4 h-4" aria-hidden="true" />
                <span className="hidden sm:inline">Storage Areas</span>
              </Link>
              <button
                onClick={() => setShowAddCategory(true)}
                className="flex items-center space-x-2 px-3 sm:px-4 py-2 bg-theme-surface-hover hover:bg-theme-surface text-theme-text-primary rounded-lg transition-colors text-sm"
              >
                <Plus className="w-4 h-4" aria-hidden="true" />
                <span className="hidden sm:inline">Add Category</span>
                <span className="sm:hidden">Category</span>
              </button>
              <button
                onClick={() => setShowAddItem(true)}
                className="flex items-center space-x-2 px-3 sm:px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition-colors text-sm"
              >
                <Plus className="w-4 h-4" aria-hidden="true" />
                <span className="hidden sm:inline">Add Item</span>
                <span className="sm:hidden">Item</span>
              </button>
              {writeOffRequests.length > 0 && (
                <button
                  onClick={() => setShowWriteOffsPanel(!showWriteOffsPanel)}
                  className="flex items-center space-x-1.5 px-3 py-2 border border-red-500/30 bg-red-500/10 hover:bg-red-500/20 text-red-700 dark:text-red-400 rounded-lg transition-colors text-sm"
                  title="Pending write-off requests"
                >
                  <FileX className="w-4 h-4" />
                  <span className="hidden sm:inline">Write-offs</span>
                  <span className="px-1.5 py-0.5 text-xs bg-red-500 text-white rounded-full">{writeOffRequests.length}</span>
                </button>
              )}
              {pendingRequests.length > 0 && (
                <button
                  onClick={() => setShowRequestsPanel(!showRequestsPanel)}
                  className="flex items-center space-x-1.5 px-3 py-2 border border-yellow-500/30 bg-yellow-500/10 hover:bg-yellow-500/20 text-yellow-700 dark:text-yellow-400 rounded-lg transition-colors text-sm"
                  title="Pending equipment requests"
                >
                  <ClipboardList className="w-4 h-4" />
                  <span className="hidden sm:inline">Requests</span>
                  <span className="px-1.5 py-0.5 text-xs bg-yellow-500 text-white rounded-full">{pendingRequests.length}</span>
                </button>
              )}
            </div>
          )}
        </div>

        {/* Error Banner */}
        {error && (
          <div className="mb-6 bg-red-500/10 border border-red-500/30 rounded-lg p-4 flex items-center gap-3" role="alert">
            <AlertCircle className="w-5 h-5 text-red-700 dark:text-red-400 flex-shrink-0" aria-hidden="true" />
            <p className="text-red-700 dark:text-red-300 text-sm flex-1">{error}</p>
            <button onClick={loadData} className="flex items-center gap-1 text-red-700 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 text-sm" aria-label="Retry loading inventory">
              <RefreshCw className="w-4 h-4" aria-hidden="true" /> Retry
            </button>
          </div>
        )}

        {/* Summary Stats */}
        {summary && (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-8" role="region" aria-label="Inventory statistics">
            <div className="bg-theme-surface backdrop-blur-sm rounded-lg p-4 border border-theme-surface-border">
              <p className="text-theme-text-muted text-xs font-medium uppercase">Total Items</p>
              <p className="text-theme-text-primary text-2xl font-bold mt-1">{summary.total_items}</p>
            </div>
            <div className="bg-theme-surface backdrop-blur-sm rounded-lg p-4 border border-theme-surface-border">
              <p className="text-theme-text-muted text-xs font-medium uppercase">Total Value</p>
              <p className="text-emerald-700 dark:text-emerald-400 text-2xl font-bold mt-1">
                ${summary.total_value.toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </p>
            </div>
            <div className="bg-theme-surface backdrop-blur-sm rounded-lg p-4 border border-theme-surface-border">
              <p className="text-theme-text-muted text-xs font-medium uppercase">Active Checkouts</p>
              <p className="text-yellow-700 dark:text-yellow-400 text-2xl font-bold mt-1">{summary.active_checkouts}</p>
              {summary.overdue_checkouts > 0 && (
                <p className="text-red-700 dark:text-red-400 text-xs mt-1">{summary.overdue_checkouts} overdue</p>
              )}
            </div>
            <div className="bg-theme-surface backdrop-blur-sm rounded-lg p-4 border border-theme-surface-border">
              <p className="text-theme-text-muted text-xs font-medium uppercase">Maintenance Due</p>
              <p className="text-orange-700 dark:text-orange-400 text-2xl font-bold mt-1">{summary.maintenance_due_count}</p>
            </div>
          </div>
        )}

        {/* Low Stock Alerts */}
        {lowStockAlerts.length > 0 && (
          <div className="mb-6 bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-4" role="alert">
            <div className="flex items-center gap-2 mb-2">
              <AlertCircle className="w-5 h-5 text-yellow-600 dark:text-yellow-400" aria-hidden="true" />
              <h3 className="text-sm font-semibold text-yellow-700 dark:text-yellow-300">Low Stock Alerts</h3>
            </div>
            <div className="space-y-3">
              {lowStockAlerts.map(alert => (
                <div key={alert.category_id} className="bg-yellow-500/10 rounded-lg px-3 py-2">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm text-yellow-700 dark:text-yellow-300 font-medium">{alert.category_name}</span>
                    <span className="text-xs text-yellow-600 dark:text-yellow-400">
                      {alert.current_stock} qty / {alert.threshold} threshold
                    </span>
                  </div>
                  {alert.items && alert.items.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-1">
                      {alert.items.map((item, idx) => (
                        <span key={idx} className="inline-flex items-center gap-1 text-xs bg-yellow-500/15 rounded px-2 py-0.5 text-yellow-700 dark:text-yellow-300">
                          {item.name}
                          <span className="text-yellow-600 dark:text-yellow-400 font-medium">({item.quantity})</span>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Pending Write-Off Requests Panel */}
        {showWriteOffsPanel && writeOffRequests.length > 0 && (
          <div className="mb-6 bg-theme-surface rounded-lg border border-red-500/30 overflow-hidden">
            <div className="px-4 py-3 bg-red-500/10 border-b border-red-500/20 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-red-700 dark:text-red-300 flex items-center gap-2">
                <FileX className="w-4 h-4" /> Pending Write-Off Requests
              </h3>
              <button onClick={() => setShowWriteOffsPanel(false)} className="text-theme-text-muted hover:text-theme-text-primary p-1">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="divide-y divide-theme-surface-border">
              {writeOffRequests.map(wo => (
                <div key={wo.id} className="px-4 py-3 flex items-center justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-theme-text-primary text-sm font-medium">
                      {wo.item_name}
                      {wo.item_serial_number && <span className="text-theme-text-muted font-mono ml-2 text-xs">SN: {wo.item_serial_number}</span>}
                    </p>
                    <p className="text-theme-text-muted text-xs">
                      {wo.requester_name || 'Unknown'} &middot;
                      <span className="capitalize"> {wo.reason.replace(/_/g, ' ')}</span>
                      {wo.item_value != null && <span> &middot; ${wo.item_value.toFixed(2)}</span>}
                    </p>
                    {wo.description && <p className="text-theme-text-secondary text-xs mt-0.5 truncate">{wo.description}</p>}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      onClick={() => handleReviewWriteOff(wo.id, 'approved')}
                      disabled={submitting}
                      className="p-1.5 bg-green-600 hover:bg-green-700 text-white rounded-lg disabled:opacity-50"
                      title="Approve write-off"
                    >
                      <Check className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => { setReviewingWriteOff(wo); setWriteOffReviewNotes(''); }}
                      className="p-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg"
                      title="Deny (with notes)"
                    >
                      <XCircle className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Write-Off Deny Modal */}
        {reviewingWriteOff && (
          <div className="fixed inset-0 z-50 overflow-y-auto" role="dialog" aria-modal="true" onKeyDown={(e) => { if (e.key === 'Escape') setReviewingWriteOff(null); }}>
            <div className="flex items-center justify-center min-h-screen px-4">
              <div className="fixed inset-0 bg-black/60" onClick={() => setReviewingWriteOff(null)} aria-hidden="true" />
              <div className="relative bg-theme-surface-modal rounded-lg shadow-xl max-w-md w-full border border-theme-surface-border">
                <div className="px-6 pt-5 pb-4">
                  <h3 className="text-lg font-medium text-theme-text-primary mb-2">Deny Write-Off</h3>
                  <p className="text-theme-text-secondary text-sm mb-4">
                    {reviewingWriteOff.item_name} — {reviewingWriteOff.reason.replace(/_/g, ' ')}
                  </p>
                  <div>
                    <label htmlFor="wo-deny-notes" className="block text-sm font-medium text-theme-text-secondary mb-1">Reason for denial</label>
                    <textarea id="wo-deny-notes" rows={3} value={writeOffReviewNotes} onChange={(e) => setWriteOffReviewNotes(e.target.value)} className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-red-500" placeholder="Explain why this write-off is being denied..." />
                  </div>
                </div>
                <div className="bg-theme-input-bg px-6 py-3 flex justify-end gap-3 rounded-b-lg">
                  <button onClick={() => setReviewingWriteOff(null)} className="px-4 py-2 border border-theme-input-border rounded-lg text-theme-text-secondary hover:bg-theme-surface-hover transition-colors">Cancel</button>
                  <button onClick={() => handleReviewWriteOff(reviewingWriteOff.id, 'denied')} disabled={submitting} className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors disabled:opacity-50">
                    {submitting ? 'Denying...' : 'Deny Write-Off'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Pending Equipment Requests Panel */}
        {showRequestsPanel && pendingRequests.length > 0 && (
          <div className="mb-6 bg-theme-surface rounded-lg border border-yellow-500/30 overflow-hidden">
            <div className="px-4 py-3 bg-yellow-500/10 border-b border-yellow-500/20 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-yellow-700 dark:text-yellow-300 flex items-center gap-2">
                <ClipboardList className="w-4 h-4" /> Pending Equipment Requests
              </h3>
              <button onClick={() => setShowRequestsPanel(false)} className="text-theme-text-muted hover:text-theme-text-primary p-1">
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="divide-y divide-theme-surface-border">
              {pendingRequests.map(req => (
                <div key={req.id} className="px-4 py-3 flex items-center justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-theme-text-primary text-sm font-medium">{req.item_name} {req.quantity > 1 ? `x${req.quantity}` : ''}</p>
                    <p className="text-theme-text-muted text-xs">
                      {req.requester_name || 'Unknown'} &middot; {req.request_type} &middot;
                      <span className={req.priority === 'high' ? ' text-red-500 font-medium' : ''}> {req.priority} priority</span>
                    </p>
                    {req.reason && <p className="text-theme-text-secondary text-xs mt-0.5 truncate">{req.reason}</p>}
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      onClick={() => setShowApproveConfirm(req)}
                      className="p-1.5 bg-green-600 hover:bg-green-700 text-white rounded-lg"
                      title="Approve"
                    >
                      <Check className="w-4 h-4" />
                    </button>
                    <button
                      onClick={() => { setReviewingRequest(req); setReviewNotes(''); }}
                      className="p-1.5 bg-red-600 hover:bg-red-700 text-white rounded-lg"
                      title="Deny (with notes)"
                    >
                      <XCircle className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Request Deny Modal (with notes) */}
        {reviewingRequest && (
          <div className="fixed inset-0 z-50 overflow-y-auto" role="dialog" aria-modal="true" onKeyDown={(e) => { if (e.key === 'Escape') setReviewingRequest(null); }}>
            <div className="flex items-center justify-center min-h-screen px-4">
              <div className="fixed inset-0 bg-black/60" onClick={() => setReviewingRequest(null)} aria-hidden="true" />
              <div className="relative bg-theme-surface-modal rounded-lg shadow-xl max-w-md w-full border border-theme-surface-border">
                <div className="px-6 pt-5 pb-4">
                  <h3 className="text-lg font-medium text-theme-text-primary mb-2">Deny Request</h3>
                  <p className="text-theme-text-secondary text-sm mb-4">{reviewingRequest.item_name} requested by {reviewingRequest.requester_name || 'Unknown'}</p>
                  <div>
                    <label htmlFor="deny-notes" className="block text-sm font-medium text-theme-text-secondary mb-1">Reason for denial (optional)</label>
                    <textarea id="deny-notes" rows={3} value={reviewNotes} onChange={(e) => setReviewNotes(e.target.value)} className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-red-500" placeholder="Explain why this request is being denied..." />
                  </div>
                </div>
                <div className="bg-theme-input-bg px-6 py-3 flex justify-end gap-3 rounded-b-lg">
                  <button onClick={() => setReviewingRequest(null)} className="px-4 py-2 border border-theme-input-border rounded-lg text-theme-text-secondary hover:bg-theme-surface-hover transition-colors">Cancel</button>
                  <button onClick={() => handleReviewRequest(reviewingRequest.id, 'denied')} disabled={submitting} className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors disabled:opacity-50">
                    {submitting ? 'Denying...' : 'Deny Request'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Request Approve Confirmation Modal */}
        {showApproveConfirm && (
          <div className="fixed inset-0 z-50 overflow-y-auto" role="dialog" aria-modal="true" onKeyDown={(e) => { if (e.key === 'Escape') setShowApproveConfirm(null); }}>
            <div className="flex items-center justify-center min-h-screen px-4">
              <div className="fixed inset-0 bg-black/60" onClick={() => setShowApproveConfirm(null)} aria-hidden="true" />
              <div className="relative bg-theme-surface-modal rounded-lg shadow-xl max-w-md w-full border border-theme-surface-border">
                <div className="px-6 pt-5 pb-4">
                  <h3 className="text-lg font-medium text-theme-text-primary mb-2">Approve Request</h3>
                  <p className="text-theme-text-secondary text-sm mb-4">
                    Are you sure you want to approve the request for <span className="font-medium text-theme-text-primary">{showApproveConfirm.item_name}</span>{showApproveConfirm.quantity > 1 ? ` x${showApproveConfirm.quantity}` : ''} requested by <span className="font-medium text-theme-text-primary">{showApproveConfirm.requester_name || 'Unknown'}</span>?
                  </p>
                </div>
                <div className="bg-theme-input-bg px-6 py-3 flex justify-end gap-3 rounded-b-lg">
                  <button onClick={() => setShowApproveConfirm(null)} className="px-4 py-2 border border-theme-input-border rounded-lg text-theme-text-secondary hover:bg-theme-surface-hover transition-colors">Cancel</button>
                  <button
                    onClick={() => {
                      const reqId = showApproveConfirm.id;
                      setShowApproveConfirm(null);
                      handleReviewRequest(reqId, 'approved');
                    }}
                    disabled={submitting}
                    className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors disabled:opacity-50"
                  >
                    {submitting ? 'Approving...' : 'Approve Request'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="flex space-x-1 mb-6 bg-theme-surface-secondary rounded-lg p-1 w-fit" role="tablist" aria-label="Inventory views">
          <button
            onClick={() => setActiveTab('items')}
            role="tab"
            aria-selected={activeTab === 'items'}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === 'items'
                ? 'bg-emerald-600 text-white'
                : 'text-theme-text-muted hover:text-theme-text-primary'
            }`}
          >
            Items ({totalItems})
          </button>
          <button
            onClick={() => setActiveTab('categories')}
            role="tab"
            aria-selected={activeTab === 'categories'}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === 'categories'
                ? 'bg-emerald-600 text-white'
                : 'text-theme-text-muted hover:text-theme-text-primary'
            }`}
          >
            Categories ({categories.length})
          </button>
          <button
            onClick={() => { setActiveTab('maintenance'); loadMaintenanceData(); }}
            role="tab"
            aria-selected={activeTab === 'maintenance'}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors flex items-center gap-1.5 ${
              activeTab === 'maintenance'
                ? 'bg-emerald-600 text-white'
                : 'text-theme-text-muted hover:text-theme-text-primary'
            }`}
          >
            <Wrench className="w-4 h-4" />
            Maintenance
            {summary && summary.maintenance_due_count > 0 && (
              <span className="px-1.5 py-0.5 text-xs rounded-full bg-orange-500/20 text-orange-700 dark:text-orange-400">
                {summary.maintenance_due_count}
              </span>
            )}
          </button>
        </div>

        {/* Items Tab */}
        {activeTab === 'items' && (
          <>
            {/* Search & Filters */}
            <div className="bg-theme-surface backdrop-blur-sm rounded-lg p-4 border border-theme-surface-border mb-6" role="search" aria-label="Search and filter inventory">
              <div className="flex flex-col md:flex-row items-center gap-4">
                <div className="relative flex-1 w-full md:max-w-md">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-theme-text-muted" aria-hidden="true" />
                  <label htmlFor="inventory-search" className="sr-only">Search inventory</label>
                  <input
                    id="inventory-search"
                    type="text"
                    placeholder="Search by name, size, color, serial #, barcode..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary placeholder-theme-text-muted focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Filter className="w-5 h-5 text-theme-text-muted hidden sm:block" aria-hidden="true" />
                  <label htmlFor="inventory-status-filter" className="sr-only">Filter by status</label>
                  <select
                    id="inventory-status-filter"
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value)}
                    className="px-4 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  >
                    <option value="">All Statuses</option>
                    {STATUS_OPTIONS.map(s => (
                      <option key={s.value} value={s.value}>{s.label}</option>
                    ))}
                  </select>
                  <label htmlFor="inventory-category-filter" className="sr-only">Filter by category</label>
                  <select
                    id="inventory-category-filter"
                    value={categoryFilter}
                    onChange={(e) => setCategoryFilter(e.target.value)}
                    className="px-4 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  >
                    <option value="">All Categories</option>
                    {categories.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
                {canManage && (
                  <div className="flex items-center gap-2 ml-auto">
                    <button onClick={handleExportCsv} className="flex items-center gap-1.5 px-3 py-2 text-sm text-theme-text-secondary hover:text-theme-text-primary bg-theme-input-bg border border-theme-input-border rounded-lg hover:bg-theme-surface-hover transition-colors" title="Export CSV">
                      <Download className="w-4 h-4" aria-hidden="true" />
                      <span className="hidden sm:inline">Export</span>
                    </button>
                    {selectedItemIds.size > 0 && (
                      <div className="relative">
                        <button
                          onClick={() => setShowBulkMenu(!showBulkMenu)}
                          className="flex items-center gap-1.5 px-3 py-2 text-sm bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary hover:bg-theme-surface-hover transition-colors"
                        >
                          Bulk Actions ({selectedItemIds.size})
                          <ChevronDown className="w-4 h-4" aria-hidden="true" />
                        </button>
                        {showBulkMenu && (
                          <div className="absolute right-0 top-full mt-1 w-48 bg-theme-surface-modal rounded-lg shadow-xl border border-theme-surface-border z-50 py-1">
                            <button onClick={() => { setShowBulkStatusModal(true); setShowBulkMenu(false); }} className="w-full text-left px-3 py-2 text-sm text-theme-text-primary hover:bg-theme-surface-hover">
                              Change Status
                            </button>
                            <button onClick={() => { setShowBulkRetireModal(true); setShowBulkMenu(false); }} className="w-full text-left px-3 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-theme-surface-hover">
                              Retire Selected
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>

            {/* Items Table */}
            {filterLoading && (
              <div className="flex items-center justify-center py-3 mb-4">
                <Loader2 className="w-5 h-5 animate-spin text-emerald-500 mr-2" />
                <span className="text-sm text-theme-text-muted">Updating results...</span>
              </div>
            )}
            {items.length === 0 && !filterLoading ? (
              <div className="bg-theme-surface backdrop-blur-sm rounded-lg p-12 border border-theme-surface-border text-center">
                <Package className="w-16 h-16 text-theme-text-muted mx-auto mb-4" aria-hidden="true" />
                <h3 className="text-theme-text-primary text-xl font-bold mb-2">No Items Found</h3>
                <p className="text-theme-text-secondary mb-6">
                  {searchQuery || statusFilter || categoryFilter
                    ? 'Try adjusting your search or filters.'
                    : 'Get started by adding your first inventory item.'}
                </p>
                {canManage && !searchQuery && !statusFilter && !categoryFilter && (
                  <button
                    onClick={() => setShowAddItem(true)}
                    className="px-6 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition-colors"
                  >
                    Add First Item
                  </button>
                )}
              </div>
            ) : (
              <div className="bg-theme-surface backdrop-blur-sm rounded-lg border border-theme-surface-border overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full" aria-label="Inventory items list">
                    <thead className="bg-theme-input-bg border-b border-theme-surface-border">
                      <tr>
                        {canManage && (
                          <th scope="col" className="w-10 px-3 py-3">
                            <input
                              type="checkbox"
                              checked={items.length > 0 && selectedItemIds.size === items.length}
                              onChange={toggleSelectAll}
                              className="h-4 w-4 rounded border-theme-input-border text-emerald-600 focus:ring-emerald-500"
                              aria-label="Select all items"
                            />
                          </th>
                        )}
                        <th scope="col" className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-theme-text-secondary uppercase tracking-wider">Item</th>
                        <th scope="col" className="hidden sm:table-cell px-3 sm:px-6 py-3 text-left text-xs font-medium text-theme-text-secondary uppercase tracking-wider">Category</th>
                        <th scope="col" className="hidden lg:table-cell px-6 py-3 text-left text-xs font-medium text-theme-text-secondary uppercase tracking-wider">Serial #</th>
                        <th scope="col" className="hidden lg:table-cell px-6 py-3 text-left text-xs font-medium text-theme-text-secondary uppercase tracking-wider">Location</th>
                        <th scope="col" className="hidden md:table-cell px-6 py-3 text-left text-xs font-medium text-theme-text-secondary uppercase tracking-wider">Condition</th>
                        <th scope="col" className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-theme-text-secondary uppercase tracking-wider">Status</th>
                        <th scope="col" className="px-3 sm:px-6 py-3 text-left text-xs font-medium text-theme-text-secondary uppercase tracking-wider">Qty</th>
                        {canManage && <th scope="col" className="px-3 py-3 text-left text-xs font-medium text-theme-text-secondary uppercase tracking-wider">Actions</th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/10">
                      {items.map((item) => (
                        <tr
                          key={item.id}
                          className="hover:bg-theme-surface-secondary transition-colors cursor-pointer"
                          onClick={() => canManage && openEditModal(item)}
                          role={canManage ? 'button' : undefined}
                          tabIndex={canManage ? 0 : undefined}
                          onKeyDown={(e) => { if (canManage && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openEditModal(item); } }}
                        >
                          {canManage && (
                            <td className="w-10 px-3 py-4" onClick={(e) => e.stopPropagation()}>
                              <input
                                type="checkbox"
                                checked={selectedItemIds.has(item.id)}
                                onChange={() => toggleItemSelection(item.id)}
                                className="h-4 w-4 rounded border-theme-input-border text-emerald-600 focus:ring-emerald-500"
                                aria-label={`Select ${item.name}`}
                              />
                            </td>
                          )}
                          <td className="px-3 sm:px-6 py-4">
                            <div>
                              <div className="text-theme-text-primary font-medium text-sm">{item.name}</div>
                              {item.manufacturer && (
                                <div className="text-theme-text-muted text-xs">{item.manufacturer}{item.model_number ? ` ${item.model_number}` : ''}</div>
                              )}
                              {(item.size || item.color || item.asset_tag) && (
                                <div className="flex flex-wrap gap-1 mt-1">
                                  {item.size && (
                                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300">
                                      {item.size}
                                    </span>
                                  )}
                                  {item.color && (
                                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300">
                                      {item.color}
                                    </span>
                                  )}
                                  {item.asset_tag && (
                                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-mono bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300">
                                      {item.asset_tag}
                                    </span>
                                  )}
                                </div>
                              )}
                            </div>
                          </td>
                          <td className="hidden sm:table-cell px-3 sm:px-6 py-4 text-theme-text-secondary text-sm">{getCategoryName(item.category_id)}</td>
                          <td className="hidden lg:table-cell px-6 py-4">
                            <span className="text-theme-text-secondary font-mono text-sm">{item.serial_number || '-'}</span>
                          </td>
                          <td className="hidden lg:table-cell px-6 py-4 text-theme-text-secondary text-sm">{(() => {
                            const room = item.location_id ? rooms.find(r => r.id === item.location_id) : null;
                            const roomLabel = room ? room.name : null;
                            const area = item.storage_location;
                            if (roomLabel && area) return `${roomLabel} — ${area}`;
                            if (roomLabel) return roomLabel;
                            return area || item.station || '-';
                          })()}</td>
                          <td className="hidden md:table-cell px-6 py-4">
                            <span className={`text-sm capitalize ${getConditionColor(item.condition)}`}>
                              {item.condition.replace('_', ' ')}
                            </span>
                          </td>
                          <td className="px-3 sm:px-6 py-4">
                            <span className={`px-2 py-1 text-xs font-semibold rounded border ${getStatusStyle(item.status)}`}>
                              {item.status.replace('_', ' ').toUpperCase()}
                            </span>
                          </td>
                          <td className="px-3 sm:px-6 py-4 text-theme-text-primary text-sm">{item.quantity}</td>
                          {canManage && (
                            <td className="px-3 py-4" onClick={(e) => e.stopPropagation()}>
                              <div className="flex items-center gap-1">
                                <button onClick={() => openEditModal(item)} className="p-1.5 text-theme-text-muted hover:text-emerald-500 rounded" title="Edit item" aria-label={`Edit ${item.name}`}>
                                  <Pencil className="w-4 h-4" aria-hidden="true" />
                                </button>
                                {item.tracking_type === 'pool' && item.status !== 'retired' && (
                                  <button onClick={() => openPoolIssueModal(item)} className="p-1.5 text-theme-text-muted hover:text-purple-500 rounded" title="Issue from pool" aria-label={`Issue ${item.name}`}>
                                    <Send className="w-4 h-4" aria-hidden="true" />
                                  </button>
                                )}
                                {item.status !== 'retired' && (
                                  <button onClick={() => openWriteOffModal(item)} className="p-1.5 text-theme-text-muted hover:text-orange-500 rounded" title="Write off item" aria-label={`Write off ${item.name}`}>
                                    <FileX className="w-4 h-4" aria-hidden="true" />
                                  </button>
                                )}
                                {item.status !== 'retired' && (
                                  <button onClick={() => setShowRetireConfirm(item)} className="p-1.5 text-theme-text-muted hover:text-red-500 rounded" title="Retire item" aria-label={`Retire ${item.name}`}>
                                    <Archive className="w-4 h-4" aria-hidden="true" />
                                  </button>
                                )}
                              </div>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="text-center py-2 text-xs text-theme-text-muted">
                  Showing {items.length} of {totalItems} items
                </div>
                {items.length < totalItems && (
                  <div className="flex justify-center py-4">
                    <button
                      onClick={loadMoreItems}
                      disabled={loadingMore}
                      className="flex items-center gap-2 px-6 py-2.5 text-sm font-medium text-theme-text-primary border border-theme-surface-border rounded-lg hover:bg-theme-surface-secondary transition-colors disabled:opacity-50"
                    >
                      {loadingMore ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Loading...
                        </>
                      ) : (
                        `Load More (${totalItems - items.length} remaining)`
                      )}
                    </button>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* Categories Tab */}
        {activeTab === 'categories' && (
          <>
            {categories.length === 0 ? (
              <div className="bg-theme-surface backdrop-blur-sm rounded-lg p-12 border border-theme-surface-border text-center">
                <Tag className="w-16 h-16 text-theme-text-muted mx-auto mb-4" aria-hidden="true" />
                <h3 className="text-theme-text-primary text-xl font-bold mb-2">No Categories</h3>
                <p className="text-theme-text-secondary mb-6">
                  Create categories to organize your inventory items.
                </p>
                {canManage && (
                  <button
                    onClick={() => setShowAddCategory(true)}
                    className="px-6 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition-colors"
                  >
                    Create First Category
                  </button>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {categories.map((cat) => (
                  <div key={cat.id} className="bg-theme-surface backdrop-blur-sm rounded-lg p-5 border border-theme-surface-border">
                    <div className="flex items-start justify-between mb-3">
                      <h3 className="text-theme-text-primary font-semibold text-lg">{cat.name}</h3>
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-1 text-xs font-medium rounded bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30 capitalize">
                          {cat.item_type}
                        </span>
                        {canManage && (
                          <button onClick={() => openEditCategory(cat)} className="p-1 text-theme-text-muted hover:text-emerald-500 rounded" title="Edit category" aria-label={`Edit ${cat.name}`}>
                            <Pencil className="w-4 h-4" aria-hidden="true" />
                          </button>
                        )}
                      </div>
                    </div>
                    {cat.description && (
                      <p className="text-theme-text-secondary text-sm mb-3">{cat.description}</p>
                    )}
                    <div className="flex flex-wrap gap-2 mt-3">
                      {cat.requires_serial_number && (
                        <span className="px-2 py-0.5 text-xs bg-blue-500/10 text-blue-700 dark:text-blue-400 rounded">Serial # Required</span>
                      )}
                      {cat.requires_maintenance && (
                        <span className="px-2 py-0.5 text-xs bg-orange-500/10 text-orange-700 dark:text-orange-400 rounded">Maintenance Tracked</span>
                      )}
                      {cat.requires_assignment && (
                        <span className="px-2 py-0.5 text-xs bg-purple-500/10 text-purple-700 dark:text-purple-400 rounded">Assignment Required</span>
                      )}
                      {cat.low_stock_threshold != null && (
                        <span className="px-2 py-0.5 text-xs bg-yellow-500/10 text-yellow-700 dark:text-yellow-400 rounded">
                          Low Stock: {cat.low_stock_threshold}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* Maintenance Tab */}
        {activeTab === 'maintenance' && (
          <>
            {maintenanceLoading ? (
              <div className="bg-theme-surface rounded-lg p-12 border border-theme-surface-border text-center">
                <Loader2 className="w-8 h-8 text-emerald-500 animate-spin mx-auto mb-3" />
                <p className="text-theme-text-secondary text-sm">Loading maintenance data...</p>
              </div>
            ) : maintenanceDueItems.length === 0 ? (
              <div className="bg-theme-surface rounded-lg p-12 border border-theme-surface-border text-center">
                <CheckCircle2 className="w-16 h-16 text-green-500 mx-auto mb-4" />
                <h3 className="text-theme-text-primary text-xl font-bold mb-2">All Clear</h3>
                <p className="text-theme-text-secondary">No items currently need maintenance or inspection.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {/* Overdue / Due Soon / In Maintenance sections */}
                {(() => {
                  const today = new Date().toISOString().split('T')[0]!;
                  const overdue = maintenanceDueItems.filter(i => i.next_inspection_due && i.next_inspection_due < today);
                  const dueSoon = maintenanceDueItems.filter(i => i.next_inspection_due && i.next_inspection_due >= today);
                  const inMaintenance = maintenanceDueItems.filter(i => i.status === 'in_maintenance' && !i.next_inspection_due);

                  const renderSection = (title: string, icon: React.ReactNode, sectionItems: InventoryItem[], colorClass: string) => {
                    if (sectionItems.length === 0) return null;
                    return (
                      <div>
                        <h3 className={`text-sm font-semibold ${colorClass} mb-3 flex items-center gap-2`}>
                          {icon} {title} ({sectionItems.length})
                        </h3>
                        <div className="bg-theme-surface rounded-lg border border-theme-surface-border overflow-hidden">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="border-b border-theme-surface-border bg-theme-surface-secondary">
                                <th className="p-3 text-left text-xs font-medium text-theme-text-muted uppercase">Item</th>
                                <th className="hidden sm:table-cell p-3 text-left text-xs font-medium text-theme-text-muted uppercase">Category</th>
                                <th className="p-3 text-left text-xs font-medium text-theme-text-muted uppercase">Condition</th>
                                <th className="hidden sm:table-cell p-3 text-left text-xs font-medium text-theme-text-muted uppercase">Due Date</th>
                                <th className="p-3 text-left text-xs font-medium text-theme-text-muted uppercase">Status</th>
                                {canManage && <th className="p-3 text-left text-xs font-medium text-theme-text-muted uppercase">Action</th>}
                              </tr>
                            </thead>
                            <tbody>
                              {sectionItems.map(item => (
                                <tr key={item.id} className="border-b border-theme-surface-border">
                                  <td className="p-3">
                                    <span className="text-theme-text-primary font-medium">{item.name}</span>
                                    {item.serial_number && <p className="text-theme-text-muted text-xs font-mono mt-0.5">SN: {item.serial_number}</p>}
                                  </td>
                                  <td className="hidden sm:table-cell p-3 text-theme-text-secondary">{getCategoryName(item.category_id)}</td>
                                  <td className="p-3">
                                    <span className={`text-xs capitalize ${getConditionColor(item.condition)}`}>{item.condition.replace('_', ' ')}</span>
                                  </td>
                                  <td className="hidden sm:table-cell p-3 text-theme-text-secondary text-xs">
                                    {item.next_inspection_due || '--'}
                                  </td>
                                  <td className="p-3">
                                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${getStatusStyle(item.status)}`}>
                                      {item.status.replace('_', ' ')}
                                    </span>
                                  </td>
                                  {canManage && (
                                    <td className="p-3">
                                      <button
                                        onClick={() => {
                                          setMaintenanceItem(item);
                                          setMaintenanceForm({
                                            maintenance_type: 'inspection',
                                            description: '',
                                            notes: '',
                                            is_completed: false,
                                            condition_after: item.condition,
                                          });
                                          loadItemMaintenanceHistory(item.id);
                                          setShowMaintenanceModal(true);
                                        }}
                                        className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs rounded-lg transition-colors"
                                      >
                                        <Wrench className="w-3.5 h-3.5" /> Log Maintenance
                                      </button>
                                    </td>
                                  )}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    );
                  };

                  return (
                    <>
                      {renderSection('Overdue', <AlertCircle className="w-4 h-4" />, overdue, 'text-red-700 dark:text-red-400')}
                      {renderSection('Due Soon', <Clock className="w-4 h-4" />, dueSoon, 'text-yellow-700 dark:text-yellow-400')}
                      {renderSection('In Maintenance', <Wrench className="w-4 h-4" />, inMaintenance, 'text-orange-700 dark:text-orange-400')}
                    </>
                  );
                })()}
              </div>
            )}
          </>
        )}

        {/* Log Maintenance Modal */}
        {showMaintenanceModal && maintenanceItem && (
          <div className="fixed inset-0 z-50 overflow-y-auto" role="dialog" aria-modal="true" onKeyDown={(e) => { if (e.key === 'Escape') setShowMaintenanceModal(false); }}>
            <div className="flex items-center justify-center min-h-screen px-4">
              <div className="fixed inset-0 bg-black/60" onClick={() => setShowMaintenanceModal(false)} aria-hidden="true" />
              <div className="relative bg-theme-surface-modal rounded-lg shadow-xl max-w-lg w-full border border-theme-surface-border max-h-[90vh] overflow-y-auto">
                <form onSubmit={handleCreateMaintenanceRecord}>
                  <div className="px-4 sm:px-6 pt-5 pb-4">
                    <h3 className="text-lg font-medium text-theme-text-primary mb-1">Log Maintenance</h3>
                    <p className="text-theme-text-muted text-sm mb-4">{maintenanceItem.name}{maintenanceItem.serial_number ? ` (SN: ${maintenanceItem.serial_number})` : ''}</p>
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label htmlFor="maint-type" className="block text-sm font-medium text-theme-text-secondary mb-1">Type *</label>
                          <select id="maint-type" value={maintenanceForm.maintenance_type || 'inspection'} onChange={(e) => setMaintenanceForm({ ...maintenanceForm, maintenance_type: e.target.value })} className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-emerald-500">
                            <option value="inspection">Inspection</option>
                            <option value="repair">Repair</option>
                            <option value="cleaning">Cleaning</option>
                            <option value="testing">Testing</option>
                            <option value="calibration">Calibration</option>
                            <option value="replacement">Replacement</option>
                            <option value="preventive">Preventive</option>
                          </select>
                        </div>
                        <div>
                          <label htmlFor="maint-condition" className="block text-sm font-medium text-theme-text-secondary mb-1">Condition After</label>
                          <select id="maint-condition" value={maintenanceForm.condition_after || ''} onChange={(e) => setMaintenanceForm({ ...maintenanceForm, condition_after: e.target.value })} className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-emerald-500">
                            <option value="">No change</option>
                            {CONDITION_OPTIONS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                          </select>
                        </div>
                      </div>
                      <div>
                        <label htmlFor="maint-description" className="block text-sm font-medium text-theme-text-secondary mb-1">Description</label>
                        <textarea id="maint-description" rows={2} value={maintenanceForm.description || ''} onChange={(e) => setMaintenanceForm({ ...maintenanceForm, description: e.target.value })} className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-emerald-500" placeholder="What was done?" />
                      </div>
                      <div>
                        <label htmlFor="maint-notes" className="block text-sm font-medium text-theme-text-secondary mb-1">Notes</label>
                        <textarea id="maint-notes" rows={2} value={maintenanceForm.notes || ''} onChange={(e) => setMaintenanceForm({ ...maintenanceForm, notes: e.target.value })} className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-emerald-500" placeholder="Any additional notes..." />
                      </div>
                      <div>
                        <label htmlFor="maint-next-due" className="block text-sm font-medium text-theme-text-secondary mb-1">Next Due Date</label>
                        <input id="maint-next-due" type="date" value={maintenanceForm.next_due_date || ''} onChange={(e) => setMaintenanceForm({ ...maintenanceForm, next_due_date: e.target.value })} className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-emerald-500" />
                      </div>
                      <div className="flex items-center gap-2">
                        <input id="maint-completed" type="checkbox" checked={maintenanceForm.is_completed || false} onChange={(e) => setMaintenanceForm({ ...maintenanceForm, is_completed: e.target.checked })} className="rounded border-theme-input-border text-emerald-600 focus:ring-emerald-500" />
                        <label htmlFor="maint-completed" className="text-sm text-theme-text-secondary">Mark as completed</label>
                      </div>

                      {/* Maintenance History */}
                      {maintenanceRecords.length > 0 && (
                        <div className="border-t border-theme-surface-border pt-4">
                          <h4 className="text-xs font-semibold text-theme-text-muted uppercase mb-2">Previous Maintenance</h4>
                          <div className="space-y-2 max-h-40 overflow-y-auto">
                            {maintenanceRecords.slice(0, 5).map(record => (
                              <div key={record.id} className="text-xs bg-theme-surface-secondary rounded-lg px-3 py-2">
                                <div className="flex items-center justify-between">
                                  <span className="text-theme-text-primary font-medium capitalize">{record.maintenance_type}</span>
                                  <span className="text-theme-text-muted">{record.completed_date || record.scheduled_date || '--'}</span>
                                </div>
                                {record.description && <p className="text-theme-text-secondary mt-0.5">{record.description}</p>}
                                {record.notes && <p className="text-theme-text-muted mt-0.5">{record.notes}</p>}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="bg-theme-input-bg px-4 sm:px-6 py-3 flex justify-end gap-3 rounded-b-lg">
                    <button type="button" onClick={() => setShowMaintenanceModal(false)} className="px-4 py-2 border border-theme-input-border rounded-lg text-theme-text-secondary hover:bg-theme-surface-hover transition-colors">Cancel</button>
                    <button type="submit" disabled={submitting} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition-colors disabled:opacity-50">
                      {submitting ? 'Saving...' : 'Save Record'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        )}

        {/* Add Item Modal */}
        {showAddItem && (
          <div
            className="fixed inset-0 z-50 overflow-y-auto"
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-item-title"
            onKeyDown={(e) => { if (e.key === 'Escape') setShowAddItem(false); }}
          >
            <div className="flex items-center justify-center min-h-screen px-4">
              <div className="fixed inset-0 bg-black/60" onClick={() => setShowAddItem(false)} aria-hidden="true" />
              <div className="relative bg-theme-surface-modal rounded-lg shadow-xl max-w-2xl w-full border border-theme-surface-border">
                <form onSubmit={handleCreateItem}>
                  <div className="px-4 sm:px-6 pt-5 pb-4">
                    <div className="flex justify-between items-center mb-4">
                      <h3 id="add-item-title" className="text-lg font-medium text-theme-text-primary">Add Inventory Item</h3>
                      <button type="button" onClick={() => setShowAddItem(false)} className="text-theme-text-muted hover:text-theme-text-primary p-1 min-w-[44px] min-h-[44px] flex items-center justify-center" aria-label="Close dialog">
                        <X className="w-5 h-5" aria-hidden="true" />
                      </button>
                    </div>

                    {formError && (
                      <div className="mb-4 bg-red-500/10 border border-red-500/30 rounded-lg p-3" role="alert">
                        <p className="text-sm text-red-700 dark:text-red-300">{formError}</p>
                      </div>
                    )}

                    <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-2">
                      {/* ── Basic Info ── */}
                      <div>
                        <label htmlFor="item-name" className="block text-sm font-medium text-theme-text-secondary mb-1">Name <span aria-hidden="true">*</span></label>
                        <input
                          id="item-name"
                          type="text" required aria-required="true" value={itemForm.name}
                          onChange={(e) => setItemForm({ ...itemForm, name: e.target.value })}
                          className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-emerald-500"
                        />
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <label htmlFor="item-category" className="block text-sm font-medium text-theme-text-secondary mb-1">Category</label>
                          <select
                            id="item-category"
                            value={itemForm.category_id}
                            onChange={(e) => setItemForm({ ...itemForm, category_id: e.target.value })}
                            className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-emerald-500"
                          >
                            <option value="">No Category</option>
                            {categories.map(c => (
                              <option key={c.id} value={c.id}>{c.name}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label htmlFor="item-tracking-type" className="block text-sm font-medium text-theme-text-secondary mb-1">
                            Tracking Type <span aria-hidden="true">*</span>
                          </label>
                          <select
                            id="item-tracking-type"
                            value={itemForm.tracking_type}
                            onChange={(e) => setItemForm({ ...itemForm, tracking_type: e.target.value })}
                            className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-emerald-500"
                          >
                            <option value="individual">Individual (unique, serialized item)</option>
                            <option value="pool">Pool (bulk stock issued by quantity)</option>
                          </select>
                        </div>
                      </div>

                      {/* Pool hint */}
                      {itemForm.tracking_type === 'pool' && (
                        <div className="flex items-start gap-2 p-3 rounded-lg bg-purple-500/10 border border-purple-500/20">
                          <Layers className="w-4 h-4 text-purple-700 dark:text-purple-400 mt-0.5 shrink-0" aria-hidden="true" />
                          <p className="text-xs text-purple-700 dark:text-purple-300">
                            Pool items are tracked by quantity (e.g., 50 pairs of gloves). Set the total stock below. Individual units are issued to members from this pool.
                          </p>
                        </div>
                      )}

                      <div>
                        <label htmlFor="item-description" className="block text-sm font-medium text-theme-text-secondary mb-1">Description</label>
                        <textarea
                          id="item-description"
                          rows={2} value={itemForm.description}
                          onChange={(e) => setItemForm({ ...itemForm, description: e.target.value })}
                          className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-emerald-500"
                        />
                      </div>

                      {/* Category requirement hints */}
                      {(() => {
                        const cat = getSelectedCategory();
                        if (!cat) return null;
                        const hints: string[] = [];
                        if (cat.requires_serial_number) hints.push('Serial number required');
                        if (cat.requires_maintenance) hints.push('Inspection interval required');
                        if (hints.length === 0) return null;
                        return (
                          <div className="flex items-start gap-2 p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
                            <AlertCircle className="w-4 h-4 text-blue-700 dark:text-blue-400 mt-0.5 shrink-0" aria-hidden="true" />
                            <p className="text-xs text-blue-700 dark:text-blue-300">
                              This category requires: {hints.join(', ')}
                            </p>
                          </div>
                        );
                      })()}

                      {/* ── Identification & Tracking ── */}
                      <fieldset>
                        <legend className="flex items-center gap-1.5 text-xs font-semibold uppercase text-theme-text-muted mb-2">
                          <Barcode className="w-3.5 h-3.5" aria-hidden="true" /> Identification
                        </legend>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                          <div>
                            <label htmlFor="item-serial-number" className="block text-sm font-medium text-theme-text-secondary mb-1">
                              Serial Number{getSelectedCategory()?.requires_serial_number ? ' *' : ''}
                            </label>
                            <input
                              id="item-serial-number"
                              type="text" value={itemForm.serial_number}
                              onChange={(e) => setItemForm({ ...itemForm, serial_number: e.target.value })}
                              className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-emerald-500"
                              placeholder="e.g., SN-12345"
                            />
                          </div>
                          <div>
                            <label htmlFor="item-asset-tag" className="block text-sm font-medium text-theme-text-secondary mb-1">Asset Tag</label>
                            <input
                              id="item-asset-tag"
                              type="text" value={itemForm.asset_tag}
                              onChange={(e) => setItemForm({ ...itemForm, asset_tag: e.target.value })}
                              className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-emerald-500"
                              placeholder="e.g., AT-001"
                            />
                          </div>
                          <div>
                            <label htmlFor="item-barcode" className="block text-sm font-medium text-theme-text-secondary mb-1">Barcode</label>
                            <input
                              id="item-barcode"
                              type="text" value={itemForm.barcode}
                              onChange={(e) => setItemForm({ ...itemForm, barcode: e.target.value })}
                              className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-emerald-500"
                              placeholder="Scan or type barcode"
                            />
                          </div>
                        </div>
                      </fieldset>

                      {/* ── Product Details ── */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <label htmlFor="item-manufacturer" className="block text-sm font-medium text-theme-text-secondary mb-1">Manufacturer</label>
                          <input
                            id="item-manufacturer"
                            type="text" value={itemForm.manufacturer}
                            onChange={(e) => setItemForm({ ...itemForm, manufacturer: e.target.value })}
                            className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-emerald-500"
                          />
                        </div>
                        <div>
                          <label htmlFor="item-model-number" className="block text-sm font-medium text-theme-text-secondary mb-1">Model Number</label>
                          <input
                            id="item-model-number"
                            type="text" value={itemForm.model_number}
                            onChange={(e) => setItemForm({ ...itemForm, model_number: e.target.value })}
                            className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-emerald-500"
                          />
                        </div>
                      </div>

                      {/* ── Physical Properties (contextual) ── */}
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div>
                          <label htmlFor="item-size" className="block text-sm font-medium text-theme-text-secondary mb-1">Size</label>
                          <input
                            id="item-size"
                            type="text" value={itemForm.size}
                            onChange={(e) => setItemForm({ ...itemForm, size: e.target.value })}
                            className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-emerald-500"
                            placeholder="e.g., Large, 10.5"
                          />
                        </div>
                        <div>
                          <label htmlFor="item-color" className="block text-sm font-medium text-theme-text-secondary mb-1">Color</label>
                          <input
                            id="item-color"
                            type="text" value={itemForm.color}
                            onChange={(e) => setItemForm({ ...itemForm, color: e.target.value })}
                            className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-emerald-500"
                            placeholder="e.g., Black"
                          />
                        </div>
                        {itemForm.tracking_type === 'pool' && (
                          <div>
                            <label htmlFor="item-unit-of-measure" className="block text-sm font-medium text-theme-text-secondary mb-1">Unit of Measure</label>
                            <input
                              id="item-unit-of-measure"
                              type="text" value={itemForm.unit_of_measure}
                              onChange={(e) => setItemForm({ ...itemForm, unit_of_measure: e.target.value })}
                              className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-emerald-500"
                              placeholder="e.g., pair, box, each"
                            />
                          </div>
                        )}
                      </div>

                      {/* ── Location ── */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <label htmlFor="item-room" className="block text-sm font-medium text-theme-text-secondary mb-1">Room</label>
                          {rooms.length > 0 ? (
                            <select
                              id="item-room"
                              value={itemForm.location_id || ''}
                              onChange={(e) => {
                                const selectedRoom = rooms.find(r => r.id === e.target.value);
                                setItemForm({
                                  ...itemForm,
                                  location_id: e.target.value,
                                  station: selectedRoom?.building || itemForm.station,
                                });
                              }}
                              className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-emerald-500"
                            >
                              <option value="">Select a room</option>
                              {rooms.map(r => (
                                <option key={r.id} value={r.id}>
                                  {r.building ? `${r.building} — ` : ''}{r.name}{r.room_number ? ` (${r.room_number})` : ''}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <div className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-muted text-sm">
                              No rooms configured. Add rooms in Locations first.
                            </div>
                          )}
                        </div>
                        <div>
                          <label htmlFor="item-storage-area" className="block text-sm font-medium text-theme-text-secondary mb-1">Storage Area</label>
                          {storageAreas.length > 0 ? (
                            <select
                              id="item-storage-area"
                              value={itemForm.storage_area_id || ''}
                              onChange={(e) => setItemForm({ ...itemForm, storage_area_id: e.target.value })}
                              className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-emerald-500"
                            >
                              <option value="">Select storage area</option>
                              {storageAreas.map(sa => (
                                <option key={sa.id} value={sa.id}>
                                  {sa.location_name ? `${sa.location_name} — ` : ''}{sa.parent_name ? `${sa.parent_name} → ` : ''}{sa.name}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <input
                              id="item-storage-area"
                              type="text" value={itemForm.storage_location}
                              onChange={(e) => setItemForm({ ...itemForm, storage_location: e.target.value })}
                              className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-emerald-500"
                              placeholder="e.g., Shelf 5, Closet B, Room 201"
                            />
                          )}
                        </div>
                      </div>

                      {/* ── Status & Quantity ── */}
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div>
                          <label htmlFor="item-condition" className="block text-sm font-medium text-theme-text-secondary mb-1">Condition</label>
                          <select
                            id="item-condition"
                            value={itemForm.condition}
                            onChange={(e) => setItemForm({ ...itemForm, condition: e.target.value })}
                            className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-emerald-500"
                          >
                            {CONDITION_OPTIONS.map(c => (
                              <option key={c.value} value={c.value}>{c.label}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label htmlFor="item-status" className="block text-sm font-medium text-theme-text-secondary mb-1">Status</label>
                          <select
                            id="item-status"
                            value={itemForm.status}
                            onChange={(e) => setItemForm({ ...itemForm, status: e.target.value })}
                            className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-emerald-500"
                          >
                            {STATUS_OPTIONS.map(s => (
                              <option key={s.value} value={s.value}>{s.label}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label htmlFor="item-quantity" className="block text-sm font-medium text-theme-text-secondary mb-1">
                            {itemForm.tracking_type === 'pool' ? 'Total Stock' : 'Quantity'}
                          </label>
                          <input
                            id="item-quantity"
                            type="number" min="1" value={itemForm.quantity}
                            onChange={(e) => setItemForm({ ...itemForm, quantity: parseInt(e.target.value) || 1 })}
                            className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-emerald-500"
                          />
                        </div>
                      </div>

                      {/* ── Purchase & Warranty ── */}
                      <details className="group">
                        <summary className="cursor-pointer text-xs font-semibold uppercase text-theme-text-muted hover:text-theme-text-secondary flex items-center gap-1.5 select-none">
                          <span className="transition-transform group-open:rotate-90">&#9654;</span>
                          Purchase & Warranty
                        </summary>
                        <div className="mt-3 space-y-3">
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                            <div>
                              <label htmlFor="item-purchase-price" className="block text-sm font-medium text-theme-text-secondary mb-1">Purchase Price</label>
                              <input
                                id="item-purchase-price"
                                type="number" min="0" step="0.01"
                                value={itemForm.purchase_price ?? ''}
                                onChange={(e) => setItemForm({ ...itemForm, purchase_price: e.target.value ? parseFloat(e.target.value) : undefined })}
                                className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-emerald-500"
                                placeholder="0.00"
                              />
                            </div>
                            <div>
                              <label htmlFor="item-purchase-date" className="block text-sm font-medium text-theme-text-secondary mb-1">Purchase Date</label>
                              <input
                                id="item-purchase-date"
                                type="date" value={itemForm.purchase_date}
                                onChange={(e) => setItemForm({ ...itemForm, purchase_date: e.target.value })}
                                className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-emerald-500"
                              />
                            </div>
                            <div>
                              <label htmlFor="item-vendor" className="block text-sm font-medium text-theme-text-secondary mb-1">Vendor</label>
                              <input
                                id="item-vendor"
                                type="text" value={itemForm.vendor}
                                onChange={(e) => setItemForm({ ...itemForm, vendor: e.target.value })}
                                className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-emerald-500"
                              />
                            </div>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                              <label htmlFor="item-warranty-expiration" className="block text-sm font-medium text-theme-text-secondary mb-1">Warranty Expiration</label>
                              <input
                                id="item-warranty-expiration"
                                type="date" value={itemForm.warranty_expiration}
                                onChange={(e) => setItemForm({ ...itemForm, warranty_expiration: e.target.value })}
                                className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-emerald-500"
                              />
                            </div>
                            <div>
                              <label htmlFor="item-inspection-interval" className="block text-sm font-medium text-theme-text-secondary mb-1">Inspection Interval (days)</label>
                              <input
                                id="item-inspection-interval"
                                type="number" min="0"
                                value={itemForm.inspection_interval_days ?? ''}
                                onChange={(e) => setItemForm({ ...itemForm, inspection_interval_days: e.target.value ? parseInt(e.target.value) : undefined })}
                                className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-emerald-500"
                                placeholder="e.g., 365"
                              />
                            </div>
                          </div>
                        </div>
                      </details>

                      {/* ── Notes ── */}
                      <div>
                        <label htmlFor="item-notes" className="block text-sm font-medium text-theme-text-secondary mb-1">Notes</label>
                        <textarea
                          id="item-notes"
                          rows={2} value={itemForm.notes}
                          onChange={(e) => setItemForm({ ...itemForm, notes: e.target.value })}
                          className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-emerald-500"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="bg-theme-input-bg px-4 sm:px-6 py-3 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:space-x-3 sm:gap-0 rounded-b-lg">
                    <button
                      type="button" onClick={() => setShowAddItem(false)}
                      className="px-4 py-2 border border-theme-input-border rounded-lg text-theme-text-secondary hover:bg-theme-surface-hover transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition-colors"
                    >
                      {itemForm.tracking_type === 'pool' ? 'Add Pool Item' : 'Add Item'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        )}

        {/* Add Category Modal */}
        {showAddCategory && (
          <div
            className="fixed inset-0 z-50 overflow-y-auto"
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-category-title"
            onKeyDown={(e) => { if (e.key === 'Escape') setShowAddCategory(false); }}
          >
            <div className="flex items-center justify-center min-h-screen px-4">
              <div className="fixed inset-0 bg-black/60" onClick={() => setShowAddCategory(false)} aria-hidden="true" />
              <div className="relative bg-theme-surface-modal rounded-lg shadow-xl max-w-lg w-full border border-theme-surface-border">
                <form onSubmit={handleCreateCategory}>
                  <div className="px-4 sm:px-6 pt-5 pb-4">
                    <div className="flex justify-between items-center mb-4">
                      <h3 id="add-category-title" className="text-lg font-medium text-theme-text-primary">Add Category</h3>
                      <button type="button" onClick={() => setShowAddCategory(false)} className="text-theme-text-muted hover:text-theme-text-primary p-1 min-w-[44px] min-h-[44px] flex items-center justify-center" aria-label="Close dialog">
                        <X className="w-5 h-5" aria-hidden="true" />
                      </button>
                    </div>

                    {formError && (
                      <div className="mb-4 bg-red-500/10 border border-red-500/30 rounded-lg p-3" role="alert">
                        <p className="text-sm text-red-700 dark:text-red-300">{formError}</p>
                      </div>
                    )}

                    <div className="space-y-4">
                      <div>
                        <label htmlFor="category-name" className="block text-sm font-medium text-theme-text-secondary mb-1">Name <span aria-hidden="true">*</span></label>
                        <input
                          id="category-name"
                          type="text" required aria-required="true" value={categoryForm.name}
                          onChange={(e) => setCategoryForm({ ...categoryForm, name: e.target.value })}
                          className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-emerald-500"
                          placeholder="e.g., Bunker Gear, SCBA, Radios"
                        />
                      </div>
                      <div>
                        <label htmlFor="category-item-type" className="block text-sm font-medium text-theme-text-secondary mb-1">Item Type <span aria-hidden="true">*</span></label>
                        <select
                          id="category-item-type"
                          value={categoryForm.item_type} required aria-required="true"
                          onChange={(e) => setCategoryForm({ ...categoryForm, item_type: e.target.value })}
                          className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-emerald-500"
                        >
                          {ITEM_TYPES.map(t => (
                            <option key={t.value} value={t.value}>{t.label}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label htmlFor="category-description" className="block text-sm font-medium text-theme-text-secondary mb-1">Description</label>
                        <textarea
                          id="category-description"
                          rows={2} value={categoryForm.description}
                          onChange={(e) => setCategoryForm({ ...categoryForm, description: e.target.value })}
                          className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-emerald-500"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="flex items-center space-x-2">
                          <input
                            type="checkbox" checked={categoryForm.requires_serial_number}
                            onChange={(e) => setCategoryForm({ ...categoryForm, requires_serial_number: e.target.checked })}
                            className="rounded border-theme-input-border bg-theme-input-bg text-emerald-600 focus:ring-emerald-500"
                          />
                          <span className="text-sm text-theme-text-secondary">Requires serial number</span>
                        </label>
                        <label className="flex items-center space-x-2">
                          <input
                            type="checkbox" checked={categoryForm.requires_maintenance}
                            onChange={(e) => setCategoryForm({ ...categoryForm, requires_maintenance: e.target.checked })}
                            className="rounded border-theme-input-border bg-theme-input-bg text-emerald-600 focus:ring-emerald-500"
                          />
                          <span className="text-sm text-theme-text-secondary">Requires maintenance tracking</span>
                        </label>
                        <label className="flex items-center space-x-2">
                          <input
                            type="checkbox" checked={categoryForm.requires_assignment}
                            onChange={(e) => setCategoryForm({ ...categoryForm, requires_assignment: e.target.checked })}
                            className="rounded border-theme-input-border bg-theme-input-bg text-emerald-600 focus:ring-emerald-500"
                          />
                          <span className="text-sm text-theme-text-secondary">Requires member assignment</span>
                        </label>
                      </div>
                      <div>
                        <label htmlFor="category-low-stock" className="block text-sm font-medium text-theme-text-secondary mb-1">Low Stock Threshold</label>
                        <input
                          id="category-low-stock"
                          type="number" min="0" value={categoryForm.low_stock_threshold || ''}
                          onChange={(e) => setCategoryForm({ ...categoryForm, low_stock_threshold: e.target.value ? parseInt(e.target.value) : undefined })}
                          className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-emerald-500"
                          placeholder="Optional - alert when stock falls below"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="bg-theme-input-bg px-4 sm:px-6 py-3 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:space-x-3 sm:gap-0 rounded-b-lg">
                    <button
                      type="button" onClick={() => setShowAddCategory(false)}
                      className="px-4 py-2 border border-theme-input-border rounded-lg text-theme-text-secondary hover:bg-theme-surface-hover transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      type="submit"
                      className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition-colors"
                    >
                      Create Category
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        )}
        {/* Edit Item Modal */}
        {showEditModal && editingItem && (
          <div
            className="fixed inset-0 z-50 overflow-y-auto"
            role="dialog"
            aria-modal="true"
            aria-labelledby="edit-item-title"
            onKeyDown={(e) => { if (e.key === 'Escape') setShowEditModal(false); }}
          >
            <div className="flex items-center justify-center min-h-screen px-4">
              <div className="fixed inset-0 bg-black/60" onClick={() => setShowEditModal(false)} aria-hidden="true" />
              <div className="relative bg-theme-surface-modal rounded-lg shadow-xl max-w-2xl w-full border border-theme-surface-border">
                <form onSubmit={handleUpdateItem}>
                  <div className="px-4 sm:px-6 pt-5 pb-4">
                    <div className="flex justify-between items-center mb-4">
                      <h3 id="edit-item-title" className="text-lg font-medium text-theme-text-primary flex items-center gap-2">
                        <Pencil className="w-5 h-5" aria-hidden="true" />
                        Edit Item
                      </h3>
                      <button type="button" onClick={() => setShowEditModal(false)} className="text-theme-text-muted hover:text-theme-text-primary p-1 min-w-[44px] min-h-[44px] flex items-center justify-center" aria-label="Close dialog">
                        <X className="w-5 h-5" aria-hidden="true" />
                      </button>
                    </div>

                    {formError && (
                      <div className="mb-4 bg-red-500/10 border border-red-500/30 rounded-lg p-3" role="alert">
                        <p className="text-sm text-red-700 dark:text-red-300">{formError}</p>
                      </div>
                    )}

                    <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-2">
                      {/* Basic Info */}
                      <div>
                        <label htmlFor="edit-item-name" className="block text-sm font-medium text-theme-text-secondary mb-1">Name *</label>
                        <input id="edit-item-name" type="text" required value={editForm.name || ''} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-emerald-500" />
                      </div>
                      <div>
                        <label htmlFor="edit-item-description" className="block text-sm font-medium text-theme-text-secondary mb-1">Description</label>
                        <textarea id="edit-item-description" rows={2} value={editForm.description || ''} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-emerald-500" />
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <label htmlFor="edit-item-category" className="block text-sm font-medium text-theme-text-secondary mb-1">Category</label>
                          <select id="edit-item-category" value={editForm.category_id || ''} onChange={(e) => setEditForm({ ...editForm, category_id: e.target.value })} className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-emerald-500">
                            <option value="">No Category</option>
                            {categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                          </select>
                        </div>
                        <div>
                          <label htmlFor="edit-item-tracking-type" className="block text-sm font-medium text-theme-text-secondary mb-1">Tracking Type</label>
                          <select id="edit-item-tracking-type" value={editForm.tracking_type || 'individual'} onChange={(e) => setEditForm({ ...editForm, tracking_type: e.target.value })} className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-emerald-500">
                            <option value="individual">Individual</option>
                            <option value="pool">Pool</option>
                          </select>
                        </div>
                      </div>

                      {/* Identification */}
                      <fieldset>
                        <legend className="flex items-center gap-1.5 text-xs font-semibold uppercase text-theme-text-muted mb-2">
                          <Barcode className="w-3.5 h-3.5" aria-hidden="true" /> Identification
                        </legend>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                          <div>
                            <label htmlFor="edit-item-serial" className="block text-sm font-medium text-theme-text-secondary mb-1">Serial Number</label>
                            <input id="edit-item-serial" type="text" value={editForm.serial_number || ''} onChange={(e) => setEditForm({ ...editForm, serial_number: e.target.value })} className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-emerald-500" />
                          </div>
                          <div>
                            <label htmlFor="edit-item-asset-tag" className="block text-sm font-medium text-theme-text-secondary mb-1">Asset Tag</label>
                            <input id="edit-item-asset-tag" type="text" value={editForm.asset_tag || ''} onChange={(e) => setEditForm({ ...editForm, asset_tag: e.target.value })} className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-emerald-500" />
                          </div>
                          <div>
                            <label htmlFor="edit-item-barcode" className="block text-sm font-medium text-theme-text-secondary mb-1 flex items-center gap-1">
                              <Barcode className="w-3.5 h-3.5" aria-hidden="true" /> Barcode
                            </label>
                            <input id="edit-item-barcode" type="text" value={editForm.barcode || ''} onChange={(e) => setEditForm({ ...editForm, barcode: e.target.value })} className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-emerald-500 font-mono" placeholder={editForm.asset_tag || editForm.serial_number || 'No barcode assigned'} />
                            {!editForm.barcode && (editForm.asset_tag || editForm.serial_number) && (
                              <p className="text-xs text-theme-text-muted mt-1">Label will use {editForm.asset_tag ? 'asset tag' : 'serial number'} if barcode is blank.</p>
                            )}
                          </div>
                        </div>
                      </fieldset>

                      {/* Product Details */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <label htmlFor="edit-item-manufacturer" className="block text-sm font-medium text-theme-text-secondary mb-1">Manufacturer</label>
                          <input id="edit-item-manufacturer" type="text" value={editForm.manufacturer || ''} onChange={(e) => setEditForm({ ...editForm, manufacturer: e.target.value })} className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-emerald-500" />
                        </div>
                        <div>
                          <label htmlFor="edit-item-model" className="block text-sm font-medium text-theme-text-secondary mb-1">Model Number</label>
                          <input id="edit-item-model" type="text" value={editForm.model_number || ''} onChange={(e) => setEditForm({ ...editForm, model_number: e.target.value })} className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-emerald-500" />
                        </div>
                      </div>

                      {/* Physical Properties */}
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div>
                          <label htmlFor="edit-item-size" className="block text-sm font-medium text-theme-text-secondary mb-1">Size</label>
                          <input id="edit-item-size" type="text" value={editForm.size || ''} onChange={(e) => setEditForm({ ...editForm, size: e.target.value })} className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-emerald-500" placeholder="e.g., Large, 10.5" />
                        </div>
                        <div>
                          <label htmlFor="edit-item-color" className="block text-sm font-medium text-theme-text-secondary mb-1">Color</label>
                          <input id="edit-item-color" type="text" value={editForm.color || ''} onChange={(e) => setEditForm({ ...editForm, color: e.target.value })} className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-emerald-500" />
                        </div>
                        {editForm.tracking_type === 'pool' && (
                          <div>
                            <label htmlFor="edit-item-uom" className="block text-sm font-medium text-theme-text-secondary mb-1">Unit of Measure</label>
                            <input id="edit-item-uom" type="text" value={editForm.unit_of_measure || ''} onChange={(e) => setEditForm({ ...editForm, unit_of_measure: e.target.value })} className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-emerald-500" placeholder="e.g., pair, box, each" />
                          </div>
                        )}
                      </div>

                      {/* Location */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <label htmlFor="edit-item-room" className="block text-sm font-medium text-theme-text-secondary mb-1">Room</label>
                          {rooms.length > 0 ? (
                            <select id="edit-item-room" value={editForm.location_id || ''} onChange={(e) => {
                              const selectedRoom = rooms.find(r => r.id === e.target.value);
                              setEditForm({ ...editForm, location_id: e.target.value, station: selectedRoom?.building || editForm.station });
                            }} className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-emerald-500">
                              <option value="">Select a room</option>
                              {rooms.map(r => (
                                <option key={r.id} value={r.id}>
                                  {r.building ? `${r.building} — ` : ''}{r.name}{r.room_number ? ` (${r.room_number})` : ''}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <div className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-muted text-sm">
                              No rooms configured. Add rooms in Locations first.
                            </div>
                          )}
                        </div>
                        <div>
                          <label htmlFor="edit-item-storage-area" className="block text-sm font-medium text-theme-text-secondary mb-1">Storage Area</label>
                          {storageAreas.length > 0 ? (
                            <select id="edit-item-storage-area" value={editForm.storage_area_id || ''} onChange={(e) => setEditForm({ ...editForm, storage_area_id: e.target.value })} className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-emerald-500">
                              <option value="">Select storage area</option>
                              {storageAreas.map(sa => (
                                <option key={sa.id} value={sa.id}>
                                  {sa.location_name ? `${sa.location_name} — ` : ''}{sa.parent_name ? `${sa.parent_name} → ` : ''}{sa.name}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <input id="edit-item-storage-area" type="text" value={editForm.storage_location || ''} onChange={(e) => setEditForm({ ...editForm, storage_location: e.target.value })} className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-emerald-500" placeholder="e.g., Shelf 5, Closet B, Room 201" />
                          )}
                        </div>
                      </div>

                      {/* Status & Quantity */}
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div>
                          <label htmlFor="edit-item-condition" className="block text-sm font-medium text-theme-text-secondary mb-1">Condition</label>
                          <select id="edit-item-condition" value={editForm.condition || 'good'} onChange={(e) => setEditForm({ ...editForm, condition: e.target.value })} className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-emerald-500">
                            {CONDITION_OPTIONS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                          </select>
                        </div>
                        <div>
                          <label htmlFor="edit-item-status" className="block text-sm font-medium text-theme-text-secondary mb-1">Status</label>
                          <select id="edit-item-status" value={editForm.status || 'available'} onChange={(e) => setEditForm({ ...editForm, status: e.target.value })} className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-emerald-500">
                            {STATUS_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                          </select>
                        </div>
                        <div>
                          <label htmlFor="edit-item-quantity" className="block text-sm font-medium text-theme-text-secondary mb-1">
                            {editForm.tracking_type === 'pool' ? 'Total Stock' : 'Quantity'}
                          </label>
                          <input id="edit-item-quantity" type="number" min="1" value={editForm.quantity ?? 1} onChange={(e) => setEditForm({ ...editForm, quantity: parseInt(e.target.value) || 1 })} className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-emerald-500" />
                        </div>
                      </div>

                      {/* Purchase & Warranty */}
                      <details className="group">
                        <summary className="cursor-pointer text-xs font-semibold uppercase text-theme-text-muted hover:text-theme-text-secondary flex items-center gap-1.5 select-none">
                          <span className="transition-transform group-open:rotate-90">&#9654;</span>
                          Purchase & Warranty
                        </summary>
                        <div className="mt-3 space-y-3">
                          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                            <div>
                              <label htmlFor="edit-item-purchase-price" className="block text-sm font-medium text-theme-text-secondary mb-1">Purchase Price</label>
                              <input id="edit-item-purchase-price" type="number" min="0" step="0.01" value={editForm.purchase_price ?? ''} onChange={(e) => setEditForm({ ...editForm, purchase_price: e.target.value ? parseFloat(e.target.value) : undefined })} className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-emerald-500" placeholder="0.00" />
                            </div>
                            <div>
                              <label htmlFor="edit-item-purchase-date" className="block text-sm font-medium text-theme-text-secondary mb-1">Purchase Date</label>
                              <input id="edit-item-purchase-date" type="date" value={editForm.purchase_date || ''} onChange={(e) => setEditForm({ ...editForm, purchase_date: e.target.value })} className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-emerald-500" />
                            </div>
                            <div>
                              <label htmlFor="edit-item-vendor" className="block text-sm font-medium text-theme-text-secondary mb-1">Vendor</label>
                              <input id="edit-item-vendor" type="text" value={editForm.vendor || ''} onChange={(e) => setEditForm({ ...editForm, vendor: e.target.value })} className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-emerald-500" />
                            </div>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div>
                              <label htmlFor="edit-item-warranty" className="block text-sm font-medium text-theme-text-secondary mb-1">Warranty Expiration</label>
                              <input id="edit-item-warranty" type="date" value={editForm.warranty_expiration || ''} onChange={(e) => setEditForm({ ...editForm, warranty_expiration: e.target.value })} className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-emerald-500" />
                            </div>
                            <div>
                              <label htmlFor="edit-item-inspection-interval" className="block text-sm font-medium text-theme-text-secondary mb-1">Inspection Interval (days)</label>
                              <input id="edit-item-inspection-interval" type="number" min="0" value={editForm.inspection_interval_days ?? ''} onChange={(e) => setEditForm({ ...editForm, inspection_interval_days: e.target.value ? parseInt(e.target.value) : undefined })} className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-emerald-500" placeholder="e.g., 365" />
                            </div>
                          </div>
                        </div>
                      </details>

                      {/* Notes */}
                      <div>
                        <label htmlFor="edit-item-notes" className="block text-sm font-medium text-theme-text-secondary mb-1">Notes</label>
                        <textarea id="edit-item-notes" rows={2} value={editForm.notes || ''} onChange={(e) => setEditForm({ ...editForm, notes: e.target.value })} className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-emerald-500" />
                      </div>
                    </div>
                  </div>
                  <div className="bg-theme-input-bg px-4 sm:px-6 py-3 flex flex-col-reverse gap-2 sm:flex-row sm:justify-between rounded-b-lg">
                    <div>
                      {editingItem.status !== 'retired' && (
                        <button type="button" onClick={() => { setShowEditModal(false); setShowRetireConfirm(editingItem); }} className="px-4 py-2 text-red-600 hover:bg-red-500/10 rounded-lg transition-colors text-sm flex items-center gap-2">
                          <Archive className="w-4 h-4" aria-hidden="true" /> Retire Item
                        </button>
                      )}
                    </div>
                    <div className="flex gap-2 sm:gap-3">
                      <button type="button" onClick={() => setShowEditModal(false)} className="px-4 py-2 border border-theme-input-border rounded-lg text-theme-text-secondary hover:bg-theme-surface-hover transition-colors">Cancel</button>
                      <button type="submit" disabled={submitting} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition-colors disabled:opacity-50">
                        {submitting ? 'Saving...' : 'Save Changes'}
                      </button>
                    </div>
                  </div>
                </form>
              </div>
            </div>
          </div>
        )}

        {/* Retire Confirmation Dialog */}
        {showRetireConfirm && (
          <div
            className="fixed inset-0 z-50 overflow-y-auto"
            role="dialog"
            aria-modal="true"
            aria-labelledby="retire-confirm-title"
            onKeyDown={(e) => { if (e.key === 'Escape') { setShowRetireConfirm(null); setRetireNotes(''); } }}
          >
            <div className="flex items-center justify-center min-h-screen px-4">
              <div className="fixed inset-0 bg-black/60" onClick={() => { setShowRetireConfirm(null); setRetireNotes(''); }} aria-hidden="true" />
              <div className="relative bg-theme-surface-modal rounded-lg shadow-xl max-w-md w-full border border-theme-surface-border">
                <div className="px-6 pt-5 pb-4">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="bg-red-500/10 p-2 rounded-full">
                      <AlertCircle className="w-5 h-5 text-red-600" aria-hidden="true" />
                    </div>
                    <h3 id="retire-confirm-title" className="text-lg font-medium text-theme-text-primary">Retire Item</h3>
                  </div>
                  <p className="text-theme-text-secondary text-sm mb-4">
                    Are you sure you want to retire <strong>{showRetireConfirm.name}</strong>?
                    This will mark the item as inactive and hide it from inventory lists.
                    Items with active checkouts or assignments cannot be retired.
                  </p>
                  <div>
                    <label htmlFor="retire-notes" className="block text-sm font-medium text-theme-text-secondary mb-1">Retirement Notes (optional)</label>
                    <textarea id="retire-notes" rows={2} value={retireNotes} onChange={(e) => setRetireNotes(e.target.value)} placeholder="Reason for retirement..." className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-red-500" />
                  </div>
                </div>
                <div className="bg-theme-input-bg px-6 py-3 flex justify-end gap-3 rounded-b-lg">
                  <button onClick={() => { setShowRetireConfirm(null); setRetireNotes(''); }} className="px-4 py-2 border border-theme-input-border rounded-lg text-theme-text-secondary hover:bg-theme-surface-hover transition-colors">Cancel</button>
                  <button onClick={handleRetireItem} disabled={submitting} className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors disabled:opacity-50">
                    {submitting ? 'Retiring...' : 'Retire Item'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
        {/* Bulk Status Modal */}
        {showBulkStatusModal && (
          <div className="fixed inset-0 z-50 overflow-y-auto" role="dialog" aria-modal="true" onKeyDown={(e) => { if (e.key === 'Escape') setShowBulkStatusModal(false); }}>
            <div className="flex items-center justify-center min-h-screen px-4">
              <div className="fixed inset-0 bg-black/60" onClick={() => setShowBulkStatusModal(false)} aria-hidden="true" />
              <div className="relative bg-theme-surface-modal rounded-lg shadow-xl max-w-md w-full border border-theme-surface-border">
                <div className="px-6 pt-5 pb-4">
                  <h3 className="text-lg font-medium text-theme-text-primary mb-4">Change Status ({selectedItemIds.size} items)</h3>
                  <div>
                    <label htmlFor="bulk-status-select" className="block text-sm font-medium text-theme-text-secondary mb-1">New Status</label>
                    <select id="bulk-status-select" value={bulkStatus} onChange={(e) => setBulkStatus(e.target.value)} className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-emerald-500">
                      <option value="">Select status...</option>
                      {STATUS_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                    </select>
                  </div>
                </div>
                <div className="bg-theme-input-bg px-6 py-3 flex justify-end gap-3 rounded-b-lg">
                  <button onClick={() => setShowBulkStatusModal(false)} className="px-4 py-2 border border-theme-input-border rounded-lg text-theme-text-secondary hover:bg-theme-surface-hover transition-colors">Cancel</button>
                  <button onClick={handleBulkStatusUpdate} disabled={submitting || !bulkStatus} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition-colors disabled:opacity-50">
                    {submitting ? 'Updating...' : 'Update Status'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Bulk Retire Modal */}
        {showBulkRetireModal && (
          <div className="fixed inset-0 z-50 overflow-y-auto" role="dialog" aria-modal="true" onKeyDown={(e) => { if (e.key === 'Escape') setShowBulkRetireModal(false); }}>
            <div className="flex items-center justify-center min-h-screen px-4">
              <div className="fixed inset-0 bg-black/60" onClick={() => setShowBulkRetireModal(false)} aria-hidden="true" />
              <div className="relative bg-theme-surface-modal rounded-lg shadow-xl max-w-md w-full border border-theme-surface-border">
                <div className="px-6 pt-5 pb-4">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="bg-red-500/10 p-2 rounded-full">
                      <AlertCircle className="w-5 h-5 text-red-600" aria-hidden="true" />
                    </div>
                    <h3 className="text-lg font-medium text-theme-text-primary">Retire {selectedItemIds.size} Items</h3>
                  </div>
                  <p className="text-theme-text-secondary text-sm">
                    Are you sure you want to retire the selected {selectedItemIds.size} item{selectedItemIds.size !== 1 ? 's' : ''}? This action will mark them as inactive.
                  </p>
                </div>
                <div className="bg-theme-input-bg px-6 py-3 flex justify-end gap-3 rounded-b-lg">
                  <button onClick={() => setShowBulkRetireModal(false)} className="px-4 py-2 border border-theme-input-border rounded-lg text-theme-text-secondary hover:bg-theme-surface-hover transition-colors">Cancel</button>
                  <button onClick={handleBulkRetire} disabled={submitting} className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors disabled:opacity-50">
                    {submitting ? 'Retiring...' : 'Retire All'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Edit Category Modal */}
        {editingCategory && (
          <div className="fixed inset-0 z-50 overflow-y-auto" role="dialog" aria-modal="true" onKeyDown={(e) => { if (e.key === 'Escape') setEditingCategory(null); }}>
            <div className="flex items-center justify-center min-h-screen px-4">
              <div className="fixed inset-0 bg-black/60" onClick={() => setEditingCategory(null)} aria-hidden="true" />
              <div className="relative bg-theme-surface-modal rounded-lg shadow-xl max-w-lg w-full border border-theme-surface-border">
                <form onSubmit={handleUpdateCategory}>
                  <div className="px-4 sm:px-6 pt-5 pb-4">
                    <div className="flex justify-between items-center mb-4">
                      <h3 className="text-lg font-medium text-theme-text-primary">Edit Category</h3>
                      <button type="button" onClick={() => setEditingCategory(null)} className="text-theme-text-muted hover:text-theme-text-primary p-1 min-w-[44px] min-h-[44px] flex items-center justify-center" aria-label="Close dialog">
                        <X className="w-5 h-5" aria-hidden="true" />
                      </button>
                    </div>
                    {formError && (
                      <div className="mb-4 bg-red-500/10 border border-red-500/30 rounded-lg p-3" role="alert">
                        <p className="text-sm text-red-700 dark:text-red-300">{formError}</p>
                      </div>
                    )}
                    <div className="space-y-4">
                      <div>
                        <label htmlFor="edit-category-name" className="block text-sm font-medium text-theme-text-secondary mb-1">Name *</label>
                        <input id="edit-category-name" type="text" required value={editCategoryForm.name || ''} onChange={(e) => setEditCategoryForm({ ...editCategoryForm, name: e.target.value })} className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-emerald-500" />
                      </div>
                      <div>
                        <label htmlFor="edit-category-item-type" className="block text-sm font-medium text-theme-text-secondary mb-1">Item Type *</label>
                        <select id="edit-category-item-type" value={editCategoryForm.item_type || 'equipment'} onChange={(e) => setEditCategoryForm({ ...editCategoryForm, item_type: e.target.value })} className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-emerald-500">
                          {ITEM_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                        </select>
                      </div>
                      <div>
                        <label htmlFor="edit-category-description" className="block text-sm font-medium text-theme-text-secondary mb-1">Description</label>
                        <textarea id="edit-category-description" rows={2} value={editCategoryForm.description || ''} onChange={(e) => setEditCategoryForm({ ...editCategoryForm, description: e.target.value })} className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-emerald-500" />
                      </div>
                      <div className="space-y-2">
                        <label className="flex items-center space-x-2">
                          <input type="checkbox" checked={editCategoryForm.requires_serial_number || false} onChange={(e) => setEditCategoryForm({ ...editCategoryForm, requires_serial_number: e.target.checked })} className="rounded border-theme-input-border bg-theme-input-bg text-emerald-600 focus:ring-emerald-500" />
                          <span className="text-sm text-theme-text-secondary">Requires serial number</span>
                        </label>
                        <label className="flex items-center space-x-2">
                          <input type="checkbox" checked={editCategoryForm.requires_maintenance || false} onChange={(e) => setEditCategoryForm({ ...editCategoryForm, requires_maintenance: e.target.checked })} className="rounded border-theme-input-border bg-theme-input-bg text-emerald-600 focus:ring-emerald-500" />
                          <span className="text-sm text-theme-text-secondary">Requires maintenance tracking</span>
                        </label>
                        <label className="flex items-center space-x-2">
                          <input type="checkbox" checked={editCategoryForm.requires_assignment || false} onChange={(e) => setEditCategoryForm({ ...editCategoryForm, requires_assignment: e.target.checked })} className="rounded border-theme-input-border bg-theme-input-bg text-emerald-600 focus:ring-emerald-500" />
                          <span className="text-sm text-theme-text-secondary">Requires member assignment</span>
                        </label>
                      </div>
                      <div>
                        <label htmlFor="edit-category-low-stock" className="block text-sm font-medium text-theme-text-secondary mb-1">Low Stock Threshold</label>
                        <input id="edit-category-low-stock" type="number" min="0" value={editCategoryForm.low_stock_threshold || ''} onChange={(e) => setEditCategoryForm({ ...editCategoryForm, low_stock_threshold: e.target.value ? parseInt(e.target.value) : undefined })} className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-emerald-500" placeholder="Alert when stock falls below" />
                      </div>
                    </div>
                  </div>
                  <div className="bg-theme-input-bg px-4 sm:px-6 py-3 flex justify-end gap-3 rounded-b-lg">
                    <button type="button" onClick={() => setEditingCategory(null)} className="px-4 py-2 border border-theme-input-border rounded-lg text-theme-text-secondary hover:bg-theme-surface-hover transition-colors">Cancel</button>
                    <button type="submit" disabled={submitting} className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg transition-colors disabled:opacity-50">
                      {submitting ? 'Saving...' : 'Save Changes'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        )}

        {/* Pool Issuance Modal */}
        {showPoolIssueModal && poolIssueItem && (
          <div className="fixed inset-0 z-50 overflow-y-auto" role="dialog" aria-modal="true" onKeyDown={(e) => { if (e.key === 'Escape') setShowPoolIssueModal(false); }}>
            <div className="flex items-center justify-center min-h-screen px-4">
              <div className="fixed inset-0 bg-black/60" onClick={() => setShowPoolIssueModal(false)} aria-hidden="true" />
              <div className="relative bg-theme-surface-modal rounded-lg shadow-xl max-w-md w-full border border-theme-surface-border">
                <div className="px-6 pt-5 pb-4">
                  <h3 className="text-lg font-medium text-theme-text-primary mb-1">Issue From Pool</h3>
                  <p className="text-theme-text-secondary text-sm mb-4">{poolIssueItem.name} — {poolIssueItem.quantity - poolIssueItem.quantity_issued} available</p>
                  <div className="space-y-4">
                    <div>
                      <label htmlFor="pool-issue-member" className="block text-sm font-medium text-theme-text-secondary mb-1">Member *</label>
                      <select id="pool-issue-member" value={poolIssueForm.member_id} onChange={(e) => setPoolIssueForm({ ...poolIssueForm, member_id: e.target.value })} className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-purple-500">
                        <option value="">Select member...</option>
                        {members.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                      </select>
                    </div>
                    <div>
                      <label htmlFor="pool-issue-quantity" className="block text-sm font-medium text-theme-text-secondary mb-1">Quantity</label>
                      <input id="pool-issue-quantity" type="number" min="1" max={poolIssueItem.quantity - poolIssueItem.quantity_issued} value={poolIssueForm.quantity} onChange={(e) => setPoolIssueForm({ ...poolIssueForm, quantity: parseInt(e.target.value) || 1 })} className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-purple-500" />
                    </div>
                    <div>
                      <label htmlFor="pool-issue-reason" className="block text-sm font-medium text-theme-text-secondary mb-1">Reason (optional)</label>
                      <input id="pool-issue-reason" type="text" value={poolIssueForm.reason} onChange={(e) => setPoolIssueForm({ ...poolIssueForm, reason: e.target.value })} className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-purple-500" placeholder="e.g., Initial issue, replacement" />
                    </div>
                  </div>
                </div>
                <div className="bg-theme-input-bg px-6 py-3 flex justify-end gap-3 rounded-b-lg">
                  <button onClick={() => setShowPoolIssueModal(false)} className="px-4 py-2 border border-theme-input-border rounded-lg text-theme-text-secondary hover:bg-theme-surface-hover transition-colors">Cancel</button>
                  <button onClick={handlePoolIssue} disabled={submitting || !poolIssueForm.member_id} className="px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-colors disabled:opacity-50">
                    {submitting ? 'Issuing...' : 'Issue Items'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
        {/* Write-Off Request Modal */}
        {showWriteOffModal && writeOffItem && (
          <div className="fixed inset-0 z-50 overflow-y-auto" role="dialog" aria-modal="true" onKeyDown={(e) => { if (e.key === 'Escape') setShowWriteOffModal(false); }}>
            <div className="flex items-center justify-center min-h-screen px-4">
              <div className="fixed inset-0 bg-black/60" onClick={() => setShowWriteOffModal(false)} aria-hidden="true" />
              <div className="relative bg-theme-surface-modal rounded-lg shadow-xl max-w-md w-full border border-theme-surface-border">
                <form onSubmit={handleCreateWriteOff}>
                  <div className="px-6 pt-5 pb-4">
                    <h3 className="text-lg font-medium text-theme-text-primary mb-2">Request Write-Off</h3>
                    <p className="text-theme-text-secondary text-sm mb-4">
                      <span className="font-medium text-theme-text-primary">{writeOffItem.name}</span>
                      {writeOffItem.serial_number && <span className="text-xs font-mono ml-2">SN: {writeOffItem.serial_number}</span>}
                      {writeOffItem.purchase_price != null && <span className="text-xs ml-2">Value: ${writeOffItem.purchase_price}</span>}
                    </p>

                    {formError && (
                      <div className="mb-4 bg-red-500/10 border border-red-500/30 rounded-lg p-3" role="alert">
                        <p className="text-sm text-red-700 dark:text-red-300">{formError}</p>
                      </div>
                    )}

                    <div className="space-y-4">
                      <div>
                        <label htmlFor="wo-reason" className="block text-sm font-medium text-theme-text-secondary mb-1">Reason</label>
                        <select id="wo-reason" value={writeOffForm.reason} onChange={(e) => setWriteOffForm({ ...writeOffForm, reason: e.target.value })} className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-red-500">
                          <option value="lost">Lost</option>
                          <option value="stolen">Stolen</option>
                          <option value="damaged_beyond_repair">Damaged Beyond Repair</option>
                          <option value="obsolete">Obsolete</option>
                          <option value="other">Other</option>
                        </select>
                      </div>
                      <div>
                        <label htmlFor="wo-description" className="block text-sm font-medium text-theme-text-secondary mb-1">Description</label>
                        <textarea id="wo-description" rows={3} required value={writeOffForm.description} onChange={(e) => setWriteOffForm({ ...writeOffForm, description: e.target.value })} className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-red-500" placeholder="Describe the circumstances..." />
                      </div>
                    </div>
                  </div>
                  <div className="bg-theme-input-bg px-6 py-3 flex justify-end gap-3 rounded-b-lg">
                    <button type="button" onClick={() => setShowWriteOffModal(false)} className="px-4 py-2 border border-theme-input-border rounded-lg text-theme-text-secondary hover:bg-theme-surface-hover transition-colors">Cancel</button>
                    <button type="submit" disabled={submitting || !writeOffForm.description.trim()} className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors disabled:opacity-50">
                      {submitting ? 'Submitting...' : 'Submit Write-Off Request'}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
};

export default InventoryPage;
