import React, { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeft, BoxSelect, Plus, Pencil, RefreshCw, Package,
  Eye, EyeOff, GripVertical, Trash2, Ruler,
} from 'lucide-react';
import { inventoryService } from '../../../services/api';
import type {
  EquipmentKit,
  EquipmentKitCreate,
  EquipmentKitItem,
  InventoryItem,
  InventoryCategory,
} from '../types';
import { useAuthStore } from '../../../stores/authStore';
import { getErrorMessage } from '../../../utils/errorHandling';
import { Modal } from '../../../components/Modal';
import toast from 'react-hot-toast';

interface LineItemFormData {
  item_id: string;
  category_id: string;
  item_name: string;
  quantity: string;
  size_selectable: boolean;
}

const EMPTY_LINE_ITEM: LineItemFormData = {
  item_id: '', category_id: '', item_name: '', quantity: '1', size_selectable: false,
};

interface KitFormData {
  name: string;
  description: string;
  line_items: LineItemFormData[];
}

const EMPTY_FORM: KitFormData = {
  name: '', description: '', line_items: [{ ...EMPTY_LINE_ITEM }],
};

const inputClass = 'form-input w-full';
const labelClass = 'form-label';

const EquipmentKitsPage: React.FC = () => {
  const { checkPermission } = useAuthStore();
  const canManage = checkPermission('inventory.manage');
  const [kits, setKits] = useState<EquipmentKit[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showInactive, setShowInactive] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [editingKit, setEditingKit] = useState<EquipmentKit | null>(null);
  const [formData, setFormData] = useState<KitFormData>(EMPTY_FORM);
  const [isSaving, setIsSaving] = useState(false);
  const [detailKit, setDetailKit] = useState<EquipmentKit | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [categories, setCategories] = useState<InventoryCategory[]>([]);

  const loadKits = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await inventoryService.getEquipmentKits(!showInactive);
      setKits(data);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to load equipment kits'));
    } finally {
      setIsLoading(false);
    }
  }, [showInactive]);

  const loadReferenceData = useCallback(async () => {
    try {
      const [itemsData, categoriesData] = await Promise.all([
        inventoryService.getItems({ limit: 500 }),
        inventoryService.getCategories(undefined, true),
      ]);
      setItems(itemsData.items);
      setCategories(categoriesData);
    } catch {
      // Reference data is supplementary; don't block the page
    }
  }, []);

  useEffect(() => { void loadKits(); }, [loadKits]);
  useEffect(() => { void loadReferenceData(); }, [loadReferenceData]);

  const openCreateModal = () => {
    setEditingKit(null);
    setFormData(EMPTY_FORM);
    setShowModal(true);
  };

  const openEditModal = async (kit: EquipmentKit) => {
    try {
      const full = await inventoryService.getEquipmentKit(kit.id);
      setEditingKit(full);
      setFormData({
        name: full.name,
        description: full.description ?? '',
        line_items: full.line_items && full.line_items.length > 0
          ? full.line_items.map((li: EquipmentKitItem) => ({
            item_id: li.item_id ?? '',
            category_id: li.category_id ?? '',
            item_name: li.item_name,
            quantity: String(li.quantity),
            size_selectable: li.size_selectable,
          }))
          : [{ ...EMPTY_LINE_ITEM }],
      });
      setShowModal(true);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to load kit details'));
    }
  };

  const openDetailModal = async (kit: EquipmentKit) => {
    try {
      const full = await inventoryService.getEquipmentKit(kit.id);
      setDetailKit(full);
      setShowDetail(true);
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to load kit details'));
    }
  };

  const closeModal = () => {
    setShowModal(false);
    setEditingKit(null);
    setFormData(EMPTY_FORM);
  };

  const addLineItem = () => {
    setFormData((prev) => ({
      ...prev,
      line_items: [...prev.line_items, { ...EMPTY_LINE_ITEM }],
    }));
  };

  const removeLineItem = (index: number) => {
    setFormData((prev) => ({
      ...prev,
      line_items: prev.line_items.filter((_, i) => i !== index),
    }));
  };

  const updateLineItem = (index: number, field: keyof LineItemFormData, value: string | boolean) => {
    setFormData((prev) => ({
      ...prev,
      line_items: prev.line_items.map((li, i) => {
        if (i !== index) return li;
        const updated = { ...li, [field]: value };
        if (field === 'item_id' && typeof value === 'string' && value) {
          const item = items.find((it) => it.id === value);
          if (item) {
            updated.item_name = item.name;
            updated.category_id = item.category_id ?? '';
          }
        }
        return updated;
      }),
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) { toast.error('Kit name is required'); return; }
    const validItems = formData.line_items.filter((li) => li.item_name.trim());
    if (validItems.length === 0) { toast.error('At least one line item is required'); return; }

    setIsSaving(true);
    try {
      const payload: EquipmentKitCreate = {
        name: formData.name.trim(),
        description: formData.description.trim() || undefined,
        line_items: validItems.map((li) => ({
          item_id: li.item_id || undefined,
          category_id: li.category_id || undefined,
          item_name: li.item_name.trim(),
          quantity: parseInt(li.quantity, 10) || 1,
          size_selectable: li.size_selectable,
        })),
      };
      if (editingKit) {
        await inventoryService.updateEquipmentKit(editingKit.id, payload);
        toast.success('Kit updated');
      } else {
        await inventoryService.createEquipmentKit(payload);
        toast.success('Kit created');
      }
      closeModal();
      void loadKits();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to save kit'));
    } finally {
      setIsSaving(false);
    }
  };

  const toggleActive = async (kit: EquipmentKit) => {
    try {
      await inventoryService.updateEquipmentKit(kit.id, { active: !kit.active });
      toast.success(kit.active ? 'Kit deactivated' : 'Kit activated');
      void loadKits();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to update kit'));
    }
  };

  const modalFooter = (
    <>
      <button
        type="submit" form="kit-form" disabled={isSaving}
        className="btn-info btn-md inline-flex items-center gap-2 disabled:opacity-50"
      >
        {isSaving && <RefreshCw className="w-4 h-4 animate-spin" />}
        {editingKit ? 'Update Kit' : 'Create Kit'}
      </button>
      <button
        type="button" onClick={closeModal}
        className="mr-2 sm:mr-3 inline-flex items-center px-4 py-2 text-sm font-medium text-theme-text-secondary hover:text-theme-text-primary"
      >
        Cancel
      </button>
    </>
  );

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6">
      <Link to="/inventory/admin" className="text-sm text-theme-text-muted hover:text-theme-text-secondary flex items-center gap-1">
        <ArrowLeft className="h-4 w-4" />
        Back to Admin
      </Link>

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-theme-text-primary">Equipment Kits</h1>
          <p className="text-theme-text-secondary mt-1">
            Create kit templates to issue multiple items to members at once.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-theme-text-secondary cursor-pointer">
            <input
              type="checkbox" checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
              className="rounded border-theme-surface-border"
            />
            Show inactive
          </label>
          {canManage && (
            <button onClick={openCreateModal} className="btn-info btn-md flex gap-2 items-center">
              <Plus className="w-4 h-4" /> Add Kit
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <RefreshCw className="w-8 h-8 animate-spin text-theme-text-muted" />
        </div>
      ) : kits.length === 0 ? (
        <div className="text-center py-16 card-secondary">
          <BoxSelect className="w-12 h-12 text-theme-text-muted mx-auto mb-3" />
          <p className="text-theme-text-muted mb-4">
            {showInactive ? 'No equipment kits found.' : 'No active kits yet. Create one to get started.'}
          </p>
          {canManage && (
            <button onClick={openCreateModal} className="btn-info btn-md inline-flex gap-2 items-center">
              <Plus className="w-4 h-4" /> Add Kit
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {kits.map((kit) => (
            <div key={kit.id} className={`card-secondary p-5 flex flex-col ${!kit.active ? 'opacity-60' : ''}`}>
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="w-9 h-9 rounded-lg bg-purple-500/10 flex items-center justify-center shrink-0">
                    <BoxSelect className="w-4 h-4 text-purple-500" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-semibold text-theme-text-primary truncate">{kit.name}</h3>
                    {!kit.active && (
                      <span className="text-xs text-theme-text-muted">Inactive</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => void openDetailModal(kit)}
                    aria-label={`View ${kit.name}`}
                    className="p-1.5 rounded-md text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover transition-colors"
                  >
                    <Eye className="w-4 h-4" />
                  </button>
                  {canManage && (
                    <>
                      <button
                        onClick={() => void openEditModal(kit)}
                        aria-label={`Edit ${kit.name}`}
                        className="p-1.5 rounded-md text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover transition-colors"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => void toggleActive(kit)}
                        aria-label={kit.active ? `Deactivate ${kit.name}` : `Activate ${kit.name}`}
                        className="p-1.5 rounded-md text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover transition-colors"
                      >
                        {kit.active ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </>
                  )}
                </div>
              </div>
              {kit.description && (
                <p className="text-sm text-theme-text-secondary mb-3 line-clamp-2">{kit.description}</p>
              )}
              <div className="flex items-center gap-2 text-xs text-theme-text-muted mt-auto pt-2 border-t border-theme-surface-border">
                <Package className="w-3.5 h-3.5" />
                {kit.line_items?.length ?? 0} item{(kit.line_items?.length ?? 0) !== 1 ? 's' : ''}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create/Edit Modal */}
      <Modal isOpen={showModal} onClose={closeModal}
        title={editingKit ? 'Edit Kit' : 'Add Equipment Kit'} footer={modalFooter} size="lg">
        <form id="kit-form" onSubmit={(e) => void handleSubmit(e)} className="space-y-5">
          <div>
            <label htmlFor="kit-name" className={labelClass}>Name <span className="text-red-500">*</span></label>
            <input id="kit-name" type="text" required value={formData.name}
              onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
              className={inputClass} placeholder="e.g. New Recruit Kit" />
          </div>
          <div>
            <label htmlFor="kit-desc" className={labelClass}>Description</label>
            <textarea id="kit-desc" rows={2} value={formData.description}
              onChange={(e) => setFormData((prev) => ({ ...prev, description: e.target.value }))}
              className={inputClass} placeholder="Optional description for this kit" />
          </div>

          {/* Line Items */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-theme-text-secondary">
                Line Items <span className="text-red-500">*</span>
              </p>
              <button type="button" onClick={addLineItem}
                className="text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 flex items-center gap-1">
                <Plus className="w-3.5 h-3.5" /> Add Item
              </button>
            </div>

            {formData.line_items.map((li, idx) => (
              <div key={idx} className="flex items-start gap-2 p-3 rounded-lg bg-theme-surface-secondary/50 border border-theme-surface-border">
                <GripVertical className="w-4 h-4 text-theme-text-muted mt-2.5 shrink-0" />
                <div className="flex-1 grid grid-cols-1 sm:grid-cols-12 gap-2">
                  <div className="sm:col-span-5">
                    <label className="text-xs text-theme-text-muted mb-0.5 block">Item</label>
                    <select
                      value={li.item_id}
                      onChange={(e) => updateLineItem(idx, 'item_id', e.target.value)}
                      className={inputClass + ' text-sm'}
                    >
                      <option value="">Select or type custom...</option>
                      {items.map((item) => (
                        <option key={item.id} value={item.id}>{item.name}</option>
                      ))}
                    </select>
                    {!li.item_id && (
                      <input
                        type="text" value={li.item_name}
                        onChange={(e) => updateLineItem(idx, 'item_name', e.target.value)}
                        className={inputClass + ' text-sm mt-1'}
                        placeholder="Custom item name"
                      />
                    )}
                  </div>
                  <div className="sm:col-span-3">
                    <label className="text-xs text-theme-text-muted mb-0.5 block">Category</label>
                    <select
                      value={li.category_id}
                      onChange={(e) => updateLineItem(idx, 'category_id', e.target.value)}
                      className={inputClass + ' text-sm'}
                    >
                      <option value="">None</option>
                      {categories.map((cat) => (
                        <option key={cat.id} value={cat.id}>{cat.name}</option>
                      ))}
                    </select>
                  </div>
                  <div className="sm:col-span-2">
                    <label className="text-xs text-theme-text-muted mb-0.5 block">Qty</label>
                    <input
                      type="number" min="1" value={li.quantity}
                      onChange={(e) => updateLineItem(idx, 'quantity', e.target.value)}
                      className={inputClass + ' text-sm'}
                    />
                  </div>
                  <div className="sm:col-span-2 flex items-end pb-1">
                    <label className="flex items-center gap-1.5 text-xs text-theme-text-secondary cursor-pointer">
                      <input
                        type="checkbox" checked={li.size_selectable}
                        onChange={(e) => updateLineItem(idx, 'size_selectable', e.target.checked)}
                        className="rounded border-theme-surface-border"
                      />
                      <Ruler className="w-3.5 h-3.5" />
                      Size
                    </label>
                  </div>
                </div>
                {formData.line_items.length > 1 && (
                  <button type="button" onClick={() => removeLineItem(idx)}
                    className="p-1.5 rounded-md text-theme-text-muted hover:text-red-500 transition-colors mt-2 shrink-0"
                    aria-label="Remove line item">
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </form>
      </Modal>

      {/* Detail View Modal */}
      <Modal isOpen={showDetail} onClose={() => { setShowDetail(false); setDetailKit(null); }}
        title={detailKit?.name ?? 'Kit Details'} size="md">
        {detailKit && (
          <div className="space-y-4">
            {detailKit.description && (
              <p className="text-sm text-theme-text-secondary">{detailKit.description}</p>
            )}
            <div className="flex items-center gap-2">
              <span className={`inline-flex text-xs font-medium px-2.5 py-1 rounded-full border ${
                detailKit.active
                  ? 'bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/30'
                  : 'bg-theme-surface-secondary text-theme-text-muted border-theme-surface-border'
              }`}>
                {detailKit.active ? 'Active' : 'Inactive'}
              </span>
            </div>

            <div>
              <h4 className="text-sm font-medium text-theme-text-primary mb-2">
                Items ({detailKit.line_items?.length ?? 0})
              </h4>
              {detailKit.line_items && detailKit.line_items.length > 0 ? (
                <div className="space-y-2">
                  {detailKit.line_items.map((li, idx) => (
                    <div key={li.id ?? idx} className="flex items-center justify-between p-2.5 rounded-lg bg-theme-surface-secondary/50 border border-theme-surface-border">
                      <div className="flex items-center gap-2">
                        <Package className="w-4 h-4 text-theme-text-muted" />
                        <span className="text-sm text-theme-text-primary">{li.item_name}</span>
                      </div>
                      <div className="flex items-center gap-3 text-xs text-theme-text-muted">
                        <span>Qty: {li.quantity}</span>
                        {li.size_selectable && (
                          <span className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400">
                            <Ruler className="w-3 h-3" /> Size select
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-theme-text-muted">No items in this kit.</p>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};

export default EquipmentKitsPage;
