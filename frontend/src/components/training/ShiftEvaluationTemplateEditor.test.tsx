import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../test/utils';
import { ShiftEvaluationTemplateEditor } from './ShiftEvaluationTemplateEditor';
import { blankShiftEvaluationTemplate, shiftEvaluationTemplateProblems } from '../../utils/shiftEvaluationTemplates';
import type { ShiftEvaluationTemplateWrite } from '../../types/training';

const onSave = vi.fn();

const filled = (): ShiftEvaluationTemplateWrite => ({
  ...blankShiftEvaluationTemplate(),
  name: 'Driver Evaluation',
  sections: [
    {
      key: 'driving',
      title: 'Driving',
      column_heading: 'Skill',
      items: [
        { key: 'backing', label: 'Backing', comment_always_required: false },
        { key: 'intersections', label: 'Intersections', comment_always_required: false },
      ],
    },
  ],
});

const renderEditor = (initial: ShiftEvaluationTemplateWrite = filled()) =>
  renderWithRouter(
    <ShiftEvaluationTemplateEditor initial={initial} heading="Edit" saving={false} onSave={onSave} onCancel={vi.fn()} />
  );

const save = async (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getAllByRole('button', { name: 'Save template' })[0] ?? document.body);

const lastSaved = () => onSave.mock.calls[onSave.mock.calls.length - 1]?.[0] as ShiftEvaluationTemplateWrite;

describe('ShiftEvaluationTemplateEditor', () => {
  beforeEach(() => {
    onSave.mockReset();
  });

  it('reorders items, keeping each item’s key', async () => {
    const user = userEvent.setup();
    renderEditor();

    await user.click(screen.getByRole('button', { name: 'Move Intersections up' }));
    await save(user);

    expect(lastSaved().sections[0]?.items.map((i) => i.key)).toEqual(['intersections', 'backing']);
  });

  it('adds an item with no key, for the server to mint', async () => {
    const user = userEvent.setup();
    renderEditor();

    await user.click(screen.getByRole('button', { name: '+ Add item' }));
    await user.type(screen.getByLabelText('Driving item 3 name'), 'Parking');
    await save(user);

    const added = lastSaved().sections[0]?.items[2];
    expect(added).toEqual({ label: 'Parking', comment_always_required: false });
  });

  it('clears the comment threshold when its rating is removed', async () => {
    const user = userEvent.setup();
    renderEditor();

    expect(screen.getByLabelText('Comment required at or below')).toHaveValue('2');
    await user.click(screen.getByRole('button', { name: 'Remove rating Needs Improvement' }));
    await save(user);

    expect(lastSaved().comment_required_at_or_below).toBeNull();
    expect(lastSaved().scale.map((l) => l.value)).toEqual([1, 3, 4]);
  });

  it('adds a choice header field with its options', async () => {
    const user = userEvent.setup();
    renderEditor();

    await user.click(screen.getByRole('button', { name: /Add field/ }));
    await user.type(screen.getByLabelText('Header field 1 label'), 'Shift');
    await user.selectOptions(screen.getByLabelText('Header field 1 type'), 'Pick one');
    await user.type(screen.getByLabelText('Shift option 1'), 'A');
    await user.type(screen.getByLabelText('Shift option 2'), 'B');
    await save(user);

    expect(lastSaved().header_fields).toEqual([
      { label: 'Shift', type: 'choice', options: ['A', 'B'], required: false },
    ]);
  });

  it('records evaluated seats, including one the department named itself', async () => {
    const user = userEvent.setup();
    renderEditor();

    await user.click(screen.getByRole('button', { name: 'EMT' }));
    await user.type(screen.getByLabelText('Another seat name'), 'Tiller{Enter}');
    await save(user);

    expect(lastSaved().evaluated_seats).toEqual(['ems', 'Tiller']);
  });

  it('lists every problem instead of saving a form the server would refuse', async () => {
    const user = userEvent.setup();
    renderEditor({ ...blankShiftEvaluationTemplate() });

    await save(user);

    const alert = screen.getByRole('alert');
    expect(within(alert).getByText('Give the template a name.')).toBeInTheDocument();
    expect(within(alert).getByText('Section 1 needs a title.')).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });
});

describe('shiftEvaluationTemplateProblems', () => {
  it('passes a complete template', () => {
    expect(shiftEvaluationTemplateProblems(filled())).toEqual([]);
  });

  it('flags a repeated rating value and a choice field short of options', () => {
    const problems = shiftEvaluationTemplateProblems({
      ...filled(),
      scale: [
        { value: 1, label: 'Low' },
        { value: 1, label: 'Also low' },
      ],
      header_fields: [{ label: 'Shift', type: 'choice', options: ['A', ' '], required: false }],
    });
    expect(problems).toContain('Each rating value may appear only once.');
    expect(problems).toContain('"Shift" needs at least two options.');
  });
});
