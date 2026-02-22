import React, { useEffect, useState } from 'react';
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
} from 'lucide-react';
import {
  inventoryService,
  type InventoryItem,
  type InventoryCategory,
  type InventorySummary,
  type InventoryItemCreate,
  type InventoryCategoryCreate,
} from '../services/api';
import { useAuthStore } from '../stores/authStore';
import { getErrorMessage } from '../utils/errorHandling';
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

const CONDITION_OPTIONS = [
  { value: 'excellent', label: 'Excellent' },
  { value: 'good', label: 'Good' },
  { value: 'fair', label: 'Fair' },
  { value: 'poor', label: 'Poor' },
  { value: 'damaged', label: 'Damaged' },
  { value: 'out_of_service', label: 'Out of Service' },
];

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

type Tab = 'items' | 'categories';

const InventoryPage: React.FC = () => {
  const { checkPermission } = useAuthStore();
  const canManage = checkPermission('inventory.manage');

  const [activeTab, setActiveTab] = useState<Tab>('items');
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [categories, setCategories] = useState<InventoryCategory[]>([]);
  const [summary, setSummary] = useState<InventorySummary | null>(null);
  const [totalItems, setTotalItems] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
    storage_location: '',
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

  useEffect(() => {
    loadData();
  }, []);

  useEffect(() => {
    if (!loading) {
      loadItems();
    }
  }, [searchQuery, statusFilter, categoryFilter]);

  const loadData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [summaryData, categoriesData, itemsData] = await Promise.all([
        inventoryService.getSummary(),
        inventoryService.getCategories(),
        inventoryService.getItems({ limit: 100 }),
      ]);
      setSummary(summaryData);
      setCategories(categoriesData);
      setItems(itemsData.items);
      setTotalItems(itemsData.total);
    } catch (err: unknown) {
      setError(getErrorMessage(err, 'Unable to load inventory data. Please check your connection and refresh the page.'));
    } finally {
      setLoading(false);
    }
  };

  const loadItems = async () => {
    try {
      const data = await inventoryService.getItems({
        search: searchQuery || undefined,
        status: statusFilter || undefined,
        category_id: categoryFilter || undefined,
        limit: 100,
      });
      setItems(data.items);
      setTotalItems(data.total);
      setSelectedItemIds(new Set());
    } catch (_err: unknown) {
      // Error silently handled - items list will remain unchanged
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
    try {
      const blob = await inventoryService.generateBarcodeLabels(Array.from(selectedItemIds));
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      toast.success(`Generated labels for ${selectedItemIds.size} item(s)`);
    } catch {
      toast.error('Failed to generate barcode labels');
    } finally {
      setPrintingLabels(false);
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
                <button
                  onClick={handlePrintLabels}
                  disabled={printingLabels}
                  className="flex items-center space-x-2 px-3 sm:px-4 py-2 bg-theme-surface-hover hover:bg-theme-surface text-theme-text-primary rounded-lg transition-colors text-sm disabled:opacity-50"
                >
                  <Printer className="w-4 h-4" aria-hidden="true" />
                  <span className="hidden sm:inline">Print Labels ({selectedItemIds.size})</span>
                  <span className="sm:hidden">Labels ({selectedItemIds.size})</span>
                </button>
              )}
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
                    placeholder="Search by name, serial number, asset tag..."
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
              </div>
            </div>

            {/* Items Table */}
            {items.length === 0 ? (
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
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/10">
                      {items.map((item) => (
                        <tr key={item.id} className="hover:bg-theme-surface-secondary transition-colors">
                          {canManage && (
                            <td className="w-10 px-3 py-4">
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
                                <div className="text-theme-text-muted text-xs sm:text-sm">{item.manufacturer} {item.model_number || ''}</div>
                              )}
                            </div>
                          </td>
                          <td className="hidden sm:table-cell px-3 sm:px-6 py-4 text-theme-text-secondary text-sm">{getCategoryName(item.category_id)}</td>
                          <td className="hidden lg:table-cell px-6 py-4">
                            <span className="text-theme-text-secondary font-mono text-sm">{item.serial_number || '-'}</span>
                          </td>
                          <td className="hidden lg:table-cell px-6 py-4 text-theme-text-secondary text-sm">{item.storage_location || item.station || '-'}</td>
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
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
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
                      <span className="px-2 py-1 text-xs font-medium rounded bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/30 capitalize">
                        {cat.item_type}
                      </span>
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

                      {/* ── Identification & Tracking ── */}
                      <fieldset>
                        <legend className="flex items-center gap-1.5 text-xs font-semibold uppercase text-theme-text-muted mb-2">
                          <Barcode className="w-3.5 h-3.5" aria-hidden="true" /> Identification
                        </legend>
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                          <div>
                            <label htmlFor="item-serial-number" className="block text-sm font-medium text-theme-text-secondary mb-1">Serial Number</label>
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
                          <label htmlFor="item-storage-location" className="block text-sm font-medium text-theme-text-secondary mb-1">Storage Location</label>
                          <input
                            id="item-storage-location"
                            type="text" value={itemForm.storage_location}
                            onChange={(e) => setItemForm({ ...itemForm, storage_location: e.target.value })}
                            className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-emerald-500"
                            placeholder="e.g., Shelf B-3"
                          />
                        </div>
                        <div>
                          <label htmlFor="item-station" className="block text-sm font-medium text-theme-text-secondary mb-1">Station</label>
                          <input
                            id="item-station"
                            type="text" value={itemForm.station}
                            onChange={(e) => setItemForm({ ...itemForm, station: e.target.value })}
                            className="w-full px-3 py-2 bg-theme-input-bg border border-theme-input-border rounded-lg text-theme-text-primary focus:outline-none focus:ring-2 focus:ring-emerald-500"
                            placeholder="e.g., Station 1"
                          />
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
      </main>
    </div>
  );
};

export default InventoryPage;
