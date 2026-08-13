import { describe, it, expect } from 'vitest';
import { hydrateTemplateSections } from './skillTemplateSections';

describe('hydrateTemplateSections', () => {
  it('generates the positional ids the section results are keyed by', () => {
    const sections = hydrateTemplateSections([
      { name: 'Scene Size-Up', criteria: [{ label: 'Scene is safe' }, { label: 'Number of patients' }] },
      { name: 'Primary Survey', criteria: [{ label: 'Assesses airway' }] },
    ]);

    expect(sections.map((s) => s.id)).toEqual(['section-0', 'section-1']);
    expect(sections[0]?.criteria.map((c) => c.id)).toEqual(['criterion-0-0', 'criterion-0-1']);
    expect(sections[1]?.criteria[0]?.id).toBe('criterion-1-0');
  });

  it('returns an empty list for missing sections', () => {
    expect(hydrateTemplateSections(null)).toEqual([]);
    expect(hydrateTemplateSections(undefined)).toEqual([]);
  });

  it('keeps every renderable criterion type as stored', () => {
    const sections = hydrateTemplateSections([
      {
        name: 'S',
        criteria: [
          { label: 'a', type: 'pass_fail' },
          { label: 'b', type: 'score' },
          { label: 'c', type: 'time_limit' },
          { label: 'd', type: 'checklist' },
          { label: 'e', type: 'statement' },
        ],
      },
    ]);

    expect(sections[0]?.criteria.map((c) => c.type)).toEqual([
      'pass_fail',
      'score',
      'time_limit',
      'checklist',
      'statement',
    ]);
  });

  // An unknown type renders no input control at all, so the step cannot be
  // marked — and an unmarked critical step scores as a failure. Templates
  // seeded before the API closed the whitelist stored "checkbox" on every
  // criterion, which failed every evaluation run against them at 0%.
  it('falls back to pass/fail for a type the examiner screen cannot render', () => {
    const sections = hydrateTemplateSections([{ name: 'S', criteria: [{ label: 'Dons the pack', type: 'checkbox' }] }]);

    expect(sections[0]?.criteria[0]?.type).toBe('pass_fail');
  });

  it('falls back to pass/fail when the type is absent or not a string', () => {
    const sections = hydrateTemplateSections([
      { name: 'S', criteria: [{ label: 'a' }, { label: 'b', type: null }, { label: 'c', type: 7 }] },
    ]);

    expect(sections[0]?.criteria.map((c) => c.type)).toEqual(['pass_fail', 'pass_fail', 'pass_fail']);
  });

  it('carries the per-type companion fields through', () => {
    const sections = hydrateTemplateSections([
      {
        name: 'Donning',
        criteria: [
          { label: 'Score', type: 'score', max_score: 5, passing_score: 3, required: true },
          { label: 'Timed', type: 'time_limit', time_limit_seconds: 60 },
          { label: 'List', type: 'checklist', checklist_items: ['one', 'two'] },
          { label: 'Read', type: 'statement', statement_text: 'Go.', starts_timer: true },
        ],
      },
    ]);

    const [score, timed, list, statement] = sections[0]?.criteria ?? [];
    expect(score).toMatchObject({ max_score: 5, passing_score: 3, required: true });
    expect(timed?.time_limit_seconds).toBe(60);
    expect(list?.checklist_items).toEqual(['one', 'two']);
    expect(statement).toMatchObject({ statement_text: 'Go.', starts_timer: true });
  });

  it('defaults starts_timer to false so a statement never opens the clock by itself', () => {
    const sections = hydrateTemplateSections([
      { name: 'S', criteria: [{ label: 'Read', type: 'statement', statement_text: 'Brief.' }] },
    ]);

    expect(sections[0]?.criteria[0]?.starts_timer).toBe(false);
  });
  // Hydration is a whitelist, so a field it forgets is a field the examiner
  // screen, the review view and both print pages all lose — a deduction would
  // vanish from every display while the percentage still took it.
  it('carries the score mode and its penalty through', () => {
    const sections = hydrateTemplateSections([
      {
        name: 'Cot Questions',
        criteria: [
          { label: 'How many people', type: 'pass_fail', score_mode: 'deduct', deduction_points: 2 },
          { label: 'How high', type: 'pass_fail', score_mode: 'points', max_score: 3 },
        ],
      },
    ]);

    const [deducting, earning] = sections[0]?.criteria ?? [];
    expect(deducting).toMatchObject({ score_mode: 'deduct', deduction_points: 2 });
    expect(earning).toMatchObject({ score_mode: 'points', max_score: 3 });
  });

  it('leaves an unrecognized mode unset rather than inventing one', () => {
    // Unset defers to the template-wide Pass/Fail setting, which is what the
    // backend scorer does with a mode it does not know. Reading it as 'none'
    // here would disagree with the number the scorecard reports.
    const sections = hydrateTemplateSections([
      {
        name: 'S',
        criteria: [
          { label: 'a', score_mode: 'penalise' },
          { label: 'b', score_mode: 3 },
        ],
      },
    ]);

    expect(sections[0]?.criteria.map((c) => c.score_mode)).toEqual([undefined, undefined]);
  });

  it('drops a penalty that is not a usable number', () => {
    const sections = hydrateTemplateSections([
      {
        name: 'S',
        criteria: [
          { label: 'a', score_mode: 'deduct', deduction_points: 0 },
          { label: 'b', score_mode: 'deduct', deduction_points: '2' },
        ],
      },
    ]);

    // The scorer charges one point for a deduct step with no usable value, and
    // showing "−0" beside a failed step would contradict it.
    expect(sections[0]?.criteria.map((c) => c.deduction_points)).toEqual([undefined, undefined]);
  });
});
