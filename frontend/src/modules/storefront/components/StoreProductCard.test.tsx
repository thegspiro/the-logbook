import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { StoreProductCard } from './StoreProductCard';
import { EmbroideryThreadColor, PersonalizationMethod } from '../types';
import type { StorefrontProductOffer } from '../types';

const offer = (overrides: Partial<StorefrontProductOffer> = {}): StorefrontProductOffer => ({
  id: 'p1',
  name: 'Job Shirt',
  description: 'Navy 1/4-zip with department patch.',
  imageUrl: null,
  category: 'Uniforms',
  price: '65.00',
  isTaxable: true,
  requiresVariant: true,
  maxPerMember: null,
  personalizationEnabled: false,
  personalizationRequired: false,
  personalizationLabel: null,
  personalizationMaxLength: 16,
  personalizationPrice: '8.00',
  personalizationThreadColor: EmbroideryThreadColor.GOLD,
  personalizationThreadColorHex: '#c8a02c',
  personalizationMethod: PersonalizationMethod.EMBROIDERY,
  availableQuantity: null,
  isAvailable: true,
  variants: [
    { id: 'v-m', label: 'M', price: '65.00', availableQuantity: null, isAvailable: true },
    { id: 'v-l', label: 'L', price: '70.00', availableQuantity: 4, isAvailable: true },
    { id: 'v-xxl', label: '2XL', price: '75.00', availableQuantity: 0, isAvailable: false },
  ],
  ...overrides,
});

