import React, { useState, useEffect, useCallback } from 'react';
import {
  BoxSelect,
  Plus,
  Pencil,
  RefreshCw,
  Package,
  Eye,
  EyeOff,
  GripVertical,
  Trash2,
  Ruler,
  UserPlus,
} from 'lucide-react';
import { MemberPickerModal } from '../../../components/MemberPickerModal';
import { inventoryService } from '../../../services/api';
import type {
  EquipmentKit,
  EquipmentKitCreate,
  EquipmentKitItem,
  InventoryCategory,
  KitIssuePlan,
  KitProductOption,
  KitProductVariant,
} from '../types';
import { useAuthStore } from '../../../stores/authStore';
import { getErrorMessage } from '../../../utils/errorHandling';
import { Modal } from '../../../components/Modal';
import toast from 'react-hot-toast';
import { formCoercions } from '../../../utils/formValues';

interface LineItemFormData {
  item_id: string;
  category_id: string;
  item_name: string;
  quantity: string;
  size_selectable: boolean;
  optional: boolean;
}

const EMPTY_LINE_ITEM: LineItemFormData = {
  item_id: '',
  category_id: '',
  item_name: '',
  quantity: '1',
  size_selectable: false,
  optional: false,
};

interface KitFormData {
  name: string;
  description: string;
  line_items: LineItemFormData[];
}

const EMPTY_FORM: KitFormData = {
  name: '',
  description: '',
  line_items: [{ ...EMPTY_LINE_ITEM }],
};

const inputClass = 'form-input w-full';
const labelClass = 'form-label';

/** Size-select value meaning "settle the size from the member's preferences". */
const MEMBER_SIZE = '__member__';
/** Item-select value for a stored row the catalog no longer offers. */
const CURRENT_ITEM = '__current__';

/** The product and variant a stored kit row belongs to, if the catalog has it. */
const findProduct = (
  products: KitProductOption[],
  itemId: string
): { product: KitProductOption; variant: KitProductVariant } | null => {
  if (!itemId) return null;
  for (const product of products) {
    const variant = product.variants.find((v) => v.item_ids.includes(itemId) || v.item_id === itemId);
    if (variant) return { product, variant };
  }
  return null;
};

/** A fixed-size line names its size, so the kit detail reads "Jacket — L". */
const fixedLineName = (product: KitProductOption, variant: KitProductVariant): string =>
  product.variants.length > 1 ? `${product.name} — ${variant.label}` : product.name;

