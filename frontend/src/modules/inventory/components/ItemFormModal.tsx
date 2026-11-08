/**
 * ItemFormModal — Reusable add/edit modal for inventory items.
 * Extracted so it can be used from both the items list page and the item detail page.
 *
 * When creating a new uniform or PPE item, a "Generate Sizes & Styles" toggle
 * lets the user pick multiple standard sizes and garment styles.  The backend
 * then creates one pool item per combination and groups them under a variant group.
 */
import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import toast from 'react-hot-toast';
import { ChevronUp, ChevronDown } from 'lucide-react';
import { inventoryService } from '../../../services/api';
import { getErrorMessage } from '../../../utils/errorHandling';
import { blankToNull, formatNameList, formCoercions, parseNameList } from '../../../utils/formValues';
import { ITEM_CONDITION_OPTIONS } from '../../../constants/enums';
import { formatNumber } from '../../../utils/dateFormatting';
import { Modal } from '../../../components/Modal';
import { FormField } from '../../../components/ux/FormField';
import { mapServerFieldErrors, type ServerFieldSpec } from '../../../utils/serverFieldErrors';
import { useDiscardGuard } from '../../../hooks/useDiscardGuard';
import type {
  InventoryItem,
  InventoryCategory,
  InventoryItemCreate,
  InventoryVendor,
  ItemVariantGroup,
  StorageAreaResponse,
  Location,
  SizeVariantCreate,
} from '../types';
import GarmentStyleAxisPicker from './GarmentStyleAxisPicker';
import {
  ITEM_TYPE_FIELDS,
  getItemTypeFromCategory,
  CUSTOM_SIZE_OPTION,
  SIZE_PICKER_GROUPS,
  GARMENT_STYLE_AXES,
  styleCombinationCount,
  standardSizeCode,
} from '../types';

interface FD {
  name: string;
  /** Comma-separated; becomes the item's `also_called` list. */
  also_called: string;
  description: string;
  category_id: string;
  tracking_type: string;
  serial_number: string;
  asset_tag: string;
  barcode: string;
  /** Chosen `StandardSize` code, or `CUSTOM_SIZE_OPTION` when `size` holds free text. */
  standard_size: string;
  /** Garment style attributes, flat across the four axes. */
  style_attributes: string[];
  /** Free text, and only ever read when `standard_size` is `CUSTOM_SIZE_OPTION`. */
  size: string;
  color: string;
  purchase_price: string;
  current_value: string;
  purchase_date: string;
  vendor: string;
  vendor_id: string;
  /** Existing variant group this item belongs to, or '' for none (W40-7). */
  variant_group_id: string;
  warranty_expiration: string;
  replacement_cost: string;
  location_id: string;
  storage_area_id: string;
  quantity: string;
  unit_of_measure: string;
  reorder_point: string;
  inspection_interval_days: string;
  condition: string;
  notes: string;
}

const EMPTY: FD = {
  name: '',
  also_called: '',
  description: '',
  category_id: '',
  tracking_type: 'individual',
  serial_number: '',
  asset_tag: '',
  barcode: '',
  standard_size: '',
  style_attributes: [],
  size: '',
  color: '',
  purchase_price: '',
  current_value: '',
  purchase_date: '',
  vendor: '',
  vendor_id: '',
  variant_group_id: '',
  warranty_expiration: '',
  replacement_cost: '',
  location_id: '',
  storage_area_id: '',
  quantity: '1',
  unit_of_measure: '',
  reorder_point: '',
  inspection_interval_days: '',
  condition: 'good',
  notes: '',
};

/** Fields a caller can pre-fill on a new item. Ignored when editing. */
export interface ItemFormDefaults {
  category_id?: string | undefined;
  location_id?: string | undefined;
  storage_area_id?: string | undefined;
  tracking_type?: string | undefined;
}

/**
 * Status an unsafe condition forces, mirroring
 * ``InventoryService._status_from_condition``. Returns nothing when the pair
 * is already legal, so the field stays absent from the payload and the backend
 * leaves the stored status alone.
 */
function statusForUnsafeCondition(currentStatus: string, condition: string): { status: string } | undefined {
  if (currentStatus !== 'available') return undefined;
  if (condition === 'poor' || condition === 'damaged' || condition === 'out_of_service') {
    return { status: 'in_maintenance' };
  }
  if (condition === 'retired') return { status: 'retired' };
  return undefined;
}

export interface ItemFormModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called after a save. A create passes the new items' ids (several for
   *  size variants) so the caller can offer to print their labels. */
  onSaved: (createdIds?: string[]) => void;
  categories: InventoryCategory[];
  locations: Location[];
  storageAreas: StorageAreaResponse[];
  editItem?: InventoryItem | null;
  /**
   * Pre-selected category/room/storage area for a new item. The setup workflow
   * has already asked for these a step earlier, so re-asking is the repetition
   * that makes adding the first item feel like paperwork.
   */
  defaults?: ItemFormDefaults;
}

/** All item types support size/style variant generation (uniforms, PPE,
 *  batteries, lights, etc. — any category where items come in different
 *  sizes, colors, or styles). */
/**
 * A save refused for an implausible date (owner decision 2026-11-01). The
 * server decides the rule (`app/utils/item_dates.py`); this only recognises
 * its refusal so it can be shown beside the dates rather than only in a toast,
 * since both fields sit in the collapsed Financial section.
 */
const DATE_REFUSAL = /^(Purchase date|Warranty expiration)\b/;

type ItemField = Exclude<keyof FD, 'style_attributes' | 'vendor_id'> | 'variant_colors';

/**
 * How the item endpoints' field names land on this form (forms review F-2), in
 * screen order. Lengths are the max_length of `InventoryItemCreate` /
 * `InventoryItemUpdate` (`EntityName` 255, `FreeText` 2000); the variant
 * generator's own names (`base_name`, `colors`, `quantity_per_variant`) land
 * on the fields they came from.
 */
