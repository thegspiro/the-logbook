/**
 * RequestEquipmentModal
 *
 * How a member asks the quartermaster for gear.
 *
 * The form this replaced was a type-ahead over the raw catalog, which failed
 * the two members it exists for. A member who does not know the department's
 * name for a thing typed "shirt" and got nothing, because the catalog calls it
 * "Long Sleeve"; a member who did know got seven near-identical rows, one per
 * stocked size, because sizes are separate catalog items. So: the list is
 * browsable with nothing typed, search runs against the category and
 * variant-group names as well as the item's own, sizes are collapsed behind
 * the product and asked for separately, and an out-of-stock size stays
 * selectable — a request the department cannot fill today is exactly the
 * signal the quartermaster is missing.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Search, Loader2, ChevronLeft, PackageSearch, Ruler, PencilLine } from 'lucide-react';
import { inventoryService } from '../../../services/api';
import type { RequestableCategory, RequestableProduct, RequestableVariant } from '../types';
import { getErrorMessage } from '../../../utils/errorHandling';
import { Modal } from '../../../components/Modal';
import { EmptyState } from '../../../components/ux';
import toast from 'react-hot-toast';

interface RequestEquipmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called after a request is accepted, so the caller can refresh its lists. */
  onSubmitted: () => void;
}

/** Identity for a variant inside one product; `size` alone is not unique. */
const variantKey = (variant: RequestableVariant): string =>
  [variant.size ?? '', variant.color ?? '', variant.style ?? ''].join('|');

/** What a variant chip reads as: "L · Navy". */
const variantLabel = (variant: RequestableVariant): string =>
  [variant.size_label ?? variant.size, variant.color, variant.style?.replace(/_/g, ' ')]
    .filter((part): part is string => Boolean(part))
    .join(' · ') || 'Standard';

const availabilityNote = (product: RequestableProduct): string => {
  if (product.total_available > 0) {
    return `${product.total_available} on hand`;
  }
  return 'None on hand — you can still ask';
};

const MAX_QUANTITY = 99;

