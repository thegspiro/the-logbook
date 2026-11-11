import { useEffect, useRef, useState } from 'react';
import { trainingSessionService } from '../services/api';
import type { MandatoryTiersUnmapped } from '../types/training';
import type { MandatoryScope } from '../components/event-form/eventFormTypes';
import type { EventFormModel } from '../components/event-form/useEventFormModel';

/** Who the ticked attendance requirements suggest the event is mandatory for. */
interface Suggestion {
  scope: MandatoryScope;
  tierIds: string[];
}

/**
 * What the note under "Mandatory for" says. `filled`: the suggestion came
 * from these requirements; `not-filled`: none of them maps to a member type,
 * so Mandatory for was left as it was.
 */
export type MandatoryPrefillNote =
  | { kind: 'filled'; everyone: boolean; sources: string[]; tierIds: string[]; unmapped: MandatoryTiersUnmapped[] }
  | { kind: 'not-filled'; unmapped: MandatoryTiersUnmapped[] };

type AttendanceModel = Pick<
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
  | 'update'
>;

/**
 * "Mandatory for" pre-filled from Counts toward attendance (owner decision
 * 2026-11-10): who the ticked requirements grade, as the backend projects them
 * onto the department's tiers (`mandatory_tiers_for_requirements`; the form
 * does not translate member types itself, pitfall #29).
 *
 * Ticking requirements never ticks Mandatory attendance: counting toward a
 * requirement's percentage does not make attending mandatory. The suggestion
 * is written into Mandatory for when Mandatory is on, or the moment the
 * officer ticks it.
 *
 * - It runs only when Counts toward attendance changes (`requirementsChanged`),
 *   never when an existing event loads, so an edit keeps its stored choice.
 * - Once the officer changes Mandatory for by hand, ticks no longer update it,
 *   the same rule as the reminder audience (`reminderAudienceEdited`).
 * - A requirement that applies to everyone suggests All members.
 * - Requirements no tier stands for are named in the note; when none of the
 *   ticked ones maps, Mandatory for is left as it was rather than falling back
 *   to everyone.
 * - Unticking every requirement leaves Mandatory and Mandatory for alone.
 */
export function useMandatoryTierPrefill(
  model: AttendanceModel,
  requirementName: (id: string) => string
): {
  /** Call with Counts toward attendance's new ticks. */
  requirementsChanged: (ids: string[]) => void;
  /** The model for `AttendanceSection`: its Mandatory-for edits stop the pre-fill, and ticking Mandatory opens on it. */
  attendanceModel: AttendanceModel;
  note: MandatoryPrefillNote | null;
} {
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [note, setNote] = useState<MandatoryPrefillNote | null>(null);
  const touched = useRef(false);
  const requestSeq = useRef(0);
  // A response lands after the render that sent it; it must see whether
  // Mandatory is on now, not when the request went out.
  const isMandatory = useRef(Boolean(model.formData.is_mandatory));
  useEffect(() => {
    isMandatory.current = Boolean(model.formData.is_mandatory);
  });

  const { update, setMandatoryScope, handleMandatoryChange, toggleMandatoryMembershipType } = model;

  const writeInto = (s: Suggestion) => {
    setMandatoryScope(s.scope);
    // All members keeps the member-type ticks apart, as the model does, so
    // choosing Only these member types again does not lose them.
    if (s.scope === 'some') update({ mandatory_membership_types: s.tierIds });
  };

  const requirementsChanged = (ids: string[]) => {
    requestSeq.current += 1;
    const seq = requestSeq.current;
    if (ids.length === 0 || touched.current) {
      // Nothing left to suggest from, or the officer has chosen: the fields
      // stay as they are, and the note no longer describes the ticks.
      setSuggestion(null);
      setNote(null);
      return;
    }
    trainingSessionService
      .getMandatoryTiers(ids)
      .then((result) => {
        if (seq !== requestSeq.current || touched.current) return;
        const unmapped = result.unmapped;
        if (!result.everyone && result.tier_ids.length === 0) {
          setSuggestion(null);
          setNote(unmapped.length ? { kind: 'not-filled', unmapped } : null);
          return;
        }
        const next: Suggestion = result.everyone
          ? { scope: 'all', tierIds: [] }
          : { scope: 'some', tierIds: result.tier_ids };
        const unmappedIds = new Set(unmapped.map((u) => u.requirement_id));
        setSuggestion(next);
        setNote({
          kind: 'filled',
          everyone: result.everyone,
          sources: ids.filter((id) => !unmappedIds.has(id)).map(requirementName),
          tierIds: next.tierIds,
          unmapped,
        });
        if (isMandatory.current) writeInto(next);
      })
      .catch(() => {
        // Non-critical: Mandatory for stays as the officer left it.
        if (seq !== requestSeq.current) return;
        setSuggestion(null);
        setNote(null);
      });
  };

  const attendanceModel: AttendanceModel = {
    ...model,
    handleMandatoryChange: (checked, scopeOnTick) => {
      if (checked && suggestion && !touched.current) {
        handleMandatoryChange(true, suggestion.scope);
        if (suggestion.scope === 'some') update({ mandatory_membership_types: suggestion.tierIds });
        return;
      }
      handleMandatoryChange(checked, scopeOnTick);
    },
    setMandatoryScope: (scope) => {
      touched.current = true;
      setMandatoryScope(scope);
    },
    toggleMandatoryMembershipType: (type, checked) => {
      touched.current = true;
      toggleMandatoryMembershipType(type, checked);
    },
  };

  return { requirementsChanged, attendanceModel, note };
}
