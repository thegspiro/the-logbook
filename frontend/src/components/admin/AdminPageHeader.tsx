import React from 'react';
import { Breadcrumbs, type BreadcrumbItem } from '../ux/Breadcrumbs';

/**
 * The header every administration page draws: trail, eyebrow, title,
 * description, and the page's controls on the right.
 *
 * `AdminHubFrame` renders this for the six hubs, and every other page in the
 * Administration menu renders it directly, so an officer moving from Audit Log
 * to Training Administration to Waivers reads the same shape in the same
 * place. It is the header only: a page that is not a hub has no metrics row or
 * attention queue to draw beneath it.
 *
 * Deliberately no icon beside the title. The hubs never carried one, the
 * standalone pages each picked a different icon and a different red, and the
 * eyebrow already says what kind of page this is.
 */

interface AdminPageHeaderProps {
  title: string;
  /** One line under the title. A ReactNode so a page can append a timestamp or a link. */
  description?: React.ReactNode;
  /** Small caps line above the title. */
  eyebrow?: string | undefined;
  /**
   * Overrides the trail. Omit it and the trail is generated from the URL and
   * ends at the parent — the `<h1>` directly below already names this page,
   * and a crumb repeating it is the same name read twice.
   */
  breadcrumbs?: BreadcrumbItem[] | undefined;
  /**
   * The administration hub this page belongs to when the URL does not sit
   * under it (`/members/scan` belongs to `/members/admin`). See `Breadcrumbs`.
   */
  underHub?: string | undefined;
  /** The page's controls, right-aligned beside the title; drop beneath it when both do not fit. */
  actions?: React.ReactNode;
  /** Extra classes on the outer column — spacing below the header, chiefly. */
  className?: string;
}

export const AdminPageHeader: React.FC<AdminPageHeaderProps> = ({
  title,
  description,
  eyebrow = 'Administration',
  breadcrumbs,
  underHub,
  actions,
  className = '',
}) => (
  <div className={`flex flex-col gap-5 ${className}`}>
    {/* `mb-0` because the column's own gap already spaces the trail. */}
    <Breadcrumbs items={breadcrumbs} underHub={underHub} className="mb-0" omitCurrentPage />

    {/* The title's 16rem basis is what makes this row wrap. With `flex-1`
        (basis 0) the title claimed no width of its own, so the row never
        wrapped and non-shrinking actions crushed it — at 390px the <h1> was
        53px wide and the actions sat over the eyebrow. Now the actions drop
        beneath the title as soon as both cannot fit. */}
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0 grow basis-64">
        <p className="text-theme-text-muted text-[11px] font-bold tracking-[0.16em] uppercase">{eyebrow}</p>
        <h1 className="text-theme-text-primary mt-0.5 text-2xl font-bold">{title}</h1>
        {description ? <div className="text-theme-text-muted mt-1 text-sm">{description}</div> : null}
      </div>

      {actions ? <div className="flex max-w-full shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  </div>
);

export default AdminPageHeader;
