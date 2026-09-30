import { describe, it, expect } from 'vitest';
import { EMPTY_STEP_FORM, buildStepCreatePayload, validateStepForm } from './approvalStepForm';

describe('validateStepForm', () => {
  it('requires a name', () => {
    expect(validateStepForm(EMPTY_STEP_FORM).name).toBeTypeOf('string');
  });

  it('requires a value once an approver type is chosen', () => {
    const errors = validateStepForm({ ...EMPTY_STEP_FORM, name: 'x', approverType: 'position' });
    expect(errors.approverValue).toBeTypeOf('string');
  });

  it('rejects a comma-separated list of emails', () => {
    // The approval email goes to approver_value as a single address.
    const errors = validateStepForm({
      ...EMPTY_STEP_FORM,
      name: 'x',
      approverType: 'email',
      approverValue: 'a@example.org, b@example.org',
    });
    expect(errors.approverValue).toBeTypeOf('string');
  });

  it.each(['abc', '-5', '1.234', '1,000'])('rejects the auto-approve amount %s', (amount) => {
    expect(validateStepForm({ ...EMPTY_STEP_FORM, name: 'x', autoApproveUnder: amount }).autoApproveUnder).toBeTypeOf(
      'string'
    );
  });

  it.each(['250', '250.5', '250.00'])('accepts the auto-approve amount %s', (amount) => {
    expect(validateStepForm({ ...EMPTY_STEP_FORM, name: 'x', autoApproveUnder: amount })).toEqual({});
  });

  it('ignores approver and amount fields on a notification step', () => {
    expect(
      validateStepForm({
        ...EMPTY_STEP_FORM,
        name: 'x',
        stepType: 'notification',
        approverType: 'email',
        approverValue: 'nope',
        autoApproveUnder: 'abc',
      })
    ).toEqual({});
  });
});

describe('buildStepCreatePayload', () => {
  it('omits blank optional fields and never allows self-approval off an Email approver', () => {
    expect(buildStepCreatePayload({ ...EMPTY_STEP_FORM, name: ' Review ', allowSelfApproval: true }, 1)).toEqual({
      step_order: 1,
      name: 'Review',
      step_type: 'approval',
      approver_type: undefined,
      approver_value: undefined,
      allow_self_approval: false,
      auto_approve_under: undefined,
    });
  });
});
