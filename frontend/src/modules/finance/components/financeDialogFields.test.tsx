/**
 * Forms review batch 17: the Finance dialogs put a server refusal on the
 * field it names (F-2), and ask before Escape or Cancel throws typed values
 * away (F-6).
 *
 * Each dialog has one test of each. A 422 entry is matched to its field by
 * the API's own field name, so these pin the mapping as well as the display.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { ConfirmProvider } from '@/contexts/ConfirmContext';
import type {
  AdvanceSummary,
  ApprovalChain,
  BudgetAmendment,
  BudgetRequest,
  ExpenseLineItem,
  ExpenseReport,
  MemberDues,
  PurchaseRequest,
} from '../types';

vi.mock('react-hot-toast', () => ({ default: { success: vi.fn(), error: vi.fn() } }));
vi.mock('@/hooks/useTimezone', () => ({ useTimezone: () => 'UTC' }));
vi.mock('@/utils/dateFormatting', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/utils/dateFormatting')>()),
  getTodayLocalDate: () => '2026-10-20',
}));
vi.mock('../hooks/useFundOptions', () => ({ useFundOptions: () => ({ funds: [], mode: 'warn' }) }));
vi.mock('../hooks/useLateLineWarning', () => ({ useLateLineWarning: () => () => null }));
vi.mock('../hooks/useMileageRate', () => ({ useMileageRate: () => ({ rate: null, loaded: true }) }));
vi.mock('../hooks/useRequestFormOptions', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../hooks/useRequestFormOptions')>()),
  useRequestFormOptions: () => ({ fiscalYears: [], budgetOptions: [], fiscalYearsLoaded: true }),
}));

const { api, call } = vi.hoisted(() => {
  const api = {
    addLineItem: vi.fn(),
    updateLineItem: vi.fn(),
    payByCheck: vi.fn(),
    recordPayment: vi.fn(),
    recordReturn: vi.fn(),
    createRequest: vi.fn(),
    updateRequest: vi.fn(),
    addAmendment: vi.fn(),
    reverseAmendment: vi.fn(),
    claimReimbursement: vi.fn(),
    markPaid: vi.fn(),
    approveStep: vi.fn(),
    denyStep: vi.fn(),
    adopt: vi.fn(),
    lock: vi.fn(),
    openItems: vi.fn(),
    review: vi.fn(),
    decide: vi.fn(),
    createMapping: vi.fn(),
    updateMapping: vi.fn(),
  };
  const call =
    (fn: (...args: unknown[]) => unknown) =>
    (...args: unknown[]) =>
      fn(...args);
  return { api, call };
});
vi.mock('../services/api', () => ({
  expenseReportService: {
    addLineItem: call(api.addLineItem),
    updateLineItem: call(api.updateLineItem),
    payByCheck: call(api.payByCheck),
  },
  duesService: { recordPayment: call(api.recordPayment) },
  advanceService: { recordReturn: call(api.recordReturn) },
  budgetRequestService: {
    create: call(api.createRequest),
    update: call(api.updateRequest),
    review: call(api.review),
    decide: call(api.decide),
  },
  exportMappingService: { create: call(api.createMapping), update: call(api.updateMapping) },
  fiscalYearService: { adopt: call(api.adopt), lock: call(api.lock), openItems: call(api.openItems) },
  budgetService: { addAmendment: call(api.addAmendment), reverseAmendment: call(api.reverseAmendment) },
  purchaseRequestService: { claimReimbursement: call(api.claimReimbursement), markPaid: call(api.markPaid) },
}));
vi.mock('../store/financeStore', () => ({
  useFinanceStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ approveStep: call(api.approveStep), denyStep: call(api.denyStep) }),
}));

import { ExpenseLineDialog } from './ExpenseLineDialog';
import { DuesPaymentDialog } from './DuesPaymentDialog';
import { AdvanceReturnDialog } from './AdvanceReturnDialog';
import { BudgetRequestDialog } from './BudgetRequestDialog';
import { AmendmentDialog } from './AmendmentDialog';
import { ReverseAmendmentDialog } from './ReverseAmendmentDialog';
import { ReimbursementClaimDialog } from './ReimbursementClaimDialog';
import { MarkPaidDialog } from './MarkPaidDialog';
import { PayByCheckDialog } from './PayByCheckDialog';
import { ApprovalDecisionDialog } from './ApprovalDecisionDialog';
import { BudgetAdoptionDialog } from './BudgetAdoptionDialog';
import { FiscalYearLockDialog } from './FiscalYearLockDialog';
import { BudgetRequestLeadershipDialog } from './BudgetRequestLeadershipDialog';
import { BudgetRequestDecisionDialog } from './BudgetRequestDecisionDialog';
import { ApprovalChainEditDialog } from './ApprovalChainEditDialog';
import { ExportMappingDialog } from './ExportMappingDialog';

const refusal = (field: string, message: string) => ({
  response: { status: 422, data: { detail: [{ field, message }] } },
});

const renderIn = (ui: React.ReactElement) =>
  render(
    <MemoryRouter>
      <ConfirmProvider>{ui}</ConfirmProvider>
    </MemoryRouter>
  );

/** The field once it is flagged, for its accessible description to be checked. */
const flagged = async (label: string | RegExp) => {
  const field = screen.getByLabelText(label);
  await waitFor(() => expect(field).toHaveAttribute('aria-invalid', 'true'));
  return field;
};

