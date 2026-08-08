/**
 * Eligibility Settings Card
 *
 * Configures which membership types are excluded from self-service shift
 * signup and which positions are open to all eligible members.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Shield, Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';

import { MembershipType, POSITION_LABELS } from '../../../constants/enums';
import { getErrorMessage } from '../../../utils/errorHandling';
import { schedulingService } from '../services/api';

const MEMBERSHIP_TYPE_LABELS: Record<string, string> = {
  prospective: 'Prospective',
  probationary: 'Probationary',
  active: 'Active',
  life: 'Life',
  retired: 'Retired',
  honorary: 'Honorary',
  administrative: 'Administrative',
};

const ALL_MEMBERSHIP_TYPES = Object.values(MembershipType);

// Deduplicated position keys (exclude alias entries like EMS/EMT)
const POSITION_KEYS = [
  'officer',
  'driver',
  'firefighter',
  'ems',
  'captain',
  'lieutenant',
  'probationary',
  'volunteer',
  'other',
];

export const EligibilitySettingsCard: React.FC = () => {
  const [excludedTypes, setExcludedTypes] = useState<string[]>([]);
  const [openPositions, setOpenPositions] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const fetchSettings = useCallback(() => {
    setLoading(true);
    schedulingService
      .getEligibilitySettings()
      .then((data) => {
        setExcludedTypes(data.excluded_membership_types);
        setOpenPositions(data.open_positions);
      })
      .catch((err: unknown) => {
        toast.error(getErrorMessage(err, 'Failed to load eligibility settings'));
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const handleSave = () => {
    setSaving(true);
    schedulingService
      .updateEligibilitySettings({
        excluded_membership_types: excludedTypes,
        open_positions: openPositions,
      })
      .then(() => {
        toast.success('Eligibility settings saved');
      })
      .catch((err: unknown) => {
        toast.error(getErrorMessage(err, 'Failed to save settings'));
      })
      .finally(() => setSaving(false));
  };

  const toggleExcludedType = (type: string) => {
    setExcludedTypes((prev) => (prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type]));
  };

  const toggleOpenPosition = (pos: string) => {
    setOpenPositions((prev) => (prev.includes(pos) ? prev.filter((p) => p !== pos) : [...prev, pos]));
  };

  if (loading) {
    return (
      <div className="bg-theme-surface border-theme-surface-border flex items-center justify-center rounded-xl border p-5 py-12">
        <Loader2 className="text-theme-text-muted h-5 w-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="bg-theme-surface border-theme-surface-border space-y-6 rounded-xl border p-5">
      <div>
        <h3 className="text-theme-text-primary flex items-center gap-2 text-base font-semibold">
          <Shield className="h-4 w-4" /> Position Eligibility
        </h3>
        <p className="text-theme-text-muted mt-1 text-sm">
          Control which membership types can self-signup for shifts and which positions are available to all members.
        </p>
      </div>

      {/* Excluded Membership Types */}
      <div>
        <h4 className="text-theme-text-primary mb-2 text-sm font-medium">Excluded from Self-Signup</h4>
        <p className="text-theme-text-muted mb-3 text-xs">
          Members with these membership types cannot sign themselves up for shifts. Admins can still assign them
          manually.
        </p>
        <div className="flex flex-wrap gap-2">
          {ALL_MEMBERSHIP_TYPES.map((type) => {
            const isExcluded = excludedTypes.includes(type);
            return (
              <button
                key={type}
                onClick={() => toggleExcludedType(type)}
                className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                  isExcluded
                    ? 'border-red-500/30 bg-red-500/10 text-red-700 dark:text-red-400'
                    : 'bg-theme-surface-hover/50 border-theme-surface-border text-theme-text-muted hover:text-theme-text-primary'
                }`}
              >
                {MEMBERSHIP_TYPE_LABELS[type] ?? type}
              </button>
            );
          })}
        </div>
      </div>

      {/* Open Positions */}
      <div>
        <h4 className="text-theme-text-primary mb-2 text-sm font-medium">Open Positions</h4>
        <p className="text-theme-text-muted mb-3 text-xs">
          These positions are available to all eligible members regardless of rank or training. Select positions that
          anyone can sign up for.
        </p>
        <div className="flex flex-wrap gap-2">
          {POSITION_KEYS.map((pos) => {
            const isOpen = openPositions.includes(pos);
            return (
              <button
                key={pos}
                onClick={() => toggleOpenPosition(pos)}
                className={`rounded-lg border px-3 py-1.5 text-sm transition-colors ${
                  isOpen
                    ? 'border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-400'
                    : 'bg-theme-surface-hover/50 border-theme-surface-border text-theme-text-muted hover:text-theme-text-primary'
                }`}
              >
                {POSITION_LABELS[pos] ?? pos}
              </button>
            );
          })}
        </div>
      </div>

      {/* Save */}
      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-2 rounded-lg bg-violet-600 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-violet-700 disabled:opacity-50"
        >
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          Save Eligibility Settings
        </button>
      </div>
    </div>
  );
};
