/**
 * Whether a campaign is a restricted fund — its donors gave for a stated
 * purpose, so finance payments can be charged to it and no more than was given
 * can be spent on it (the finance module's Restricted funds report).
 *
 * Shown on each campaign card; a `fundraising.manage` holder can mark a
 * campaign restricted, with its purpose, or make it unrestricted again. The
 * server refuses the latter once a payment is charged to it.
 */

import React, { useState } from 'react';
import toast from 'react-hot-toast';
import { Lock } from 'lucide-react';
import { PromptDialog } from '@/components/ux/PromptDialog';
import { useConfirm } from '@/contexts/ConfirmContext';
import { getErrorMessage } from '@/utils/errorHandling';
import { fundraisingService } from '../services/api';
import type { FundraisingCampaign } from '../types';

interface CampaignRestrictionControlProps {
  campaign: FundraisingCampaign;
  canManage: boolean;
  onChanged: () => void;
}

export const CampaignRestrictionControl: React.FC<CampaignRestrictionControlProps> = ({
  campaign,
  canManage,
  onChanged,
}) => {
  const { confirm } = useConfirm();
  const [asking, setAsking] = useState(false);
  const [saving, setSaving] = useState(false);

  const save = async (data: Partial<FundraisingCampaign>, done: string) => {
    setSaving(true);
    try {
      await fundraisingService.updateCampaign(campaign.id, data);
      toast.success(done);
      setAsking(false);
      onChanged();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Could not change the campaign'));
    } finally {
      setSaving(false);
    }
  };

  const unrestrict = async () => {
    const ok = await confirm({
      title: 'Make this campaign unrestricted?',
      message:
        'Payments will no longer be charged to it, and it will leave the Restricted funds report. Only do this if its donors did not give for a stated purpose.',
      confirmLabel: 'Make unrestricted',
      cancelLabel: 'Keep it restricted',
      variant: 'warning',
    });
    if (ok) await save({ isRestricted: false }, 'Campaign is no longer a restricted fund');
  };

  return (
    <div className="space-y-1">
      {campaign.isRestricted && (
        <div>
          <span className="badge inline-flex items-center gap-1 bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300">
            <Lock className="h-3 w-3" aria-hidden="true" />
            Restricted fund
          </span>
          {campaign.restrictionPurpose && (
            <p className="text-theme-text-secondary mt-1 text-sm">For: {campaign.restrictionPurpose}</p>
          )}
        </div>
      )}
      {canManage && (
        <button
          type="button"
          className="text-sm font-medium text-red-700 hover:underline disabled:opacity-50 dark:text-red-400"
          disabled={saving}
          onClick={() => (campaign.isRestricted ? void unrestrict() : setAsking(true))}
        >
          {campaign.isRestricted ? 'Make unrestricted' : 'Mark as restricted fund'}
        </button>
      )}
      <PromptDialog
        isOpen={asking}
        onClose={() => setAsking(false)}
        onSubmit={(purpose) =>
          void save({ isRestricted: true, restrictionPurpose: purpose }, 'Campaign is now a restricted fund')
        }
        title={`Make ${campaign.name} a restricted fund`}
        message="Donations to it can then be spent only on what the donors gave for. Finance requests can be charged to it, and its balance shows on the Restricted funds report."
        label="What the donors gave for"
        placeholder="e.g. Replacing Engine 2"
        multiline
        confirmLabel="Mark as restricted"
        loading={saving}
      />
    </div>
  );
};

export default CampaignRestrictionControl;
