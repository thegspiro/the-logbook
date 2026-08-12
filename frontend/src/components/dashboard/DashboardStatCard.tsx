import React from 'react';
import type { LucideIcon } from 'lucide-react';

interface DashboardStatCardProps {
  label: string;
  value: React.ReactNode;
  icon: LucideIcon;
  iconColor: string;
  description: React.ReactNode;
  loading: boolean;
  onClick?: () => void;
  hoverClass?: string;
  valueColor?: string;
  ariaLabel?: string;
}

const DashboardStatCard: React.FC<DashboardStatCardProps> = ({
  label,
  value,
  icon: Icon,
  iconColor,
  description,
  loading,
  onClick,
  hoverClass = 'hover:border-red-500/50',
  valueColor = 'text-theme-text-primary',
  ariaLabel,
}) => {
  const clickableClasses = onClick ? `cursor-pointer ${hoverClass} transition-colors` : '';
  const content = (
    <>
      <div className="flex items-start justify-between gap-2 sm:items-center">
        <div className="min-w-0">
          <p className="text-theme-text-secondary text-xs leading-tight font-medium uppercase">{label}</p>
          {loading ? (
            <div className="bg-theme-surface-hover mt-1 h-8 w-14 animate-pulse rounded-sm"></div>
          ) : (
            <p className={`${valueColor} mt-1 text-xl font-bold sm:text-2xl`}>{value}</p>
          )}
        </div>
        <Icon className={`h-6 w-6 shrink-0 sm:h-8 sm:w-8 ${iconColor}`} aria-hidden="true" />
      </div>
      <p className="text-theme-text-muted sr-only mt-2 text-xs sm:not-sr-only">{description}</p>
    </>
  );

  if (onClick) {
    return (
      <button
        type="button"
        className={`card w-full p-3 text-left sm:p-5 ${clickableClasses}`}
        onClick={onClick}
        aria-label={ariaLabel}
      >
        {content}
      </button>
    );
  }

  return <div className="card p-3 sm:p-5">{content}</div>;
};

export default DashboardStatCard;
