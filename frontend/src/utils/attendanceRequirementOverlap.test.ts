import { describe, it, expect } from 'vitest';
import { ambiguousAttendanceRequirements, ambiguousAttendanceWarning } from './attendanceRequirementOverlap';
import type { TrainingRequirement } from '../types/training';

type Shape = Pick<TrainingRequirement, 'id' | 'name' | 'requirement_type' | 'active' | 'required_membership_types'>;

const req = (id: string, types: string[], over: Partial<Shape> = {}): Shape => ({
  id,
  name: `Req ${id}`,
  requirement_type: 'session_attendance',
  active: true,
  required_membership_types: types,
  ...over,
});

const ids = (saved: Shape, all: Shape[]) => ambiguousAttendanceRequirements(saved, all).map((r) => r.id);

describe('ambiguousAttendanceRequirements', () => {
  it('flags another requirement naming a shared membership type', () => {
    const saved = req('a', ['active', 'probationary']);
    expect(ids(saved, [saved, req('b', ['probationary'])])).toEqual(['b']);
  });

  it('flags two requirements that name no type, since both apply to everyone', () => {
    const saved = req('a', []);
    expect(ids(saved, [saved, req('b', [])])).toEqual(['b']);
  });

  it('does not flag disjoint types', () => {
    const saved = req('a', ['active']);
    expect(ids(saved, [req('b', ['probationary'])])).toEqual([]);
  });

  it('does not flag a named requirement beside one that names none: the named one governs its types', () => {
    const saved = req('a', ['active']);
    expect(ids(saved, [req('b', [])])).toEqual([]);
  });

  it('ignores inactive requirements and other requirement types', () => {
    const saved = req('a', ['active']);
    expect(
      ids(saved, [req('b', ['active'], { active: false }), req('c', ['active'], { requirement_type: 'hours' })])
    ).toEqual([]);
  });

  it('says nothing about a saved requirement that is not session attendance, or inactive', () => {
    expect(ids(req('a', ['active'], { requirement_type: 'hours' }), [req('b', ['active'])])).toEqual([]);
    expect(ids(req('a', ['active'], { active: false }), [req('b', ['active'])])).toEqual([]);
  });

  it('treats a missing type list as naming none', () => {
    // The key is absent, not undefined: that is how an older row arrives.
    const saved: Shape = { id: 'a', name: 'Req a', requirement_type: 'session_attendance', active: true };
    expect(ids(saved, [req('b', [])])).toEqual(['b']);
  });
});

describe('ambiguousAttendanceWarning', () => {
  it('names the colliding requirements', () => {
    const warning = ambiguousAttendanceWarning(req('a', ['active']), [req('b', ['active']), req('c', ['active'])]);
    expect(warning).toContain('"Req a" and "Req b", "Req c"');
    expect(warning).toContain('no single governing requirement');
  });

  it('is null when nothing collides', () => {
    expect(ambiguousAttendanceWarning(req('a', ['active']), [])).toBeNull();
  });
});
