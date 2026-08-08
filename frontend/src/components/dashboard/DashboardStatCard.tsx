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

  return (
    <div
      className={`card p-3 sm:p-5 ${clickableClasses}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
      onKeyDown={
        onClick
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') onClick();
            }
          : undefined
      }
      aria-label={ariaLabel}
    >
      <div className="flex items-center justify-between">
        <div>
          <p className="text-theme-text-secondary text-xs font-medium uppercase">{label}</p>
          {loading ? (
            <div className="bg-theme-surface-hover mt-1 h-8 w-14 animate-pulse rounded-sm"></div>
          ) : (
            <p className={`${valueColor} mt-1 text-2xl font-bold`}>{value}</p>
          )}
        </div>
        <Icon className={`h-8 w-8 ${iconColor}`} aria-hidden="true" />
      </div>
      <p className="text-theme-text-muted mt-2 text-xs">{description}</p>
    </div>
  );
};

export default DashboardStatCard;
