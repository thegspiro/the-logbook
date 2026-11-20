import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../../../test/utils';
import type { SuggestionBoxPublic } from '../types/suggestions';

const mockListBoxes = vi.fn();
const mockSubmit = vi.fn();
const mockPickOptions = vi.fn();

vi.mock('../services/suggestionsService', () => ({
  suggestionsService: {
    listBoxes: (...args: unknown[]) => mockListBoxes(...args) as unknown,
    submit: (...args: unknown[]) => mockSubmit(...args) as unknown,
    pickOptions: (...args: unknown[]) => mockPickOptions(...args) as unknown,
  },
}));

import SuggestionSubmitForm from './SuggestionSubmitForm';

const box = (overrides: Partial<SuggestionBoxPublic> = {}): SuggestionBoxPublic => ({
  id: 'b1',
  name: 'Training ideas',
  description: 'Ideas for drills',
  anonymityMode: 'allowed',
  followUpEnabled: true,
  publicBoardEnabled: false,
  ...overrides,
});

async function fillAndSubmit(buttonName: RegExp) {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(/^Title/), 'Night drills');
  await user.type(screen.getByLabelText(/^Details/), 'More of them');
  await user.click(screen.getByRole('button', { name: buttonName }));
  return user;
}

describe('SuggestionSubmitForm', () => {
  beforeEach(() => {
    mockListBoxes.mockReset();
    mockSubmit.mockReset();
  });

  it('shows the follow-up key once after an anonymous submission', async () => {
    mockListBoxes.mockResolvedValue([box()]);
    mockSubmit.mockResolvedValue({ id: null, isAnonymous: true, followUpKey: 'secret-key-value-1234567890' });
    renderWithRouter(<SuggestionSubmitForm />);

    const user = userEvent.setup();
    await user.click(await screen.findByLabelText(/Submit anonymously/));
    await fillAndSubmit(/Submit anonymously/);

    expect(mockSubmit).toHaveBeenCalledWith('b1', {
      title: 'Night drills',
      details: 'More of them',
      anonymous: true,
      screenshots: [],
      answers: {},
    });
    expect(await screen.findByText('secret-key-value-1234567890')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'I saved it' }));
    expect(screen.queryByText('secret-key-value-1234567890')).not.toBeInTheDocument();
  });

  it('submits anonymously without offering a choice when the box requires it', async () => {
    mockListBoxes.mockResolvedValue([box({ anonymityMode: 'required', followUpEnabled: false })]);
    mockSubmit.mockResolvedValue({ id: null, isAnonymous: true, followUpKey: null });
    renderWithRouter(<SuggestionSubmitForm />);

    expect(await screen.findByText(/always anonymous/i)).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /Submit anonymously/ })).not.toBeInTheDocument();
    await fillAndSubmit(/Submit anonymously/);

    expect(mockSubmit).toHaveBeenCalledWith('b1', expect.objectContaining({ anonymous: true }));
  });

  it('submits named when the box refuses anonymity', async () => {
    mockListBoxes.mockResolvedValue([box({ anonymityMode: 'disabled' })]);
    mockSubmit.mockResolvedValue({ id: 's1', isAnonymous: false, followUpKey: null });
    renderWithRouter(<SuggestionSubmitForm />);

    expect(await screen.findByText(/include your name/i)).toBeInTheDocument();
    await fillAndSubmit(/^Submit$/);

    expect(mockSubmit).toHaveBeenCalledWith('b1', expect.objectContaining({ anonymous: false }));
  });

  it('states the screenshot restrictions the server enforces', async () => {
    mockListBoxes.mockResolvedValue([box()]);
    renderWithRouter(<SuggestionSubmitForm />);

    expect(await screen.findByText(/PNG, JPEG, WebP or GIF, up to 10 MB each/)).toBeInTheDocument();
    expect(screen.getByText(/scaled down to 2560 pixels/)).toBeInTheDocument();
    expect(screen.getByText(/animated GIFs keep only their first frame/)).toBeInTheDocument();
    expect(screen.getByText('Screenshots (optional, up to 5)')).toBeInTheDocument();
  });

  it('says so when the department has no boxes', async () => {
    mockListBoxes.mockResolvedValue([]);
    renderWithRouter(<SuggestionSubmitForm />);

    expect(await screen.findByText('No suggestion boxes yet')).toBeInTheDocument();
  });

  describe('intake questions', () => {
    const general = box({
      id: 'b1',
      name: 'General',
      followUpEnabled: false,
      intakeQuestions: [
        {
          id: 'safety',
          label: 'Is this a safety concern?',
          type: 'radio',
          required: true,
          options: [
            { value: 'yes', label: 'Yes', routeToBoxId: 'b2' },
            { value: 'no', label: 'No' },
          ],
        },
        {
          id: 'where',
          label: 'Where did it happen?',
          type: 'text',
          required: true,
          options: [],
          conditionQuestionId: 'safety',
          conditionOperator: 'equals',
          conditionValue: 'yes',
        },
      ],
    });
    const compliance = box({ id: 'b2', name: 'Compliance', anonymityMode: 'disabled' });

    beforeEach(() => {
      mockListBoxes.mockReset();
      mockSubmit.mockReset();
      mockListBoxes.mockResolvedValue([general, compliance]);
      mockSubmit.mockResolvedValue({ id: 's1', isAnonymous: false, followUpKey: null, boxName: 'Compliance' });
    });

    it('shows a follow-up question only on the answer it branches from', async () => {
      renderWithRouter(<SuggestionSubmitForm />);
      const user = userEvent.setup();
      await user.selectOptions(await screen.findByLabelText(/^Suggestion box/), 'b1');

      expect(screen.queryByLabelText(/Where did it happen/)).not.toBeInTheDocument();
      await user.click(screen.getByRole('radio', { name: 'Yes' }));
      expect(screen.getByLabelText(/Where did it happen/)).toBeInTheDocument();
      await user.click(screen.getByRole('radio', { name: 'No' }));
      expect(screen.queryByLabelText(/Where did it happen/)).not.toBeInTheDocument();
    });

    it('previews the route and sends only the answers shown', async () => {
      renderWithRouter(<SuggestionSubmitForm />);
      const user = userEvent.setup();
      await user.selectOptions(await screen.findByLabelText(/^Suggestion box/), 'b1');
      await user.click(screen.getByRole('radio', { name: 'Yes' }));
      await user.type(screen.getByLabelText(/Where did it happen/), 'Engine 2');
      await user.click(screen.getByRole('radio', { name: 'No' }));
      expect(screen.queryByText(/this will be sent to/)).not.toBeInTheDocument();
      await user.click(screen.getByRole('radio', { name: 'Yes' }));
      expect(screen.getByText(/this will be sent to/)).toHaveTextContent('Compliance');

      await user.click(screen.getByRole('button', { name: 'Continue' }));
      await fillAndSubmit(/^Submit$/);
      expect(mockSubmit).toHaveBeenCalledWith(
        'b1',
        expect.objectContaining({ answers: { safety: 'yes', where: 'Engine 2' }, anonymous: false })
      );
    });

    it('drops an answer to a question the member backed out of', async () => {
      mockSubmit.mockResolvedValue({ id: 's1', isAnonymous: false, followUpKey: null, boxName: 'General' });
      renderWithRouter(<SuggestionSubmitForm />);
      const user = userEvent.setup();
      await user.selectOptions(await screen.findByLabelText(/^Suggestion box/), 'b1');
      await user.click(screen.getByRole('radio', { name: 'Yes' }));
      await user.type(screen.getByLabelText(/Where did it happen/), 'Engine 2');
      await user.click(screen.getByRole('radio', { name: 'No' }));

      await user.click(screen.getByRole('button', { name: 'Continue' }));
      await fillAndSubmit(/^Submit$/);
      expect(mockSubmit).toHaveBeenCalledWith('b1', expect.objectContaining({ answers: { safety: 'no' } }));
    });

    it('warns when going back and re-answering leads to a box that records names', async () => {
      renderWithRouter(<SuggestionSubmitForm />);
      const user = userEvent.setup();
      await user.selectOptions(await screen.findByLabelText(/^Suggestion box/), 'b1');
      await user.click(screen.getByRole('radio', { name: 'No' }));
      await user.click(screen.getByRole('button', { name: 'Continue' }));
      await user.click(screen.getByLabelText(/Submit anonymously/));

      await user.click(screen.getByRole('button', { name: 'Back to the questions' }));
      await user.click(screen.getByRole('radio', { name: 'Yes' }));

      expect(screen.getByRole('alert')).toHaveTextContent('does not accept anonymous submissions');
      await user.type(screen.getByLabelText(/Where did it happen/), 'Bay');
      await user.click(screen.getByRole('button', { name: 'Continue' }));
      expect(screen.queryByLabelText(/Submit anonymously/)).not.toBeInTheDocument();
    });

    it('keeps an always-anonymous box anonymous wherever the answer sends it', async () => {
      const promised = box({ ...general, anonymityMode: 'required' });
      const open = box({ id: 'b2', name: 'Compliance', anonymityMode: 'allowed' });
      mockListBoxes.mockResolvedValue([promised, open]);
      mockSubmit.mockResolvedValue({ id: null, isAnonymous: true, followUpKey: null, boxName: 'Compliance' });
      renderWithRouter(<SuggestionSubmitForm />);
      const user = userEvent.setup();
      await user.selectOptions(await screen.findByLabelText(/^Suggestion box/), 'b1');
      await user.click(screen.getByRole('radio', { name: 'Yes' }));
      await user.type(screen.getByLabelText(/Where did it happen/), 'Bay');
      await user.click(screen.getByRole('button', { name: 'Continue' }));

      expect(screen.queryByLabelText(/Submit anonymously/)).not.toBeInTheDocument();
      await fillAndSubmit(/Submit anonymously/);
      expect(mockSubmit).toHaveBeenCalledWith('b1', expect.objectContaining({ anonymous: true }));
    });

    it('asks the questions first and the suggestion after, keeping answers on the way back', async () => {
      renderWithRouter(<SuggestionSubmitForm />);
      const user = userEvent.setup();
      await user.selectOptions(await screen.findByLabelText(/^Suggestion box/), 'b1');

      expect(screen.getByRole('heading', { name: /Step 1 of 2/ })).toBeInTheDocument();
      expect(screen.queryByLabelText(/^Title/)).not.toBeInTheDocument();
      expect(screen.queryByLabelText(/^Details/)).not.toBeInTheDocument();

      await user.click(screen.getByRole('radio', { name: 'Yes' }));
      await user.type(screen.getByLabelText(/Where did it happen/), 'Engine 2');
      await user.click(screen.getByRole('button', { name: 'Continue' }));

      expect(screen.getByRole('heading', { name: /Step 2 of 2/ })).toHaveFocus();
      expect(screen.getByLabelText(/^Title/)).toBeInTheDocument();
      expect(screen.queryByRole('radio', { name: 'Yes' })).not.toBeInTheDocument();

      await user.click(screen.getByRole('button', { name: 'Back to the questions' }));
      expect(screen.getByRole('radio', { name: 'Yes' })).toBeChecked();
      expect(screen.getByLabelText(/Where did it happen/)).toHaveValue('Engine 2');
    });

    it('does not continue past an unanswered required question', async () => {
      renderWithRouter(<SuggestionSubmitForm />);
      const user = userEvent.setup();
      await user.selectOptions(await screen.findByLabelText(/^Suggestion box/), 'b1');

      await user.click(screen.getByRole('button', { name: 'Continue' }));

      expect(screen.getByRole('heading', { name: /Step 1 of 2/ })).toBeInTheDocument();
      expect(screen.queryByLabelText(/^Title/)).not.toBeInTheDocument();
    });

    it('keeps a single page for a box with no questions', async () => {
      mockListBoxes.mockResolvedValue([box({ id: 'b3', name: 'Ideas' })]);
      renderWithRouter(<SuggestionSubmitForm />);

      expect(await screen.findByLabelText(/^Title/)).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: /Step/ })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Continue' })).not.toBeInTheDocument();
    });

    it('holds the questions step until a required member pick is made', async () => {
      mockPickOptions.mockReset();
      mockPickOptions.mockResolvedValue([{ id: 'u1', name: 'Riley Member' }]);
      mockListBoxes.mockResolvedValue([
        box({
          id: 'b4',
          name: 'Conduct',
          intakeQuestions: [{ id: 'who', label: 'Who is this about?', type: 'member', required: true, options: [] }],
        }),
      ]);
      renderWithRouter(<SuggestionSubmitForm />);
      const user = userEvent.setup();

      await user.click(await screen.findByRole('button', { name: 'Continue' }));
      expect(screen.queryByLabelText(/^Title/)).not.toBeInTheDocument();

      await user.click(await screen.findByRole('button', { name: 'Riley Member' }));
      await user.click(screen.getByRole('button', { name: 'Continue' }));
      expect(screen.getByLabelText(/^Title/)).toBeInTheDocument();
    });
  });
});

