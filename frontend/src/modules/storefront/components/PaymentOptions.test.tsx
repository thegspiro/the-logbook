import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { PaymentOptions } from './PaymentOptions';
import type { StorePaymentInstructions, StorePaymentOption } from '../types';

const option = (overrides: Partial<StorePaymentOption> = {}): StorePaymentOption => ({
  method: 'venmo',
  label: 'Venmo',
  handle: '@FallsChurchFire',
  paymentUrl: 'https://venmo.com/FallsChurchFire?txn=pay&amount=45.00&note=ORD-2026-0001',
  instructions: null,
  prefillsReference: true,
  ...overrides,
});

const instructions = (overrides: Partial<StorePaymentInstructions> = {}): StorePaymentInstructions => ({
  method: 'venmo',
  label: 'Venmo',
  reference: 'ORD-2026-0001',
  amountDue: '45.00',
  options: [option()],
  ...overrides,
});

describe('PaymentOptions', () => {
  it('renders a pay link per option that has one', () => {
    render(
      <PaymentOptions
        instructions={instructions({
          options: [
            option(),
            option({
              method: 'cash_app',
              label: 'Cash App',
              handle: '$FallsChurchFire',
              paymentUrl: 'https://cash.app/$FallsChurchFire/45.00',
              prefillsReference: false,
            }),
          ],
        })}
        amount={45}
      />
    );

    const links = screen.getAllByRole('link', { name: /Pay/ });
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute('href', expect.stringContaining('venmo.com'));
    expect(links[1]).toHaveAttribute('href', 'https://cash.app/$FallsChurchFire/45.00');
  });

  it('shows a method with no link at all, because the handle is the instruction', () => {
    render(
      <PaymentOptions
        instructions={instructions({
          options: [
            option({
              method: 'zelle',
              label: 'Zelle',
              handle: 'treasurer@example.org',
              paymentUrl: null,
              instructions: 'Confirm the recipient reads Falls Church FD.',
              prefillsReference: false,
            }),
          ],
        })}
        amount={45}
      />
    );

    expect(screen.getByText('Zelle')).toBeInTheDocument();
    expect(screen.getByText('treasurer@example.org')).toBeInTheDocument();
    expect(screen.getByText('Confirm the recipient reads Falls Church FD.')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('only asks for the reference when the link will not carry it', () => {
    render(
      <PaymentOptions
        instructions={instructions({
          options: [
            option({ prefillsReference: true }),
            option({
              method: 'cash_app',
              label: 'Cash App',
              handle: '$dept',
              paymentUrl: 'https://cash.app/$dept/45.00',
              prefillsReference: false,
            }),
          ],
        })}
        amount={45}
      />
    );

    // Venmo passes our note through; Cash App has no note field.
    expect(screen.getAllByText(/Reference/)).toHaveLength(1);
  });

  it('copies a handle to the clipboard', async () => {
    // Ordering matters: userEvent.setup() installs its own clipboard stub, so
    // ours has to land after it.
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    render(<PaymentOptions instructions={instructions()} amount={45} />);

    await user.click(screen.getByRole('button', { name: /Copy Venmo handle/ }));

    expect(writeText).toHaveBeenCalledWith('@FallsChurchFire');
  });

  it('still shows the reference when nothing is configured', () => {
    render(<PaymentOptions instructions={instructions({ options: [] })} amount={45} />);

    // Without a reference a treasurer cannot match the payment to an order, so
    // it stays on screen even with no buttons to show.
    expect(screen.getByText('ORD-2026-0001')).toBeInTheDocument();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('falls back to a contact message with no reference either', () => {
    render(<PaymentOptions instructions={instructions({ options: [], reference: null })} amount={45} />);

    expect(screen.getByText('Contact the department for payment details.')).toBeInTheDocument();
  });

  it('offers the report button only when the caller supplies a handler', async () => {
    const onReport = vi.fn();
    const user = userEvent.setup();
    const { rerender } = render(<PaymentOptions instructions={instructions()} amount={45} onReport={onReport} />);

    await user.click(screen.getByRole('button', { name: /sent payment/ }));
    expect(onReport).toHaveBeenCalledTimes(1);

    rerender(<PaymentOptions instructions={instructions()} amount={45} />);
    expect(screen.queryByRole('button', { name: /sent payment/ })).not.toBeInTheDocument();
  });

  it('tolerates a response with no options field', () => {
    const legacy = { ...instructions() };
    delete legacy.options;
    render(<PaymentOptions instructions={legacy} amount={45} />);

    expect(screen.getByText('ORD-2026-0001')).toBeInTheDocument();
  });
});
