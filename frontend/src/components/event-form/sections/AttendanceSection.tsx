import React from 'react';
import { Users } from 'lucide-react';
import { FIELD_ERROR_CLASS } from '../../ux/FormField';
import { EVENT_FIELD_IDS, checkboxClass, labelClass } from '../eventFormConstants';
import type { MandatoryScope } from '../eventFormTypes';
import type { EventFormModel } from '../useEventFormModel';

const MANDATORY_FOR_ERROR_ID = 'mandatory-for-error';

interface AttendanceSectionProps {
  model: Pick<
    EventFormModel,
    | 'formData'
    | 'fieldErrors'
    | 'handleMandatoryChange'
    | 'mandatoryScope'
    | 'setMandatoryScope'
    | 'membershipTypes'
    | 'membershipTypesLoaded'
    | 'unlistedMandatoryTypes'
    | 'toggleMandatoryMembershipType'
  >;
  /** Where "Mandatory for" opens when Mandatory attendance is ticked. */
  scopeOnTick?: MandatoryScope | undefined;
}

/** Whether attendance is mandatory, and for every member or which member types. */
export const AttendanceSection: React.FC<AttendanceSectionProps> = ({ model, scopeOnTick = 'some' }) => {
  const {
    formData,
    fieldErrors,
    handleMandatoryChange,
    mandatoryScope,
    setMandatoryScope,
    membershipTypes,
    membershipTypesLoaded,
    unlistedMandatoryTypes,
    toggleMandatoryMembershipType,
  } = model;
  const error = fieldErrors.mandatory_membership_types;
  const selected = formData.mandatory_membership_types || [];
  const typeBoxes = [
    ...membershipTypes.map((type) => ({ value: type.value, label: type.label })),
    ...unlistedMandatoryTypes.map((saved) => ({
      value: saved,
      // Only once the department's own list has loaded: the built-in
      // fallback lacks real tiers such as senior.
      label: membershipTypesLoaded ? `${saved} (not a current member type)` : saved,
    })),
  ];
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
          onChange={(e) => handleMandatoryChange(e.target.checked, scopeOnTick)}
          className={checkboxClass}
        />
        <span className="text-theme-text-secondary text-sm">Mandatory attendance</span>
      </label>

      {formData.is_mandatory && (
        <fieldset
          className="space-y-2 border-l-2 border-red-500/30 pl-4"
          aria-describedby={error ? MANDATORY_FOR_ERROR_ID : undefined}
        >
          <legend className={labelClass}>Mandatory for</legend>
          <label className="mobile-touch-target flex items-center justify-start space-x-3">
            <input
              type="radio"
              name="mandatory-scope"
              id="mandatory-scope-all"
              checked={mandatoryScope === 'all'}
              onChange={() => setMandatoryScope('all')}
              className={checkboxClass}
            />
            <span className="text-theme-text-secondary text-sm">All members</span>
          </label>
          <label className="mobile-touch-target flex items-center justify-start space-x-3">
            <input
              type="radio"
              name="mandatory-scope"
              id="mandatory-scope-some"
              checked={mandatoryScope === 'some'}
              onChange={() => setMandatoryScope('some')}
              className={checkboxClass}
            />
            <span className="text-theme-text-secondary text-sm">Only these member types</span>
          </label>

          {mandatoryScope === 'some' && (
            <div className="space-y-2 pl-7">
              <p className="text-theme-text-muted text-xs">Select one or more member types required to attend.</p>
              {typeBoxes.map((type, index) => (
                <label key={type.value} className="mobile-touch-target flex items-center justify-start space-x-3">
                  <input
                    type="checkbox"
                    // The first box takes the field's id, so a refusal can focus it.
                    id={index === 0 ? EVENT_FIELD_IDS.mandatory_membership_types : `mandatory-${type.value}`}
                    checked={selected.includes(type.value)}
                    onChange={(e) => toggleMandatoryMembershipType(type.value, e.target.checked)}
                    aria-invalid={error ? true : undefined}
                    aria-describedby={error ? MANDATORY_FOR_ERROR_ID : undefined}
                    className={checkboxClass}
                  />
                  <span className="text-theme-text-secondary text-sm">{type.label}</span>
                </label>
              ))}
            </div>
          )}
          {error && (
            <p id={MANDATORY_FOR_ERROR_ID} className={`text-sm ${FIELD_ERROR_CLASS}`}>
              {error}
            </p>
          )}
        </fieldset>
      )}
    </section>
  );
};
