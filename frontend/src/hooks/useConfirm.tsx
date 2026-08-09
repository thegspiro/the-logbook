/**
 * Promise-based confirmation, as a drop-in for `window.confirm`.
 *
 * `window.confirm` is a blocking call that returns a boolean, which is why it
 * survived in so many places: every alternative meant hoisting the pending
 * action into component state and splitting one function into two. This keeps
 * the original shape —
 *
 *     if (!(await confirm({ message: 'Delete this?' }))) return;
 *
 * — so converting a call site is a one-line change and the control flow around
 * it stays readable.
 *
 * Beyond looking like the rest of the app, the native dialog cannot be styled,
 * cannot show more than one paragraph, gives no way to label the buttons for
 * the actual decision ("Keep it" / "Delete" beats "Cancel" / "OK"), and on a
 * phone renders as a system alert people dismiss by reflex.
 *
 *     const { confirm, confirmDialog } = useConfirm();
 *     ...
 *     return (<>{yourUi}{confirmDialog}</>);
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ConfirmDialog } from '../components/ux/ConfirmDialog';

export interface ConfirmOptions {
  message: string;
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'warning' | 'info';
}

interface PendingConfirm {
  options: ConfirmOptions;
  resolve: (confirmed: boolean) => void;
}

export function useConfirm(): {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  confirmDialog: React.ReactElement;
} {
  const [pending, setPending] = useState<PendingConfirm | null>(null);

  // Held in a ref as well so unmount can settle a promise the caller is still
  // awaiting. Without this, unmounting mid-question leaves that `await`
  // pending forever and the rest of the caller's function never runs — the
  // failure mode is silent, which is the one this whole exercise is about.
  const pendingRef = useRef<PendingConfirm | null>(null);
  pendingRef.current = pending;
  useEffect(
    () => () => {
      pendingRef.current?.resolve(false);
    },
    []
  );

  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        // A second question while one is open would strand the first promise,
        // so the earlier one is answered "no" before being replaced.
        pendingRef.current?.resolve(false);
        setPending({ options, resolve });
      }),
    []
  );

  const settle = useCallback((confirmed: boolean) => {
    pendingRef.current?.resolve(confirmed);
    setPending(null);
  }, []);

  const confirmDialog = (
    <ConfirmDialog
      isOpen={pending !== null}
      onClose={() => settle(false)}
      onConfirm={() => settle(true)}
      title={pending?.options.title ?? 'Are you sure?'}
      message={pending?.options.message ?? ''}
      {...(pending?.options.confirmLabel ? { confirmLabel: pending.options.confirmLabel } : {})}
      {...(pending?.options.cancelLabel ? { cancelLabel: pending.options.cancelLabel } : {})}
      variant={pending?.options.variant ?? 'danger'}
    />
  );

  return { confirm, confirmDialog };
}

export default useConfirm;