interface IssueReview {
  kit: EquipmentKit;
  userId: string;
  memberName: string;
  plan: KitIssuePlan;
}

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
  const [issueKit, setIssueKit] = useState<EquipmentKit | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  const [products, setProducts] = useState<KitProductOption[]>([]);
  const [issueReview, setIssueReview] = useState<IssueReview | null>(null);
  const [sizeSelections, setSizeSelections] = useState<Record<string, string>>({});
  const [isIssuing, setIsIssuing] = useState(false);
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
      const [productsData, categoriesData] = await Promise.all([
        inventoryService.getKitProductOptions(),
        inventoryService.getCategories(undefined, true),
      ]);
      setProducts(productsData);
      setCategories(categoriesData);
    } catch {
      // Reference data is supplementary; don't block the page
    }
  }, []);

  useEffect(() => {
    void loadKits();
  }, [loadKits]);
  useEffect(() => {
    void loadReferenceData();
  }, [loadReferenceData]);

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
        line_items:
          full.line_items && full.line_items.length > 0
            ? full.line_items.map((li: EquipmentKitItem) => ({
                item_id: li.item_id ?? '',
                category_id: li.category_id ?? '',
                item_name: li.item_name,
                quantity: String(li.quantity),
                size_selectable: li.size_selectable,
                optional: li.optional ?? false,
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
      line_items: prev.line_items.map((li, i) => (i === index ? { ...li, [field]: value } : li)),
    }));
  };

  const patchLineItem = (index: number, patch: Partial<LineItemFormData>) => {
    setFormData((prev) => ({
      ...prev,
      line_items: prev.line_items.map((li, i) => (i === index ? { ...li, ...patch } : li)),
    }));
  };

  // A kit is issued to many members, so a sized product defaults to "the
  // member's size" rather than to whichever size happens to be listed first.
  const selectProduct = (index: number, key: string) => {
    if (key === CURRENT_ITEM) return;
    const product = products.find((p) => p.key === key);
    const first = product?.variants[0];
    if (!product || !first) {
      patchLineItem(index, { item_id: '', item_name: '', size_selectable: false });
      return;
    }
    patchLineItem(index, {
      item_id: first.item_id,
      category_id: product.category_id ?? '',
      item_name: product.has_sizes ? product.name : fixedLineName(product, first),
      size_selectable: product.has_sizes,
    });
  };

  const selectSize = (index: number, product: KitProductOption, value: string) => {
    if (value === MEMBER_SIZE) {
      patchLineItem(index, { size_selectable: true, item_name: product.name });
      return;
    }
    const variant = product.variants.find((v) => v.item_id === value);
    if (!variant) return;
    patchLineItem(index, {
      item_id: variant.item_id,
      size_selectable: false,
      item_name: fixedLineName(product, variant),
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) {
      toast.error('Kit name is required');
      return;
    }
    const validItems = formData.line_items.filter((li) => li.item_name.trim());
    if (validItems.length === 0) {
      toast.error('At least one line item is required');
      return;
    }

    setIsSaving(true);
    try {
      // On edit a cleared description goes as an explicit null: the backend
      // dumps update payloads with `exclude_unset`, so omitting the key leaves
      // the old text in place behind a success toast (CLAUDE.md pitfall #1).
      const { text } = formCoercions(Boolean(editingKit));
      const payload: EquipmentKitCreate = {
        name: formData.name.trim(),
        description: text(formData.description),
        line_items: validItems.map((li) => ({
          item_id: li.item_id || undefined,
          category_id: li.category_id || undefined,
          item_name: li.item_name.trim(),
          quantity: parseInt(li.quantity, 10) || 1,
          size_selectable: li.size_selectable,
          optional: li.optional,
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

  // Picking a name in the member list is the whole gesture, so a slip on the
  // row above or below issued every item in the kit with nothing to stop it.
  // The review that follows names the member and shows the size each line
  // resolved to from their preferences, which the quartermaster can change.
  const handleIssueKit = async (userId: string, memberName: string) => {
    if (!issueKit) return;
    const kit = issueKit;
    setIssueKit(null);
    try {
      const plan = await inventoryService.getKitIssuePlan(kit.id, userId);
      const initial: Record<string, string> = {};
      for (const line of plan.lines) {
        if (line.size_selectable && line.selected_item_id) initial[line.line_id] = line.selected_item_id;
      }
      setSizeSelections(initial);
      setIssueReview({ kit, userId, memberName, plan });
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to prepare kit issue'));
    }
  };

  const closeIssueReview = () => {
    setIssueReview(null);
    setSizeSelections({});
  };

  // Every sized line needs a size before anything is issued: a member with no
  // size on file gets an explicit choice, never an arbitrary default.
  const missingSizes = issueReview
    ? issueReview.plan.lines.filter((l) => l.issuable && l.size_selectable && !sizeSelections[l.line_id])
    : [];

  const confirmIssueKit = async () => {
    if (!issueReview || missingSizes.length > 0) return;
    const { kit, userId } = issueReview;
    setIsIssuing(true);
    try {
      const res = await inventoryService.issueKitToMember(kit.id, userId, sizeSelections);
      toast.success(`Issued ${res.items_issued} item${res.items_issued !== 1 ? 's' : ''} from "${kit.name}"`);
      closeIssueReview();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to issue kit'));
    } finally {
      setIsIssuing(false);
    }
  };

  const modalFooter = (
    <>
      <button
        type="submit"
        form="kit-form"
        disabled={isSaving}
        className="btn-info btn-md inline-flex items-center gap-2 disabled:opacity-50"
      >
        {isSaving && <RefreshCw className="h-4 w-4 animate-spin" />}
        {editingKit ? 'Update Kit' : 'Create Kit'}
      </button>
      <button
        type="button"
        onClick={closeModal}
        className="text-theme-text-secondary hover:text-theme-text-primary mr-2 inline-flex items-center px-4 py-2 text-sm font-medium sm:mr-3"
      >
        Cancel
      </button>
    </>
  );

  return (
    <div className="max-w-7xl space-y-6 py-6 sm:py-8">
      {/* Header */}
      <div className="split-row gap-4 sm:items-center">
        <div className="split-row-main">
          <h2 className="text-theme-text-primary text-2xl font-bold">Gear Kits</h2>
          <p className="text-theme-text-secondary mt-1">
            Create kit templates to issue multiple items to members at once.
          </p>
        </div>
        <div className="split-row-aside flex flex-wrap items-center gap-3 whitespace-nowrap">
          <label className="text-theme-text-secondary touch:min-h-11 flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
              className="border-theme-surface-border rounded"
            />
            Show inactive
          </label>
          {canManage && (
            <button onClick={openCreateModal} className="btn-info btn-md flex items-center gap-2">
              <Plus className="h-4 w-4" /> Add Kit
            </button>
          )}
        </div>
      </div>

      {/* Content */}
      {isLoading ? (
        <div className="flex items-center justify-center py-20" role="status" aria-live="polite">
          <RefreshCw className="text-theme-text-muted h-8 w-8 animate-spin" />
        </div>
      ) : kits.length === 0 ? (
        <div className="card-secondary py-16 text-center">
          <BoxSelect className="text-theme-text-muted mx-auto mb-3 h-12 w-12" />
          <p className="text-theme-text-muted mb-4">
            {showInactive ? 'No equipment kits found.' : 'No active kits yet. Create one to get started.'}
          </p>
          {canManage && (
            <button onClick={openCreateModal} className="btn-info btn-md inline-flex items-center gap-2">
              <Plus className="h-4 w-4" /> Add Kit
            </button>
          )}
        </div>
      ) : (
        <div className="card-grid gap-4">
          {kits.map((kit) => (
            <div key={kit.id} className={`card-secondary flex flex-col p-5 ${!kit.active ? 'opacity-60' : ''}`}>
              <div className="mb-3 flex min-w-0 items-center gap-2.5">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-purple-500/10">
                  <BoxSelect className="h-4 w-4 text-purple-500" />
                </div>
                <div className="min-w-0">
                  <h3 className="text-theme-text-primary line-clamp-2 font-semibold">{kit.name}</h3>
                  {!kit.active && <span className="text-theme-text-muted text-xs">Inactive</span>}
                </div>
              </div>
              {kit.description && (
                <p className="text-theme-text-secondary mb-3 line-clamp-2 text-sm">{kit.description}</p>
              )}
              {/* Actions share the footer with the item count. Four icons beside
                  the title left it ~100px on a two-column tablet grid, which
                  clamped "Structural Firefighting Turnout Gear Kit" to two words. */}
              <div className="text-theme-text-muted border-theme-surface-border mt-auto flex flex-wrap items-center gap-2 border-t pt-2 text-xs">
                <Package className="h-3.5 w-3.5 shrink-0" />
                <span className="whitespace-nowrap">
                  {/* The list response carries item_count, not the line items
                      themselves — reading length off the absent array showed
                      every kit as holding nothing. */}
                  {kit.line_items?.length ?? kit.item_count ?? 0} item
                  {(kit.line_items?.length ?? kit.item_count ?? 0) !== 1 ? 's' : ''}
                </span>
                <div className="ml-auto flex shrink-0 items-center gap-1">
                  <button
                    onClick={() => void openDetailModal(kit)}
                    aria-label={`View ${kit.name}`}
                    className="text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover touch-target-phone rounded-md p-1.5 transition-colors"
                  >
                    <Eye className="h-4 w-4" />
                  </button>
                  {canManage && (
                    <>
                      {kit.active && (
                        <button
                          onClick={() => setIssueKit(kit)}
                          aria-label={`Issue ${kit.name} to a member`}
                          className="text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover touch-target-phone rounded-md p-1.5 transition-colors"
                        >
                          <UserPlus className="h-4 w-4" />
                        </button>
                      )}
                      <button
                        onClick={() => void openEditModal(kit)}
                        aria-label={`Edit ${kit.name}`}
                        className="text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover touch-target-phone rounded-md p-1.5 transition-colors"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => void toggleActive(kit)}
                        aria-label={kit.active ? `Deactivate ${kit.name}` : `Activate ${kit.name}`}
                        className="text-theme-text-muted hover:text-theme-text-primary hover:bg-theme-surface-hover touch-target-phone rounded-md p-1.5 transition-colors"
                      >
                        {kit.active ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create/Edit Modal */}
      <Modal
        isOpen={showModal}
        onClose={closeModal}
        title={editingKit ? 'Edit Kit' : 'Add Equipment Kit'}
        footer={modalFooter}
        size="lg"
      >
        <form id="kit-form" onSubmit={(e) => void handleSubmit(e)} className="space-y-5">
          <div>
            <label htmlFor="kit-name" className={labelClass}>
              Name <span className="text-red-500">*</span>
            </label>
            <input
              id="kit-name"
              type="text"
              required
              value={formData.name}
              onChange={(e) => setFormData((prev) => ({ ...prev, name: e.target.value }))}
              className={inputClass}
              placeholder="e.g. New Recruit Kit"
            />
          </div>
          <div>
            <label htmlFor="kit-desc" className={labelClass}>
              Description
            </label>
            <textarea
              id="kit-desc"
              rows={2}
              value={formData.description}
              onChange={(e) => setFormData((prev) => ({ ...prev, description: e.target.value }))}
              className={inputClass}
              placeholder="Optional description for this kit"
            />
          </div>

          {/* Line Items */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-theme-text-secondary text-sm font-medium">
                Line Items <span className="text-red-500">*</span>
              </p>
              <button
                type="button"
                onClick={addLineItem}
                className="touch:min-h-11 flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
              >
                <Plus className="h-3.5 w-3.5" /> Add Item
              </button>
            </div>

            {formData.line_items.map((li, idx) => (
              <div
                key={idx}
                className="bg-theme-surface-secondary/50 border-theme-surface-border flex items-start gap-2 rounded-lg border p-3"
              >
                <GripVertical className="text-theme-text-muted mt-2.5 h-4 w-4 shrink-0" />
                {(() => {
                  const match = findProduct(products, li.item_id);
                  const productKey = match ? match.product.key : li.item_id ? CURRENT_ITEM : '';
                  const showSize = match !== null && match.product.variants.length > 1;
                  return (
                    <div className="grid flex-1 grid-cols-1 gap-2 sm:grid-cols-12">
                      <div className={showSize ? 'sm:col-span-6' : 'sm:col-span-12'}>
                        <label htmlFor={`kit-line-${idx}-item`} className="text-theme-text-muted mb-0.5 block text-xs">
                          Item
                        </label>
                        <select
                          id={`kit-line-${idx}-item`}
                          value={productKey}
                          onChange={(e) => selectProduct(idx, e.target.value)}
                          className={inputClass + ' text-sm'}
                        >
                          <option value="">Select or type custom...</option>
                          {productKey === CURRENT_ITEM && (
                            <option value={CURRENT_ITEM}>{li.item_name} (no longer in catalog)</option>
                          )}
                          {products.map((product) => (
                            <option key={product.key} value={product.key}>
                              {product.name}
                            </option>
                          ))}
                        </select>
                        {!li.item_id && (
                          <input
                            type="text"
                            value={li.item_name}
                            onChange={(e) => updateLineItem(idx, 'item_name', e.target.value)}
                            className={inputClass + ' mt-1 text-sm'}
                            placeholder="Custom item name"
                          />
                        )}
                      </div>
                      {showSize && match && (
                        <div className="sm:col-span-6">
                          <label
                            htmlFor={`kit-line-${idx}-size`}
                            className="text-theme-text-muted mb-0.5 flex items-center gap-1 text-xs"
                          >
                            <Ruler className="h-3 w-3" />
                            {match.product.has_sizes ? 'Size' : 'Variant'}
                          </label>
                          <select
                            id={`kit-line-${idx}-size`}
                            value={li.size_selectable ? MEMBER_SIZE : match.variant.item_id}
                            onChange={(e) => selectSize(idx, match.product, e.target.value)}
                            className={inputClass + ' text-sm'}
                          >
                            {match.product.has_sizes && <option value={MEMBER_SIZE}>Member&apos;s size</option>}
                            {match.product.variants.map((variant) => (
                              <option key={variant.item_id} value={variant.item_id}>
                                {match.product.has_sizes ? `Always ${variant.label}` : variant.label}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                      <div className="sm:col-span-6">
                        <label
                          htmlFor={`kit-line-${idx}-category`}
                          className="text-theme-text-muted mb-0.5 block text-xs"
                        >
                          Category
                        </label>
                        <select
                          id={`kit-line-${idx}-category`}
                          value={li.category_id}
                          onChange={(e) => updateLineItem(idx, 'category_id', e.target.value)}
                          className={inputClass + ' text-sm'}
                        >
                          <option value="">None</option>
                          {categories.map((cat) => (
                            <option key={cat.id} value={cat.id}>
                              {cat.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="sm:col-span-3">
                        <label htmlFor={`kit-line-${idx}-qty`} className="text-theme-text-muted mb-0.5 block text-xs">
                          Qty
                        </label>
                        <input
                          id={`kit-line-${idx}-qty`}
                          type="number"
                          min="1"
                          value={li.quantity}
                          onChange={(e) => updateLineItem(idx, 'quantity', e.target.value)}
                          className={inputClass + ' text-sm'}
                        />
                      </div>
                      <div className="flex items-end pb-1 sm:col-span-3">
                        <label className="text-theme-text-secondary mobile-touch-target flex cursor-pointer items-center justify-start gap-1.5 text-xs">
                          <input
                            type="checkbox"
                            checked={li.optional}
                            onChange={(e) => updateLineItem(idx, 'optional', e.target.checked)}
                            className="form-checkbox"
                          />
                          Optional
                        </label>
                      </div>
                    </div>
                  );
                })()}
                {formData.line_items.length > 1 && (
                  <button
                    type="button"
                    onClick={() => removeLineItem(idx)}
                    className="text-theme-text-muted mt-2 shrink-0 rounded-md p-1.5 transition-colors hover:text-red-500"
                    aria-label="Remove line item"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </form>
      </Modal>

      {/* Detail View Modal */}
      <Modal
        isOpen={showDetail}
        onClose={() => {
          setShowDetail(false);
          setDetailKit(null);
        }}
        title={detailKit?.name ?? 'Kit Details'}
        size="md"
      >
        {detailKit && (
          <div className="space-y-4">
            {detailKit.description && <p className="text-theme-text-secondary text-sm">{detailKit.description}</p>}
            <div className="flex items-center gap-2">
              <span
                className={`inline-flex rounded-full border px-2.5 py-1 text-xs font-medium ${
                  detailKit.active
                    ? 'border-green-500/30 bg-green-500/10 text-green-800 dark:text-green-400'
                    : 'bg-theme-surface-secondary text-theme-text-muted border-theme-surface-border'
                }`}
              >
                {detailKit.active ? 'Active' : 'Inactive'}
              </span>
            </div>

            <div>
              <h4 className="text-theme-text-primary mb-2 text-sm font-medium">
                Items ({detailKit.line_items?.length ?? 0})
              </h4>
              {detailKit.line_items && detailKit.line_items.length > 0 ? (
                <div className="space-y-2">
                  {detailKit.line_items.map((li, idx) => (
                    <div
                      key={li.id ?? idx}
                      className="bg-theme-surface-secondary/50 border-theme-surface-border flex items-center justify-between rounded-lg border p-2.5"
                    >
                      <div className="flex items-center gap-2">
                        <Package className="text-theme-text-muted h-4 w-4" />
                        <span className="text-theme-text-primary text-sm">{li.item_name}</span>
                      </div>
                      <div className="text-theme-text-muted flex items-center gap-3 text-xs">
                        <span>Qty: {li.quantity}</span>
                        {li.size_selectable && (
                          <span className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400">
                            <Ruler className="h-3 w-3" /> Member&apos;s size
                          </span>
                        )}
                        {li.optional && <span className="text-amber-700 dark:text-amber-400">Optional</span>}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-theme-text-muted text-sm">No items in this kit.</p>
              )}
            </div>
          </div>
        )}
      </Modal>

      {/* Issue kit — pick the member to issue every kit item to */}
      <MemberPickerModal
        isOpen={issueKit !== null}
        onClose={() => setIssueKit(null)}
        title={issueKit ? `Issue "${issueKit.name}" — Select a Member` : 'Issue Kit'}
        onSelect={(member) => {
          void handleIssueKit(member.userId, member.memberName);
        }}
      />

      {/* Issue review — each line sized from the member's preferences */}
      <Modal
        isOpen={issueReview !== null}
        onClose={closeIssueReview}
        title={issueReview ? `Issue ${issueReview.kit.name}?` : 'Issue Kit'}
        size="md"
        footer={
          issueReview ? (
            <>
              <button
                type="button"
                onClick={() => void confirmIssueKit()}
                disabled={isIssuing || missingSizes.length > 0}
                className="btn-info btn-md inline-flex items-center gap-2 disabled:opacity-50"
              >
                {isIssuing && <RefreshCw className="h-4 w-4 animate-spin" />}
                {`Issue to ${issueReview.memberName}`}
              </button>
              <button
                type="button"
                onClick={closeIssueReview}
                className="text-theme-text-secondary hover:text-theme-text-primary mr-2 inline-flex items-center px-4 py-2 text-sm font-medium sm:mr-3"
              >
                Don&apos;t issue
              </button>
            </>
          ) : undefined
        }
      >
        {issueReview && (
          <div className="space-y-4">
            <p className="text-theme-text-secondary text-sm">
              {`Issue ${issueReview.plan.lines.length} item${issueReview.plan.lines.length !== 1 ? 's' : ''} from "${
                issueReview.kit.name
              }" to ${issueReview.memberName}.`}
            </p>
            <ul className="space-y-2">
              {issueReview.plan.lines.map((line) => {
                const fixed = line.variants.find((v) => v.item_id === line.selected_item_id);
                return (
                  <li
                    key={line.line_id}
                    className="bg-theme-surface-secondary/50 border-theme-surface-border space-y-2 rounded-lg border p-2.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-theme-text-primary flex items-center gap-2 text-sm">
                        <Package className="text-theme-text-muted h-4 w-4 shrink-0" />
                        {line.item_name}
                      </span>
                      <span className="text-theme-text-muted text-xs whitespace-nowrap">
                        Qty: {line.quantity}
                        {line.optional && ' · Optional'}
                      </span>
                    </div>
                    {!line.issuable ? (
                      <p className="text-theme-text-muted text-xs">
                        Not linked to a catalog item — hand it out separately.
                      </p>
                    ) : line.size_selectable ? (
                      <div>
                        <label
                          htmlFor={`issue-size-${line.line_id}`}
                          className="text-theme-text-muted mb-0.5 block text-xs"
                        >
                          Size for {line.item_name}
                        </label>
                        <select
                          id={`issue-size-${line.line_id}`}
                          value={sizeSelections[line.line_id] ?? ''}
                          onChange={(e) => setSizeSelections((prev) => ({ ...prev, [line.line_id]: e.target.value }))}
                          className={inputClass + ' text-sm'}
                        >
                          {!sizeSelections[line.line_id] && <option value="">Choose a size…</option>}
                          {line.variants.map((variant) => (
                            <option key={variant.item_id} value={variant.item_id}>
                              {variant.label} ({variant.available} on hand)
                            </option>
                          ))}
                        </select>
                        <p className="text-theme-text-muted mt-1 text-xs">
                          {line.member_size
                            ? line.selected_item_id
                              ? `Member's size: ${line.member_size}`
                              : `Member's size ${line.member_size} is not stocked — choose one.`
                            : 'No size on file for this member — choose one.'}
                        </p>
                      </div>
                    ) : (
                      fixed &&
                      line.variants.length > 1 && (
                        <p className="text-theme-text-muted text-xs">Always issued as {fixed.label}</p>
                      )
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </Modal>
    </div>
  );
};

export default EquipmentKitsPage;
