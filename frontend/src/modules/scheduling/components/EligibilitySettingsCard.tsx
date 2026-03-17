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
    setExcludedTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type],
    );
  };

  const toggleOpenPosition = (pos: string) => {
    setOpenPositions((prev) =>
      prev.includes(pos) ? prev.filter((p) => p !== pos) : [...prev, pos],
    );
  };

  if (loading) {
    return (
      <div className="bg-theme-surface border border-theme-surface-border rounded-xl p-5 flex items-center justify-center py-12">
        <Loader2 className="w-5 h-5 animate-spin text-theme-text-muted" />
      </div>
    );
  }

  return (
    <div className="bg-theme-surface border border-theme-surface-border rounded-xl p-5 space-y-6">
      <div>
        <h3 className="text-base font-semibold text-theme-text-primary flex items-center gap-2">
          <Shield className="w-4 h-4" /> Position Eligibility
        </h3>
        <p className="text-sm text-theme-text-muted mt-1">
          Control which membership types can self-signup for shifts and which
          positions are available to all members.
        </p>
      </div>

      {/* Excluded Membership Types */}
      <div>
        <h4 className="text-sm font-medium text-theme-text-primary mb-2">
          Excluded from Self-Signup
        </h4>
        <p className="text-xs text-theme-text-muted mb-3">
          Members with these membership types cannot sign themselves up for
          shifts. Admins can still assign them manually.
        </p>
        <div className="flex flex-wrap gap-2">
          {ALL_MEMBERSHIP_TYPES.map((type) => {
            const isExcluded = excludedTypes.includes(type);
            return (
              <button
                key={type}
                onClick={() => toggleExcludedType(type)}
                className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
                  isExcluded
                    ? 'bg-red-500/10 border-red-500/30 text-red-700 dark:text-red-400'
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
        <h4 className="text-sm font-medium text-theme-text-primary mb-2">
          Open Positions
        </h4>
        <p className="text-xs text-theme-text-muted mb-3">
          These positions are available to all eligible members regardless of
          rank or training. Select positions that anyone can sign up for.
        </p>
        <div className="flex flex-wrap gap-2">
          {POSITION_KEYS.map((pos) => {
            const isOpen = openPositions.includes(pos);
            return (
              <button
                key={pos}
                onClick={() => toggleOpenPosition(pos)}
                className={`px-3 py-1.5 text-sm rounded-lg border transition-colors ${
                  isOpen
                    ? 'bg-green-500/10 border-green-500/30 text-green-700 dark:text-green-400'
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
          className="px-5 py-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-50 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2"
        >
          {saving && <Loader2 className="w-4 h-4 animate-spin" />}
          Save Eligibility Settings
        </button>
      </div>
    </div>
  );
};