const ITEM_FIELDS: Record<ItemField, ServerFieldSpec> = {
  name: { label: 'Name', maxLength: 255, api: ['name', 'base_name'] },
  also_called: { label: 'Also called' },
  description: { label: 'Description', maxLength: 2000 },
  category_id: { label: 'Category' },
  tracking_type: { label: 'Tracking type' },
  variant_group_id: { label: 'Variant group' },
  serial_number: { label: 'Serial number', maxLength: 255 },
  asset_tag: { label: 'Asset tag', maxLength: 255 },
  barcode: { label: 'Barcode', maxLength: 255 },
  variant_colors: { label: 'Colors', api: 'colors' },
  standard_size: { label: 'Size' },
  size: { label: 'Custom size', maxLength: 50 },
  color: { label: 'Color', maxLength: 50 },
  purchase_price: { label: 'Purchase price' },
  current_value: { label: 'Current value' },
  purchase_date: { label: 'Purchase date' },
  vendor: { label: 'Vendor name', maxLength: 255 },
  warranty_expiration: { label: 'Warranty expiration' },
  replacement_cost: { label: 'Replacement cost' },
  location_id: { label: 'Location' },
  storage_area_id: { label: 'Storage area' },
  quantity: { label: 'Quantity', api: ['quantity', 'quantity_per_variant'] },
  unit_of_measure: { label: 'Unit of measure', maxLength: 50 },
  reorder_point: { label: 'Reorder point' },
  inspection_interval_days: { label: 'Inspection interval' },
  condition: { label: 'Condition' },
  notes: { label: 'Notes', maxLength: 2000 },
};

/** The fields inside the collapsed Financial section, which must open for one to take focus. */
const FINANCIAL_FIELDS: readonly ItemField[] = [
  'purchase_price',
  'current_value',
  'purchase_date',
  'vendor',
  'warranty_expiration',
  'replacement_cost',
];

const ITEM_FIELD_IDS: Partial<Record<ItemField, string>> = {
  also_called: 'item-also-called',
  vendor: 'item-vendor-name',
};
const itemFieldId = (field: ItemField) => ITEM_FIELD_IDS[field] ?? `item-${field}`;

const VARIANT_ITEM_TYPES = new Set([
  'uniform',
  'ppe',
  'tool',
  'equipment',
  'vehicle',
  'electronics',
  'consumable',
  'other',
]);

const changeSnapshot = (form: FD, variants: boolean, sizes: string[], styles: string[], colors: string) =>
  JSON.stringify([form, variants, sizes, styles, colors]);

