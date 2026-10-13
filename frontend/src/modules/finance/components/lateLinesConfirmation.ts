/**
 * The confirmation an approver gives before approving an expense report with
 * lines submitted after the department's substantiation deadline. Shared by the
 * step decision dialog and the manual decision panel so both say the same.
 */
export const lateLinesConfirmation = (count: number) => ({
  title: 'Approve late expenses?',
  message: `${count} ${count === 1 ? 'line on this report was' : 'lines on this report were'} submitted after the department's deadline for claiming expenses. Reimbursing ${count === 1 ? 'it falls' : 'them falls'} outside the accountable plan, so the department may have to report ${count === 1 ? 'it' : 'them'} as taxable pay. Approving confirms you have reviewed ${count === 1 ? 'it' : 'them'}.`,
  confirmLabel: count === 1 ? "I've reviewed it, approve" : "I've reviewed them, approve",
  cancelLabel: 'Go back',
  variant: 'warning' as const,
});
