import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mockCreate = vi.fn();
const mockUpdate = vi.fn();

vi.mock('../services/api', () => ({
  minutesService: {
    createOutline: (...a: unknown[]) => mockCreate(...a) as unknown,
    updateOutline: (...a: unknown[]) => mockUpdate(...a) as unknown,
  },
}));

import { OutlineEditorModal } from './OutlineEditorModal';
import { renderWithRouter } from '../../../test/utils';
import type { MinutesTemplate } from '../types/minutes';

const outline: MinutesTemplate = {
  id: 'o1',
  organization_id: 'org',
  name: 'Our order',
  description: 'How we run it',
  meeting_type: 'business',
  is_default: true,
  sections: [
    { order: 1, key: 'roll_call', title: 'Roll Call', default_content: '', required: true },
    { order: 0, key: 'call_to_order', title: 'Call to Order', default_content: '', required: true },
    { order: 2, key: 'adjournment', title: 'Adjournment', default_content: '', required: false },
  ],
  header_config: { subtitle: 'Official Minutes', show_date: true },
  footer_config: { confidentiality_notice: 'Members only', show_page_numbers: true },
  created_at: '',
  updated_at: '',
};

describe('OutlineEditorModal', () => {
  const onSaved = vi.fn();
  const onClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockCreate.mockReset();
    mockUpdate.mockReset();
    mockCreate.mockResolvedValue(outline);
    mockUpdate.mockResolvedValue(outline);
    onSaved.mockResolvedValue(undefined);
  });

  const open = (props: { outline?: MinutesTemplate | null; copyFrom?: MinutesTemplate | null } = {}) =>
    renderWithRouter(
      <OutlineEditorModal
        isOpen
        outline={props.outline ?? null}
        copyFrom={props.copyFrom ?? null}
        onClose={onClose}
        onSaved={onSaved}
      />
    );

  it('starts a new outline with the two sections every meeting has', () => {
    open();
    expect(screen.getByLabelText('Section 1 title')).toHaveValue('Call to Order');
    expect(screen.getByLabelText('Section 2 title')).toHaveValue('Adjournment');
  });

  it('shows an existing outline in its order of business', () => {
    open({ outline });
    expect(screen.getAllByLabelText(/Section \d title/).map((el) => (el as HTMLInputElement).value)).toEqual([
      'Call to Order',
      'Roll Call',
      'Adjournment',
    ]);
    expect(screen.getByLabelText('Name')).toHaveValue('Our order');
    expect(screen.getByLabelText('Heading under the department name')).toHaveValue('Official Minutes');
  });

  it('creates an outline with new sections keyed from their titles, in the order shown', async () => {
    const user = userEvent.setup();
    open();

    await user.type(screen.getByLabelText('Name'), 'Short form');
    await user.click(screen.getByRole('button', { name: 'Add section' }));
    await user.type(screen.getByLabelText('Section 3 title'), "Chief's Report");
    await user.click(screen.getByRole('button', { name: "Move Chief's Report up" }));
    await user.click(screen.getByRole('button', { name: 'Save outline' }));

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const sent = mockCreate.mock.calls[0]?.[0] as { sections: Array<{ order: number; key: string }>; name: string };
    expect(sent.name).toBe('Short form');
    expect(sent.sections.map((s) => [s.order, s.key])).toEqual([
      [0, 'call_to_order'],
      [1, 'chief_s_report'],
      [2, 'adjournment'],
    ]);
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('saves every section’s starting text as rich text, turning old plain text into paragraphs', async () => {
    const user = userEvent.setup();
    const plain: MinutesTemplate = {
      ...outline,
      sections: [
        {
          order: 0,
          key: 'call_to_order',
          title: 'Call to Order',
          default_content: 'The chair calls the meeting to order.\n\nNote the time <7pm',
          required: true,
        },
        { order: 1, key: 'adjournment', title: 'Adjournment', default_content: '', required: false },
      ],
    };
    open({ outline: plain });

    await user.click(screen.getByRole('button', { name: 'Save outline' }));

    const sent = mockUpdate.mock.calls[0]?.[1] as {
      sections: Array<{ key: string; default_content: string; format?: string }>;
    };
    expect(sent.sections.map((x) => x.format)).toEqual(['html', 'html']);
    expect(sent.sections[0]?.default_content).toBe(
      '<p>The chair calls the meeting to order.</p><p>Note the time &lt;7pm</p>'
    );
    expect(sent.sections[1]?.default_content).toBe('');
  });

  it('gives each section a formatting toolbar for its starting text', async () => {
    open({ outline });
    expect(await screen.findAllByRole('toolbar')).toHaveLength(3);
    expect(screen.getByRole('textbox', { name: 'Starting text for Roll Call' })).toBeInTheDocument();
  });

  it('keeps a section’s key when it is renamed', async () => {
    const user = userEvent.setup();
    open({ outline });

    const title = screen.getByLabelText('Section 2 title');
    await user.clear(title);
    await user.type(title, 'Attendance');
    await user.click(screen.getByRole('button', { name: 'Save outline' }));

    const sent = mockUpdate.mock.calls[0]?.[1] as { sections: Array<{ key: string; title: string }> };
    expect(mockUpdate.mock.calls[0]?.[0]).toBe('o1');
    expect(sent.sections.map((s) => [s.key, s.title])).toEqual([
      ['call_to_order', 'Call to Order'],
      ['roll_call', 'Attendance'],
      ['adjournment', 'Adjournment'],
    ]);
  });

  it('gives two sections with the same title different keys', async () => {
    const user = userEvent.setup();
    open();

    await user.type(screen.getByLabelText('Name'), 'Doubled');
    await user.click(screen.getByRole('button', { name: 'Add section' }));
    await user.click(screen.getByRole('button', { name: 'Add section' }));
    await user.type(screen.getByLabelText('Section 3 title'), 'Old Business');
    await user.type(screen.getByLabelText('Section 4 title'), 'Old Business');
    await user.click(screen.getByRole('button', { name: 'Save outline' }));

    const sent = mockCreate.mock.calls[0]?.[0] as { sections: Array<{ key: string }> };
    expect(sent.sections.map((s) => s.key)).toEqual(['call_to_order', 'adjournment', 'old_business', 'old_business_2']);
  });

  it('sends every field it owns on an edit, clearing blanks with null', async () => {
    const user = userEvent.setup();
    open({ outline });

    await user.clear(screen.getByLabelText('Description'));
    await user.clear(screen.getByLabelText('Heading under the department name'));
    await user.clear(screen.getByLabelText('Footer notice'));
    await user.click(screen.getByRole('button', { name: 'Save outline' }));

    expect(mockUpdate).toHaveBeenCalledWith(
      'o1',
      expect.objectContaining({
        description: null,
        header_config: expect.objectContaining({ subtitle: null, show_date: true }) as unknown,
        footer_config: expect.objectContaining({ confidentiality_notice: null, show_page_numbers: true }) as unknown,
        is_default: true,
      })
    );
  });

  it('copies another outline under a new name without making it the default', async () => {
    const user = userEvent.setup();
    open({ copyFrom: outline });

    expect(screen.getByLabelText('Name')).toHaveValue('Our order (copy)');
    expect(screen.getByRole('checkbox', { name: /Use this for new minutes/ })).not.toBeChecked();
    await user.click(screen.getByRole('button', { name: 'Save outline' }));

    expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ name: 'Our order (copy)', is_default: false }));
  });

  it('refuses a missing name, an untitled section, and an empty outline', async () => {
    const user = userEvent.setup();
    open();

    await user.click(screen.getByRole('button', { name: 'Save outline' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Give the outline a name');

    await user.type(screen.getByLabelText('Name'), 'X');
    await user.click(screen.getByRole('button', { name: 'Add section' }));
    await user.click(screen.getByRole('button', { name: 'Save outline' }));
    expect(screen.getByRole('alert')).toHaveTextContent('Every section needs a title');

    await user.click(screen.getByRole('button', { name: 'Remove section 3' }));
    await user.click(screen.getByRole('button', { name: 'Remove Call to Order' }));
    await user.click(screen.getByRole('button', { name: 'Remove Adjournment' }));
    await user.click(screen.getByRole('button', { name: 'Save outline' }));
    expect(screen.getByRole('alert')).toHaveTextContent('at least one section');
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('disables moving a section past either end', () => {
    open({ outline });
    expect(screen.getByRole('button', { name: 'Move Call to Order up' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Move Adjournment down' })).toBeDisabled();
  });

  it('shows the server’s refusal and stays open', async () => {
    mockUpdate.mockRejectedValue(new Error('Section key is used twice'));
    const user = userEvent.setup();
    open({ outline });

    await user.click(screen.getByRole('button', { name: 'Save outline' }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByLabelText('Name')).toBeInTheDocument();
  });

  describe('sections that need a motion and a second', () => {
    type Sent = { sections: Array<{ key: string; needs_motion: boolean; motion_text: string }> };
    const sentSections = () => (mockUpdate.mock.calls[0]?.[1] as Sent).sections;

    it('starts a new outline with adjournment flagged and its wording written', async () => {
      const user = userEvent.setup();
      open();
      await user.type(screen.getByLabelText('Name'), 'Short form');
      await user.click(screen.getByRole('button', { name: 'Save outline' }));

      const sent = (mockCreate.mock.calls[0]?.[0] as Sent).sections;
      expect(sent.map((x) => [x.key, x.needs_motion])).toEqual([
        ['call_to_order', false],
        ['adjournment', true],
      ]);
      expect(sent[1]?.motion_text).toBe('Motion to adjourn the meeting.');
    });

    it('asks for the wording only once a section is flagged', async () => {
      const user = userEvent.setup();
      open({ outline });
      expect(screen.queryByLabelText('Wording of the motion')).toBeNull();

      const boxes = screen.getAllByRole('checkbox', { name: /Needs a motion and a second/ });
      await user.click(boxes[2] as HTMLElement);

      expect(screen.getByLabelText('Wording of the motion')).toBeInTheDocument();
    });

    it('saves the flag and the wording on the section it was set for', async () => {
      const user = userEvent.setup();
      open({ outline });
      const boxes = screen.getAllByRole('checkbox', { name: /Needs a motion and a second/ });
      await user.click(boxes[2] as HTMLElement);
      await user.type(screen.getByLabelText('Wording of the motion'), '  Motion to adjourn.  ');
      await user.click(screen.getByRole('button', { name: 'Save outline' }));

      expect(sentSections().map((x) => [x.key, x.needs_motion, x.motion_text])).toEqual([
        ['call_to_order', false, ''],
        ['roll_call', false, ''],
        ['adjournment', true, 'Motion to adjourn.'],
      ]);
    });

    it('clears the wording when the flag is taken off', async () => {
      const user = userEvent.setup();
      const flagged: MinutesTemplate = {
        ...outline,
        sections: outline.sections.map((x) =>
          x.key === 'adjournment' ? { ...x, needs_motion: true, motion_text: 'Motion to adjourn.' } : x
        ),
      };
      open({ outline: flagged });
      expect(screen.getByLabelText('Wording of the motion')).toHaveValue('Motion to adjourn.');

      const boxes = screen.getAllByRole('checkbox', { name: /Needs a motion and a second/ });
      await user.click(boxes[2] as HTMLElement);
      await user.click(screen.getByRole('button', { name: 'Save outline' }));

      const adjourn = sentSections().find((x) => x.key === 'adjournment');
      expect(adjourn?.needs_motion).toBe(false);
      expect(adjourn?.motion_text).toBe('');
    });
  });
});
