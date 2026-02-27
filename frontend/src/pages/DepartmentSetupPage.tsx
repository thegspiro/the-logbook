/**
 * Department Setup Page
 *
 * Guides administrators through all post-onboarding configuration steps
 * needed for the application to run successfully. Shows completion status
 * for each step with direct links to the relevant pages.
 */

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CheckCircle2,
  Circle,
  Users,
  Shield,
  Truck,
  MapPin,
  Settings,
  Calendar,
  GraduationCap,
  ClipboardList,
  ListChecks,
  Package,
  Mail,
  UserPlus,
  Plug,
  ChevronRight,
  Loader2,
  Rocket,
  PartyPopper,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { organizationService } from '../services/api';
import type { SetupChecklistItem } from '../services/api';

const CATEGORY_STYLES: Record<string, { bgClass: string; textClass: string }> = {
  essential: { bgClass: 'bg-red-500/10', textClass: 'text-red-500' },
  scheduling: { bgClass: 'bg-violet-500/10', textClass: 'text-violet-500' },
  training: { bgClass: 'bg-blue-500/10', textClass: 'text-blue-500' },
  forms: { bgClass: 'bg-emerald-500/10', textClass: 'text-emerald-500' },
  notifications: { bgClass: 'bg-amber-500/10', textClass: 'text-amber-500' },
  prospective_members: { bgClass: 'bg-purple-500/10', textClass: 'text-purple-500' },
  inventory: { bgClass: 'bg-orange-500/10', textClass: 'text-orange-500' },
  integrations: { bgClass: 'bg-cyan-500/10', textClass: 'text-cyan-500' },
};

const ITEM_ICONS: Record<string, React.ReactNode> = {
  members: <Users className="w-5 h-5" />,
  roles: <Shield className="w-5 h-5" />,
  apparatus: <Truck className="w-5 h-5" />,
  locations: <MapPin className="w-5 h-5" />,
  org_settings: <Settings className="w-5 h-5" />,
  modules: <Package className="w-5 h-5" />,
  scheduling: <Calendar className="w-5 h-5" />,
  training: <GraduationCap className="w-5 h-5" />,
  training_requirements: <ListChecks className="w-5 h-5" />,
  inventory: <Package className="w-5 h-5" />,
  forms: <ClipboardList className="w-5 h-5" />,
  email: <Mail className="w-5 h-5" />,
  pipeline: <UserPlus className="w-5 h-5" />,
  integrations: <Plug className="w-5 h-5" />,
};

