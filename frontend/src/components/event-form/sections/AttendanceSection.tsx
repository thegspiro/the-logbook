import React from 'react';
import { Users } from 'lucide-react';
import { checkboxClass, labelClass } from '../eventFormConstants';
import type { EventFormModel } from '../useEventFormModel';

interface AttendanceSectionProps {
  model: Pick<
    EventFormModel,
    | 'formData'
    | 'handleMandatoryChange'
    | 'storedMandatoryForEveryone'
    | 'membershipTypes'
    | 'membershipTypesLoaded'
    | 'unlistedMandatoryTypes'
    | 'toggleMandatoryMembershipType'
  >;
}

/** Whether attendance is mandatory, and for which member types. */
export const AttendanceSection: React.FC<AttendanceSectionProps> = ({ model }) => {
  const {
    formData,
    handleMandatoryChange,
    storedMandatoryForEveryone,
    membershipTypes,
    membershipTypesLoaded,
    unlistedMandatoryTypes,
    toggleMandatoryMembershipType,
  } = model;
  return (
    <section className="space-y-4">
      <h2 className="text-theme-text-primary flex items-center space-x-2 text-lg font-bold">
        <Users className="h-5 w-5 text-red-700" />
        <span>Attendance</span>
      </h2>

      <label className="mobile-touch-target flex items-center justify-start space-x-3">
        <input
          type="checkbox"
          id="is-mandatory"
          checked={formData.is_mandatory}
          onChange={(e) => handleMandatoryChange(e.target.checked)}
          className={checkboxClass}
        />
        <span className="text-theme-text-secondary text-sm">Mandatory attendance</span>
      </label>

      {formData.is_mandatory && (
        <fieldset className="space-y-2 border-l-2 border-red-500/30 pl-4">
          <legend className={labelClass}>Mandatory for</legend>
          <p className="text-theme-text-muted text-xs">
            {storedMandatoryForEveryone && !formData.mandatory_membership_types?.length
              ? 'Mandatory for every member. Tick member types to narrow it.'
              : 'Select one or more member types required to attend.'}
          </p>
          {membershipTypes.map((membershipType) => (
            <label key={membershipType.value} className="mobile-touch-target flex items-center justify-start space-x-3">
              <input
                type="checkbox"
                id={`mandatory-${membershipType.value}`}
                checked={(formData.mandatory_membership_types || []).includes(membershipType.value)}
                onChange={(e) => toggleMandatoryMembershipType(membershipType.value, e.target.checked)}
                className={checkboxClass}
              />
              <span className="text-theme-text-secondary text-sm">{membershipType.label}</span>
            </label>
          ))}
          {unlistedMandatoryTypes.map((saved) => (
            <label key={saved} className="mobile-touch-target flex items-center justify-start space-x-3">
              <input
                type="checkbox"
                id={`mandatory-${saved}`}
                checked={(formData.mandatory_membership_types || []).includes(saved)}
                onChange={(e) => toggleMandatoryMembershipType(saved, e.target.checked)}
                className={checkboxClass}
              />
              <span className="text-theme-text-secondary text-sm">
                {/* Only once the department's own list has loaded: the
                    built-in fallback lacks real tiers such as senior. */}
                {membershipTypesLoaded ? `${saved} (not a current member type)` : saved}
              </span>
            </label>
          ))}
        </fieldset>
      )}
    </section>
  );
};