describe('StoreProductCard', () => {
  let onAdd: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onAdd = vi.fn();
  });

  it('exposes every size as a pressable chip rather than a dropdown', () => {
    render(<StoreProductCard offer={offer()} onAdd={onAdd} />);

    // The whole point of the redesign: a member can see all three sizes, and
    // which one is sold out, without opening anything.
    expect(screen.getByRole('button', { name: 'M' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'L' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: '2XL' })).toBeDisabled();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('reprices the add button when a different size is picked', async () => {
    const user = userEvent.setup();
    render(<StoreProductCard offer={offer()} onAdd={onAdd} />);

    expect(screen.getByRole('button', { name: /Add \$65\.00/ })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'L' }));

    expect(screen.getByRole('button', { name: /Add \$70\.00/ })).toBeInTheDocument();
  });

  it('multiplies the add-button amount by the quantity', async () => {
    const user = userEvent.setup();
    render(<StoreProductCard offer={offer()} onAdd={onAdd} />);

    await user.click(screen.getByRole('button', { name: /Increase quantity/ }));

    expect(screen.getByRole('button', { name: /Add \$130\.00/ })).toBeInTheDocument();
  });

  it('warns about low stock on the selected size only', async () => {
    const user = userEvent.setup();
    render(<StoreProductCard offer={offer()} onAdd={onAdd} />);

    expect(screen.queryByText(/Only \d+ left/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'L' }));

    expect(screen.getByText('Only 4 left in L')).toBeInTheDocument();
  });

  it('adds the personalization upcharge only once text is entered', async () => {
    const user = userEvent.setup();
    render(<StoreProductCard offer={offer({ personalizationEnabled: true })} onAdd={onAdd} />);

    await user.click(screen.getByRole('checkbox', { name: /Add name embroidery/ }));
    // An empty box is not personalization, so it is not chargeable yet.
    expect(screen.getByRole('button', { name: /Add \$65\.00/ })).toBeInTheDocument();

    await user.type(screen.getByRole('textbox', { name: /Add name embroidery/ }), 'J. SMITH');

    expect(screen.getByRole('button', { name: /Add \$73\.00/ })).toBeInTheDocument();
  });

  it('previews the embroidery uppercased but submits the raw text', async () => {
    const user = userEvent.setup();
    render(<StoreProductCard offer={offer({ personalizationEnabled: true })} onAdd={onAdd} />);

    await user.click(screen.getByRole('checkbox', { name: /Add name embroidery/ }));
    await user.type(screen.getByRole('textbox', { name: /Add name embroidery/ }), 'j. smith');

    // The uppercase is a rendering of the stitching, not a change to the order.
    expect(screen.getByText('j. smith', { selector: 'span' })).toHaveClass('uppercase');

    await user.click(screen.getByRole('button', { name: /Add \$/ }));

    expect(onAdd).toHaveBeenCalledWith('v-m', 1, 'j. smith');
  });

  it('previews the embroidery in the thread the quartermaster chose', async () => {
    const user = userEvent.setup();
    render(
      <StoreProductCard
        offer={offer({
          personalizationEnabled: true,
          personalizationThreadColor: EmbroideryThreadColor.WHITE,
          personalizationThreadColorHex: '#f5f5f4',
        })}
        onAdd={onAdd}
      />
    );

    await user.click(screen.getByRole('checkbox', { name: /Add name embroidery/ }));
    await user.type(screen.getByRole('textbox', { name: /Add name embroidery/ }), 'J. SMITH');

    // The preview stands in for the goods, so it has to show the thread the
    // department actually orders rather than the gold it used to hardcode.
    expect(screen.getByText('J. SMITH', { selector: 'span' })).toHaveStyle({ color: '#f5f5f4' });
  });

  it('falls back to gold when the offer carries no thread colour', async () => {
    const user = userEvent.setup();
    const bare = offer({ personalizationEnabled: true });
    // A backend that predates the setting serves no hex at all.
    delete (bare as Partial<typeof bare>).personalizationThreadColorHex;

    render(<StoreProductCard offer={bare} onAdd={onAdd} />);

    await user.click(screen.getByRole('checkbox', { name: /Add name embroidery/ }));
    await user.type(screen.getByRole('textbox', { name: /Add name embroidery/ }), 'J. SMITH');

    expect(screen.getByText('J. SMITH', { selector: 'span' })).toHaveStyle({ color: '#c8a02c' });
  });

  it('asks a metal item to be engraved, not embroidered', () => {
    render(
      <StoreProductCard
        offer={offer({
          personalizationEnabled: true,
          personalizationMethod: PersonalizationMethod.ENGRAVING,
        })}
        onAdd={onAdd}
      />
    );

    // The prompt names the process: a challenge coin is cut, not stitched.
    expect(screen.getByRole('checkbox', { name: /Add name engraving/ })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: /embroidery/i })).not.toBeInTheDocument();
  });

  it('previews an engraved item without a thread colour', async () => {
    const user = userEvent.setup();
    render(
      <StoreProductCard
        offer={offer({
          personalizationEnabled: true,
          personalizationMethod: PersonalizationMethod.ENGRAVING,
          // The product still stores a colour; engraving must ignore it rather
          // than stitch a coin in gold.
          personalizationThreadColor: EmbroideryThreadColor.GOLD,
          personalizationThreadColorHex: '#c8a02c',
        })}
        onAdd={onAdd}
      />
    );

    await user.click(screen.getByRole('checkbox', { name: /Add name engraving/ }));
    await user.type(screen.getByRole('textbox', { name: /Add name engraving/ }), 'J. SMITH');

    expect(screen.getByText('J. SMITH', { selector: 'span' })).not.toHaveStyle({ color: '#c8a02c' });
  });

  it('renders the size chips in the order the API served them', () => {
    // Ordering is settled server-side (StorefrontService._ordered_variants), so
    // the card must not re-sort and must not reverse what it was given.
    render(
      <StoreProductCard
        offer={offer({
          variants: [
            { id: 'v-xs', label: 'XS', price: '60.00', availableQuantity: null, isAvailable: true },
            { id: 'v-s', label: 'S', price: '62.00', availableQuantity: null, isAvailable: true },
            { id: 'v-m', label: 'M', price: '65.00', availableQuantity: null, isAvailable: true },
            { id: 'v-2xl', label: '2XL', price: '75.00', availableQuantity: null, isAvailable: true },
          ],
        })}
        onAdd={onAdd}
      />
    );

    const chips = screen.getAllByRole('button', { name: /^(XS|S|M|2XL)$/ });
    expect(chips.map((chip) => chip.textContent)).toEqual(['XS', 'S', 'M', '2XL']);
  });

  it('keeps required personalization ticked and blocks add until it is filled', async () => {
    const user = userEvent.setup();
    render(
      <StoreProductCard offer={offer({ personalizationEnabled: true, personalizationRequired: true })} onAdd={onAdd} />
    );

    const checkbox = screen.getByRole('checkbox', { name: /Add name embroidery/ });
    expect(checkbox).toBeChecked();
    expect(checkbox).toBeDisabled();
    expect(screen.getByRole('button', { name: /Add \$/ })).toBeDisabled();

    await user.type(screen.getByRole('textbox', { name: /Add name embroidery/ }), 'J. SMITH');

    expect(screen.getByRole('button', { name: /Add \$/ })).toBeEnabled();
  });

  it('resets quantity and clears the embroidery after adding', async () => {
    const user = userEvent.setup();
    render(<StoreProductCard offer={offer({ personalizationEnabled: true })} onAdd={onAdd} />);

    await user.click(screen.getByRole('button', { name: /Increase quantity/ }));
    await user.click(screen.getByRole('checkbox', { name: /Add name embroidery/ }));
    await user.type(screen.getByRole('textbox', { name: /Add name embroidery/ }), 'J. SMITH');
    await user.click(screen.getByRole('button', { name: /Add \$/ }));

    expect(onAdd).toHaveBeenCalledWith('v-m', 2, 'J. SMITH');
    expect(screen.getByRole('textbox', { name: /Add name embroidery/ })).toHaveValue('');
    expect(screen.getByRole('button', { name: /Add \$65\.00/ })).toBeInTheDocument();
  });

  it('offers no quantity stepper and no add on a sold-out product', () => {
    render(<StoreProductCard offer={offer({ isAvailable: false, variants: [] })} onAdd={onAdd} />);

    expect(screen.getByRole('button', { name: 'Sold out this window' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /Increase quantity/ })).not.toBeInTheDocument();
    expect(screen.getByText('Sold out')).toBeInTheDocument();
  });
});
