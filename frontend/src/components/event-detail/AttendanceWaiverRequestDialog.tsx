/**
 * The form a member fills in to ask to be excused from one training session.
 *
 * Built from the eligibility answer, not from the policy directly: that answer
 * carries the policy's form fields together with the cap figures and deadline
 * for this session, so the dialog shows exactly the fields the department
 * turned on and the server will accept. The server checks everything again on
 * submit; a refusal it sends back (a deadline passed while the dialog was open,
 * a check-in recorded in the meantime) is shown as it was worded.
 */

import React, { useMemo, useState } from 'react';
import { Modal } from '../Modal';
import { ErrorSummary, FormField } from '../ux';
import { useFieldErrors, type FieldErrors, type FieldSpecs } from '../../hooks/useFieldErrors';
import { attendanceWaiverService } from '../../services/attendanceWaiverService';
import { AttendanceWaiverReasonText } from '../../constants/enums';
import type { AttendanceWaiverEligibility, AttendanceWaiverRequest } from '../../types/attendanceWaiver';
import { formatDateTime } from '../../utils/dateFormatting';
import { capSummary, WAIVER_TEXT_MAX_LENGTH } from '../../utils/attendanceWaivers';

type Field = 'category' | 'reason';

const FIELDS: FieldSpecs<Field> = {
  category: { id: 'attendance-waiver-category', label: 'Reason category' },
  reason: { id: 'attendance-waiver-reason', label: 'Explanation' },
};

interface AttendanceWaiverRequestDialogProps {
  eventTitle: string;
  eligibility: AttendanceWaiverEligibility;
  timezone: string;
  onClose: () => void;
  onSubmitted: (request: AttendanceWaiverRequest) => void;
}

export const AttendanceWaiverRequestDialog: React.FC<AttendanceWaiverRequestDialogProps> = ({
  eventTitle,
  eligibility,
  timezone,
  onClose,
  onSubmitted,
}) => {
  const [category, setCategory] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [summaryFocus, setSummaryFocus] = useState(0);
  const { errors, formError, setErrors, setFromApiError, summary, clear } = useFieldErrors(FIELDS);

  const showCategory = eligibility.categories.length > 0;
  const showReason = eligibility.reason_text !== AttendanceWaiverReasonText.OFF;
  const reasonRequired = eligibility.reason_text === AttendanceWaiverReasonText.REQUIRED;
  const cap = useMemo(() => capSummary(eligibility), [eligibility]);

  const validate = (): FieldErrors<Field> => {
    const found: FieldErrors<Field> = {};
    if (showCategory && eligibility.category_required && !category) found.category = 'Choose a category.';
    if (showReason && reasonRequired && !reason.trim()) found.reason = 'Say briefly why you cannot attend.';
    return found;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const found = validate();
    if (Object.keys(found).length > 0) {
      setErrors(found);
      setSummaryFocus((n) => n + 1);
      return;
    }
    clear();
    setSubmitting(true);
    try {
      // `|| undefined` omits a blank field (pitfall #1): the backend refuses a
      // category it does not list, and an empty string is not one.
      const request = await attendanceWaiverService.submit({
        event_id: eligibility.event_id,
        category: (showCategory && category) || undefined,
        reason: (showReason && reason.trim()) || undefined,
      });
      onSubmitted(request);
    } catch (err: unknown) {
      setFromApiError(err, 'Your request could not be sent. Try again.');
      setSummaryFocus((n) => n + 1);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Ask to be excused"
      titleId="attendance-waiver-title"
      aria-describedby="attendance-waiver-description"
      onSubmit={(e) => void handleSubmit(e)}
      noValidate
      isDirty={Boolean(category || reason.trim())}
      footer={
        <>
          <button
            type="submit"
            disabled={submitting}
            className="btn-primary inline-flex w-full justify-center rounded-md text-base font-medium sm:ml-3 sm:w-auto sm:text-sm"
          >
            {submitting ? 'Sending...' : 'Send request'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="btn-secondary text-theme-text-secondary mt-3 inline-flex w-full justify-center text-base font-medium shadow-xs sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm"
          >
            Cancel
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div id="attendance-waiver-description" className="text-theme-text-secondary space-y-2 text-sm">
          <p>
            Ask to be excused from <span className="text-theme-text-primary font-medium">{eventTitle}</span>. If it is
            approved, this session no longer counts toward your attendance requirement. You can withdraw the request
            while it is waiting for a decision.
          </p>
          {eligibility.deadline && (
            <p>Requests for this session close {formatDateTime(eligibility.deadline, timezone)}.</p>
          )}
          {cap && <p>{cap} Only approved requests count.</p>}
        </div>

        <ErrorSummary items={summary} formError={formError} focusKey={summaryFocus} />

        {showCategory && (
          <FormField
            id={FIELDS.category.id}
            label={FIELDS.category.label}
            required={eligibility.category_required}
            optional={!eligibility.category_required}
            error={errors.category}
          >
            {(field) => (
              <select
                {...field}
                className="form-input"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                disabled={submitting}
              >
                <option value="">{eligibility.category_required ? 'Choose a category' : 'No category'}</option>
                {eligibility.categories.map((label) => (
                  <option key={label} value={label}>
                    {label}
                  </option>
                ))}
              </select>
            )}
          </FormField>
        )}

        {showReason && (
          <FormField
            id={FIELDS.reason.id}
            label={FIELDS.reason.label}
            required={reasonRequired}
            optional={!reasonRequired}
            error={errors.reason}
            maxLength={WAIVER_TEXT_MAX_LENGTH}
            count={reason.length}
            hint="Seen only by you and the officers who decide requests."
          >
            {(field) => (
              <textarea
                {...field}
                className="form-input"
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                disabled={submitting}
              />
            )}
          </FormField>
        )}
      </div>
    </Modal>
  );
};

export default AttendanceWaiverRequestDialog;
