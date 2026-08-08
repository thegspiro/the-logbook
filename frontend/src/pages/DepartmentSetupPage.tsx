/**
 * Department Setup Page
 *
 * Guides administrators through all post-onboarding configuration steps
 * needed for the application to run successfully. Shows completion status
 * for each step with direct links to the relevant pages.
 */

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
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
  UserCheck,
  KeyRound,
  FileText,
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
  members: <Users className="h-5 w-5" />,
  members_signed_in: <UserCheck className="h-5 w-5" />,
  documents: <FileText className="h-5 w-5" />,
  events: <Calendar className="h-5 w-5" />,
  mfa: <KeyRound className="h-5 w-5" />,
  roles: <Shield className="h-5 w-5" />,
  apparatus: <Truck className="h-5 w-5" />,
  locations: <MapPin className="h-5 w-5" />,
  org_settings: <Settings className="h-5 w-5" />,
  modules: <Package className="h-5 w-5" />,
  scheduling: <Calendar className="h-5 w-5" />,
  training: <GraduationCap className="h-5 w-5" />,
  training_requirements: <ListChecks className="h-5 w-5" />,
  inventory: <Package className="h-5 w-5" />,
  forms: <ClipboardList className="h-5 w-5" />,
  email: <Mail className="h-5 w-5" />,
  pipeline: <UserPlus className="h-5 w-5" />,
  integrations: <Plug className="h-5 w-5" />,
};

