/**
 * Store Catalog Tab
 *
 * Manage the sellable items members see when a window is open.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Archive, Loader2, Package, Pencil, Plus } from 'lucide-react';
import toast from 'react-hot-toast';
import { EmptyState } from '../../../components/ux/EmptyState';
import { formatCurrency } from '../../../utils/dateFormatting';
import { getErrorMessage } from '../../../utils/errorHandling';
import { storefrontService } from '../services/api';
import { StoreProductStatus, type StoreProduct } from '../types';
import { ProductFormModal } from './ProductFormModal';

/** Matches the Status choices in ProductFormModal. */
const PRODUCT_STATUS_LABELS: Record<string, string> = {
  [StoreProductStatus.DRAFT]: 'Draft',
  [StoreProductStatus.ACTIVE]: 'Active',
  [StoreProductStatus.ARCHIVED]: 'Archived',
};

export const StoreCatalogTab: React.FC = () => {
  const [products, setProducts] = useState<StoreProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [includeArchived, setIncludeArchived] = useState(false);
  const [editing, setEditing] = useState<StoreProduct | null>(null);
  const [formOpen, setFormOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setProducts(await storefrontService.getProducts({ includeArchived }));
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not load the catalog'));
    } finally {
      setLoading(false);
    }
  }, [includeArchived]);

  useEffect(() => {
    void load();
  }, [load]);

  const archive = useCallback(
    async (product: StoreProduct) => {
      try {
        await storefrontService.archiveProduct(product.id);
        toast.success(`${product.name} archived`);
        void load();
      } catch (err: unknown) {
        toast.error(getErrorMessage(err, 'Could not archive the item'));
      }
    },
    [load]
  );

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <label className="text-theme-text-secondary touch:min-h-11 flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="form-checkbox"
            checked={includeArchived}
            onChange={(e) => setIncludeArchived(e.target.checked)}
          />
          Show archived
        </label>
        <button
          type="button"
          className="btn-primary btn-md"
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
        >
          <Plus className="h-4 w-4" />
          New item
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12" role="status" aria-live="polite">
          <Loader2 className="text-theme-text-muted h-6 w-6 animate-spin" />
        </div>
      ) : products.length === 0 ? (
        <EmptyState
          icon={Package}
          title="No items yet"
          description="Add the shirts, coins, or gear the department sells to members."
        />
      ) : (
        <div className="card-grid gap-3">
          {products.map((product) => (
            <div key={product.id} className="card-secondary p-4">
              {/* The price sits on the badge row rather than beside the name:
                  beside it, its nowrap width cut long item names to two lines
                  on every three-column layout. */}
              <div className="min-w-0">
                <h3 className="text-theme-text-primary line-clamp-2 text-sm font-semibold">{product.name}</h3>
                <p className="text-theme-text-muted text-xs">
                  {product.category ?? 'Uncategorized'}
                  {product.sku ? ` · ${product.sku}` : ''}
                </p>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="text-theme-text-primary order-last ml-auto text-sm font-semibold whitespace-nowrap">
                  {formatCurrency(Number(product.price))}
                </span>
                <span className="badge bg-theme-surface-secondary text-theme-text-muted border-theme-surface-border border">
                  {PRODUCT_STATUS_LABELS[product.status] ?? product.status}
                </span>
                {product.variants.length > 0 && (
                  <span className="badge bg-theme-surface-secondary text-theme-text-muted border-theme-surface-border border">
                    {product.variants.length} {product.variants.length === 1 ? 'option' : 'options'}
                  </span>
                )}
                {product.trackStock && (
                  <span className="badge bg-theme-surface-secondary text-theme-text-muted border-theme-surface-border border">
                    {product.stockQuantity ?? 0} in stock
                  </span>
                )}
              </div>

              <div className="mt-4 flex gap-2">
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  onClick={() => {
                    setEditing(product);
                    setFormOpen(true);
                  }}
                >
                  <Pencil className="h-3.5 w-3.5" />
                  Edit
                </button>
                {product.status !== 'archived' && (
                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    onClick={() => {
                      void archive(product);
                    }}
                  >
                    <Archive className="h-3.5 w-3.5" />
                    Archive
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <ProductFormModal
        isOpen={formOpen}
        product={editing}
        onClose={() => setFormOpen(false)}
        onSaved={() => {
          void load();
        }}
      />
    </div>
  );
};
