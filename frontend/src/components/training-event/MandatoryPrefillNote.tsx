import React from 'react';
import { Info } from 'lucide-react';
import type { MandatoryPrefillNote as Note } from '../../hooks/useMandatoryTierPrefill';
import type { MandatoryScope } from '../event-form/eventFormTypes';

interface MandatoryPrefillNoteProps {
  note: Note;
  /** The department's member types, to name the suggested tiers. */
  membershipTypes: { value: string; label: string }[];
  /** Where Mandatory for stands now, for the not-filled note to say so. */
  mandatoryScope: MandatoryScope;
  id?: string | undefined;
}

const joinNames = (names: string[]) => names.join(', ');

/** Where a requirement grades no member at all, as the backend says (applies_to_no_one). */
const ADDS_NO_ONE = ', so it adds no one to Mandatory for.';

/**
 * Each requirement no member type stands for, with the backend's reason
 * (worded for the officer there, so it is shown as is) and what follows from
 * it. For one that grades members no type stands for, that differs by note
 * (`then`); one that grades no member at all adds no one, whatever the note,
 * and is never a reason to choose All members.
 */
const UnmappedList: React.FC<{ unmapped: Note['unmapped']; then: string }> = ({ unmapped, then }) => (
  <>
    {unmapped.map((u, index) => (
      <p key={`${u.requirement_id}-${index}`} className="text-sm">
        <span className="font-semibold">{u.name}</span>: {u.reason}
        {u.applies_to_no_one ? ADDS_NO_ONE : then}
      </p>
    ))}
  </>
);

/** The note under "Mandatory for" saying where its pre-fill came from, and what it could not map. */
export const MandatoryPrefillNote: React.FC<MandatoryPrefillNoteProps> = ({
  note,
  membershipTypes,
  mandatoryScope,
  id,
}) => {
  if (note.kind === 'not-filled') {
    // Choosing All members is offered only for a requirement that grades
    // someone: for one that grades no one there is nobody to choose it for.
    const gradesSomeone = note.unmapped.some((u) => !u.applies_to_no_one);
    return (
      <div id={id} className="alert-info flex items-start gap-3" role="note">
        <Info className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
        <div className="space-y-1">
          <p className="font-semibold">Not pre-filled from Counts toward attendance</p>
          <UnmappedList
            unmapped={note.unmapped}
            then={mandatoryScope === 'all' ? ', so All members is selected.' : '.'}
          />
          <p className="text-sm">
            {mandatoryScope === 'all'
              ? 'Choose member types instead if only some must attend.'
              : gradesSomeone
                ? 'Mandatory for is left as it was. Choose All members if they must attend.'
                : 'Mandatory for is left as it was.'}
          </p>
        </div>
      </div>
    );
  }

  const label = (tierId: string) => membershipTypes.find((type) => type.value === tierId)?.label ?? tierId;
  const who = note.everyone ? 'All members' : joinNames(note.tierIds.map(label));
  return (
    <div id={id} className="space-y-2">
      <div className="alert-info flex items-start gap-3" role="note">
        <Info className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
        <div className="space-y-1">
          <p className="font-semibold">Pre-filled from Counts toward attendance</p>
          <p className="text-sm">{note.sources.length ? `${joinNames(note.sources)} → ${who}.` : `${who}.`}</p>
          {note.unmapped.length > 0 && (
            <UnmappedList
              unmapped={note.unmapped}
              then={note.everyone ? '.' : '; choose All members if they must attend.'}
            />
          )}
        </div>
      </div>
      <p className="text-theme-text-muted text-sm">
        Once you change these, ticks on Training Info no longer update them. A member with an approved attendance waiver
        is still excused from a mandatory session.
      </p>
    </div>
  );
};
