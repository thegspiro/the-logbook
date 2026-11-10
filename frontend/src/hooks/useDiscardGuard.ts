import { useCallback, useEffect, useRef } from 'react';
import { useConfirmRequest } from '../contexts/confirmRequest';

/**
 * Asks before a dialog with changed fields is closed (forms review F-6, owner
 * decision 2026-11-06: "Escape asks first").
 *
 * Pitfall #31 keeps Escape as the way out of every dialog, and nothing in a
 * dialog is drafted, so one stray Escape used to throw away everything typed
 * into it. The exit stays; on a dirty dialog it now asks "Keep editing" or
 * "Discard changes" first. A clean dialog still closes at once, so a member
 * who opened the wrong dialog is never asked a question about nothing.
 *
 * `Modal` and `DialogPanel` call this for you when given `isDirty`, which
 * covers Escape and the header X. A dialog whose own Cancel button must ask
 * the same question calls the hook itself and hands the returned function to
 * both the shell's `onClose` and the button — and then does not also pass
 * `isDirty` to the shell, or the question would be asked twice.
 */

export interface DiscardGuardOptions {
  /**
   * Whether the dialog holds changes that closing would lose. Leave it
   * undefined for a dialog that never asks; any boolean opts in, and then a
   * ConfirmProvider is required.
   */
  isDirty?: boolean | undefined;
  onClose: () => void;
  /** Override the question when "this form" is not the clearest wording. */
  message?: string | undefined;
}

const missingProviderMessage =
  'A dialog given isDirty must render inside a ConfirmProvider: it has to ask before discarding, and closing ' +
  'without asking would silently lose the changes the flag says are there.';

export function useDiscardGuard({ isDirty, onClose, message }: DiscardGuardOptions): () => void {
  const { confirm, available } = useConfirmRequest();
  // Fail where the wiring is wrong, at render, rather than at the moment a
  // member presses Escape on a half-filled form.
  if (isDirty !== undefined && !available) throw new Error(missingProviderMessage);

  // Held in refs so the returned function is stable: useDialog keeps its
  // Escape listener in a ref too, and a fresh function each keystroke would
  // otherwise be harmless but wasteful.
  const latest = useRef({ isDirty, onClose, message, confirm });
  useEffect(() => {
    latest.current = { isDirty, onClose, message, confirm };
  });
  const asking = useRef(false);

  return useCallback(() => {
    const current = latest.current;
    if (!current.isDirty) {
      current.onClose();
      return;
    }
    // A second Escape or X while the question is up is the same request, not a
    // second one to queue behind it.
    if (asking.current) return;
    asking.current = true;
    void current
      .confirm({
        title: 'Discard your changes?',
        message: current.message ?? 'What you entered in this form has not been saved. Closing it will lose it.',
        confirmLabel: 'Discard changes',
        cancelLabel: 'Keep editing',
        variant: 'warning',
      })
      .then((discard) => {
        if (discard) latest.current.onClose();
      })
      .finally(() => {
        asking.current = false;
      });
  }, []);
}
