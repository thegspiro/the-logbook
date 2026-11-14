/**
 * The member's written response to their finalized evaluation.
 *
 * The member drafts it, privately, until they submit it inside the template's
 * response window. Once submitted it is final: it joins the record, is
 * printed in a second PDF beside the signed one, and the evaluator and the
 * evaluation managers are told. Everyone who may read the evaluation sees the
 * submitted response here.
 */
import React, { useEffect, useState } from 'react';
import { useTimezone } from '../../../../hooks/useTimezone';
import { formatCalendarDate, formatDateTime } from '../../../../utils/dateFormatting';
import type { EvaluationDetail } from '../../types/evaluations';

interface ResponsePanelProps {
  detail: EvaluationDetail;
  busy: boolean;
  onSave: (text: string) => void;
  onSubmit: () => void;
}

export const ResponsePanel: React.FC<ResponsePanelProps> = ({ detail, busy, onSave, onSubmit }) => {
  const tz = useTimezone();
  const part = detail.parts.find((p) => p.kind === 'member_response');
  const saved = part?.content.overall_comment ?? '';
  const [text, setText] = useState(saved);

  // Follow the server's copy whenever it changes (a save, a submit, a reload).
  useEffect(() => {
    setText(saved);
  }, [saved]);

  if (part?.status === 'submitted') {
    return (
      <section aria-labelledby="response-heading" className="card p-4 sm:p-6">
        <h2 id="response-heading" className="text-theme-text-primary text-lg font-semibold">
          {detail.viewer.is_member ? 'Your written response' : "Member's written response"}
        </h2>
        <p className="text-theme-text-primary mt-3 text-sm whitespace-pre-wrap">{saved}</p>
        {part.submitted_at && (
          <p className="text-theme-text-secondary mt-2 text-xs">
            Submitted {formatDateTime(part.submitted_at, tz)}, after the evaluation was final.
          </p>
        )}
      </section>
    );
  }

  if (!detail.viewer.can_respond) return null;

  const unchanged = text.trim() === saved.trim();
  return (
    <section aria-labelledby="response-heading" className="card p-4 sm:p-6">
      <h2 id="response-heading" className="text-theme-text-primary text-lg font-semibold">
        Your written response
      </h2>
      <p className="text-theme-text-secondary mt-1 text-sm">
        You may attach a written response to this evaluation
        {detail.response_due ? ` until ${formatCalendarDate(detail.response_due)}` : ''}. It is kept with the record and
        printed on its PDF. Only you see a saved draft; once you submit it, it is final.
      </p>
      <label htmlFor="member-response" className="form-label mt-3">
        Response
      </label>
      <textarea
        id="member-response"
        className="form-input min-h-32"
        maxLength={5000}
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <button
          type="button"
          className="btn-secondary text-sm"
          disabled={busy || !text.trim() || unchanged}
          onClick={() => onSave(text.trim())}
        >
          Save draft
        </button>
        <button
          type="button"
          className="btn-primary text-sm"
          disabled={busy || !saved.trim() || !unchanged}
          onClick={onSubmit}
        >
          Submit response
        </button>
      </div>
      {!unchanged && saved && (
        <p className="text-theme-text-secondary mt-2 text-xs">Save your changes before submitting.</p>
      )}
    </section>
  );
};
