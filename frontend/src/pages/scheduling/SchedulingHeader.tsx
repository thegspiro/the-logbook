import React from 'react';
import { ArrowLeft, Clock } from 'lucide-react';
import { Link } from 'react-router';
import { Breadcrumbs } from '../../components/ux/Breadcrumbs';

interface SchedulingHeaderProps {
  /**
   * The page's own name.
   *
   * Defaults to the module, which is right for the member-facing `/scheduling`
   * landing page and wrong everywhere else: every sub-page used to be headed
   * "Shift Scheduling" with its real name demoted to a prefix on the
   * description ("Templates · Define reusable…"), so the largest text on the
   * screen named the module and nothing named the page.
   */
  title?: string;
  actions?: React.ReactNode;
  backTo?: string;
  backLabel?: string;
  description?: string;
}

/** Consistent module identity for the scheduling landing page and its sub-pages. */
const SchedulingHeader: React.FC<SchedulingHeaderProps> = ({
  title = 'Shift Scheduling',
  actions,
  backTo,
  backLabel = 'Back to scheduling',
  description = 'Manage schedules, sign up for shifts, and handle trades',
}) => (
  <>
    {/* Kept alongside the back arrow rather than replacing it. The arrow is one
        44px target that always means "up one level"; the trail says where that
        level is and what lies above it, which an icon cannot. On `/scheduling`
        itself the trail is a single crumb and suppresses itself. */}
    <Breadcrumbs />
    <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
      <div className="flex items-center space-x-3">
        {backTo && (
          <Link
            to={backTo}
            className="text-theme-text-muted hover:bg-theme-surface-hover hover:text-theme-text-primary focus-visible:ring-theme-focus-ring flex min-h-11 min-w-11 items-center justify-center rounded-lg p-2 transition-colors focus-visible:ring-2 focus-visible:outline-none"
            aria-label={backLabel}
          >
            <ArrowLeft className="h-5 w-5" aria-hidden="true" />
          </Link>
        )}
        <div className="rounded-lg bg-red-800 p-2">
          <Clock className="h-6 w-6 text-white" aria-hidden="true" />
        </div>
        <div>
          <h1 className="text-theme-text-primary text-xl font-bold sm:text-2xl">{title}</h1>
          <p className="text-theme-text-muted text-sm">{description}</p>
        </div>
      </div>
      {actions}
    </div>
  </>
);

export default SchedulingHeader;
