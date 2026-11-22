/**
 * "Approver cover": an approver away for a period names an officer who manages
 * leave to decide leave requests in their place.
 *
 * Shown only to someone the server says may set a cover (an approver, for
 * themself, or an officer who manages leave, for anyone), or who is named in
 * one. The server decides who is an approver and who may stand in; this lists
 * what it returns (CLAUDE.md pitfall #29).
 */

import React, { useCallback, useEffect, useState } from 'react';
import toast from 'react-hot-toast';
import { useConfirm } from '../../contexts/ConfirmContext';
import { leaveRequestService } from '../../services/leaveRequestService';
import { useAuthStore } from '../../stores/authStore';
import type { LeaveApproverCover, LeaveApproverCoverBoard } from '../../types/leaveRequest';
import { formatCalendarDate } from '../../utils/dateFormatting';
import { getErrorMessage } from '../../utils/errorHandling';

const period = (c: LeaveApproverCover): string =>
  c.start_date === c.end_date
    ? formatCalendarDate(c.start_date)
    : `${formatCalendarDate(c.start_date)} – ${formatCalendarDate(c.end_date)}`;

const emptyForm = { approver_id: '', stand_in_id: '', start_date: '', end_date: '' };

const ApproverCover: React.FC = () => {
  const { confirm } = useConfirm();
  const userId = useAuthStore((state) => state.user?.id);
  const [board, setBoard] = useState<LeaveApproverCoverBoard | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setBoard(await leaveRequestService.getCovers());
    } catch {
      // Cover is an extra on this page; the requests above still work without it.
      setBoard(null);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!board || (board.approvers.length === 0 && board.covers.length === 0)) return null;

  // An approver who does not manage leave may set only their own cover.
  const onlySelf = board.approvers.length === 1 && board.approvers[0]?.id === userId ? board.approvers[0] : undefined;
  const approverId = onlySelf?.id ?? form.approver_id;
  const standIns = board.stand_ins.filter((p) => p.id !== approverId);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!approverId || !form.stand_in_id || !form.start_date || !form.end_date) return;
    setBusy(true);
    try {
      setBoard(
        await leaveRequestService.setCover({
          approver_id: approverId,
          stand_in_id: form.stand_in_id,
          start_date: form.start_date,
          end_date: form.end_date,
        })
      );
      setForm(emptyForm);
      toast.success('Cover set. The stand-in decides requests in the approver’s place for those days.');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'The cover was not set.'));
    } finally {
      setBusy(false);
    }
  };

  const clear = async (c: LeaveApproverCover) => {
    const ok = await confirm({
      title: 'End this cover now?',
      message: `${c.approver_name} decides leave requests again from now. Votes ${c.stand_in_name} already cast still count.`,
      confirmLabel: 'End the cover',
      cancelLabel: 'Keep it',
    });
    if (!ok) return;
    setBusy(true);
    try {
      setBoard(await leaveRequestService.clearCover(c.id));
      toast.success('Cover ended.');
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, 'The cover was not ended.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card mb-6 p-4" aria-labelledby="approver-cover-heading">
      <h2 id="approver-cover-heading" className="text-theme-text-primary mb-1 font-semibold">
        Approver cover
      </h2>
      <p className="text-theme-text-muted mb-3 text-sm">
        While an approver is away, an officer who manages leave can decide requests in their place. The approver cannot
        vote until the cover ends.
      </p>

      {board.covers.length > 0 && (
        <ul className="mb-4 space-y-2">
          {board.covers.map((c) => (
            <li
              key={c.id}
              className="border-theme-surface-border flex flex-wrap items-center justify-between gap-2 rounded-md border p-3"
            >
              <div className="text-sm">
                <p className="text-theme-text-primary">
                  <span className="font-medium">{c.stand_in_name}</span> stands in for{' '}
                  <span className="font-medium">{c.approver_name}</span>
                </p>
                <p className="text-theme-text-muted text-xs">
                  {period(c)}
                  {c.active ? ' · in effect now' : ''}
                </p>
              </div>
              {c.can_clear && (
                <button type="button" className="btn-secondary" disabled={busy} onClick={() => void clear(c)}>
                  End cover
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {board.approvers.length > 0 && (
        <form className="space-y-4" onSubmit={(e) => void submit(e)}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {onlySelf ? (
              <p className="text-theme-text-secondary text-sm sm:col-span-2">
                Set cover for yourself, <span className="font-medium">{onlySelf.name}</span>.
              </p>
            ) : (
              <div>
                <label className="form-label" htmlFor="cover-approver">
                  Approver who is away
                </label>
                <select
                  id="cover-approver"
                  className="form-input"
                  required
                  value={form.approver_id}
                  onChange={(e) => setForm({ ...form, approver_id: e.target.value })}
                >
                  <option value="">Choose an approver…</option>
                  {board.approvers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <label className="form-label" htmlFor="cover-stand-in">
                Stand-in
              </label>
              <select
                id="cover-stand-in"
                className="form-input"
                required
                aria-describedby="cover-stand-in-help"
                value={form.stand_in_id}
                onChange={(e) => setForm({ ...form, stand_in_id: e.target.value })}
              >
                <option value="">Choose a stand-in…</option>
                {standIns.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <p id="cover-stand-in-help" className="text-theme-text-muted mt-1 text-xs">
                Only officers who manage leave can stand in.
              </p>
            </div>
            <div>
              <label className="form-label" htmlFor="cover-start">
                First day away
              </label>
              <input
                id="cover-start"
                type="date"
                className="form-input"
                required
                min={board.today}
                value={form.start_date}
                onChange={(e) => setForm({ ...form, start_date: e.target.value })}
              />
            </div>
            <div>
              <label className="form-label" htmlFor="cover-end">
                Last day away
              </label>
              <input
                id="cover-end"
                type="date"
                className="form-input"
                required
                min={form.start_date || board.today}
                value={form.end_date}
                onChange={(e) => setForm({ ...form, end_date: e.target.value })}
              />
            </div>
          </div>
          <button
            type="submit"
            className="btn-primary"
            disabled={busy || !approverId || !form.stand_in_id || !form.start_date || !form.end_date}
          >
            {busy ? 'Saving…' : 'Set cover'}
          </button>
        </form>
      )}
    </section>
  );
};

export default ApproverCover;