const DepartmentSetupPage: React.FC = () => {
  const navigate = useNavigate();
  const [items, setItems] = useState<SetupChecklistItem[]>([]);
  const [completedCount, setCompletedCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [acknowledgingKey, setAcknowledgingKey] = useState<string | null>(null);

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

  const handleAcknowledge = async (item: SetupChecklistItem) => {
    setAcknowledgingKey(item.key);
    try {
      await organizationService.acknowledgeSetupChecklistItem(item.key, !item.is_complete);
      await loadChecklist();
      toast.success(item.is_complete ? `"${item.title}" reopened` : `"${item.title}" marked reviewed`);
    } catch {
      toast.error('Failed to update that step');
    } finally {
      setAcknowledgingKey(null);
    }
  };

  const progressPct = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;
  const allComplete = completedCount === totalCount && totalCount > 0;

  const essentialItems = items.filter((i) => i.category === 'essential');
  const moduleItems = items.filter((i) => i.category !== 'essential');

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24" role="status" aria-live="polite">
        <Loader2 className="text-theme-text-muted h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      {/* Header */}
      <div>
        <div className="mb-2 flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-red-500/10">
            <Rocket className="h-5 w-5 text-red-500" />
          </div>
          <div>
            <h1 className="text-theme-text-primary text-2xl font-bold">Department Setup</h1>
            <p className="text-theme-text-muted text-sm">
              Complete these steps to get your department fully operational.
            </p>
          </div>
        </div>
      </div>

      {/* Progress Card */}
      <div className="bg-theme-surface border-theme-surface-border rounded-xl border p-6">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <p className="text-theme-text-secondary text-sm font-medium">Setup Progress</p>
            <p className="text-theme-text-primary mt-1 text-3xl font-bold">
              {completedCount} <span className="text-theme-text-muted text-lg font-normal">/ {totalCount} steps</span>
            </p>
          </div>
          <div className="text-right">
            {allComplete ? (
              <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
                <PartyPopper className="h-6 w-6" />
                <span className="text-lg font-semibold">All Done!</span>
              </div>
            ) : (
              <span className="text-theme-text-primary text-2xl font-bold">{progressPct}%</span>
            )}
          </div>
        </div>
        <div className="bg-theme-surface-secondary h-3 w-full rounded-full">
          <div
            className={`h-3 rounded-full transition-all duration-500 ${allComplete ? 'bg-emerald-500' : 'bg-red-500'}`}
            style={{ width: `${progressPct}%` }}
          />
        </div>
        {allComplete && (
          <p className="mt-3 text-sm text-emerald-600 dark:text-emerald-400">
            Your department is fully configured and ready to use. You can always return here to review your setup.
          </p>
        )}
      </div>

      {/* Essential Steps */}
      <div>
        <h2 className="text-theme-text-primary mb-1 text-lg font-semibold">Essential Setup</h2>
        <p className="text-theme-text-muted mb-4 text-sm">
          These steps are required for the core application to work properly.
        </p>
        <div className="space-y-3">
          {essentialItems.map((item) => (
            <SetupCard
              key={item.key}
              item={item}
              onNavigate={(path) => void navigate(path)}
              onAcknowledge={(target) => void handleAcknowledge(target)}
              isAcknowledging={acknowledgingKey === item.key}
            />
          ))}
        </div>
      </div>

      {/* Module-Specific Steps */}
      {moduleItems.length > 0 && (
        <div>
          <h2 className="text-theme-text-primary mb-1 text-lg font-semibold">Module Configuration</h2>
          <p className="text-theme-text-muted mb-4 text-sm">
            Additional setup for the modules you've enabled. These are optional but recommended.
          </p>
          <div className="space-y-3">
            {moduleItems.map((item) => (
              <SetupCard
                key={item.key}
                item={item}
                onNavigate={(path) => void navigate(path)}
                onAcknowledge={(target) => void handleAcknowledge(target)}
                isAcknowledging={acknowledgingKey === item.key}
              />
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
  onAcknowledge: (item: SetupChecklistItem) => void;
  isAcknowledging: boolean;
}

const SetupCard: React.FC<SetupCardProps> = ({ item, onNavigate, onAcknowledge, isAcknowledging }) => {
  const styles = CATEGORY_STYLES[item.category] || CATEGORY_STYLES.essential;
  const icon = ITEM_ICONS[item.key] || <Circle className="h-5 w-5" />;

  // A review item's "Mark reviewed" control is a real button, so the card
  // itself can't be one — nesting interactive elements is invalid HTML and
  // breaks keyboard navigation. The navigation target is its own button.
  return (
    <div className="bg-theme-surface border-theme-surface-border group w-full rounded-xl border transition-all hover:border-red-500/30">
      <button onClick={() => onNavigate(item.path)} className="w-full p-4 text-left">
        <div className="flex items-center gap-4">
          {/* Status Icon */}
          <div className="shrink-0">
            {item.is_complete ? (
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-500/10">
                <CheckCircle2 className="h-5 w-5 text-emerald-500" />
              </div>
            ) : (
              <div className={`h-10 w-10 rounded-full ${styles?.bgClass} flex items-center justify-center`}>
                <span className={styles?.textClass}>{icon}</span>
              </div>
            )}
          </div>

          {/* Content */}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3
                className={`text-sm font-semibold ${
                  item.is_complete ? 'text-theme-text-muted line-through' : 'text-theme-text-primary'
                }`}
              >
                {item.title}
              </h3>
              {item.required && !item.is_complete && (
                <span className="rounded-sm bg-red-500/10 px-1.5 py-0.5 text-[10px] font-medium text-red-600 uppercase dark:text-red-400">
                  Required
                </span>
              )}
              {item.is_complete && item.count > 0 && item.kind !== 'review' && (
                <span className="rounded-sm bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                  {item.count} {item.count === 1 ? 'item' : 'items'}
                </span>
              )}
            </div>
            <p className="text-theme-text-muted mt-0.5 line-clamp-1 text-xs">{item.description}</p>
          </div>

          {/* Arrow */}
          <ChevronRight className="text-theme-text-muted h-5 w-5 shrink-0 transition-colors group-hover:text-red-500" />
        </div>
      </button>

      {item.kind === 'review' && (
        <div className="-mt-1 flex items-center gap-3 px-4 pb-3 pl-18">
          <button
            onClick={() => onAcknowledge(item)}
            disabled={isAcknowledging}
            className="text-theme-text-secondary mobile-touch-target text-xs font-medium underline underline-offset-2 hover:text-red-500 disabled:opacity-50"
          >
            {item.is_complete ? 'Mark as not reviewed' : 'Mark as reviewed'}
          </button>
          {!item.is_complete && (
            <span className="text-theme-text-muted text-[11px]">
              Nothing to count here — confirm once you have looked it over.
            </span>
          )}
        </div>
      )}
    </div>
  );
};

export default DepartmentSetupPage;
