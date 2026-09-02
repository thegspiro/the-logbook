import React from 'react';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  EyeOff,
  Link2,
  Mail,
  Pencil,
  Phone,
  Trash2,
  UserPlus,
} from 'lucide-react';

import type { OrgChartNode } from '../types/orgChart';

export interface SeatCardHandlers {
  onAddReport: (node: OrgChartNode) => void;
  onEdit: (node: OrgChartNode) => void;
  onDelete: (node: OrgChartNode) => void;
  /** -1 moves the seat one place earlier among its siblings, 1 one place later. */
  onNudge: (node: OrgChartNode, direction: -1 | 1) => void;
}

interface OrgChartSeatCardProps extends SeatCardHandlers {
  node: OrgChartNode;
  canManage: boolean;
  isSaving: boolean;
  /** False for the first/last of its siblings, which disables the nudge. */
  canMoveUp: boolean;
  canMoveDown: boolean;
  /**
   * The diagram lays siblings out left to right and has far less room per box,
   * so the same seat renders more tightly and its nudge arrows point sideways —
   * an up arrow on a horizontal row would be pointing at the wrong axis.
   */
  variant: 'diagram' | 'outline';
  /** Extra classes for the box itself — the outline's depth stripe rides here
      rather than on a wrapper, so it follows the card's rounded corners. */
  className?: string | undefined;
}

/**
 * One seat, as both views draw it.
 *
 * Shared rather than written twice because everything that makes a seat
 * *correct* — the vacancy wording, the "follows a role" badge, which actions a
 * manager gets — has to agree between the diagram and the outline. Only the
 * density and the direction of the reorder arrows differ, and those are the
 * two things the variant controls.
 */
export const OrgChartSeatCard: React.FC<OrgChartSeatCardProps> = ({
  node,
  canManage,
  isSaving,
  canMoveUp,
  canMoveDown,
  variant,
  className = '',
  onAddReport,
  onEdit,
  onDelete,
  onNudge,
}) => {
  const compact = variant === 'diagram';
  const PreviousIcon = compact ? ChevronLeft : ChevronUp;
  const NextIcon = compact ? ChevronRight : ChevronDown;
  const previousLabel = compact ? 'left' : 'up';
  const nextLabel = compact ? 'right' : 'down';

  return (
    <div
      className={`card ${compact ? 'w-60 p-3 text-left' : 'space-y-2 p-4'} ${
        node.isPublished ? '' : 'opacity-75'
      } ${className}`}
    >
      <div className={compact ? 'space-y-2' : 'flex flex-wrap items-start justify-between gap-3'}>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className={`text-theme-text-primary font-semibold ${compact ? 'text-sm' : 'text-base'}`}>
              {node.title}
            </h3>
            {node.isPublished ? null : (
              <span
                className="badge border-theme-surface-border text-theme-text-muted flex items-center gap-1 border"
                title="Only people who can manage the chart see this position"
              >
                <EyeOff className="h-3 w-3" aria-hidden="true" /> Hidden
              </span>
            )}
          </div>

          {node.holders.length === 0 ? (
            <p className="text-theme-text-muted mt-1 text-sm italic">Vacant</p>
          ) : (
            // A list, not a comma-joined line: a seat held by five trustees is
            // five people, and running their names together makes the box read
            // as one person with a very long name.
            <ul className={`mt-1 space-y-0.5 ${compact ? 'text-xs' : 'text-sm'}`}>
              {node.holders.map((holder, index) => (
                <li key={holder.userId ?? `${holder.name}-${index}`} className="text-theme-text-primary">
                  {holder.name}
                </li>
              ))}
            </ul>
          )}

          {node.linkLabel ? (
            // Says where the names came from. A reader looking at a name the
            // chart did not choose deserves to know the roster is what put it
            // there — and that it will stay right without anyone's attention.
            <p className="text-theme-text-muted mt-1.5 flex items-center gap-1 text-xs">
              <Link2 className="h-3 w-3 shrink-0" aria-hidden="true" />
              <span>Linked to {node.linkLabel}</span>
            </p>
          ) : null}
        </div>

        {canManage ? (
          <div className={`flex flex-wrap gap-1 ${compact ? 'justify-start' : ''}`}>
            <button
              type="button"
              className={compact ? 'btn-icon-sm' : 'btn-icon'}
              onClick={() => onNudge(node, -1)}
              disabled={isSaving || !canMoveUp}
              aria-label={`Move ${node.title} ${previousLabel}`}
              title={`Move ${previousLabel}`}
            >
              <PreviousIcon className="h-4 w-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              className={compact ? 'btn-icon-sm' : 'btn-icon'}
              onClick={() => onNudge(node, 1)}
              disabled={isSaving || !canMoveDown}
              aria-label={`Move ${node.title} ${nextLabel}`}
              title={`Move ${nextLabel}`}
            >
              <NextIcon className="h-4 w-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              className={compact ? 'btn-icon-sm' : 'btn-icon'}
              onClick={() => onAddReport(node)}
              disabled={isSaving}
              aria-label={`Add a position reporting to ${node.title}`}
              title="Add a position reporting to this one"
            >
              <UserPlus className="h-4 w-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              className={compact ? 'btn-icon-sm' : 'btn-icon'}
              onClick={() => onEdit(node)}
              disabled={isSaving}
              aria-label={`Edit ${node.title}`}
              title="Edit"
            >
              <Pencil className="h-4 w-4" aria-hidden="true" />
            </button>
            <button
              type="button"
              className={compact ? 'btn-icon-sm' : 'btn-icon'}
              onClick={() => onDelete(node)}
              disabled={isSaving}
              aria-label={`Remove ${node.title}`}
              title="Remove"
            >
              <Trash2 className="h-4 w-4" aria-hidden="true" />
            </button>
          </div>
        ) : null}
      </div>

      {node.responsibility ? (
        // Clamped in the diagram, where a paragraph would stretch one box far
        // past its siblings and drag the whole row of connectors with it. The
        // full text is one click away in the outline, and in the tooltip.
        <p
          className={`text-theme-text-secondary ${compact ? 'mt-2 line-clamp-2 text-xs' : 'text-sm leading-6'}`}
          {...(compact ? { title: node.responsibility } : {})}
        >
          {node.responsibility}
        </p>
      ) : null}

      {node.contactEmail || node.contactPhone ? (
        // `mobile-touch-target`, not a bare inline link: a phone number on this
        // screen exists to be tapped from a phone, and a text-sm anchor is
        // about 20px tall — half the 44px minimum.
        <div className={`flex flex-wrap gap-x-4 ${compact ? 'mt-1 text-xs' : 'text-sm'}`}>
          {node.contactEmail ? (
            <a
              className="text-theme-accent-red mobile-touch-target justify-start gap-1.5"
              href={`mailto:${node.contactEmail}`}
            >
              <Mail className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="break-all">{node.contactEmail}</span>
            </a>
          ) : null}
          {node.contactPhone ? (
            <a
              className="text-theme-accent-red mobile-touch-target justify-start gap-1.5"
              href={`tel:${node.contactPhone}`}
            >
              <Phone className="h-4 w-4 shrink-0" aria-hidden="true" />
              {node.contactPhone}
            </a>
          ) : null}
        </div>
      ) : null}
    </div>
  );
};

export default OrgChartSeatCard;