export const ItemFormModal: React.FC<ItemFormModalProps> = ({
  isOpen,
  onClose,
  onSaved,
  categories,
  locations,
  storageAreas,
  editItem,
  defaults,
}) => {
  const [f, setF] = useState<FD>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [showFin, setShowFin] = useState(false);
  const [dateError, setDateError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Partial<Record<ItemField, string>>>({});
  // Fetched here rather than threaded through every page that opens this modal.
  // A failed load leaves the picker empty and the free-text name still usable,
  // so it never blocks adding an item.
  const [vendors, setVendors] = useState<InventoryVendor[]>([]);
  // Same failure contract as vendors: an empty list leaves the item ungrouped
  // rather than blocking the save.
  const [variantGroups, setVariantGroups] = useState<ItemVariantGroup[]>([]);

  // Variant generation state (only for new items)
  const [generateVariants, setGenerateVariants] = useState(false);
  const [selectedSizes, setSelectedSizes] = useState<string[]>([]);
  const [selectedStyles, setSelectedStyles] = useState<string[]>([]);
  const [variantColors, setVariantColors] = useState('');
  // What the form held when it opened, so Escape, the X and Cancel can ask
  // before discarding anything typed since (forms review F-6).
  const [baseline, setBaseline] = useState('');
  const isDirty =
    baseline !== '' && changeSnapshot(f, generateVariants, selectedSizes, selectedStyles, variantColors) !== baseline;
  // An edit that saved all but a refused field tells the page only when the
  // form closes: the detail page passes the item it reloads as `editItem`, and
  // reloading while the form is open would reseed it and drop the flag.
  const savedExceptRefused = useRef(false);
  const closeForm = () => {
    if (savedExceptRefused.current) {
      savedExceptRefused.current = false;
      onSaved();
    }
    onClose();
  };
  const requestClose = useDiscardGuard({ isDirty, onClose: closeForm });

  // Read as primitives so an inline `defaults={{...}}` at the call site does
  // not re-run the reset effect on every parent render and wipe what is typed.
  const defaultCategoryId = defaults?.category_id ?? '';
  const defaultLocationId = defaults?.location_id ?? '';
  const defaultStorageAreaId = defaults?.storage_area_id ?? '';
  const defaultTrackingType = defaults?.tracking_type ?? '';

  useEffect(() => {
    if (!isOpen) return;
    void (async () => {
      try {
        // Inactive vendors are fetched too: an item linked to one before it was
        // deactivated must still show that name rather than reading as unlinked
        // while quietly submitting the old id. Only active ones are offered.
        setVendors(await inventoryService.getVendors({ active_only: false }));
      } catch {
        setVendors([]);
      }
    })();
    void (async () => {
      try {
        // Inactive groups too, for the same reason as vendors: an item already
        // in a deactivated group must show it rather than read as ungrouped.
        setVariantGroups(await inventoryService.getVariantGroups(false));
      } catch {
        setVariantGroups([]);
      }
    })();
  }, [isOpen]);

  useEffect(() => {
    let seeded: FD;
    if (editItem) {
      // The two size columns are one control here. Prefer the structured
      // `standard_size`, but fall back to the legacy free-text `size`: an
      // item generated by the variant builder stores the same code in both,
      // and one typed into the old free-text box has only the latter.
      // Anything outside the vocabulary (a boot width, a chest measurement)
      // resolves to '' and opens the picker on Custom with the text intact.
      const sizeCode = standardSizeCode(editItem.standard_size || editItem.size);
      seeded = {
        name: editItem.name,
        also_called: formatNameList(editItem.also_called),
        description: editItem.description ?? '',
        category_id: editItem.category_id ?? '',
        tracking_type: editItem.tracking_type,
        serial_number: editItem.serial_number ?? '',
        asset_tag: editItem.asset_tag ?? '',
        barcode: editItem.barcode ?? '',
        standard_size: sizeCode || (editItem.size ? CUSTOM_SIZE_OPTION : ''),
        // Fall back to the single `style` for a row written before the axes
        // existed, so opening one does not silently blank its style on save.
        style_attributes: editItem.style_attributes ?? (editItem.style ? [editItem.style] : []),
        size: sizeCode ? '' : (editItem.size ?? ''),
        color: editItem.color ?? '',
        purchase_price: editItem.purchase_price != null ? String(editItem.purchase_price) : '',
        current_value: editItem.current_value != null ? String(editItem.current_value) : '',
        purchase_date: editItem.purchase_date ?? '',
        vendor: editItem.vendor ?? '',
        vendor_id: editItem.vendor_id ?? '',
        variant_group_id: editItem.variant_group_id ?? '',
        warranty_expiration: editItem.warranty_expiration ?? '',
        replacement_cost: editItem.replacement_cost != null ? String(editItem.replacement_cost) : '',
        location_id: editItem.location_id ?? '',
        storage_area_id: editItem.storage_area_id ?? '',
        quantity: String(editItem.quantity),
        unit_of_measure: editItem.unit_of_measure ?? '',
        reorder_point: editItem.reorder_point != null ? String(editItem.reorder_point) : '',
        inspection_interval_days:
          editItem.inspection_interval_days != null ? String(editItem.inspection_interval_days) : '',
        condition: editItem.condition,
        notes: editItem.notes ?? '',
      };
    } else {
      seeded = {
        ...EMPTY,
        category_id: defaultCategoryId,
        location_id: defaultLocationId,
        storage_area_id: defaultStorageAreaId,
        tracking_type: defaultTrackingType || EMPTY.tracking_type,
      };
    }
    setF(seeded);
    setBaseline(changeSnapshot(seeded, false, [], [], ''));
    setShowFin(false);
    setDateError(null);
    setErrors({});
    setGenerateVariants(false);
    setSelectedSizes([]);
    setSelectedStyles([]);
    setVariantColors('');
  }, [editItem, isOpen, defaultCategoryId, defaultLocationId, defaultStorageAreaId, defaultTrackingType]);

  const cat = useMemo(() => categories.find((c) => c.id === f.category_id), [categories, f.category_id]);
  // The server refuses an item whose category requires these and lacks them
  // (`_validate_category_requirements`), so say so on the field rather than
  // in a 400 after Create.
  const serialRequired = cat?.requires_serial_number === true;
  const intervalRequired = cat?.requires_maintenance === true;
  const itemType = getItemTypeFromCategory(cat);
  const tf = ITEM_TYPE_FIELDS[itemType] ?? [];
  const areas = useMemo(
    () => (f.location_id ? storageAreas.filter((a) => a.location_id === f.location_id) : storageAreas),
    [storageAreas, f.location_id]
  );
  const has = (k: string) => tf.includes(k);
  const up = (k: keyof FD, v: string) => {
    setF((p) => ({ ...p, [k]: v }));
    if (k in ITEM_FIELDS) setErrors((p) => ({ ...p, [k]: undefined }));
  };

  const showErrors = (next: Partial<Record<ItemField, string>>) => {
    setErrors(next);
    if (next.warranty_expiration) setDateError(next.warranty_expiration);
    const first = (Object.keys(ITEM_FIELDS) as ItemField[]).find((k) => next[k]);
    if (!first) return;
    if (FINANCIAL_FIELDS.includes(first)) setShowFin(true);
    window.setTimeout(() => document.getElementById(itemFieldId(first))?.focus(), 0);
  };

  /** Puts a 422 on its fields; false when the error was not one, for the caller to report. */
  const flagServerErrors = (err: unknown): boolean => {
    const mapped = mapServerFieldErrors(err, ITEM_FIELDS);
    if (!mapped || Object.keys(mapped.fieldErrors).length === 0) return false;
    showErrors(mapped.fieldErrors);
    toast.error(mapped.unmatched.join(' ') || 'Fix the fields marked below, then save again.');
    return true;
  };
  const upDate = (k: 'purchase_date' | 'warranty_expiration', v: string) => {
    setDateError(null);
    up(k, v);
  };
  const dateErrorProps = dateError ? ({ 'aria-invalid': true, 'aria-describedby': 'item-date-error' } as const) : {};

  /** Whether the selected category supports variant generation */
  const supportsVariants = !editItem && VARIANT_ITEM_TYPES.has(itemType);
  // A lot-stocked item's real count is the sum of its in-date stock lots;
  // `quantity` is a best-effort mirror that the next delivery's carry-forward
  // overwrites. Matches MedicalItemFormModal: the form neither shows nor sends
  // it for such an item (MSUP-15).
  const isLotStocked = Boolean(editItem?.is_lot_stocked);

  // Turn off variant generation when category changes to one that doesn't support it
  useEffect(() => {
    if (!supportsVariants) setGenerateVariants(false);
  }, [supportsVariants]);

  const toggleSize = useCallback((value: string) => {
    setSelectedSizes((prev) => (prev.includes(value) ? prev.filter((s) => s !== value) : [...prev, value]));
  }, []);

  /** Single-item path: one value per axis, so picking a second in the same
   *  axis replaces the first rather than making the item two things at once —
   *  which the backend rejects with a 422 naming the axis. */
  const toggleItemStyle = useCallback((value: string) => {
    setF((prev) => {
      const axis = GARMENT_STYLE_AXES.find((a) => a.options.some((o) => o.value === value));
      const siblings = axis ? axis.options.map((o) => o.value) : [];
      const already = prev.style_attributes.includes(value);
      const kept = prev.style_attributes.filter((v) => !siblings.includes(v));
      return { ...prev, style_attributes: already ? kept : [...kept, value] };
    });
  }, []);

  const toggleStyle = useCallback((value: string) => {
    setSelectedStyles((prev) => (prev.includes(value) ? prev.filter((s) => s !== value) : [...prev, value]));
  }, []);

  /** Compute how many items will be generated for the preview label */
  const variantCount = useMemo(() => {
    if (!generateVariants || selectedSizes.length === 0) return 0;
    const colorList = variantColors
      .split(',')
      .map((c) => c.trim())
      .filter(Boolean);
    const colorMult = colorList.length || 1;
    // Across axes, not over the flat chip list: Long Sleeve + Men's + Polo is
    // one men's long-sleeve polo, which this used to report as three items.
    return selectedSizes.length * colorMult * styleCombinationCount(selectedStyles);
  }, [generateVariants, selectedSizes, selectedStyles, variantColors]);

  /**
   * After an edit that wrote everything but `refused`: the form stays open with
   * those fields flagged, and only they count as unsaved.
   */
  const keepRefused = (refused: Partial<Record<ItemField, string>>) => {
    showErrors(refused);
    const stored = (JSON.parse(baseline) as [FD])[0];
    const keys = (Object.keys(refused) as ItemField[]).filter((k): k is keyof FD & ItemField => k in stored);
    const kept = { ...f, ...Object.fromEntries(keys.map((k) => [k, stored[k]])) };
    setBaseline(changeSnapshot(kept, generateVariants, selectedSizes, selectedStyles, variantColors));
    const first = (Object.keys(ITEM_FIELDS) as ItemField[]).find((k) => refused[k]);
    if (first) {
      toast.error(
        `Item saved, except ${ITEM_FIELDS[first].label.toLowerCase()}: ${refused[first] ?? ''} Fix it and save again.`
      );
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const missing: Partial<Record<ItemField, string>> = {};
    if (!f.name.trim()) missing.name = 'Name is required.';
    if (!generateVariants && serialRequired && has('serial_number') && !f.serial_number.trim()) {
      missing.serial_number = 'This category needs a serial number.';
    }
    if (
      !generateVariants &&
      intervalRequired &&
      has('inspection_interval_days') &&
      !(Number(f.inspection_interval_days) >= 1)
    ) {
      missing.inspection_interval_days = 'This category needs an inspection interval of at least 1 day.';
    }
    // A new item is not created until every field is fixed; an edit saves
    // the rest and keeps the stored value of a refused one (below).
    if (!editItem && Object.keys(missing).length > 0) {
      showErrors(missing);
      return;
    }

    // Variant generation path
    if (generateVariants) {
      if (selectedSizes.length === 0) {
        toast.error('Select at least one size');
        return;
      }
      setSaving(true);
      try {
        const colorList = variantColors
          .split(',')
          .map((c) => c.trim())
          .filter(Boolean);
        const data: SizeVariantCreate = {
          base_name: f.name.trim(),
          sizes: selectedSizes,
          colors: colorList.length > 0 ? colorList : undefined,
          styles: selectedStyles.length > 0 ? selectedStyles : undefined,
          category_id: f.category_id || undefined,
          quantity_per_variant: f.quantity ? Number(f.quantity) : 0,
          tracking_type: f.tracking_type,
          replacement_cost: f.replacement_cost ? Number(f.replacement_cost) : undefined,
          purchase_price: f.purchase_price ? Number(f.purchase_price) : undefined,
          unit_of_measure: f.unit_of_measure.trim() || undefined,
          location_id: f.location_id || undefined,
          storage_area_id: f.storage_area_id || undefined,
          notes: f.notes.trim() || undefined,
          create_variant_group: true,
        };
        const result = await inventoryService.createSizeVariants(data);
        toast.success(`Created ${result.created_count} variant item${result.created_count !== 1 ? 's' : ''}`);
        onSaved(result.items.map((item) => item.id));
        onClose();
      } catch (err: unknown) {
        if (!flagServerErrors(err)) toast.error(getErrorMessage(err, 'Failed to create variants'));
      } finally {
        setSaving(false);
      }
      return;
    }

    // Standard single-item path
    setSaving(true);
    try {
      // Create and edit want opposite things from a blank box, so the mode
      // decides once here rather than per field. On create a blank is omitted so
      // `""` never reaches a Pydantic validator; on edit it goes as an explicit
      // null, because the backend dumps update payloads with `exclude_unset` and
      // an omitted key means "leave this alone" — the clear was being lost
      // behind a success toast (CLAUDE.md pitfall #1).
      const isEdit = Boolean(editItem);
      const { text, pick, num } = formCoercions(isEdit);

      // One control writes both size columns, so they cannot drift: the
      // chosen code goes to the structured `standard_size` and is mirrored
      // into the legacy `size`, which is what variant generation already
      // stores and what the list endpoint's size filter matches on. Editing
      // only `size` used to leave `standard_size` at its old value, which
      // the detail card, the variant capsules and the stock matrix all read.
      const isCustomSize = f.standard_size === CUSTOM_SIZE_OPTION;
      const sizeCode = isCustomSize ? '' : f.standard_size;
      const sizeText = isCustomSize ? f.size : sizeCode;

      const p: InventoryItemCreate = {
        name: f.name.trim(),
        // The list is sent whole on every save, and `[]` clears it on edit; on
        // create it is omitted when empty so no empty array reaches the API.
        also_called: isEdit || parseNameList(f.also_called).length ? parseNameList(f.also_called) : undefined,
        description: text(f.description),
        category_id: pick(f.category_id),
        serial_number: text(f.serial_number),
        asset_tag: text(f.asset_tag),
        barcode: text(f.barcode),
        size: text(sizeText),
        standard_size: pick(sizeCode),
        color: text(f.color),
        // An explicit null when every chip is cleared: update payloads are
        // dumped with `exclude_unset`, so omitting the key means "leave this
        // alone" and the clear would vanish behind a success toast
        // (CLAUDE.md pitfall #1). On create, omit instead.
        style_attributes: f.style_attributes.length ? f.style_attributes : isEdit ? null : undefined,
        purchase_price: num(f.purchase_price),
        current_value: num(f.current_value),
        purchase_date: pick(f.purchase_date),
        vendor: isEdit ? blankToNull(f.vendor) : f.vendor.trim() || undefined,
        vendor_id: f.vendor_id || (isEdit ? null : undefined),
        // W40-7: groups made on the Variant Groups page are filled from here.
        variant_group_id: pick(f.variant_group_id),
        warranty_expiration: pick(f.warranty_expiration),
        replacement_cost: num(f.replacement_cost),
        location_id: pick(f.location_id),
        storage_area_id: pick(f.storage_area_id),
        unit_of_measure: text(f.unit_of_measure),
        reorder_point: num(f.reorder_point),
        inspection_interval_days: num(f.inspection_interval_days),
        notes: text(f.notes),
        // Deliberately omitted rather than nulled on edit, all three for
        // backend reasons rather than schema ones: `condition` is a NOT NULL
        // enum column, and `update_item` builds `ItemCondition(value)` and
        // compares `quantity < 0` for a pool item — both raise on None.
        // `tracking_type` re-shapes how the item is counted and is not a field
        // a blank box should clear.
        tracking_type: f.tracking_type || undefined,
        quantity: isLotStocked ? undefined : f.quantity ? Number(f.quantity) : undefined,
        condition: f.condition || undefined,
        // This form has no Status control, but the backend requires an
        // AVAILABLE item to be in excellent/good/fair condition — so the last
        // four options of the Condition dropdown above produced a 400 naming a
        // field that does not exist anywhere on the screen, with no way to
        // satisfy it. Derive the status the same way the service's
        // _status_from_condition does.
        //
        // Only when the item would otherwise be AVAILABLE: an ASSIGNED item
        // recorded as damaged is a legal pair, and overriding it here would
        // quietly pull a member's issued gear out of service on an unrelated
        // edit.
        ...(statusForUnsafeCondition(editItem?.status ?? 'available', f.condition) ?? {}),
      };
      if (editItem) {
        // Single-save rule (owner, 2026-11-05): a value the record cannot hold
        // is not written — its key is left out, which the backend reads as
        // "leave alone", so the stored value is kept — the rest saves, and the
        // field stays flagged until it is fixed.
        let refused: Partial<Record<ItemField, string>> = missing;
        const send = (skip: Partial<Record<ItemField, string>>) => {
          const rest: Record<string, unknown> = { ...p };
          for (const key of Object.keys(skip)) delete rest[key];
          return inventoryService.updateItem(editItem.id, rest);
        };
        try {
          await send(refused);
        } catch (err) {
          const mapped = mapServerFieldErrors(err, ITEM_FIELDS);
          if (!mapped || Object.keys(mapped.fieldErrors).length === 0 || mapped.unmatched.length > 0) throw err;
          refused = { ...refused, ...mapped.fieldErrors };
          await send(refused);
        }
        if (Object.keys(refused).length > 0) {
          savedExceptRefused.current = true;
          keepRefused(refused);
          return;
        }
        savedExceptRefused.current = false;
        toast.success('Item updated');
        onSaved();
      } else {
        const created = await inventoryService.createItem(p);
        toast.success('Item created');
        onSaved([created.id]);
      }
      onClose();
    } catch (err: unknown) {
      // A refused field is flagged on that field rather than named in a toast
      // (forms review F-2); a new item is not created until it is fixed.
      if (flagServerErrors(err)) return;
      const message = getErrorMessage(err, 'Failed to save item');
      toast.error(message);
      if (DATE_REFUSAL.test(message)) {
        setDateError(message);
        setShowFin(true);
      }
    } finally {
      setSaving(false);
    }
  };

  const lbl = 'form-label';
  const inp = 'form-input';
  const chipBase =
    'inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium cursor-pointer select-none border transition-colors';
  const chipOn = 'bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/40';
  const chipOff =
    'bg-theme-surface-secondary text-theme-text-muted border-theme-surface-border hover:border-theme-text-muted';

  return (
    <Modal
      isOpen={isOpen}
      onClose={requestClose}
      title={editItem ? 'Edit Item' : 'Add Item'}
      size="lg"
      footer={
        <>
          <button type="submit" form="item-form" disabled={saving} className="btn-info btn-md ml-2">
            {saving
              ? 'Saving...'
              : editItem
                ? 'Update'
                : generateVariants
                  ? `Create ${variantCount} Item${variantCount === 1 ? '' : 's'}`
                  : 'Create'}
          </button>
          <button type="button" onClick={requestClose} className="btn-secondary btn-md">
            Cancel
          </button>
        </>
      }
    >
      <form id="item-form" onSubmit={(e) => void submit(e)} noValidate className="space-y-5">
        {/* Basic */}
        <fieldset>
          <legend className="text-theme-text-primary mb-2 text-sm font-semibold">Basic Info</legend>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FormField
              label="Name"
              required
              error={errors.name}
              id="item-name"
              maxLength={ITEM_FIELDS.name.maxLength}
              count={f.name.length}
              className="sm:col-span-2"
            >
              {(field) => (
                <input {...field} className={inp} value={f.name} onChange={(e) => up('name', e.target.value)} />
              )}
            </FormField>
            {/* SizeVariantCreate carries no alternate names, description,
                current value, purchase date, vendor or warranty, so those
                fields are offered only when one item is being saved. */}
            {!generateVariants && (
              <>
                <FormField
                  label="Also called"
                  error={errors.also_called}
                  id="item-also-called"
                  maxLength={ITEM_FIELDS.also_called.maxLength}
                  count={f.also_called.length}
                  className="sm:col-span-2"
                  hint={<>Other names for this item, separated by commas. Checklists use them to find it.</>}
                >
                  {(field) => (
                    <input
                      {...field}
                      className={inp}
                      value={f.also_called}
                      onChange={(e) => up('also_called', e.target.value)}
                      placeholder="e.g. BVM, Ambu bag"
                    />
                  )}
                </FormField>
                <FormField
                  label="Description"
                  error={errors.description}
                  id="item-description"
                  maxLength={ITEM_FIELDS.description.maxLength}
                  count={f.description.length}
                  className="sm:col-span-2"
                >
                  {(field) => (
                    <textarea
                      {...field}
                      className={inp}
                      rows={2}
                      value={f.description}
                      onChange={(e) => up('description', e.target.value)}
                    />
                  )}
                </FormField>
              </>
            )}
            <FormField label="Category" error={errors.category_id} id="item-category_id">
              {(field) => (
                <select
                  {...field}
                  className={inp}
                  value={f.category_id}
                  onChange={(e) => up('category_id', e.target.value)}
                >
                  <option value="">-- Select --</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              )}
            </FormField>
            <FormField
              label="Tracking Type"
              error={errors.tracking_type}
              id="item-tracking_type"
              hint={
                f.tracking_type === 'pool'
                  ? 'Pool: one record for a stock of identical items, such as gloves or T-shirts, counted by quantity and handed out a few at a time.'
                  : 'Individual: one record per physical item, such as a radio or an SCBA pack, tracked on its own, usually by serial number.'
              }
            >
              {(field) => (
                <select
                  {...field}
                  className={inp}
                  value={f.tracking_type}
                  onChange={(e) => up('tracking_type', e.target.value)}
                >
                  <option value="individual">Individual</option>
                  <option value="pool">Pool</option>
                </select>
              )}
            </FormField>
            {/* Generating variants creates and fills a group of its own. */}
            {!generateVariants && (
              <FormField
                label="Variant Group"
                error={errors.variant_group_id}
                id="item-variant_group_id"
                hint={
                  <>
                    Puts this item with the other sizes and styles of the same product. Groups are created on Variant
                    Groups.
                  </>
                }
              >
                {(field) => (
                  <select
                    {...field}
                    className={inp}
                    value={f.variant_group_id}
                    onChange={(e) => up('variant_group_id', e.target.value)}
                  >
                    <option value="">— None —</option>
                    {variantGroups
                      .filter((g) => g.active || g.id === f.variant_group_id)
                      .map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.name}
                          {g.active ? '' : ' (inactive)'}
                        </option>
                      ))}
                  </select>
                )}
              </FormField>
            )}
          </div>
        </fieldset>

        {/* Identity — barcode is always available; serial/asset tag depend on category */}
        {!generateVariants && (
          <fieldset>
            <legend className="text-theme-text-primary mb-2 text-sm font-semibold">Identity</legend>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {has('serial_number') && (
                <FormField
                  label="Serial #"
                  required={serialRequired}
                  error={errors.serial_number}
                  id="item-serial_number"
                  maxLength={ITEM_FIELDS.serial_number.maxLength}
                  count={f.serial_number.length}
                >
                  {(field) => (
                    <input
                      {...field}
                      className={inp}
                      value={f.serial_number}
                      onChange={(e) => up('serial_number', e.target.value)}
                    />
                  )}
                </FormField>
              )}
              {has('asset_tag') && (
                <FormField
                  label="Asset Tag"
                  error={errors.asset_tag}
                  id="item-asset_tag"
                  maxLength={ITEM_FIELDS.asset_tag.maxLength}
                  count={f.asset_tag.length}
                >
                  {(field) => (
                    <input
                      {...field}
                      className={inp}
                      value={f.asset_tag}
                      onChange={(e) => up('asset_tag', e.target.value)}
                    />
                  )}
                </FormField>
              )}
              <FormField
                label="Barcode"
                error={errors.barcode}
                id="item-barcode"
                maxLength={ITEM_FIELDS.barcode.maxLength}
                count={f.barcode.length}
              >
                {(field) => (
                  <input {...field} className={inp} value={f.barcode} onChange={(e) => up('barcode', e.target.value)} />
                )}
              </FormField>
            </div>
          </fieldset>
        )}

        {/* Generate Sizes & Styles toggle (new uniform/PPE items only) */}
        {supportsVariants && (
          <fieldset>
            {/* The row is the switch, not just the track beside it.
                The knob used to be an `::after` on a track that was never
                `relative`, so it positioned against the 44px label instead of
                the 20px track and floated above it — the visible defect. The
                shared toggle-track/knob utilities fix that, but the shared
                SettingsToggle button is only 24px tall, and the old markup met
                the 44px touch minimum through the <label> wrapping its
                checkbox. `mobile-create-edit.spec.ts` measures a button's own
                box (its label exception is for checkbox/radio only), so the
                whole row carries role="switch" and the 44px: the target is the
                text as well as the track, which is the easier thing to hit. */}
            <button
              type="button"
              role="switch"
              aria-checked={generateVariants}
              onClick={() => setGenerateVariants(!generateVariants)}
              className="mb-2 flex min-h-[44px] w-full items-center gap-2 text-left"
            >
              <span
                aria-hidden="true"
                className={`toggle-track-sm ${generateVariants ? 'bg-blue-600' : 'bg-theme-surface-border'}`}
              >
                <span className={`toggle-knob-sm ${generateVariants ? 'translate-x-6' : 'translate-x-1'}`} />
              </span>
              <span className="text-theme-text-primary text-sm font-semibold">Generate Sizes &amp; Styles</span>
            </button>
            {generateVariants && (
              <p className="text-theme-text-muted mb-3 text-xs">
                Pick the sizes and styles below. Each style row describes a different property of the same garment, so
                one pick per row creates one item; picking two in a row creates one item for each.
              </p>
            )}
          </fieldset>
        )}

        {/* Variant size/style selectors */}
        {generateVariants && (
          <fieldset className="space-y-4">
            {/* Sizes — a toggle-button group, so it is labelled as a group
                rather than with a <label> that names no single control. */}
            <div>
              <span className={lbl} id="item-sizes-label">
                Sizes *
              </span>
              {/* Grouped like the style axes below, and for more than symmetry:
                  the flat list was the letter sizes only, so a department
                  stocking boots 8-13 or trousers in waist 30-40 had no way to
                  generate them even though the API always accepted them. It
                  also drops the "Custom" chip, which produced an item named
                  "... - Custom" with nowhere to say what the custom size was. */}
              <div className="mt-1 space-y-2">
                {SIZE_PICKER_GROUPS.map((group) => (
                  <div key={group.label}>
                    <span
                      className="text-theme-text-muted text-xs font-medium"
                      id={`item-size-${group.label.replace(/\W+/g, '-').toLowerCase()}-label`}
                    >
                      {group.label}
                    </span>
                    <div
                      className="mt-1 flex flex-wrap gap-1.5"
                      role="group"
                      aria-labelledby={`item-size-${group.label.replace(/\W+/g, '-').toLowerCase()}-label`}
                    >
                      {group.options.map((o) => (
                        <button
                          key={o.value}
                          type="button"
                          className={`${chipBase} ${selectedSizes.includes(o.value) ? chipOn : chipOff}`}
                          onClick={() => toggleSize(o.value)}
                        >
                          {o.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
              {selectedSizes.length > 0 && (
                <p className="text-theme-text-muted mt-1 text-xs">
                  {selectedSizes.length} size{selectedSizes.length !== 1 ? 's' : ''} selected
                </p>
              )}
            </div>

            {/* Styles — one labelled group per axis. A flat row of ten chips
                read as ten alternatives and hid the rule that a sleeve, a fit
                and a neckline describe one garment rather than three. */}
            <div className="space-y-3">
              <span className={lbl}>Styles</span>
              <GarmentStyleAxisPicker selected={selectedStyles} onToggle={toggleStyle} idPrefix="item-style" />
            </div>

            {/* Colors (comma-separated text) */}
            <FormField label="Colors" error={errors.variant_colors} id="item-variant_colors">
              {(field) => (
                <input
                  {...field}
                  className={inp}
                  value={variantColors}
                  onChange={(e) => {
                    setVariantColors(e.target.value);
                    setErrors(({ variant_colors: _cleared, ...rest }) => rest);
                  }}
                  placeholder="e.g. Navy, White, Red (comma-separated, optional)"
                />
              )}
            </FormField>

            {/* Preview */}
            {variantCount > 0 && (
              <div className="border-theme-surface-border bg-theme-surface-secondary/50 rounded-lg border p-3">
                <p className="text-theme-text-primary text-sm font-medium">
                  {variantCount} item{variantCount !== 1 ? 's' : ''} will be created
                </p>
                <p className="text-theme-text-muted mt-0.5 text-xs">
                  {selectedSizes.length} size{selectedSizes.length !== 1 ? 's' : ''}
                  {GARMENT_STYLE_AXES.map((axis) => {
                    const n = selectedStyles.filter((v) => axis.options.some((o) => o.value === v)).length;
                    return n > 1 ? ` × ${n} ${axis.label.toLowerCase()} options` : '';
                  }).join('')}
                  {(() => {
                    const n = variantColors.split(',').filter((c) => c.trim()).length;
                    return n > 0 ? ` × ${n} color${n !== 1 ? 's' : ''}` : '';
                  })()}
                </p>
              </div>
            )}
          </fieldset>
        )}

        {/* Physical — only when NOT generating variants */}
        {!generateVariants && (has('size') || has('color')) && (
          <fieldset>
            <legend className="text-theme-text-primary mb-2 text-sm font-semibold">Physical</legend>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {has('size') && (
                <div>
                  <label className={lbl} htmlFor="item-standard_size">
                    Size
                  </label>
                  <select
                    id="item-standard_size"
                    aria-invalid={errors.standard_size ? true : undefined}
                    aria-describedby={errors.standard_size ? 'item-standard_size-error' : undefined}
                    className={inp}
                    value={f.standard_size}
                    onChange={(e) => up('standard_size', e.target.value)}
                  >
                    <option value="">-- Select --</option>
                    {SIZE_PICKER_GROUPS.map((g) => (
                      <optgroup key={g.label} label={g.label}>
                        {g.options.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                    <option value={CUSTOM_SIZE_OPTION}>Custom...</option>
                  </select>
                  {errors.standard_size && (
                    <p id="item-standard_size-error" className="mt-1 text-sm text-red-800 dark:text-red-300">
                      {errors.standard_size}
                    </p>
                  )}
                  {f.standard_size === CUSTOM_SIZE_OPTION && (
                    <FormField
                      label="Custom size"
                      error={errors.size}
                      id="item-size"
                      className="mt-2"
                      maxLength={ITEM_FIELDS.size.maxLength}
                      count={f.size.length}
                    >
                      {(field) => (
                        <input
                          {...field}
                          className={inp}
                          value={f.size}
                          onChange={(e) => up('size', e.target.value)}
                          placeholder="e.g. 10.5 EE"
                        />
                      )}
                    </FormField>
                  )}
                </div>
              )}
              {has('color') && (
                <FormField
                  label="Color"
                  error={errors.color}
                  id="item-color"
                  maxLength={ITEM_FIELDS.color.maxLength}
                  count={f.color.length}
                >
                  {(field) => (
                    <input {...field} className={inp} value={f.color} onChange={(e) => up('color', e.target.value)} />
                  )}
                </FormField>
              )}
            </div>
            {/* Style, on the single-item path. The generator could write a
                men's long-sleeve polo and nothing could then correct it: this
                form had no style control at all, so a mis-picked chip meant
                the item was stuck with it, and renaming only changed the label
                while the catalog kept grouping on the columns. */}
            {has('style') && (
              <div className="mt-3">
                <span className={lbl}>Style</span>
                <GarmentStyleAxisPicker
                  selected={f.style_attributes}
                  onToggle={toggleItemStyle}
                  idPrefix="item-physical-style"
                />
              </div>
            )}
          </fieldset>
        )}

        {/* Financial (collapsible) */}
        <fieldset>
          <button
            type="button"
            className="text-theme-text-primary mb-2 flex min-h-[44px] items-center gap-1 text-sm font-semibold"
            onClick={() => setShowFin(!showFin)}
          >
            Financial {showFin ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
          {showFin && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FormField label="Purchase Price" error={errors.purchase_price} id="item-purchase_price">
                {(field) => (
                  <input
                    {...field}
                    type="number"
                    step="0.01"
                    className={inp}
                    value={f.purchase_price}
                    onChange={(e) => up('purchase_price', e.target.value)}
                  />
                )}
              </FormField>
              {!generateVariants && (
                <>
                  <FormField label="Current Value" error={errors.current_value} id="item-current_value">
                    {(field) => (
                      <input
                        {...field}
                        type="number"
                        step="0.01"
                        className={inp}
                        value={f.current_value}
                        onChange={(e) => up('current_value', e.target.value)}
                      />
                    )}
                  </FormField>
                  <FormField label="Purchase Date" error={errors.purchase_date} id="item-purchase_date">
                    {(field) => (
                      <input
                        {...field}
                        type="date"
                        className={inp}
                        value={f.purchase_date}
                        onChange={(e) => upDate('purchase_date', e.target.value)}
                        {...dateErrorProps}
                      />
                    )}
                  </FormField>
                  <div>
                    <label className={lbl} htmlFor="item-vendor">
                      Vendor
                    </label>
                    <select
                      id="item-vendor"
                      className={inp}
                      value={f.vendor_id}
                      onChange={(e) => {
                        const id = e.target.value;
                        // Linking wins over the typed-in name: keeping both would
                        // leave two answers to "who did we buy this from".
                        setF((p) => ({ ...p, vendor_id: id, vendor: id ? '' : p.vendor }));
                      }}
                    >
                      <option value="">— Not linked —</option>
                      {vendors
                        .filter((v) => v.is_active || v.id === f.vendor_id)
                        .map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.name}
                            {v.is_active ? '' : ' (inactive)'}
                          </option>
                        ))}
                    </select>
                    {!f.vendor_id && (
                      <FormField
                        label="Vendor name (not on file)"
                        error={errors.vendor}
                        id="item-vendor-name"
                        className="mt-2"
                        maxLength={ITEM_FIELDS.vendor.maxLength}
                        count={f.vendor.length}
                      >
                        {(field) => (
                          <input
                            {...field}
                            className={inp}
                            value={f.vendor}
                            onChange={(e) => up('vendor', e.target.value)}
                            placeholder="Or type a name not on file"
                          />
                        )}
                      </FormField>
                    )}
                  </div>
                  <div>
                    <label className={lbl} htmlFor="item-warranty_expiration">
                      Warranty Expiration
                    </label>
                    <input
                      id="item-warranty_expiration"
                      type="date"
                      className={inp}
                      value={f.warranty_expiration}
                      onChange={(e) => upDate('warranty_expiration', e.target.value)}
                      {...dateErrorProps}
                    />
                    {dateError && (
                      <p id="item-date-error" role="alert" className="mt-1 text-sm text-red-800 dark:text-red-300">
                        {dateError}
                      </p>
                    )}
                  </div>
                </>
              )}
              <FormField label="Replacement Cost" error={errors.replacement_cost} id="item-replacement_cost">
                {(field) => (
                  <input
                    {...field}
                    type="number"
                    step="0.01"
                    className={inp}
                    value={f.replacement_cost}
                    onChange={(e) => up('replacement_cost', e.target.value)}
                  />
                )}
              </FormField>
            </div>
          )}
        </fieldset>

        {/* Location */}
        <fieldset>
          <legend className="text-theme-text-primary mb-2 text-sm font-semibold">Location</legend>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <FormField label="Facility / Room" error={errors.location_id} id="item-location_id">
              {(field) => (
                <select
                  {...field}
                  className={inp}
                  value={f.location_id}
                  onChange={(e) => {
                    up('location_id', e.target.value);
                    up('storage_area_id', '');
                  }}
                >
                  <option value="">-- Select --</option>
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              )}
            </FormField>
            <FormField label="Storage Area" error={errors.storage_area_id} id="item-storage_area_id">
              {(field) => (
                <select
                  {...field}
                  className={inp}
                  value={f.storage_area_id}
                  onChange={(e) => up('storage_area_id', e.target.value)}
                >
                  <option value="">-- Select --</option>
                  {areas.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                      {a.label ? ` (${a.label})` : ''}
                    </option>
                  ))}
                </select>
              )}
            </FormField>
          </div>
        </fieldset>

        {/* Quantity (pool or variant generation) */}
        {(f.tracking_type === 'pool' || generateVariants) && (
          <fieldset>
            <legend className="text-theme-text-primary mb-2 text-sm font-semibold">
              {generateVariants ? 'Quantity Per Variant' : 'Quantity & Reorder'}
            </legend>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                {isLotStocked ? (
                  <>
                    <span className={lbl}>Quantity</span>
                    {/* The field would write `quantity`, a column no lot backs;
                        an admin "correcting" it to the lot total changes nothing
                        a reader trusts and is overwritten by the next delivery. */}
                    <p className="text-theme-text-muted border-theme-surface-border rounded-md border border-dashed px-3 py-2 text-sm">
                      {formatNumber(editItem?.lot_stock ?? 0)} from stock lots — adjust by receiving a delivery or
                      editing the item&apos;s lots.
                    </p>
                  </>
                ) : (
                  <FormField
                    label={generateVariants ? 'Starting Quantity (each)' : 'Quantity'}
                    error={errors.quantity}
                    id="item-quantity"
                  >
                    {(field) => (
                      <input
                        {...field}
                        type="number"
                        inputMode="numeric"
                        min="0"
                        className={inp}
                        value={f.quantity}
                        onChange={(e) => up('quantity', e.target.value)}
                      />
                    )}
                  </FormField>
                )}
              </div>
              <FormField
                label="Unit of Measure"
                error={errors.unit_of_measure}
                id="item-unit_of_measure"
                maxLength={ITEM_FIELDS.unit_of_measure.maxLength}
                count={f.unit_of_measure.length}
              >
                {(field) => (
                  <input
                    {...field}
                    className={inp}
                    placeholder="e.g. pairs, boxes"
                    value={f.unit_of_measure}
                    onChange={(e) => up('unit_of_measure', e.target.value)}
                  />
                )}
              </FormField>
              {!generateVariants && (
                <FormField
                  label="Reorder Point"
                  error={errors.reorder_point}
                  id="item-reorder_point"
                  hint="Leave empty to disable item-level alerts"
                >
                  {(field) => (
                    <input
                      {...field}
                      type="number"
                      inputMode="numeric"
                      min="0"
                      className={inp}
                      value={f.reorder_point}
                      onChange={(e) => up('reorder_point', e.target.value)}
                      placeholder="Alert when qty falls to this level"
                    />
                  )}
                </FormField>
              )}
            </div>
          </fieldset>
        )}

        {/* Maintenance */}
        {!generateVariants && has('inspection_interval_days') && (
          <fieldset>
            <legend className="text-theme-text-primary mb-2 text-sm font-semibold">Maintenance</legend>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FormField
                label="Inspection Interval (days)"
                required={intervalRequired}
                error={errors.inspection_interval_days}
                id="item-inspection_interval_days"
              >
                {(field) => (
                  <input
                    {...field}
                    type="number"
                    min={intervalRequired ? '1' : '0'}
                    className={inp}
                    value={f.inspection_interval_days}
                    onChange={(e) => up('inspection_interval_days', e.target.value)}
                  />
                )}
              </FormField>
              <FormField label="Condition" error={errors.condition} id="item-condition">
                {(field) => (
                  <select
                    {...field}
                    className={inp}
                    value={f.condition}
                    onChange={(e) => up('condition', e.target.value)}
                  >
                    {/* Retiring is the dedicated Retire action's job alone --
                      the backend rejects a status/condition pair of retired
                      through this generic PATCH path, so offering it here
                      would deterministically 400 on save. */}
                    {ITEM_CONDITION_OPTIONS.filter((c) => c.value !== 'retired').map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                )}
              </FormField>
            </div>
          </fieldset>
        )}

        {/* Notes */}
        <fieldset>
          <FormField
            label="Notes"
            error={errors.notes}
            id="item-notes"
            maxLength={ITEM_FIELDS.notes.maxLength}
            count={f.notes.length}
          >
            {(field) => (
              <textarea
                {...field}
                className={inp}
                rows={2}
                value={f.notes}
                onChange={(e) => up('notes', e.target.value)}
              />
            )}
          </FormField>
        </fieldset>
      </form>
    </Modal>
  );
};