/** Escape asks and can be declined; then Cancel asks and the changes are discarded. */
const answerDiscardQuestion = async (user: UserEvent, onClose: ReturnType<typeof vi.fn>) => {
  await user.keyboard('{Escape}');
  await user.click(await screen.findByRole('button', { name: 'Keep editing' }));
  expect(onClose).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Cancel' }));
  await user.click(await screen.findByRole('button', { name: 'Discard changes' }));
};

beforeEach(() => {
  for (const fn of Object.values(api)) {
    fn.mockReset();
    fn.mockResolvedValue({});
  }
  api.openItems.mockResolvedValue([]);
});

describe('ExpenseLineDialog', () => {
  const props = { reportId: 'er-1', fiscalYearId: 'fy-1', onSaved: vi.fn() };

  it('puts a refused merchant on its field and adds nothing', async () => {
    api.addLineItem.mockRejectedValue(refusal('merchant', 'Value is too long.'));
    const user = userEvent.setup();
    renderIn(<ExpenseLineDialog {...props} onClose={vi.fn()} />);
    await user.type(screen.getByLabelText('Description *'), 'Gloves');
    await user.type(screen.getByLabelText('Amount *'), '20');
    await user.type(screen.getByLabelText('Merchant'), 'Supply');
    await user.click(screen.getByRole('button', { name: 'Add line' }));

    expect(await flagged('Merchant')).toHaveAccessibleDescription(
      expect.stringContaining('Merchant is too long — keep it to 300 characters.')
    );
    expect(api.addLineItem).toHaveBeenCalledTimes(1);
    expect(props.onSaved).not.toHaveBeenCalled();
  });

  it('saves the rest of an edit and keeps the refused field flagged', async () => {
    const line = {
      id: 'li-1',
      description: 'Gloves',
      amount: '20.00',
      dateIncurred: '2026-10-01T12:00:00Z',
      expenseType: 'general',
      merchant: 'Old',
    } as ExpenseLineItem;
    api.updateLineItem.mockRejectedValueOnce(refusal('merchant', 'Merchant must be plain text.'));
    const onSaved = vi.fn();
    const user = userEvent.setup();
    renderIn(<ExpenseLineDialog {...props} line={line} onSaved={onSaved} onClose={vi.fn()} />);
    await user.clear(screen.getByLabelText('Merchant'));
    await user.type(screen.getByLabelText('Merchant'), 'New');
    await user.click(screen.getByRole('button', { name: 'Save line' }));

    expect(await flagged('Merchant')).toHaveAccessibleDescription(
      expect.stringContaining('Merchant must be plain text.')
    );
    expect(api.updateLineItem).toHaveBeenCalledTimes(2);
    expect(api.updateLineItem.mock.calls[1]?.[2]).not.toHaveProperty('merchant');
    expect(screen.getByLabelText('Merchant')).toHaveValue('New');
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('asks before Escape or Cancel throws a typed line away', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderIn(<ExpenseLineDialog {...props} onClose={onClose} />);
    await user.type(screen.getByLabelText('Description *'), 'Half a line');
    await answerDiscardQuestion(user, onClose);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('DuesPaymentDialog', () => {
  const dues = { id: 'dues-1', amountDue: '120.00', amountPaid: '0.00' } as MemberDues;

  it('puts a refused reference on its field', async () => {
    api.recordPayment.mockRejectedValue(refusal('transaction_reference', 'Value is too long.'));
    const user = userEvent.setup();
    renderIn(<DuesPaymentDialog dues={dues} memberLabel="Dana" onClose={vi.fn()} onSaved={vi.fn()} />);
    await user.type(screen.getByLabelText(/^Reference/), 'CHK-1');
    await user.click(screen.getByRole('button', { name: 'Record payment' }));

    expect(await flagged(/^Reference/)).toHaveAccessibleDescription(
      expect.stringContaining('Reference is too long — keep it to 200 characters.')
    );
  });

  it('asks before Escape or Cancel throws a typed payment away', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderIn(<DuesPaymentDialog dues={dues} memberLabel="Dana" onClose={onClose} onSaved={vi.fn()} />);
    await user.type(screen.getByLabelText(/^Notes/), 'Paid at the meeting');
    await answerDiscardQuestion(user, onClose);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('AdvanceReturnDialog', () => {
  const advance = {
    id: 'adv-1',
    outstanding: '50.00',
    memberName: 'Dana',
    requestNumber: 'CR-1',
  } as AdvanceSummary;

  it('puts a refused method on its field', async () => {
    api.recordReturn.mockRejectedValue(refusal('payment_method', 'Value is too long.'));
    const user = userEvent.setup();
    renderIn(<AdvanceReturnDialog advance={advance} onClose={vi.fn()} onSaved={vi.fn()} />);
    await user.selectOptions(screen.getByLabelText(/^Method/), 'cash');
    await user.click(screen.getByRole('button', { name: 'Record return' }));

    expect(await flagged(/^Method/)).toHaveAccessibleDescription(
      expect.stringContaining('Method is too long — keep it to 50 characters.')
    );
  });

  it('asks before Escape or Cancel throws a typed return away', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderIn(<AdvanceReturnDialog advance={advance} onClose={onClose} onSaved={vi.fn()} />);
    await user.type(screen.getByLabelText(/^Notes/), 'Change from the store');
    await answerDiscardQuestion(user, onClose);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('BudgetRequestDialog', () => {
  const target = { kind: 'line' as const, budgetId: 'b-1', lineLabel: 'Hose' };

  it('puts a refused justification on its field and creates nothing', async () => {
    api.createRequest.mockRejectedValue(refusal('justification', 'must not be blank'));
    const user = userEvent.setup();
    renderIn(
      <BudgetRequestDialog
        fiscalYearId="fy-1"
        fiscalYearName="FY2027"
        target={target}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />
    );
    await user.type(screen.getByLabelText('Amount requested'), '500');
    await user.type(screen.getByLabelText('Justification'), 'More hose');
    await user.click(screen.getByRole('button', { name: 'Save draft' }));

    expect(await flagged('Justification')).toHaveAccessibleDescription(expect.stringContaining('must not be blank'));
  });

  it('asks before Escape or Cancel throws a typed request away', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderIn(
      <BudgetRequestDialog
        fiscalYearId="fy-1"
        fiscalYearName="FY2027"
        target={target}
        onClose={onClose}
        onSaved={vi.fn()}
      />
    );
    await user.type(screen.getByLabelText('Justification'), 'More hose');
    await answerDiscardQuestion(user, onClose);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

const fillApproval = async (user: UserEvent) => {
  await user.type(screen.getByLabelText('Reason'), 'Mistake');
  await user.type(screen.getByLabelText('Approved by'), 'Board vote');
};

describe('AmendmentDialog', () => {
  it('puts a refused approval date on its field', async () => {
    api.addAmendment.mockRejectedValue(refusal('approved_on', 'Invalid date format.'));
    const user = userEvent.setup();
    renderIn(<AmendmentDialog budgetId="b-1" lineName="Hose" onClose={vi.fn()} onSaved={vi.fn()} />);
    await user.type(screen.getByLabelText('Amount added'), '100');
    await fillApproval(user);
    await user.click(screen.getByRole('button', { name: 'Record amendment' }));

    expect(await flagged('Approval date')).toHaveAccessibleDescription(
      expect.stringContaining('Approval date needs a valid date.')
    );
  });

  it('asks before Escape or Cancel throws a typed amendment away', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderIn(<AmendmentDialog budgetId="b-1" lineName="Hose" onClose={onClose} onSaved={vi.fn()} />);
    await user.type(screen.getByLabelText('Amount added'), '100');
    await answerDiscardQuestion(user, onClose);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('ReverseAmendmentDialog', () => {
  const amendment = {
    id: 'am-1',
    amount: '100.00',
    approvedOn: '2026-10-01',
    approvedBy: 'Board',
  } as BudgetAmendment;

  it('puts a refused "approved by" on its field', async () => {
    api.reverseAmendment.mockRejectedValue(refusal('approved_by', 'Value is too long.'));
    const user = userEvent.setup();
    renderIn(<ReverseAmendmentDialog budgetId="b-1" amendment={amendment} onClose={vi.fn()} onSaved={vi.fn()} />);
    await fillApproval(user);
    await user.click(screen.getByRole('button', { name: 'Record reversal' }));

    expect(await flagged('Approved by')).toHaveAccessibleDescription(
      expect.stringContaining('Approved by is too long — keep it to 200 characters.')
    );
  });

  it('asks before Escape or Cancel throws a typed reversal away', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderIn(<ReverseAmendmentDialog budgetId="b-1" amendment={amendment} onClose={onClose} onSaved={vi.fn()} />);
    await user.type(screen.getByLabelText('Reason'), 'Typo');
    await answerDiscardQuestion(user, onClose);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

const purchase = {
  id: 'pr-1',
  requestNumber: 'PR-1',
  estimatedAmount: '100.00',
  vendor: null,
} as unknown as PurchaseRequest;

describe('ReimbursementClaimDialog', () => {
  it('puts a refused merchant on its field and starts nothing', async () => {
    api.claimReimbursement.mockRejectedValue(refusal('merchant', 'Value is too long.'));
    const onClaimed = vi.fn();
    const user = userEvent.setup();
    renderIn(<ReimbursementClaimDialog purchase={purchase} onClose={vi.fn()} onClaimed={onClaimed} />);
    await user.type(screen.getByLabelText(/^Where/), 'Supply house');
    await user.click(screen.getByRole('button', { name: 'Start expense report' }));

    expect(await flagged(/^Where/)).toHaveAccessibleDescription(
      expect.stringContaining('Where is too long — keep it to 300 characters.')
    );
    expect(onClaimed).not.toHaveBeenCalled();
  });

  it('asks before Escape or Cancel throws typed values away', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderIn(<ReimbursementClaimDialog purchase={purchase} onClose={onClose} onClaimed={vi.fn()} />);
    await user.type(screen.getByLabelText(/^Where/), 'Supply house');
    await answerDiscardQuestion(user, onClose);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('MarkPaidDialog', () => {
  it('puts a refused amount on its field', async () => {
    api.markPaid.mockRejectedValue(refusal('query.actual_amount', 'Expected a number.'));
    const user = userEvent.setup();
    renderIn(<MarkPaidDialog purchase={purchase} onClose={vi.fn()} onPaid={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Mark paid' }));

    expect(await flagged('Amount paid')).toHaveAccessibleDescription(
      expect.stringContaining('Amount paid needs a number.')
    );
  });

  it('asks before Escape or Cancel throws a changed amount away', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderIn(<MarkPaidDialog purchase={purchase} onClose={onClose} onPaid={vi.fn()} />);
    await user.type(screen.getByLabelText('Amount paid'), '5');
    await answerDiscardQuestion(user, onClose);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('PayByCheckDialog', () => {
  const report = { id: 'er-1', reportNumber: 'ER-1', totalAmount: '40.00' } as ExpenseReport;

  it('puts a refused memo on its field', async () => {
    api.payByCheck.mockRejectedValue(refusal('memo', 'Value is too long.'));
    const user = userEvent.setup();
    renderIn(<PayByCheckDialog report={report} onClose={vi.fn()} onRequested={vi.fn()} />);
    await user.type(screen.getByLabelText(/^Memo/), 'Boots');
    await user.click(screen.getByRole('button', { name: 'Request check' }));

    expect(await flagged(/^Memo/)).toHaveAccessibleDescription(
      expect.stringContaining('Memo is too long — keep it to 500 characters.')
    );
  });

  it('asks before Escape or Cancel throws typed values away', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderIn(<PayByCheckDialog report={report} onClose={onClose} onRequested={vi.fn()} />);
    await user.type(screen.getByLabelText(/^Memo/), 'Boots');
    await answerDiscardQuestion(user, onClose);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('ApprovalDecisionDialog override form', () => {
  const decision = {
    stepRecordId: 'step-1',
    action: 'approve' as const,
    subject: 'Radio repair',
    override: { assigneeLabel: 'Treasurer' },
  };

  it('puts a refused override reason on its field and stays open', async () => {
    api.approveStep.mockRejectedValue(refusal('override_reason', 'Value is too long.'));
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderIn(<ApprovalDecisionDialog decision={decision} onClose={onClose} />);
    await user.type(screen.getByLabelText('Override reason'), 'Treasurer away');
    await user.click(screen.getByRole('button', { name: 'Approve as approvals admin' }));

    expect(await flagged('Override reason')).toHaveAccessibleDescription(
      expect.stringContaining('Override reason is too long — keep it to 2000 characters.')
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it('asks before Escape or Cancel throws a typed reason away', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderIn(<ApprovalDecisionDialog decision={decision} onClose={onClose} />);
    await user.type(screen.getByLabelText('Override reason'), 'Treasurer away');
    await answerDiscardQuestion(user, onClose);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('BudgetAdoptionDialog', () => {
  const year = { id: 'fy-1', name: 'FY2027' };

  it('puts a refused reference on its field', async () => {
    api.adopt.mockRejectedValue(refusal('adoption_reference', 'Value is too long.'));
    const user = userEvent.setup();
    renderIn(<BudgetAdoptionDialog fiscalYear={year} onClose={vi.fn()} onAdopted={vi.fn()} />);
    await user.type(screen.getByLabelText('Motion or minutes reference'), 'Motion 4');
    await user.click(screen.getByRole('button', { name: 'Record adoption' }));

    expect(await flagged('Motion or minutes reference')).toHaveAccessibleDescription(
      expect.stringContaining('keep it to 500 characters.')
    );
  });

  it('asks before Escape or Cancel throws a typed adoption away', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderIn(<BudgetAdoptionDialog fiscalYear={year} onClose={onClose} onAdopted={vi.fn()} />);
    await user.type(screen.getByLabelText('Motion or minutes reference'), 'Motion 4');
    await answerDiscardQuestion(user, onClose);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('FiscalYearLockDialog', () => {
  const year = { id: 'fy-1', name: 'FY2026' };

  it('puts refused notes on their field and does not lock', async () => {
    api.lock.mockRejectedValue(refusal('notes', 'Value is too long.'));
    const onLocked = vi.fn();
    const user = userEvent.setup();
    renderIn(<FiscalYearLockDialog fiscalYear={year} onClose={vi.fn()} onLocked={onLocked} />);
    await user.type(screen.getByLabelText('Reconciliation notes'), 'Reconciled');
    await screen.findByText(/Nothing is open/);
    await user.click(screen.getByRole('button', { name: 'Lock the year' }));

    expect(await flagged('Reconciliation notes')).toHaveAccessibleDescription(
      expect.stringContaining('keep it to 4000 characters.')
    );
    expect(onLocked).not.toHaveBeenCalled();
  });

  it('asks before Escape or Cancel throws typed notes away', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderIn(<FiscalYearLockDialog fiscalYear={year} onClose={onClose} onLocked={vi.fn()} />);
    await user.type(screen.getByLabelText('Reconciliation notes'), 'Reconciled');
    await answerDiscardQuestion(user, onClose);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

const submitted = {
  id: 'br-1',
  lineLabel: 'Hose',
  status: 'submitted',
  requestedAmount: '500.00',
  approvedAmount: '400.00',
  justification: 'More hose',
} as BudgetRequest;

describe('BudgetRequestLeadershipDialog', () => {
  it('puts a refused note on its field', async () => {
    api.review.mockRejectedValue(refusal('note', 'Value is too long.'));
    const user = userEvent.setup();
    renderIn(<BudgetRequestLeadershipDialog request={submitted} onClose={vi.fn()} onReviewed={vi.fn()} />);
    await user.type(screen.getByLabelText('Why'), 'Board cut');
    await user.click(screen.getByRole('button', { name: 'Record change' }));

    expect(await flagged('Why')).toHaveAccessibleDescription(
      expect.stringContaining('Why is too long — keep it to 4000 characters.')
    );
  });

  it('asks before Escape or Cancel throws a typed change away', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderIn(<BudgetRequestLeadershipDialog request={submitted} onClose={onClose} onReviewed={vi.fn()} />);
    await user.type(screen.getByLabelText('Why'), 'Board cut');
    await answerDiscardQuestion(user, onClose);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('BudgetRequestDecisionDialog', () => {
  it('puts a refused note on its field', async () => {
    api.decide.mockRejectedValue(refusal('decision_note', 'Value is too long.'));
    const user = userEvent.setup();
    renderIn(<BudgetRequestDecisionDialog request={submitted} onClose={vi.fn()} onDecided={vi.fn()} />);
    await user.type(screen.getByLabelText(/^Note/), 'Fine');
    await user.click(screen.getByRole('button', { name: 'Record decision' }));

    expect(await flagged(/^Note/)).toHaveAccessibleDescription(
      expect.stringContaining('Note is too long — keep it to 4000 characters.')
    );
  });

  it('asks before Escape or Cancel throws a typed decision away', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderIn(<BudgetRequestDecisionDialog request={submitted} onClose={onClose} onDecided={vi.fn()} />);
    await user.type(screen.getByLabelText(/^Note/), 'Fine');
    await answerDiscardQuestion(user, onClose);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('ApprovalChainEditDialog', () => {
  const chain = { id: 'ch-1', name: 'Large purchases', description: '', isActive: true } as unknown as ApprovalChain;

  it('saves the rest of the edit and keeps a refused name flagged', async () => {
    const save = vi.fn().mockRejectedValueOnce(refusal('name', 'Value is too long.')).mockResolvedValueOnce(undefined);
    const onSaved = vi.fn();
    const user = userEvent.setup();
    renderIn(<ApprovalChainEditDialog chain={chain} onClose={vi.fn()} save={save} onSaved={onSaved} />);
    await user.type(screen.getByLabelText('Name'), ' over');
    await user.type(screen.getByLabelText('Description'), 'Over $5,000');
    await user.click(screen.getByRole('button', { name: 'Save chain' }));

    expect(await flagged('Name')).toHaveAccessibleDescription(
      expect.stringContaining('Name is too long — keep it to 200 characters.')
    );
    expect(save).toHaveBeenLastCalledWith({ description: 'Over $5,000', is_active: true });
    expect(screen.getByLabelText('Name')).toHaveValue('Large purchases over');
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('asks before Escape or Cancel throws a changed chain away', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderIn(<ApprovalChainEditDialog chain={chain} onClose={onClose} save={vi.fn()} onSaved={vi.fn()} />);
    await user.type(screen.getByLabelText('Description'), 'Over $5,000');
    await answerDiscardQuestion(user, onClose);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('ExportMappingDialog', () => {
  it('puts a refused account on its field and adds nothing', async () => {
    api.createMapping.mockRejectedValue(refusal('qb_account_name', 'Value is too long.'));
    const onSaved = vi.fn();
    const user = userEvent.setup();
    renderIn(<ExportMappingDialog categoryNames={['Fuel']} onClose={vi.fn()} onSaved={onSaved} />);
    await user.selectOptions(screen.getByLabelText('Budget category'), 'Fuel');
    await user.type(screen.getByLabelText('QuickBooks account'), 'Vehicle:Fuel');
    await user.type(screen.getByLabelText('Paid from account'), 'Checking');
    await user.click(screen.getByRole('button', { name: 'Add mapping' }));

    expect(await flagged('QuickBooks account')).toHaveAccessibleDescription(
      expect.stringContaining('QuickBooks account is too long — keep it to 200 characters.')
    );
    expect(onSaved).not.toHaveBeenCalled();
  });

  it('asks before Escape or Cancel throws a typed mapping away', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    renderIn(<ExportMappingDialog categoryNames={['Fuel']} onClose={onClose} onSaved={vi.fn()} />);
    await user.type(screen.getByLabelText('QuickBooks account'), 'Vehicle:Fuel');
    await answerDiscardQuestion(user, onClose);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
