/**
 * Who has signed the adopted minutes, and who still needs to.
 *
 * The department decides the slots (Minutes → Signers). Each shows its
 * signature, or says it is waiting; a member who holds what a waiting slot asks
 * is offered a button to sign it. A signature is bound to the adopted version
 * it was given on, and the panel says so if that version is no longer the one
 * on file.
 */

import React, { useCallback, useEffect, useState } from 'react';
import { PenLine, ShieldAlert } from 'lucide-react';
import { useTimezone } from '../../../hooks/useTimezone';
import { formatDateTime } from '../../../utils/dateFormatting';
import { minutesService } from '../services/api';
import { PanelDisclosure } from './PanelDisclosure';
import { SignDialog } from './SignDialog';
import type { MinutesStatus, SignatureStatus } from '../types/minutes';

interface SignaturesPanelProps {
  minutesId: string;
  minutesTitle: string;
  status: MinutesStatus;
  /** Changes whenever the minutes are reloaded, so a state change refreshes this. */
  version: string;
  defaultOpen?: boolean;
}

export const SignaturesPanel: React.FC<SignaturesPanelProps> = ({
  minutesId,
  minutesTitle,
  status,
  version,
  defaultOpen = true,
}) => {
  const tz = useTimezone();
  const [state, setState] = useState<SignatureStatus | null>(null);
  const [signing, setSigning] = useState<{ key: string; title: string } | null>(null);

  const load = useCallback(async () => {
    try {
      setState(await minutesService.getSignatureStatus(minutesId));
    } catch {
      setState(null);
    }
  }, [minutesId]);

  useEffect(() => {
    if (status === 'approved') void load();
  }, [load, status, version]);

  if (status !== 'approved' || !state || state.slots.length === 0) return null;

  const signed = state.slots.filter((s) => s.signature).length;
  const broken = state.slots.some((s) => s.signature && !s.signature.intact);

  return (
    <>
      <PanelDisclosure
        id="signatures-heading"
        icon={<PenLine className="h-5 w-5" aria-hidden="true" />}
        title="Signatures"
        count={signed}
        defaultOpen={defaultOpen}
        attention={broken}
      >
        <p className="text-theme-text-muted mb-3 text-xs">
          {signed} of {state.slots.length} signed
          {state.version ? ` · adopted version ${state.version}` : ''}
        </p>
        <ul className="space-y-3">
          {state.slots.map((slot) => (
            <li key={slot.key} className="border-theme-surface-border rounded-lg border p-3">
              <p className="text-theme-text-primary text-sm font-medium">{slot.title}</p>
              {slot.signature ? (
                <>
                  <p className="text-theme-text-secondary mt-1 text-sm">
                    Signed by <strong>{slot.signature.signed_name}</strong> on{' '}
                    {formatDateTime(slot.signature.signed_at, tz)}
                  </p>
                  {!slot.signature.intact && (
                    <p className="mt-1 flex items-center gap-1 text-xs text-red-700 dark:text-red-400" role="alert">
                      <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
                      This signature does not match the version now on file.
                    </p>
                  )}
                </>
              ) : (
                <div className="mt-1 flex flex-wrap items-center gap-3">
                  <span className="text-theme-text-muted text-sm italic">Waiting for a signature</span>
                  {slot.can_sign && (
                    <button
                      type="button"
                      onClick={() => setSigning({ key: slot.key, title: slot.title })}
                      className="btn-primary touch:min-h-11"
                    >
                      Sign as {slot.title}
                    </button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      </PanelDisclosure>
      <SignDialog
        isOpen={signing !== null}
        minutesId={minutesId}
        minutesTitle={minutesTitle}
        slotKey={signing?.key ?? ''}
        slotTitle={signing?.title ?? ''}
        onClose={() => setSigning(null)}
        onSigned={load}
      />
    </>
  );
};

export default SignaturesPanel;
