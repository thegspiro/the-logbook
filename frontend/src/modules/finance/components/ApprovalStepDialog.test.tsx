/**
 * Forms review: the approval step dialog names a missing or invalid value on
 * its field and sends nothing (F-3), puts a refusal it is handed on the field
 * it names (F-2), says one no field answers for inside the dialog, and asks
 * before Escape or Cancel throws a changed step away (F-6). What a step sends
 * and who may approve are unchanged; approvalStepForm.test.ts covers those.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '@/test/utils';
import { ApprovalStepDialog } from './ApprovalStepDialog';
import { EMPTY_STEP_FORM, type StepFormValues } from '../utils/approvalStepForm';
import { ApprovalStepType, ApproverType } from '../types';
import type { ApproverOptions } from '../hooks/useApproverOptions';

const approverOptions: ApproverOptions = {
  positions: [{ value: 'treasurer', label: 'Treasurer' }],
  permissions: null,
  users: null,
};
const stored: StepFormValues = {
  name: 'Board review',
  stepType: ApprovalStepType.APPROVAL,
  approverType: ApproverType.EMAIL,
  approverValue: 'board@example.org',
  allowSelfApproval: false,
  autoApproveUnder: '',
};
const refusal = (field: string, message: string) => ({
  response: { status: 422, data: { detail: [{ field, message }] } },
});

const onSubmit = vi.fn<(values: StepFormValues) => Promise<void>>();
const onClose = vi.fn();
const renderDialog = (initialValues?: StepFormValues) =>
  renderWithRouter(
    <ApprovalStepDialog
      mode={initialValues ? 'edit' : 'add'}
      {...(initialValues ? { initialValues } : {})}
      approverOptions={approverOptions}
      saving={false}
      onClose={onClose}
      onSubmit={onSubmit}
    />
  );

beforeEach(() => {
  onSubmit.mockReset();
  onSubmit.mockResolvedValue(undefined);
  onClose.mockReset();
});

describe('ApprovalStepDialog', () => {
  it('names a missing step name on its field, focuses it, and sends nothing', async () => {
    renderDialog();
    await userEvent.click(screen.getByRole('button', { name: 'Add step' }));

    const name = screen.getByLabelText(/Step name/);
    expect(name).toHaveAttribute('aria-invalid', 'true');
    expect(name).toHaveAccessibleDescription('Enter a name for this step.');
    expect(name).toHaveFocus();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('names an invalid approver email on its field and sends nothing', async () => {
    renderDialog({ ...stored, approverValue: 'not-an-email' });
    await userEvent.click(screen.getByRole('button', { name: 'Save step' }));

    const email = screen.getByLabelText(/Approver email/);
    expect(email).toHaveAttribute('aria-invalid', 'true');
    expect(email).toHaveAccessibleDescription('Enter one valid email address, such as trustee@example.org.');
    expect(email).toHaveFocus();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('submits on Enter with the values as typed', async () => {
    renderDialog();
    await userEvent.type(screen.getByLabelText(/Step name/), 'Treasurer review{Enter}');

    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ ...EMPTY_STEP_FORM, name: 'Treasurer review' }));
  });

  it('puts a 422 it is handed on the field it names', async () => {
    onSubmit.mockRejectedValue(refusal('auto_approve_under', 'Input should be greater than or equal to 0'));
    renderDialog({ ...stored, autoApproveUnder: '250' });
    await userEvent.click(screen.getByRole('button', { name: 'Save step' }));

    const amount = screen.getByLabelText(/Auto-approve under/);
    await waitFor(() => expect(amount).toHaveAttribute('aria-invalid', 'true'));
    // The hint follows the error in the description.
    expect(amount).toHaveAccessibleDescription(/^Auto-approve under must be 0 or more\. A request for less/);
    expect(amount).toHaveFocus();
  });

  it('says a refusal no field answers for inside the dialog', async () => {
    onSubmit.mockRejectedValue(new Error('Approval chain step not found'));
    renderDialog(stored);
    await userEvent.click(screen.getByRole('button', { name: 'Save step' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Approval chain step not found');
  });

  it('closes at once when nothing changed', async () => {
    renderDialog(stored);
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onClose).toHaveBeenCalled();
  });

  it('asks before Cancel throws a changed step away', async () => {
    renderDialog(stored);
    await userEvent.type(screen.getByLabelText(/Step name/), ' 2');
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await userEvent.click(await screen.findByRole('button', { name: 'Keep editing' }));
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/Step name/)).toHaveValue('Board review 2');
  });
});

describe('ApprovalStepDialog — specific member approver', () => {
  const memberOptions: ApproverOptions = {
    positions: [],
    permissions: [],
    users: [
      { value: 'u1', label: 'Sam Ortiz' },
      { value: 'u2', label: 'Lee Park', former: true },
    ],
  };
  const renderMemberStep = (approverValue: string) =>
    renderWithRouter(
      <ApprovalStepDialog
        mode="edit"
        initialValues={{ ...EMPTY_STEP_FORM, name: 'Chief', approverType: ApproverType.SPECIFIC_USER, approverValue }}
        approverOptions={memberOptions}
        saving={false}
        onClose={onClose}
        onSubmit={onSubmit}
      />
    );
  const offered = () =>
    within(screen.getByLabelText(/^Specific member/))
      .getAllByRole('option')
      .map((o) => o.textContent);

  it('does not offer a former member', () => {
    renderMemberStep('u1');

    expect(offered()).toEqual(['Choose…', 'Sam Ortiz']);
  });

  it('keeps a stored approver who has since left, marked as a former member', () => {
    renderMemberStep('u2');

    expect(screen.getByLabelText(/^Specific member/)).toHaveValue('u2');
    expect(offered()).toEqual(['Choose…', 'Sam Ortiz', 'Lee Park (former member)']);
  });
});
