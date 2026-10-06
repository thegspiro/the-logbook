/**
 * What the examiner needs to know about signal while scoring: that there is
 * none, that their scoring is safe on this device, and — if the server later
 * refused it — why, with the choice to discard it.
 *
 * A refused evaluation is never discarded automatically (offline plan §3.1);
 * this is the one place it can be, and only by the examiner who scored it.
 */

import React, { useState } from 'react';
import { CloudOff, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';
import { useConfirm } from '../../contexts/ConfirmContext';
import { useSkillsTestingStore, type SkillsOfflineState } from '../../stores/skillsTestingStore';
import { discardSkillsPending } from '../../utils/skillsTestOffline';
import { usePendingSyncStore } from '../../stores/pendingSyncStore';

interface Props {
  online: boolean;
  state: SkillsOfflineState | null;
  testId: string;
}

export const SkillsOfflineBanner: React.FC<Props> = ({ online, state, testId }) => {
  const { confirm } = useConfirm();
  const [discarding, setDiscarding] = useState(false);
  const mine = state?.testId === testId ? state : null;

  if (mine?.failed) {
    const discard = async () => {
      const ok = await confirm({
        title: 'Discard this evaluation from the device?',
        message:
          'The scoring saved on this device will be deleted and cannot be recovered. Note anything you need from the screen first.',
        confirmLabel: 'Discard it',
        cancelLabel: 'Keep it',
        variant: 'danger',
      });
      if (!ok) return;
      setDiscarding(true);
      try {
        await discardSkillsPending(testId);
        void usePendingSyncStore.getState().refresh();
        await useSkillsTestingStore.getState().loadTest(testId);
        toast.success('Discarded from this device');
      } finally {
        setDiscarding(false);
      }
    };
    return (
      <div className="border-b border-red-200 bg-red-50 px-4 py-3 dark:border-red-800 dark:bg-red-900/20" role="alert">
        <p className="flex items-start gap-2 text-sm font-medium text-red-900 dark:text-white">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            The server did not accept this evaluation: {mine.failed} The scoring is still saved on this device.
          </span>
        </p>
        <button type="button" className="btn-secondary mt-2" disabled={discarding} onClick={() => void discard()}>
          Discard from this device
        </button>
      </div>
    );
  }

  if (online && !mine?.queued) return null;

  return (
    <div
      className="border-b border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-800 dark:bg-amber-900/20"
      role="status"
    >
      <p className="flex items-start gap-2 text-sm font-medium text-amber-900 dark:text-white">
        <CloudOff className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <span>
          {online
            ? 'Sending the scoring saved on this device…'
            : 'No signal. Your scoring is saved on this device and will be sent when you are back online.'}
        </span>
      </p>
    </div>
  );
};
