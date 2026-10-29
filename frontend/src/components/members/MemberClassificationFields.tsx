import React from 'react';
import { MEMBER_CLASS_LABELS, MemberClass } from '../../constants/enums';
import { statusOptionsFor } from '../../utils/membership';
import type { MembershipTier } from '../../types/user';

interface MemberClassificationFieldsProps {
  memberClass: string;
  memberStatus: string;
  onClassChange: (value: MemberClass) => void;
  onStatusChange: (value: string) => void;
  /** The department's ladder, so its tiers are offered as statuses by name. */
  tiers?: readonly MembershipTier[] | undefined;
  /** A value already stored that neither list names, so the control can show it. */
  currentStatus?: string | null | undefined;
  disabled?: boolean | undefined;
  required?: boolean | undefined;
  /** Prefix for the two control ids, so a page with several forms keeps them unique. */
  idPrefix?: string | undefined;
  labelClassName?: string | undefined;
  selectClassName?: string | undefined;
}

/**
 * The two independent facts about a member's standing, as two controls.
 *
 * Class is what kind of member somebody is: operational members ride,
 * administrative members hold corporate office, social members support the
 * company without responding. Status is where they sit on the membership
 * ladder, from prospective to life, including the department's own tiers.
 * One fused "Membership Type" dropdown could not say "administrative and a
 * life member", which is exactly what a long-serving treasurer is.
 */
export const MemberClassificationFields: React.FC<MemberClassificationFieldsProps> = ({
  memberClass,
  memberStatus,
  onClassChange,
  onStatusChange,
  tiers,
  currentStatus,
  disabled = false,
  required = false,
  idPrefix = 'member',
  labelClassName = 'text-theme-text-primary mb-2 block text-sm font-medium',
  selectClassName = 'form-input',
}) => {
  const statusOptions = statusOptionsFor(tiers, currentStatus ? [currentStatus] : []);
  const marker = required ? <span className="text-red-700 dark:text-red-400"> *</span> : null;

  return (
    <>
      <div>
        <label htmlFor={`${idPrefix}-member-class`} className={labelClassName}>
          Member class{marker}
        </label>
        <select
          id={`${idPrefix}-member-class`}
          aria-describedby={`${idPrefix}-member-class-help`}
          value={memberClass}
          onChange={(e) => onClassChange(e.target.value as MemberClass)}
          className={selectClassName}
          disabled={disabled}
        >
          {(Object.values(MemberClass) as MemberClass[]).map((value) => (
            <option key={value} value={value}>
              {MEMBER_CLASS_LABELS[value]}
            </option>
          ))}
        </select>
        <p id={`${idPrefix}-member-class-help`} className="text-theme-text-muted mt-1 text-xs">
          Operational members ride and hold a rank. Administrative members hold office without responding. Social
          members support the department.
        </p>
      </div>
      <div>
        <label htmlFor={`${idPrefix}-member-status`} className={labelClassName}>
          Membership status{marker}
        </label>
        <select
          id={`${idPrefix}-member-status`}
          aria-describedby={`${idPrefix}-member-status-help`}
          value={memberStatus}
          onChange={(e) => onStatusChange(e.target.value)}
          className={selectClassName}
          disabled={disabled}
        >
          {statusOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
        <p id={`${idPrefix}-member-status-help`} className="text-theme-text-muted mt-1 text-xs">
          Where they sit on the membership ladder. Any class can be probationary, regular or life; the tier ladder
          advances this by years of service.
        </p>
      </div>
    </>
  );
};

export default MemberClassificationFields;
