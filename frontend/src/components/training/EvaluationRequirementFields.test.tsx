import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { EvaluationRequirementFields } from './EvaluationRequirementFields';

const handlers = {
  onShiftsChange: vi.fn(),
  onTransportsChange: vi.fn(),
  onRefusalsChange: vi.fn(),
  onExcludesLowestChange: vi.fn(),
};

const renderFields = (type: string, excludesLowest = false) =>
  render(
    <EvaluationRequirementFields
      idPrefix="t"
      type={type}
      shifts=""
      transports=""
      refusals=""
      excludesLowest={excludesLowest}
      {...handlers}
    />
  );

describe('EvaluationRequirementFields', () => {
  beforeEach(() => {
    Object.values(handlers).forEach((handler) => handler.mockReset());
  });

  it('renders nothing for a type not credited by evaluations', () => {
    const { container } = renderFields('shifts');

    expect(container).toBeEmptyDOMElement();
  });

  it('asks for evaluated shifts and offers the lowest-rating rule', async () => {
    const user = userEvent.setup();
    renderFields('evaluated_shifts');

    await user.type(screen.getByLabelText(/Required evaluated shifts/), '8');
    await user.click(screen.getByRole('checkbox', { name: /no item at the lowest rating/ }));

    expect(handlers.onShiftsChange).toHaveBeenCalledWith('8');
    expect(handlers.onExcludesLowestChange).toHaveBeenCalledWith(true);
    expect(screen.getByText(/Counted from submitted shift evaluations/)).toBeInTheDocument();
  });

  it('asks for a transport count without the lowest-rating rule', async () => {
    const user = userEvent.setup();
    renderFields('transports');

    await user.type(screen.getByLabelText(/Required transports/), '2');

    expect(handlers.onTransportsChange).toHaveBeenCalledWith('2');
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('asks for a refusal count', async () => {
    const user = userEvent.setup();
    renderFields('refusals');

    await user.type(screen.getByLabelText(/Required refusals/), '3');

    expect(handlers.onRefusalsChange).toHaveBeenCalledWith('3');
  });
});
