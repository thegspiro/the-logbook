/**
 * The note under "Mandatory for" names each ticked requirement no member type
 * stands for, with the backend's reason, and says what follows from it. A
 * requirement that grades no member at all (no scope, or no longer active)
 * adds no one; the others grade members no tier stands for, so All members is
 * offered for them.
 */
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MandatoryPrefillNote } from './MandatoryPrefillNote';
import type { MandatoryTiersUnmapped } from '../../types/training';

const MEMBERSHIP_TYPES = [{ value: 'active', label: 'Active Member' }];

const UNSCOPED: MandatoryTiersUnmapped = {
  requirement_id: 'req-empty',
  name: 'Unscoped Attendance',
  reason: 'It applies to no members, since no member categories, ranks or positions are set',
  applies_to_no_one: true,
};

const ADMIN: MandatoryTiersUnmapped = {
  requirement_id: 'req-admin',
  name: 'Administrative Drill Attendance',
  reason: "Administrative members can't be chosen by member type",
  applies_to_no_one: false,
};

/** The note's paragraph reading exactly `text`, across the bold name and the rest. */
const paragraph = (text: string) =>
  screen.getByText((_, element) => element?.tagName === 'P' && element.textContent === text);

describe('MandatoryPrefillNote', () => {
  describe('a requirement that grades no one', () => {
    it('adds no one when it is ticked alone, rather than selecting All members for it', () => {
      render(
        <MandatoryPrefillNote
          note={{ kind: 'not-filled', unmapped: [UNSCOPED] }}
          membershipTypes={MEMBERSHIP_TYPES}
          mandatoryScope="all"
        />
      );

      expect(
        paragraph(
          'Unscoped Attendance: It applies to no members, since no member categories, ranks or positions are set, so it adds no one to Mandatory for.'
        )
      ).toBeInTheDocument();
      expect(screen.queryByText(/so All members is selected/)).not.toBeInTheDocument();
    });

    it('adds no one beside a requirement that maps, rather than offering All members for it', () => {
      render(
        <MandatoryPrefillNote
          note={{ kind: 'filled', everyone: false, sources: ['Drills'], tierIds: ['active'], unmapped: [UNSCOPED] }}
          membershipTypes={MEMBERSHIP_TYPES}
          mandatoryScope="some"
        />
      );

      expect(screen.getByText('Drills → Active Member.')).toBeInTheDocument();
      expect(
        paragraph(
          'Unscoped Attendance: It applies to no members, since no member categories, ranks or positions are set, so it adds no one to Mandatory for.'
        )
      ).toBeInTheDocument();
      expect(screen.queryByText(/choose All members if they must attend/)).not.toBeInTheDocument();
    });

    // The backend states only the fact, as it does "since …" for no scope, so
    // the note's ending is the one place that says what follows from it.
    it('says once what follows from a requirement no longer active', () => {
      render(
        <MandatoryPrefillNote
          note={{
            kind: 'not-filled',
            unmapped: [
              {
                requirement_id: 'req-retired',
                name: 'Old Drill Attendance',
                reason: 'It is no longer active',
                applies_to_no_one: true,
              },
            ],
          }}
          membershipTypes={MEMBERSHIP_TYPES}
          mandatoryScope="some"
        />
      );

      expect(
        paragraph('Old Drill Attendance: It is no longer active, so it adds no one to Mandatory for.')
      ).toBeInTheDocument();
    });

    it('says only that Mandatory for is left as it was when nothing else is ticked', () => {
      render(
        <MandatoryPrefillNote
          note={{ kind: 'not-filled', unmapped: [UNSCOPED] }}
          membershipTypes={MEMBERSHIP_TYPES}
          mandatoryScope="some"
        />
      );

      expect(screen.getByText('Mandatory for is left as it was.')).toBeInTheDocument();
    });
  });

  describe('a requirement whose members no type stands for', () => {
    it('selects All members for it when it is ticked alone', () => {
      render(
        <MandatoryPrefillNote
          note={{ kind: 'not-filled', unmapped: [ADMIN] }}
          membershipTypes={MEMBERSHIP_TYPES}
          mandatoryScope="all"
        />
      );

      expect(
        paragraph(
          "Administrative Drill Attendance: Administrative members can't be chosen by member type, so All members is selected."
        )
      ).toBeInTheDocument();
    });

    it('offers All members for it beside one that maps', () => {
      render(
        <MandatoryPrefillNote
          note={{
            kind: 'filled',
            everyone: false,
            sources: ['Drills'],
            tierIds: ['active'],
            unmapped: [UNSCOPED, ADMIN],
          }}
          membershipTypes={MEMBERSHIP_TYPES}
          mandatoryScope="some"
        />
      );

      expect(
        paragraph(
          "Administrative Drill Attendance: Administrative members can't be chosen by member type; choose All members if they must attend."
        )
      ).toBeInTheDocument();
    });

    it('still says to choose All members when it is left as it was', () => {
      render(
        <MandatoryPrefillNote
          note={{ kind: 'not-filled', unmapped: [UNSCOPED, ADMIN] }}
          membershipTypes={MEMBERSHIP_TYPES}
          mandatoryScope="some"
        />
      );

      expect(
        screen.getByText('Mandatory for is left as it was. Choose All members if they must attend.')
      ).toBeInTheDocument();
    });
  });
});
