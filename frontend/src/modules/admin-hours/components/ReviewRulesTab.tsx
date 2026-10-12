/**
 * ReviewRulesTab Component
 *
 * The department's two admin-hours review rules (AH-21). The values shown are
 * the server's reading (`GET /admin-hours/settings`), never a local default,
 * so the screen cannot claim a rule the approval path does not apply.
 *
 * Writing goes through the organization settings endpoint and needs
 * `settings.manage`: one rule relaxes the self-approval control on the very
 * people who hold `admin_hours.manage`, so they can read it here but only a
 * settings administrator can change it.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { adminHoursEntryService } from '../services/api';
import { organizationService } from '../../../services/api';
import { useAuthStore } from '../../../stores/authStore';
import { getErrorMessage } from '../../../utils/errorHandling';
import type { AdminHoursReviewSettings } from '../types';

const ReviewRulesTab: React.FC = () => {
  const checkPermission = useAuthStore((s) => s.checkPermission);
  const canEdit = checkPermission('settings.manage') || checkPermission('organization.update_settings');

  const [settings, setSettings] = useState<AdminHoursReviewSettings | null>(null);
  const [growthDraft, setGrowthDraft] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const next = await adminHoursEntryService.getReviewSettings();
      setSettings(next);
      setGrowthDraft(String(next.resyncRequeueGrowthPercent));
      setLoadError(null);
    } catch (err: unknown) {
      setLoadError(getErrorMessage(err, 'Failed to load the review rules'));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (update: { allow_self_approval?: boolean; resync_requeue_growth_percent?: number }) => {
    setSaving(true);
    try {
      await organizationService.updateSettings({ admin_hours: update });
      // Re-read rather than trusting the value sent, so the screen shows what
      // the approval path will actually enforce.
      await load();
      toast.success('Review rules saved');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Failed to save the review rules'));
    } finally {
      setSaving(false);
    }
  };

  const growthValue = Number(growthDraft);
  const growthValid =
    growthDraft.trim() !== '' && Number.isInteger(growthValue) && growthValue >= 0 && growthValue <= 1000;

  if (loadError) {
    return <div className="alert-danger">{loadError}</div>;
  }
  if (!settings) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="text-theme-text-muted h-6 w-6 animate-spin" aria-label="Loading review rules" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {!canEdit && (
        <p className="text-theme-text-secondary text-sm">
          These rules are set by a settings administrator. They are shown here so reviewers know what applies.
        </p>
      )}

      <section className="card p-5">
        <label className="flex items-start gap-3">
          <input
            type="checkbox"
            className="form-checkbox mt-0.5"
            checked={settings.allowSelfApproval}
            disabled={!canEdit || saving}
            onChange={(e) => void save({ allow_self_approval: e.target.checked })}
          />
          <span>
            <span className="text-theme-text-primary block text-sm font-medium">
              Let an approver approve their own entries
            </span>
            <span className="text-theme-text-secondary mt-1 block text-xs">
              For a department with a single officer who reviews admin hours. Leave this off whenever a second person
              can review: separation of duties is the control on credited hours. A self-approved entry is still recorded
              with its approver, so it can be seen as one.
            </span>
          </span>
        </label>
      </section>

      <section className="card p-5">
        <label htmlFor="requeue-growth" className="form-label">
          Send a corrected event entry back for review when it grows by more than
        </label>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <input
            id="requeue-growth"
            type="number"
            min={0}
            max={1000}
            step={1}
            inputMode="numeric"
            className="form-input w-28"
            value={growthDraft}
            disabled={!canEdit || saving}
            onChange={(e) => setGrowthDraft(e.target.value)}
          />
          <span className="text-theme-text-secondary text-sm">percent</span>
          {canEdit && (
            <button
              type="button"
              className="btn-primary"
              disabled={saving || !growthValid || growthValue === settings.resyncRequeueGrowthPercent}
              onClick={() => void save({ resync_requeue_growth_percent: growthValue })}
            >
              Save
            </button>
          )}
        </div>
        {!growthValid && <p className="text-theme-text-secondary mt-1 text-xs">Enter a whole number from 0 to 1000.</p>}
        <p className="text-theme-text-secondary mt-2 text-xs">
          When a reopened event&rsquo;s check-out is corrected, attendance hours already approved are updated in place.
          If the correction grows an entry past this threshold, and its category would not have approved the new length
          automatically, the entry returns to Pending Review. 0 sends back any growth at all.
        </p>
      </section>
    </div>
  );
};

export default ReviewRulesTab;
