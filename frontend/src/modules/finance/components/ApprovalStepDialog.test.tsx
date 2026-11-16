import { describe, it, expect, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithRouter } from '../../../test/utils';
import { ApprovalStepDialog } from './ApprovalStepDialog';
import { ApproverType } from '../types';
import { EMPTY_STEP_FORM } from '../utils/approvalStepForm';
import type { ApproverOptions } from '../hooks/useApproverOptions';

const approverOptions: ApproverOptions = {
  positions: [],
  permissions: [],
  users: [
    { value: 'u1', label: 'Sam Ortiz' },
    { value: 'u2', label: 'Lee Park', former: true },
  ],
};

const renderDialog = (approverValue: string) =>
  renderWithRouter(
    <ApprovalStepDialog
      mode="edit"
      initialValues={{ ...EMPTY_STEP_FORM, name: 'Chief', approverType: ApproverType.SPECIFIC_USER, approverValue }}
      approverOptions={approverOptions}
      saving={false}
      onClose={vi.fn()}
      onSubmit={vi.fn()}
    />
  );

const memberOptions = () =>
  within(screen.getByLabelText('Specific member'))
    .getAllByRole('option')
    .map((o) => o.textContent);

describe('ApprovalStepDialog — specific member approver', () => {
  it('does not offer a former member', () => {
    renderDialog('u1');

    expect(memberOptions()).toEqual(['Choose…', 'Sam Ortiz']);
  });

  it('keeps a stored approver who has since left, marked as a former member', () => {
    renderDialog('u2');

    expect(screen.getByLabelText('Specific member')).toHaveValue('u2');
    expect(memberOptions()).toEqual(['Choose…', 'Sam Ortiz', 'Lee Park (former member)']);
  });
});
