/**
 * MobileItemCard
 *
 * A responsive card component that replaces table rows on small screens.
 * Designed for touch-friendly inventory management on mobile and tablet.
 */

import React from 'react';
import { Pencil, Copy, Send, FileX, Archive, ChevronRight } from 'lucide-react';

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
      className="bg-theme-surface border-theme-surface-border active:bg-theme-surface-hover rounded-lg border p-4 shadow-sm transition-all duration-200 hover:shadow-md active:scale-[0.99]"
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
              className="border-theme-input-border h-5 w-5 rounded-sm text-emerald-600 focus:ring-emerald-500"
              aria-label={`Select ${name}`}
            />
          </div>
        )}

        {/* Content */}
        <div className="min-w-0 flex-1">
          {/* Top row: name + status */}
          <div className="mb-2 flex items-start justify-between gap-2">
            <div className="min-w-0">
              <h3 className="text-theme-text-primary truncate text-sm font-medium">{name}</h3>
              {manufacturer && <p className="text-theme-text-muted truncate text-xs">{manufacturer}</p>}
            </div>
            <span
              className={`shrink-0 rounded-sm border px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap ${statusStyle}`}
            >
              {status.replace('_', ' ').toUpperCase()}
            </span>
          </div>

          {/* Metadata tags */}
          <div className="mb-2 flex flex-wrap gap-1.5">
            {category && (
              <span className="bg-theme-surface-secondary text-theme-text-muted inline-flex items-center rounded-sm px-2 py-0.5 text-xs">
                {category}
              </span>
            )}
            {size && (
              <span className="inline-flex items-center rounded-sm bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800 dark:bg-blue-900/40 dark:text-blue-300">
                {size}
              </span>
            )}
            {color && (
              <span className="inline-flex items-center rounded-sm bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-800 dark:bg-purple-900/40 dark:text-purple-300">
                {color}
              </span>
            )}
            {condition && (
              <span
                className={`inline-flex items-center rounded-sm px-2 py-0.5 text-xs capitalize ${conditionColor ?? 'text-theme-text-muted'}`}
              >
                {condition.replace('_', ' ')}
              </span>
            )}
            {quantity != null && quantity > 1 && (
              <span className="bg-theme-surface-secondary text-theme-text-primary inline-flex items-center rounded-sm px-2 py-0.5 text-xs font-medium">
                Qty: {quantity}
              </span>
            )}
          </div>

          {/* Detail row */}
          <div className="flex items-center justify-between gap-2">
            <div className="text-theme-text-muted flex min-w-0 flex-wrap gap-x-3 gap-y-0.5 text-xs">
              {barcode && <span className="truncate font-mono">BC: {barcode}</span>}
              {serialNumber && <span className="truncate font-mono">SN: {serialNumber}</span>}
              {assetTag && <span className="truncate font-mono">Tag: {assetTag}</span>}
              {location && <span className="truncate">{location}</span>}
              {cost && <span className="text-theme-text-secondary font-medium">{cost}</span>}
            </div>
            <ChevronRight className="text-theme-text-muted h-4 w-4 shrink-0" aria-hidden="true" />
          </div>
        </div>
      </div>

      {/* Action buttons */}
      {showActions && (
        <div
          className="border-theme-surface-border mt-3 flex items-center gap-1 border-t pt-3"
          onClick={(e) => e.stopPropagation()}
        >
          {onEdit && (
            <button
              onClick={onEdit}
              className="text-theme-text-secondary flex min-h-[44px] items-center gap-1.5 rounded-lg px-3 py-2.5 text-xs transition-colors hover:bg-emerald-500/10 hover:text-emerald-500"
              title="Edit"
            >
              <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
              Edit
            </button>
          )}
          {onDuplicate && (
            <button
              onClick={onDuplicate}
              className="text-theme-text-secondary flex min-h-[44px] items-center gap-1.5 rounded-lg px-3 py-2.5 text-xs transition-colors hover:bg-blue-500/10 hover:text-blue-500"
              title="Duplicate"
            >
              <Copy className="h-3.5 w-3.5" aria-hidden="true" />
              Copy
            </button>
          )}
          {canIssue && onIssue && (
            <button
              onClick={onIssue}
              className="text-theme-text-secondary flex min-h-[44px] items-center gap-1.5 rounded-lg px-3 py-2.5 text-xs transition-colors hover:bg-purple-500/10 hover:text-purple-500"
              title="Issue from pool"
            >
              <Send className="h-3.5 w-3.5" aria-hidden="true" />
              Issue
            </button>
          )}
          {canRetire && onWriteOff && (
            <button
              onClick={onWriteOff}
              className="text-theme-text-secondary flex min-h-[44px] items-center gap-1.5 rounded-lg px-3 py-2.5 text-xs transition-colors hover:bg-orange-500/10 hover:text-orange-500"
              title="Write off"
            >
              <FileX className="h-3.5 w-3.5" aria-hidden="true" />
              Write Off
            </button>
          )}
          {canRetire && onRetire && (
            <button
              onClick={onRetire}
              className="text-theme-text-secondary flex min-h-[44px] items-center gap-1.5 rounded-lg px-3 py-2.5 text-xs transition-colors hover:bg-red-500/10 hover:text-red-500"
              title="Retire"
            >
              <Archive className="h-3.5 w-3.5" aria-hidden="true" />
              Retire
            </button>
          )}
        </div>
      )}
    </div>
  );
};
