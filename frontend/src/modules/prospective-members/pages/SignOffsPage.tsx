/**
 * Sign-offs — Multi-Signer Approval stages waiting on the signed-in member.
 *
 * A pipeline stage can require named officers (the Chief, the President) to
 * approve an applicant. The server has always been able to record those
 * signatures (`/approve-step`), but no screen asked for them: the officers a
 * stage names rarely hold prospective_members access, so they never saw the
 * applicant, and conversion did not wait for them either (workflow review
 * W16-1). Conversion now refuses until every required stage is complete; this
 * page is where the signers do their part.
 *
 * Deliberately shows the applicant's name and stage only. The server returns
 * nothing more, because holding an approval role is not a grant to read the
 * applicant's file.
 */

import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { PenLine } from 'lucide-react';
import { Breadcrumbs, EmptyState, PromptDialog, SkeletonCard } from '../../../components/ux';
import { getErrorMessage } from '../../../utils/errorHandling';
import { signOffService } from '../services/api';
import type { PendingSignOff, SignOffRole } from '../types';

interface Signing {
  item: PendingSignOff;
  role: SignOffRole;
}

const SignOffsPage: React.FC = () => {
  const [items, setItems] = useState<PendingSignOff[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [signing, setSigning] = useState<Signing | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setItems(await signOffService.listMine());
    } catch (err: unknown) {
      setLoadError(getErrorMessage(err, 'Your sign-offs could not be loaded.'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const sign = async (note: string) => {
    if (!signing) return;
    const { item, role } = signing;
    setSubmitting(true);
    try {
      const result = await signOffService.sign(item.prospect_id, item.step_id, role.role, note || undefined);
      const name = `${item.first_name} ${item.last_name}`;
      toast.success(
        result.step_completed
          ? `Signed as ${role.label}. ${item.step_name} is complete for ${name}.`
          : `Signed as ${role.label}. ${item.step_name} still needs other signatures.`
      );
      setSigning(null);
      await load();
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'Your sign-off could not be recorded.'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 sm:px-6 lg:px-8">
      <Breadcrumbs />
      <h1 className="text-theme-text-primary text-2xl font-bold">Sign-offs</h1>
      <p className="text-theme-text-muted mt-1 mb-6 text-sm">
        Applicants waiting on your approval before they can become members.
      </p>

      {loading ? (
        <div className="space-y-3" aria-busy="true">
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : loadError ? (
        <div className="alert-danger flex flex-wrap items-center gap-2" role="alert">
          <span className="min-w-0 flex-1 text-sm">{loadError}</span>
          <button type="button" className="btn-secondary mobile-touch-target px-3 text-sm" onClick={() => void load()}>
            Try again
          </button>
        </div>
      ) : items.length === 0 ? (
        <EmptyState
          icon={PenLine}
          title="Nothing is waiting on you"
          description="When an applicant reaches a stage that needs your approval, it will appear here."
        />
      ) : (
        <ul className="space-y-3">
          {items.map((item) => (
            <li key={`${item.prospect_id}-${item.step_id}`} className="card p-4">
              <h2 className="text-theme-text-primary text-base font-semibold">
                {item.first_name} {item.last_name}
              </h2>
              <p className="text-theme-text-muted text-sm">
                {item.step_name}
                {item.pipeline_name ? ` · ${item.pipeline_name}` : ''}
              </p>
              {item.step_description && (
                <p className="text-theme-text-secondary mt-2 text-sm">{item.step_description}</p>
              )}
              <ul className="mt-3 flex flex-wrap gap-2" aria-label="Required approvals">
                {item.required_roles.map((r) => (
                  <li
                    key={r.role}
                    className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                      r.signed
                        ? 'bg-green-500/15 text-green-800 dark:text-green-300'
                        : 'bg-theme-surface-secondary text-theme-text-secondary'
                    }`}
                  >
                    {r.label}: {r.signed ? 'signed' : 'waiting'}
                  </li>
                ))}
              </ul>
              <div className="mt-4 flex flex-wrap gap-2">
                {item.roles_to_sign.map((role) => (
                  <button
                    key={role.role}
                    type="button"
                    className="btn-primary px-4 text-sm"
                    onClick={() => setSigning({ item, role })}
                  >
                    Sign as {role.label}
                  </button>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}

      <PromptDialog
        isOpen={signing !== null}
        onClose={() => setSigning(null)}
        onSubmit={(note) => void sign(note)}
        title={signing ? `Sign as ${signing.role.label}` : 'Sign'}
        message={
          signing
            ? `You are approving ${signing.item.first_name} ${signing.item.last_name} at "${signing.item.step_name}". Your name and role are recorded with the approval.`
            : undefined
        }
        label="Note"
        required={false}
        multiline
        confirmLabel="Sign"
        cancelLabel="Not now"
        loading={submitting}
      />
    </div>
  );
};

export default SignOffsPage;
