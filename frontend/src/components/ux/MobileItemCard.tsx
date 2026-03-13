/**
 * MobileItemCard
 *
 * A responsive card component that replaces table rows on small screens.
 * Designed for touch-friendly inventory management on mobile and tablet.
 */

import React from 'react';
import {
  Pencil,
  Copy,
  Send,
  FileX,
  Archive,
  ChevronRight,
} from 'lucide-react';

interface MobileItemCardProps {
  /** Primary display name */
  name: string;
  /** Status badge text */
  status: string;
  /** Tailwind classes for the status badge */
  statusStyle: string;
  /** Condition text (e.g., "good", "fair") */
  condition?: string | undefined;
  /** Tailwind class for condition text color */
  conditionColor?: string | undefined;
  /** Category name */
  category?: string | undefined;
  /** Serial number */
  serialNumber?: string | undefined;
  /** Barcode value */
  barcode?: string | undefined;
  /** Asset tag */
  assetTag?: string | undefined;
  /** Size label */
  size?: string | undefined;
  /** Color label */
  color?: string | undefined;
  /** Location string */
  location?: string | undefined;
  /** Manufacturer + model */
  manufacturer?: string | undefined;
  /** Item quantity */
  quantity?: number | undefined;
  /** Cost/price display string */
  cost?: string | undefined;
  /** Whether the item is selected (checkbox) */
  selected?: boolean | undefined;
  /** Called when selection changes */
  onSelect?: (() => void) | undefined;
  /** Called when the card is tapped to view details */
  onTap?: (() => void) | undefined;
  /** Whether to show management actions */
  showActions?: boolean | undefined;
  /** Edit handler */
  onEdit?: (() => void) | undefined;
  /** Duplicate handler */
  onDuplicate?: (() => void) | undefined;
  /** Issue from pool handler */
  onIssue?: (() => void) | undefined;
  /** Write-off handler */
  onWriteOff?: (() => void) | undefined;
  /** Retire handler */
  onRetire?: (() => void) | undefined;
  /** Whether the item can be issued (pool tracking, not retired) */
  canIssue?: boolean | undefined;
  /** Whether the item can be retired/written off */
  canRetire?: boolean | undefined;
}

export const MobileItemCard: React.FC<MobileItemCardProps> = ({
  name,
  status,
  statusStyle,
  condition,
  conditionColor,
  category,
  serialNumber,
  barcode,
  assetTag,
  size,
  color,
  location,
  manufacturer,
  quantity,
  cost,
  selected,
  onSelect,
  onTap,
  showActions,
  onEdit,
  onDuplicate,
  onIssue,
  onWriteOff,
  onRetire,
  canIssue,
  canRetire,
}) => {
  return (
    <div
      className="bg-theme-surface rounded-lg border border-theme-surface-border p-4 shadow-sm active:bg-theme-surface-hover active:scale-[0.99] hover:shadow-md transition-all duration-200"
      role="button"
      tabIndex={0}
      onClick={onTap}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onTap?.();
        }
      }}
    >
      <div className="flex items-start gap-3">
        {/* Checkbox */}
        {onSelect && (
          <div className="pt-0.5" onClick={(e) => e.stopPropagation()}>
            <input
              type="checkbox"
              checked={selected}
              onChange={onSelect}
              className="h-5 w-5 rounded-sm border-theme-input-border text-emerald-600 focus:ring-emerald-500"
              aria-label={`Select ${name}`}
            />
          </div>
        )}

        {/* Content */}
        <div className="flex-1 min-w-0">
          {/* Top row: name + status */}
          <div className="flex items-start justify-between gap-2 mb-2">
            <div className="min-w-0">
              <h3 className="text-theme-text-primary font-medium text-sm truncate">{name}</h3>
              {manufacturer && (
                <p className="text-theme-text-muted text-xs truncate">{manufacturer}</p>
              )}
            </div>
            <span className={`px-2 py-0.5 text-[11px] font-semibold rounded-sm border whitespace-nowrap shrink-0 ${statusStyle}`}>
              {status.replace('_', ' ').toUpperCase()}
            </span>
          </div>

          {/* Metadata tags */}
          <div className="flex flex-wrap gap-1.5 mb-2">
            {category && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-sm text-xs bg-theme-surface-secondary text-theme-text-muted">
                {category}
              </span>
            )}
            {size && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-sm text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300">
                {size}
              </span>
            )}
            {color && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-sm text-xs font-medium bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300">
                {color}
              </span>
            )}
            {condition && (
              <span className={`inline-flex items-center px-2 py-0.5 rounded-sm text-xs capitalize ${conditionColor ?? 'text-theme-text-muted'}`}>
                {condition.replace('_', ' ')}
              </span>
            )}
            {quantity != null && quantity > 1 && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-sm text-xs bg-theme-surface-secondary text-theme-text-primary font-medium">
                Qty: {quantity}
              </span>
            )}
          </div>

          {/* Detail row */}
          <div className="flex items-center justify-between gap-2">
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-theme-text-muted min-w-0">
              {barcode && <span className="font-mono truncate">BC: {barcode}</span>}
              {serialNumber && <span className="font-mono truncate">SN: {serialNumber}</span>}
              {assetTag && <span className="font-mono truncate">Tag: {assetTag}</span>}
              {location && <span className="truncate">{location}</span>}
              {cost && <span className="font-medium text-theme-text-secondary">{cost}</span>}
            </div>
            <ChevronRight className="w-4 h-4 text-theme-text-muted shrink-0" aria-hidden="true" />
          </div>
        </div>
      </div>

      {/* Action buttons */}
      {showActions && (
        <div
          className="flex items-center gap-1 mt-3 pt-3 border-t border-theme-surface-border"
          onClick={(e) => e.stopPropagation()}
        >
          {onEdit && (
            <button
              onClick={onEdit}
              className="flex items-center gap-1.5 px-3 py-2 text-xs text-theme-text-secondary hover:text-emerald-500 hover:bg-emerald-500/10 rounded-lg transition-colors"
              title="Edit"
            >
              <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
              Edit
            </button>
          )}
          {onDuplicate && (
            <button
              onClick={onDuplicate}
              className="flex items-center gap-1.5 px-3 py-2 text-xs text-theme-text-secondary hover:text-blue-500 hover:bg-blue-500/10 rounded-lg transition-colors"
              title="Duplicate"
            >
              <Copy className="w-3.5 h-3.5" aria-hidden="true" />
              Copy
            </button>
          )}
          {canIssue && onIssue && (
            <button
              onClick={onIssue}
              className="flex items-center gap-1.5 px-3 py-2 text-xs text-theme-text-secondary hover:text-purple-500 hover:bg-purple-500/10 rounded-lg transition-colors"
              title="Issue from pool"
            >
              <Send className="w-3.5 h-3.5" aria-hidden="true" />
              Issue
            </button>
          )}
          {canRetire && onWriteOff && (
            <button
              onClick={onWriteOff}
              className="flex items-center gap-1.5 px-3 py-2 text-xs text-theme-text-secondary hover:text-orange-500 hover:bg-orange-500/10 rounded-lg transition-colors"
              title="Write off"
            >
              <FileX className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          )}
          {canRetire && onRetire && (
            <button
              onClick={onRetire}
              className="flex items-center gap-1.5 px-3 py-2 text-xs text-theme-text-secondary hover:text-red-500 hover:bg-red-500/10 rounded-lg transition-colors"
              title="Retire"
            >
              <Archive className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          )}
        </div>
      )}
    </div>
  );
};