export const RequestEquipmentModal: React.FC<RequestEquipmentModalProps> = ({ isOpen, onClose, onSubmitted }) => {
  const [search, setSearch] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [products, setProducts] = useState<RequestableProduct[]>([]);
  const [categories, setCategories] = useState<RequestableCategory[]>([]);
  const [loading, setLoading] = useState(false);

  const [selected, setSelected] = useState<RequestableProduct | null>(null);
  const [selectedVariant, setSelectedVariant] = useState<string>('');
  const [freeText, setFreeText] = useState('');
  const [duration, setDuration] = useState<'temporary' | 'ongoing'>('temporary');
  const [quantity, setQuantity] = useState('1');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * Sequence number of the newest catalog request.
   *
   * The browse load fires the moment the modal opens and is not debounced, so
   * a member who types before it lands can have the newer filtered response
   * arrive first and then be overwritten by the older unfiltered one — a list
   * that no longer matches the box above it. The same crossing happens across
   * a close and reopen. Only the newest request is allowed to write state.
   */
  const loadSeq = useRef(0);

  const resetForm = useCallback(() => {
    setSearch('');
    setCategoryId('');
    setSelected(null);
    setSelectedVariant('');
    setFreeText('');
    setDuration('temporary');
    setQuantity('1');
    setReason('');
  }, []);

  const loadCatalog = useCallback(async (term: string, category: string) => {
    const seq = ++loadSeq.current;
    setLoading(true);
    try {
      const data = await inventoryService.getRequestableCatalog({
        search: term.trim() || undefined,
        category_id: category || undefined,
      });
      if (seq !== loadSeq.current) return;
      setProducts(data.products);
      setCategories(data.categories);
    } catch (err: unknown) {
      if (seq !== loadSeq.current) return;
      setProducts([]);
      toast.error(getErrorMessage(err, 'Failed to load the equipment catalog'));
    } finally {
      // Only the newest request owns the spinner; a superseded one clearing it
      // would report "done" while the current load is still in flight.
      if (seq === loadSeq.current) setLoading(false);
    }
  }, []);

  // Opening the modal loads the catalog unprompted: browsing is the point, and
  // a member who does not know what to type is the case this exists for.
  useEffect(() => {
    if (!isOpen) return;
    resetForm();
    void loadCatalog('', '');
  }, [isOpen, loadCatalog, resetForm]);

  useEffect(() => {
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, []);

  const runSearch = (term: string, category: string) => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => void loadCatalog(term, category), 250);
  };

  const handleSearchChange = (value: string) => {
    setSearch(value);
    runSearch(value, categoryId);
  };

  const handleCategoryChange = (value: string) => {
    setCategoryId(value);
    runSearch(search, value);
  };

  /**
   * The size options offered for the selected product.
   *
   * When the member's own size on file is not stocked at all, it is appended
   * as an option with no catalog row behind it. Dropping it would leave the
   * member choosing a size that does not fit, and would lose the one piece of
   * information the quartermaster cannot get any other way.
   */
  const sizeOptions = useMemo((): RequestableVariant[] => {
    if (!selected) return [];
    const stocked = selected.variants;
    if (selected.member_size && !selected.suggested_size) {
      return [
        ...stocked,
        { item_id: null, size: selected.member_size, size_label: selected.member_size, available: 0 },
      ];
    }
    return stocked;
  }, [selected]);

  const chooseProduct = (product: RequestableProduct) => {
    setSelected(product);
    setQuantity('1');
    if (!product.has_sizes) {
      setSelectedVariant(product.variants[0] ? variantKey(product.variants[0]) : '');
      return;
    }
    const suggested = product.suggested_size
      ? product.variants.find((variant) => variant.size === product.suggested_size)
      : undefined;
    if (suggested) {
      setSelectedVariant(variantKey(suggested));
      return;
    }
    // The member's own size outranks the sole stocked one: a department that
    // stocks only Medium has not thereby made everyone a Medium, and defaulting
    // to it is how a request for the wrong size gets filed under their name.
    if (product.member_size) {
      setSelectedVariant([product.member_size, '', ''].join('|'));
      return;
    }
    setSelectedVariant(product.variants.length === 1 && product.variants[0] ? variantKey(product.variants[0]) : '');
  };

  const activeVariant = sizeOptions.find((variant) => variantKey(variant) === selectedVariant);

  const isPool = selected?.tracking_type === 'pool';
  const parsedQuantity = Number(quantity);
  const quantityValid = Number.isInteger(parsedQuantity) && parsedQuantity >= 1 && parsedQuantity <= MAX_QUANTITY;

  const handleSubmit = async () => {
    const itemName = selected ? selected.name : freeText.trim();
    if (!itemName) {
      toast.error('Choose an item, or describe what you need');
      return;
    }
    if (selected?.has_sizes && !activeVariant) {
      toast.error('Choose a size');
      return;
    }
    if (isPool && !quantityValid) {
      toast.error(`Enter a quantity between 1 and ${MAX_QUANTITY}`);
      return;
    }

    setSubmitting(true);
    try {
      await inventoryService.createEquipmentRequest({
        item_name: itemName,
        // `|| undefined` throughout: this is a create payload, so a blank has
        // to be omitted rather than sent as an empty string.
        item_id: activeVariant?.item_id || undefined,
        category_id: selected?.category_id || undefined,
        quantity: isPool ? parsedQuantity : 1,
        requested_duration: duration,
        requested_size: activeVariant?.size || undefined,
        reason: reason.trim() || undefined,
      });
      toast.success('Equipment request submitted');
      onSubmitted();
      onClose();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to submit request'));
    } finally {
      setSubmitting(false);
    }
  };

  const chipClass = (active: boolean): string =>
    `mobile-touch-target rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
      active
        ? 'border-transparent bg-red-800 text-white'
        : 'border-theme-surface-border text-theme-text-secondary hover:bg-theme-surface-secondary'
    }`;

  /* Duration and reason belong to the request, not to the catalog branch of
     the form. Rendering them only alongside a chosen product meant a free-text
     request — gear the department does not carry, the case most likely to be
     an ongoing need — could only ever be submitted as "temporary". */
  const durationField = (
    <div>
      <label className="form-label" htmlFor="requested-duration">
        How long do you need it?
      </label>
      <select
        id="requested-duration"
        value={duration}
        onChange={(e) => setDuration(e.target.value as 'temporary' | 'ongoing')}
        className="form-input"
      >
        <option value="temporary">Temporary — I expect to return it</option>
        <option value="ongoing">Ongoing — I need it as regular assigned gear</option>
      </select>
      <p className="text-theme-text-muted mt-1 text-xs">
        The quartermaster decides the final issue method based on availability and department policy.
      </p>
    </div>
  );

  const reasonField = (
    <div>
      <label className="form-label" htmlFor="request-reason">
        Reason (optional)
      </label>
      <textarea
        id="request-reason"
        rows={3}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        className="form-input"
        placeholder="Why do you need this item?"
      />
    </div>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Request Equipment"
      size="lg"
      // The actions go in Modal's own footer rather than inside the body: the
      // size chips make this panel taller than a landscape phone, and an
      // action row that scrolls with the content is one a member has to go
      // looking for.
      footer={
        <>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={submitting || (!selected && !freeText.trim())}
            className="btn-info btn-md disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? 'Submitting…' : 'Submit Request'}
          </button>
          <button type="button" onClick={onClose} className="btn-secondary btn-md">
            Cancel
          </button>
        </>
      }
    >
      {selected === null ? (
        <div className="space-y-4">
          <div>
            <label className="form-label" htmlFor="request-catalog-search">
              What do you need?
            </label>
            <div className="relative">
              <Search className="text-theme-text-muted absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2" />
              <input
                id="request-catalog-search"
                type="text"
                value={search}
                onChange={(e) => handleSearchChange(e.target.value)}
                placeholder="Try what it is — shirt, boots, radio"
                className="form-input pl-9"
              />
              {loading && (
                <Loader2 className="text-theme-text-muted absolute top-1/2 right-3 h-4 w-4 -translate-y-1/2 animate-spin" />
              )}
            </div>
            <p className="text-theme-text-muted mt-1 text-xs">
              Search matches the category as well as the item name, so you do not need the department&rsquo;s exact
              wording. Leave it blank to browse everything.
            </p>
          </div>

          {categories.length > 0 && (
            <div className="hscroll flex gap-2 pb-1">
              <button type="button" onClick={() => handleCategoryChange('')} className={chipClass(categoryId === '')}>
                All
              </button>
              {categories.map((category) => (
                <button
                  key={category.id}
                  type="button"
                  onClick={() => handleCategoryChange(category.id)}
                  className={chipClass(categoryId === category.id)}
                >
                  {category.name}
                </button>
              ))}
            </div>
          )}

          <div className="divide-theme-surface-border border-theme-surface-border max-h-72 divide-y overflow-y-auto rounded-md border">
            {products.length === 0 && !loading && (
              <EmptyState
                icon={PackageSearch}
                title="Nothing matches that"
                description="Try a broader word, pick a category above, or describe what you need below."
              />
            )}
            {products.map((product) => (
              <button
                key={product.key}
                type="button"
                onClick={() => chooseProduct(product)}
                className="hover:bg-theme-surface-secondary/50 w-full px-3 py-3 text-left transition-colors"
              >
                <span className="text-theme-text-primary block text-sm font-medium">{product.name}</span>
                <span className="text-theme-text-muted mt-0.5 block text-xs">
                  {[product.category_name, availabilityNote(product)].filter(Boolean).join(' · ')}
                  {product.has_sizes && ` · ${product.variants.length} sizes`}
                </span>
              </button>
            ))}
          </div>

          <div className="border-theme-surface-border space-y-2 border-t pt-4">
            <label className="form-label" htmlFor="request-free-text">
              <PencilLine className="mr-1 inline h-3.5 w-3.5" />
              Not listed? Describe what you need
            </label>
            <input
              id="request-free-text"
              type="text"
              value={freeText}
              onChange={(e) => setFreeText(e.target.value)}
              placeholder="e.g. Wildland gloves, size L"
              className="form-input"
            />
            <p className="text-theme-text-muted text-xs">
              The quartermaster sees these too — it is how the department finds out what it is missing.
            </p>
            {freeText.trim() !== '' && (
              <div className="space-y-4 pt-2">
                {durationField}
                {reasonField}
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="bg-theme-surface-secondary/50 flex items-start justify-between gap-3 rounded-md p-3">
            <div className="min-w-0">
              <p className="text-theme-text-primary text-sm font-medium">{selected.name}</p>
              <p className="text-theme-text-muted text-xs">
                {[selected.category_name, availabilityNote(selected)].filter(Boolean).join(' · ')}
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                setSelected(null);
                setSelectedVariant('');
              }}
              className="text-theme-text-secondary hover:text-theme-text-primary mobile-touch-target inline-flex items-center gap-1 text-xs whitespace-nowrap"
            >
              <ChevronLeft className="h-3.5 w-3.5" /> Change
            </button>
          </div>

          {selected.has_sizes && (
            <div>
              <span className="form-label block" id="request-size-label">
                Size
              </span>
              <div className="flex flex-wrap gap-2" role="group" aria-labelledby="request-size-label">
                {sizeOptions.map((variant) => {
                  const key = variantKey(variant);
                  const stock = variant.available > 0 ? `${variant.available} on hand` : 'none on hand';
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setSelectedVariant(key)}
                      aria-pressed={selectedVariant === key}
                      // Spelled out rather than left to the concatenated text:
                      // the visible form collapses to "L· 3" for a screen
                      // reader, which reads as a size nobody stocks.
                      aria-label={`${variantLabel(variant)}, ${stock}`}
                      className={chipClass(selectedVariant === key)}
                    >
                      {variantLabel(variant)}
                      <span className={selectedVariant === key ? 'ml-1.5 opacity-80' : 'ml-1.5 opacity-70'}>
                        {variant.available > 0 ? `· ${variant.available}` : '· none on hand'}
                      </span>
                    </button>
                  );
                })}
              </div>
              {selected.member_size && (
                <p className="text-theme-text-muted mt-2 inline-flex items-center gap-1 text-xs">
                  <Ruler className="h-3.5 w-3.5" />
                  Your size on file: <span className="text-theme-text-primary font-medium">{selected.member_size}</span>
                  {!selected.suggested_size && ' — the department does not stock it, so it is offered above as a need.'}
                </p>
              )}
            </div>
          )}

          {durationField}

          {isPool && (
            <div>
              <label className="form-label" htmlFor="request-quantity">
                Quantity
              </label>
              <input
                id="request-quantity"
                type="number"
                min={1}
                max={MAX_QUANTITY}
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                className="form-input w-28"
              />
              {activeVariant && activeVariant.available < parsedQuantity && (
                <p className="text-theme-text-muted mt-1 text-xs">
                  More than is on hand. The request still goes through — the quartermaster will order or substitute.
                </p>
              )}
            </div>
          )}

          {reasonField}
        </div>
      )}
    </Modal>
  );
};

export default RequestEquipmentModal;