const DepartmentSetupPage: React.FC = () => {
  const navigate = useNavigate();
  const [items, setItems] = useState<SetupChecklistItem[]>([]);
  const [completedCount, setCompletedCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void loadChecklist();
  }, []);

  const loadChecklist = async () => {
    try {
      setLoading(true);
      const data = await organizationService.getSetupChecklist();
      setItems(data.items);
      setCompletedCount(data.completed_count);
      setTotalCount(data.total_count);
    } catch {
      toast.error('Failed to load setup checklist');
    } finally {
      setLoading(false);
    }
  };

  const progressPct = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;
  const allComplete = completedCount === totalCount && totalCount > 0;

  const essentialItems = items.filter(i => i.category === 'essential');
  const moduleItems = items.filter(i => i.category !== 'essential');

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 className="w-8 h-8 animate-spin text-theme-text-muted" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-xl bg-red-500/10 flex items-center justify-center">
            <Rocket className="w-5 h-5 text-red-500" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-theme-text-primary">Department Setup</h1>
            <p className="text-sm text-theme-text-muted">
              Complete these steps to get your department fully operational.
            </p>
          </div>
        </div>
      </div>

      {/* Progress Card */}
      <div className="bg-theme-surface border border-theme-surface-border rounded-xl p-6">
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-sm font-medium text-theme-text-secondary">Setup Progress</p>
            <p className="text-3xl font-bold text-theme-text-primary mt-1">
              {completedCount} <span className="text-lg font-normal text-theme-text-muted">/ {totalCount} steps</span>
            </p>
          </div>
          <div className="text-right">
            {allComplete ? (
              <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
                <PartyPopper className="w-6 h-6" />
                <span className="text-lg font-semibold">All Done!</span>
              </div>
            ) : (
              <span className="text-2xl font-bold text-theme-text-primary">{progressPct}%</span>
            )}
          </div>
        </div>
        <div className="w-full bg-theme-surface-secondary rounded-full h-3">
          <div
            className={`h-3 rounded-full transition-all duration-500 ${
              allComplete ? 'bg-emerald-500' : 'bg-red-500'
            }`}
            style={{ width: `${progressPct}%` }}
          />
        </div>
        {allComplete && (
          <p className="text-sm text-emerald-600 dark:text-emerald-400 mt-3">
            Your department is fully configured and ready to use. You can always return here to review your setup.
          </p>
        )}
      </div>

      {/* Essential Steps */}
      <div>
        <h2 className="text-lg font-semibold text-theme-text-primary mb-1">Essential Setup</h2>
        <p className="text-sm text-theme-text-muted mb-4">
          These steps are required for the core application to work properly.
        </p>
        <div className="space-y-3">
          {essentialItems.map(item => (
            <SetupCard key={item.key} item={item} onNavigate={(path) => navigate(path)} />
          ))}
        </div>
      </div>

      {/* Module-Specific Steps */}
      {moduleItems.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold text-theme-text-primary mb-1">Module Configuration</h2>
          <p className="text-sm text-theme-text-muted mb-4">
            Additional setup for the modules you've enabled. These are optional but recommended.
          </p>
          <div className="space-y-3">
            {moduleItems.map(item => (
              <SetupCard key={item.key} item={item} onNavigate={(path) => navigate(path)} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};


interface SetupCardProps {
  item: SetupChecklistItem;
  onNavigate: (path: string) => void;
}

const SetupCard: React.FC<SetupCardProps> = ({ item, onNavigate }) => {
  const styles = CATEGORY_STYLES[item.category] || CATEGORY_STYLES.essential;
  const icon = ITEM_ICONS[item.key] || <Circle className="w-5 h-5" />;

  return (
    <button
      onClick={() => onNavigate(item.path)}
      className="w-full bg-theme-surface border border-theme-surface-border rounded-xl p-4 hover:border-red-500/30 transition-all group text-left"
    >
      <div className="flex items-center gap-4">
        {/* Status Icon */}
        <div className="flex-shrink-0">
          {item.is_complete ? (
            <div className="w-10 h-10 rounded-full bg-emerald-500/10 flex items-center justify-center">
              <CheckCircle2 className="w-5 h-5 text-emerald-500" />
            </div>
          ) : (
            <div className={`w-10 h-10 rounded-full ${styles?.bgClass} flex items-center justify-center`}>
              <span className={styles?.textClass}>{icon}</span>
            </div>
          )}
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className={`text-sm font-semibold ${
              item.is_complete ? 'text-theme-text-muted line-through' : 'text-theme-text-primary'
            }`}>
              {item.title}
            </h3>
            {item.required && !item.is_complete && (
              <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-red-500/10 text-red-600 dark:text-red-400 uppercase">
                Required
              </span>
            )}
            {item.is_complete && item.count > 0 && item.key !== 'org_settings' && (
              <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                {item.count} {item.count === 1 ? 'item' : 'items'}
              </span>
            )}
          </div>
          <p className="text-xs text-theme-text-muted mt-0.5 line-clamp-1">{item.description}</p>
        </div>

        {/* Arrow */}
        <ChevronRight className="w-5 h-5 text-theme-text-muted group-hover:text-red-500 transition-colors flex-shrink-0" />
      </div>
    </button>
  );
};

export default DepartmentSetupPage;