describe('SuggestionSubmitForm — what is missing is named on its field (batch 24)', () => {
  const asked = box({
    id: 'b5',
    name: 'Station issues',
    intakeQuestions: [
      { id: 'station', label: 'Which station?', type: 'text', required: true, options: [] },
      { id: 'note', label: 'Anything else?', type: 'text', required: false, options: [] },
    ],
  });

  beforeEach(() => {
    mockListBoxes.mockReset();
    mockSubmit.mockReset();
  });

  it('names an unanswered required question on the question, and focuses it', async () => {
    mockListBoxes.mockResolvedValue([asked]);
    renderWithRouter(<SuggestionSubmitForm />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole('button', { name: 'Continue' }));

    const station = screen.getByLabelText(/^Which station\?/);
    expect(station).toHaveAccessibleDescription('Answer “Which station?”.');
    expect(station).toHaveAttribute('aria-invalid', 'true');
    expect(station).toHaveFocus();
    expect(screen.getByLabelText(/^Anything else\?/)).not.toHaveAttribute('aria-invalid');

    await user.type(station, 'Station 2');
    expect(station).not.toHaveAttribute('aria-invalid');
  });

  it('keeps Submit pressable and names a missing title and details on their fields', async () => {
    mockListBoxes.mockResolvedValue([box()]);
    renderWithRouter(<SuggestionSubmitForm />);
    const user = userEvent.setup();

    const submit = await screen.findByRole('button', { name: 'Submit' });
    expect(submit).toBeEnabled();
    await user.click(submit);

    expect(screen.getByLabelText(/^Title/)).toHaveAccessibleDescription('Give your suggestion a title.');
    expect(screen.getByLabelText(/^Details/)).toHaveAccessibleDescription('Describe your suggestion.');
    expect(screen.getByLabelText(/^Title/)).toHaveFocus();
    expect(mockSubmit).not.toHaveBeenCalled();
  });

  it('takes a refusal naming a question back to that question, keeping the suggestion typed', async () => {
    mockListBoxes.mockResolvedValue([asked]);
    mockSubmit.mockRejectedValue({
      response: { status: 400, data: { detail: "'Which station?' needs a number." } },
    });
    renderWithRouter(<SuggestionSubmitForm />);
    const user = userEvent.setup();

    await user.type(await screen.findByLabelText(/^Which station\?/), 'two');
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await fillAndSubmit(/^Submit$/);

    const station = await screen.findByLabelText(/^Which station\?/);
    expect(station).toHaveAccessibleDescription("'Which station?' needs a number.");
    expect(station).toHaveFocus();
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByLabelText(/^Title/)).toHaveValue('Night drills');
  });

  it('says a refusal no field answers for in the form, by the button', async () => {
    mockListBoxes.mockResolvedValue([box()]);
    mockSubmit.mockRejectedValue({
      response: { status: 400, data: { detail: 'This box does not accept anonymous submissions.' } },
    });
    renderWithRouter(<SuggestionSubmitForm />);
    await screen.findByLabelText(/^Title/);

    await fillAndSubmit(/^Submit$/);

    expect(await screen.findByRole('alert')).toHaveTextContent('This box does not accept anonymous submissions.');
    expect(screen.getByLabelText(/^Title/)).toHaveValue('Night drills');
  });
});
