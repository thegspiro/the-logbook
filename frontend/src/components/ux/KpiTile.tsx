import React from 'react';
import { Link } from 'react-router';
import { ChevronRight } from 'lucide-react';

interface KpiTileProps {
  label: string;
  value: string;
  icon: React.ReactNode;
  /** Background for the icon's rounded square, e.g. `bg-green-100 dark:bg-green-500/20`. */
  iconBgClass: string;
  /** When set, the whole tile links here and shows a chevron. */
  linkTo?: string;
}

/**
 * A headline number with its label and icon.
 *
 * The tile decides its own layout from its own width, not the screen's. Under
 * 13rem the icon stacks above the label and the chevron pins to the corner;
 * side by side, the icon and chevron left a label ~30px on a 320px phone and
 * ~57px in a four-column row beside the 1024px tablet sidebar, and words like
 * "Budgeted" were drawn across the chevron. A viewport breakpoint fixed the
 * phone and missed the tablet, because the sidebar, not the screen, decides
 * how wide a tile is. Finance and Grants each carried their own copy of the
 * cramped version, which is why this is shared.
 */
export const KpiTile: React.FC<KpiTileProps> = ({ label, value, icon, iconBgClass, linkTo }) => {
  const content = (
    <div className="card @container relative p-4 transition-shadow hover:shadow-md">
      <div
        className="flex flex-col items-start gap-2 @[13rem]:flex-row @[13rem]:items-center @[13rem]:gap-3"
        data-testid="kpi-tile-layout"
      >
        <div className={`rounded-lg p-2 ${iconBgClass}`}>{icon}</div>
        <div className="min-w-0 flex-1">
          <p className="text-theme-text-secondary text-sm leading-snug">{label}</p>
          <p className="text-theme-text-primary text-xl font-bold break-words">{value}</p>
        </div>
        {linkTo && (
          <ChevronRight
            className="text-theme-text-secondary absolute top-4 right-4 h-4 w-4 shrink-0 @[13rem]:static"
            aria-hidden="true"
            data-testid="kpi-tile-chevron"
          />
        )}
      </div>
    </div>
  );

  return linkTo ? <Link to={linkTo}>{content}</Link> : content;
};
