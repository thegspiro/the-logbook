import { describe, it, expect } from 'vitest';
import type { ShiftEvaluationFormSnapshot } from '../types/training';
import { commentRequired, parseCount, shiftEvaluationPagePath, shiftEvaluationProblems } from './shiftEvaluations';

const form: ShiftEvaluationFormSnapshot = {
  name: 'EMT Shift Evaluation',
  scale: [
    { value: 1, label: 'Unsatisfactory' },
    { value: 2, label: 'Needs Improvement' },
    { value: 3, label: 'Meets Expectations' },
    { value: 4, label: 'Exceeds Expectations' },
  ],
  allow_not_applicable: true,
  not_applicable_label: 'Not Observed',
  comment_required_at_or_below: 2,
  header_fields: [
    { key: 'platoon', label: 'Shift (A, B, C)', type: 'choice', options: ['A', 'B', 'C'], required: true },
  ],
  statistics: ['calls', 'transports', 'refusals'],
  sections: [
    {
      key: 'clinical',
      title: 'Clinical Performance',
      column_heading: 'Skill Area',
      items: [
        { key: 'als', label: 'Assist with ALS skills', comment_always_required: true },
        { key: 'vitals', label: 'Vital Signs', comment_always_required: false },
      ],
    },
  ],
};

const complete = {
  header_values: { platoon: 'B' },
  statistics: { calls: '7', transports: '4', refusals: '2' },
  responses: {
    als: { rating: 3, not_applicable: false, comment: '12-lead' },
    vitals: { rating: null, not_applicable: true, comment: null },
  },
  closing_comments: '',
};

describe('shiftEvaluationProblems', () => {
  it('passes a complete evaluation, N/A counting as an answer', () => {
    expect(shiftEvaluationProblems(form, complete)).toEqual([]);
  });

  it('lists what is missing, in form order', () => {
    expect(
      shiftEvaluationProblems(form, { header_values: {}, statistics: {}, responses: {}, closing_comments: '' })
    ).toEqual([
      'Answer "Shift (A, B, C)".',
      'Enter the number of calls.',
      'Enter the number of transports.',
      'Enter the number of refusals.',
      'Rate "Assist with ALS skills".',
      'Rate "Vital Signs".',
    ]);
  });

  it('asks for a comment on a low rating and on an always-commented item', () => {
    expect(
      shiftEvaluationProblems(form, {
        ...complete,
        responses: {
          als: { rating: 4, not_applicable: false, comment: '  ' },
          vitals: { rating: 2, not_applicable: false, comment: null },
        },
      })
    ).toEqual(['Add a comment for "Assist with ALS skills".', 'Add a comment for "Vital Signs".']);
  });

  it('keeps transports and refusals within the calls', () => {
    expect(
      shiftEvaluationProblems(form, { ...complete, statistics: { calls: '3', transports: '3', refusals: '1' } })
    ).toEqual(['Transports and refusals together cannot exceed the number of calls.']);
  });
});

describe('commentRequired', () => {
  const vitals = { key: 'vitals', label: 'Vital Signs', comment_always_required: false };

  it('requires one at or below the threshold only', () => {
    expect(commentRequired(form, vitals, { rating: 2, not_applicable: false })).toBe(true);
    expect(commentRequired(form, vitals, { rating: 3, not_applicable: false })).toBe(false);
    expect(commentRequired(form, vitals, { rating: null, not_applicable: true })).toBe(false);
  });

  it('never requires one by rating when the form has no threshold', () => {
    expect(
      commentRequired({ ...form, comment_required_at_or_below: null }, vitals, { rating: 1, not_applicable: false })
    ).toBe(false);
  });
});

describe('parseCount and paths', () => {
  it('reads only whole non-negative numbers', () => {
    expect(parseCount('7')).toBe(7);
    expect(parseCount(' 0 ')).toBe(0);
    expect(parseCount('')).toBeUndefined();
    expect(parseCount('2.5')).toBeUndefined();
    expect(parseCount(undefined)).toBeUndefined();
  });

  it('builds the evaluation page path', () => {
    expect(shiftEvaluationPagePath('sh1', 'u2', 'combined')).toBe(
      '/scheduling/shift-reports/sh1/evaluations/u2/combined'
    );
  });
});
