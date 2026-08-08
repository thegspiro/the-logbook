import React from 'react';
import { ChevronRight } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

interface DashboardCardHeaderProps {
  icon: LucideIcon;
  iconColor: string;
  title: string;
  badge?:
    | {
        content: React.ReactNode;
        ariaLabel: string;
        color: string;
      }
    | undefined;
  viewAllLabel?: string;
  viewAllColor?: string;
  onViewAll?: () => void;
  extraActions?: React.ReactNode | undefined;
  className?: string;
}

const DashboardCardHeader: React.FC<DashboardCardHeaderProps> = ({
  icon: Icon,
  iconColor,
  title,
  badge,
  viewAllLabel = 'View All',
  viewAllColor = 'text-red-700 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300',
  onViewAll,
  extraActions,
  className = 'flex items-center justify-between mb-4',
}) => {
  return (
    <div className={className}>
      <h3 className="text-theme-text-primary flex items-center space-x-2 text-lg font-bold">
        <Icon className={`h-5 w-5 ${iconColor}`} aria-hidden="true" />
        <span>{title}</span>
        {badge && (
          <span className={`${badge.color} rounded-full px-2 py-0.5 text-xs`} aria-label={badge.ariaLabel}>
            {badge.content}
          </span>
        )}
      </h3>
      <div className="flex items-center space-x-2">
        {extraActions}
        {onViewAll && (
          <button
            onClick={onViewAll}
            className={`${viewAllColor} flex items-center space-x-1 py-2 pl-2 text-sm max-md:min-h-[44px]`}
          >
            <span>{viewAllLabel}</span>
            <ChevronRight className="h-4 w-4" />
          </button>
        )}
      </div>
    </div>
  );
};

export default DashboardCardHeader;
