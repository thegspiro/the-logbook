import { expect, test } from '@playwright/test';
import { json, signIn, TEST_USER } from './helpers';
import { TABLE_FIT_VIEWPORTS } from './tableFit';

// A department's real payment handles run long — a treasurer's Zelle email on
// the department's own domain. The handle is one unbroken token, and on My
// Orders it ran past the edge of its option card, clipped where the card
// ended (seen in the 18-04 training screenshot at 1440px).
const LONG_ZELLE = 'treasurer.station-one@oakvillefiredepartment.example.org';

const order = {
  id: 'o1',
  organizationId: 'org1',
  orderNumber: 'ORD-2026-0001',
  customerName: 'Alex Tester',
  windowName: 'Fall 2026 Order Window',
  status: 'awaiting_payment',
  paymentStatus: 'unpaid',
  paymentMethod: 'venmo',
  subtotal: '76.00',
  taxAmount: '0.00',
  shippingAmount: '0.00',
  discountAmount: '0.00',
  total: '76.00',
  amountPaid: '0.00',
  balanceDue: '76.00',
  fulfillmentMethod: 'pickup',
  submittedAt: '2026-11-21T14:42:00Z',
  items: [
    {
      id: 'i1',
      productName: 'Department Job Shirt',
      variantLabel: 'L',
      unitPrice: '54.00',
      quantity: 1,
      lineTotal: '54.00',
      fulfilledQuantity: 0,
    },
  ],
  events: [],
  paymentInstructions: {
    method: 'venmo',
    label: 'Venmo',
    paymentUrl: 'https://venmo.com/OakvilleFD?txn=pay&amount=76.00&note=ORD-2026-0001',
    handle: '@OakvilleFD',
    reference: 'ORD-2026-0001',
    amountDue: '76.00',
    options: [
      {
        method: 'venmo',
        label: 'Venmo',
        handle: '@OakvilleFD',
        paymentUrl: 'https://venmo.com/OakvilleFD?txn=pay&amount=76.00&note=ORD-2026-0001',
        instructions: null,
        prefillsReference: true,
      },
      {
        method: 'cashapp',
        label: 'Cash App',
        handle: '$OakvilleFD',
        paymentUrl: 'https://cash.app/$OakvilleFD/76.00',
        instructions: null,
        prefillsReference: false,
      },
      {
        method: 'zelle',
        label: 'Zelle',
        handle: LONG_ZELLE,
        paymentUrl: null,
        instructions: 'Put your order number in the Zelle memo so the treasurer can match the payment.',
        prefillsReference: false,
      },
    ],
  },
};

test.describe('My Orders payment options fit their cards', () => {
  for (const viewport of [{ name: 'iPhone 390x844', width: 390, height: 844 }, ...TABLE_FIT_VIEWPORTS]) {
    test(`/store/orders — ${viewport.name}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await signIn(page, { permissions: [...TEST_USER.permissions, 'storefront.view'] });
      await page.route('**/api/v1/store/orders/mine**', (route) => route.fulfill(json([order])));
      await page.goto('/store/orders');

      const handle = page.getByRole('button', { name: `Copy Zelle handle ${LONG_ZELLE}` });
      await expect(handle).toBeVisible();

      const card = page.locator('li').filter({ has: handle });
      const fit = await card.evaluate((li) => {
        const box = li.getBoundingClientRect();
        const overflowing = Array.from(li.querySelectorAll<HTMLElement>('*'))
          .filter((el) => el.getBoundingClientRect().right > box.right + 0.5)
          .map((el) => `${el.tagName.toLowerCase()}: ${(el.textContent ?? '').trim().slice(0, 40)}`);
        return { scrolls: li.scrollWidth > li.clientWidth, overflowing };
      });
      expect(fit.overflowing, 'elements past the Zelle card’s right edge').toEqual([]);
      expect(fit.scrolls, 'the Zelle card scrolls sideways').toBe(false);
    });
  }
});
