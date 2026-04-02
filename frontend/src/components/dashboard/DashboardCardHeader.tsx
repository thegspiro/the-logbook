import React from "react";
import { ChevronRight } from "lucide-react";
import type { LucideIcon } from "lucide-react";

interface DashboardCardHeaderProps {
  icon: LucideIcon;
  iconColor: string;
  title: string;
  badge?: {
    content: React.ReactNode;
    ariaLabel: string;
    color: string;
  } | undefined;
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
  viewAllLabel = "View All",
  viewAllColor = "text-red-700 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300",
  onViewAll,
  extraActions,
  className = "flex items-center justify-between mb-4",
}) => {
  return (
    <div className={className}>
      <h3 className="text-lg font-bold text-theme-text-primary flex items-center space-x-2">
        <Icon className={`w-5 h-5 ${iconColor}`} aria-hidden="true" />
        <span>{title}</span>
        {badge && (
          <span
            className={`${badge.color} text-xs px-2 py-0.5 rounded-full`}
            aria-label={badge.ariaLabel}
          >
            {badge.content}
          </span>
        )}
      </h3>
      <div className="flex items-center space-x-2">
        {extraActions}
        {onViewAll && (
          <button
            onClick={onViewAll}
            className={`${viewAllColor} text-sm flex items-center space-x-1 py-2 pl-2`}
          >
            <span>{viewAllLabel}</span>
            <ChevronRight className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
};

export default DashboardCardHeader;
