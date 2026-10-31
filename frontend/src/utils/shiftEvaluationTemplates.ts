/**
 * Helpers for shift evaluation templates, shared by the editor and the
 * settings panel.
 */

import { ShiftEvaluationStatistic, type ShiftEvaluationTemplateWrite } from '../types/training';

/** A blank template: the paper form's 1-4 scale, one empty section. */
export const blankShiftEvaluationTemplate = (): ShiftEvaluationTemplateWrite => ({
  name: '',
  description: null,
  is_active: true,
  scale: [
    { value: 1, label: 'Unsatisfactory' },
    { value: 2, label: 'Needs Improvement' },
    { value: 3, label: 'Meets Expectations' },
    { value: 4, label: 'Exceeds Expectations' },
  ],
  allow_not_applicable: true,
  not_applicable_label: 'Not Observed',
  comment_required_at_or_below: 2,
  header_fields: [],
  statistics: [ShiftEvaluationStatistic.CALLS],
  sections: [{ title: '', column_heading: 'Skill', items: [{ label: '', comment_always_required: false }] }],
  closing_comments_label: 'Comments',
  closing_comments_hint: null,
  evaluator_rule: 'shift_officer',
  evaluated_seats: [],
});

/** What has to be fixed before the server is asked, in the order it appears on the form. */
export function shiftEvaluationTemplateProblems(body: ShiftEvaluationTemplateWrite): string[] {
  const problems: string[] = [];
  if (!body.name.trim()) problems.push('Give the template a name.');
  if (body.scale.length < 2) problems.push('The rating scale needs at least two ratings.');
  if (body.scale.some((level) => !level.label.trim())) problems.push('Every rating needs a label.');
  const values = body.scale.map((level) => level.value);
  if (new Set(values).size !== values.length) problems.push('Each rating value may appear only once.');
  body.header_fields.forEach((field) => {
    if (!field.label.trim()) problems.push('Every header field needs a label.');
    if (field.type === 'choice' && field.options.filter((o) => o.trim()).length < 2) {
      problems.push(`"${field.label.trim() || 'A choice field'}" needs at least two options.`);
    }
  });
  if (body.sections.length === 0) problems.push('Add at least one section.');
  body.sections.forEach((section, index) => {
    const name = section.title.trim() || `Section ${index + 1}`;
    if (!section.title.trim()) problems.push(`Section ${index + 1} needs a title.`);
    if (section.items.length === 0) problems.push(`${name} needs at least one item.`);
    if (section.items.some((item) => !item.label.trim())) problems.push(`Every item in ${name} needs a name.`);
  });
  return problems;
}
