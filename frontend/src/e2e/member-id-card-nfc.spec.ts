import { expect, test, type Page, type Request } from '@playwright/test';
import { json, signIn } from './helpers';

/**
 * Issuing an NFC ID card from a member's profile, end to end in the browser.
 *
 * The unit tests cover NfcCardCapture and MemberIdCardsPanel in isolation with
 * the hooks mocked. What only a real page can show is the whole chain: the
 * profile mounting the panel once the integration is connected, the officer's
 * clicks reaching Web NFC inside a user gesture, the captured credential
 * reaching `POST /nfc-tags` in the snake_case shape the backend schema
 * accepts, and the list refreshing afterwards.
 *
 * Web NFC needs a physical radio, so `window.NDEFReader` is replaced before the
 * app loads with a fake the test drives: a write stays pending until the test
 * completes or fails it, exactly as the real API stays pending until a tag is
 * held against the phone, and a scan reports a tap only when the test says so.
 */

const MEMBER_ID = 'member-nfc-1';
const MEMBER = {
  id: MEMBER_ID,
  organization_id: 'org-1',
  username: 'jrivera',
  email: 'jrivera@example.com',
  first_name: 'Jordan',
  last_name: 'Rivera',
  status: 'active',
  roles: [],
  positions: [],
};
const MEMBER_NAME = 'Jordan Rivera';

const OFFICER_PERMISSIONS = ['members.view', 'members.manage', 'members.manage_id_cards'];

/** 128-bit issued code: the `LBC1` prefix and 32 upper-case hex characters. */
const ISSUED_CODE = /^LBC1[0-9A-F]{32}$/;

interface FakeNfcControl {
  writes: { recordType: string; data: string }[];
  writeArmed: boolean;
  writeAborted: boolean;
  scanArmed: boolean;
  completeWrite: () => void;
  failWrite: (name: string) => void;
  tap: (serialNumber: string) => void;
}

declare global {
  interface Window {
    __nfc?: FakeNfcControl;
  }
}

/** Replaces Web NFC with a controllable fake. Must run before navigation. */
async function installFakeNfc(page: Page): Promise<void> {
  await page.addInitScript(() => {
    let settleWrite: { resolve: () => void; reject: (err: Error) => void } | null = null;
    const readers = new Set<{ onreading: ((event: unknown) => void) | null }>();

    const control = {
      writes: [] as { recordType: string; data: string }[],
      writeArmed: false,
      writeAborted: false,
      scanArmed: false,
      completeWrite() {
        settleWrite?.resolve();
        settleWrite = null;
        control.writeArmed = false;
      },
      failWrite(name: string) {
        const err = new Error(name);
        err.name = name;
        settleWrite?.reject(err);
        settleWrite = null;
        control.writeArmed = false;
      },
      tap(serialNumber: string) {
        // A factory-printed ID card carries no NDEF records; the serial is
        // the only thing the reading event holds.
        readers.forEach((r) => r.onreading?.({ serialNumber, message: { records: [] } }));
      },
    };

    class FakeNDEFReader {
      onreading: ((event: unknown) => void) | null = null;
      onreadingerror: (() => void) | null = null;

      scan({ signal }: { signal?: AbortSignal } = {}): Promise<void> {
        readers.add(this);
        control.scanArmed = true;
        signal?.addEventListener('abort', () => {
          readers.delete(this);
          control.scanArmed = readers.size > 0;
        });
        return Promise.resolve();
      }

      write(
        message: { records: { recordType: string; data: string }[] },
        { signal }: { signal?: AbortSignal } = {}
      ): Promise<void> {
        control.writes.push(...message.records);
        control.writeArmed = true;
        control.writeAborted = false;
        return new Promise<void>((resolve, reject) => {
          settleWrite = { resolve, reject };
          signal?.addEventListener('abort', () => {
            control.writeArmed = false;
            control.writeAborted = true;
            const err = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
          });
        });
      }
    }

    Object.defineProperty(window, 'NDEFReader', { value: FakeNDEFReader, configurable: true });
    Object.defineProperty(window, '__nfc', { value: control, configurable: true });
  });
}

interface CardApi {
  /** Every `POST /nfc-tags` body, parsed. */
  registrations: Record<string, unknown>[];
}

/**
 * Serves the member, a connected NFC ID Cards integration, and a stateful
 * `/nfc-tags` collection, so a successful registration shows up on reload.
 *
 * Registered after `signIn` so these win over the catch-all.
 */
async function mockCardApi(page: Page, { rejectWith }: { rejectWith?: string } = {}): Promise<CardApi> {
  const api: CardApi = { registrations: [] };
  const cards: Record<string, unknown>[] = [];

  await page.route('**/api/v1/users/*/with-roles', (route) => route.fulfill(json(MEMBER)));
  await page.route('**/api/v1/integrations/connected', (route) =>
    route.fulfill(json([{ integration_type: 'nfc-id-cards', status: 'connected' }]))
  );
  await page.route('**/api/v1/nfc-tags**', async (route) => {
    const request = route.request();
    if (request.method() === 'GET') {
      await route.fulfill(json({ items: cards, total: cards.length }));
      return;
    }
    if (request.method() === 'POST') {
      const body = request.postDataJSON() as Record<string, unknown>;
      api.registrations.push(body);
      if (rejectWith) {
        await route.fulfill(json({ detail: rejectWith }, 400));
        return;
      }
      const now = new Date().toISOString();
      const card = {
        id: `card-${cards.length + 1}`,
        organizationId: 'org-1',
        userId: body.user_id,
        uidPreview: String(body.tag_uid).slice(-4),
        credentialType: body.credential_type,
        label: body.label ?? null,
        status: 'active',
        issuedAt: now,
        lastUsedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      cards.push(card);
      await route.fulfill(json(card, 201));
      return;
    }
    await route.fulfill(json({}));
  });

  return api;
}

const PROFILE_PATH = `/members/${MEMBER_ID}`;
const ADMIN_EDIT_PATH = `/members/admin/edit/${MEMBER_ID}`;

async function openIssueDialog(page: Page, path = PROFILE_PATH) {
  await page.goto(path);
  const panel = page.locator('.card', { has: page.getByRole('heading', { name: 'ID Cards' }) });
  await expect(panel).toBeVisible({ timeout: 15_000 });
  await expect(panel.getByText('No ID cards issued')).toBeVisible();
  await panel.getByRole('button', { name: 'Issue card' }).click();
  const dialog = page.getByRole('dialog', { name: `Issue an ID card to ${MEMBER_NAME}` });
  await expect(dialog).toBeVisible();
  return { panel, dialog };
}

const nfc = (page: Page) => page.evaluate(() => window.__nfc as FakeNfcControl);

const isRegistration = (request: Request) => request.method() === 'POST' && /\/api\/v1\/nfc-tags$/.test(request.url());

test.describe('issuing an NFC ID card on a phone with Web NFC', () => {
  test.beforeEach(async ({ page }) => {
    await installFakeNfc(page);
    await signIn(page, { permissions: OFFICER_PERMISSIONS });
  });

  test('writes a fresh code to a blank card and registers it as written', async ({ page }) => {
    const api = await mockCardApi(page);
    const { panel, dialog } = await openIssueDialog(page);

    await dialog.getByRole('button', { name: 'Write a code to a blank card' }).click();
    await expect(dialog.getByRole('button', { name: 'Hold the card against the phone…' })).toBeDisabled();
    await expect.poll(async () => (await nfc(page)).writeArmed).toBe(true);

    // Nothing is bound until the tag has actually taken the code.
    const field = dialog.locator('#nfc-card-credential');
    await expect(field).toHaveValue('');

    await page.evaluate(() => window.__nfc?.completeWrite());
    await expect(dialog.getByRole('status')).toHaveText('Code written to the card. Register it to finish.');

    const code = await field.inputValue();
    expect(code).toMatch(ISSUED_CODE);
    const { writes } = await nfc(page);
    // Written as a text record, not a URL a passing phone would offer to open,
    // and the value on the tag is the value about to be registered.
    expect(writes).toEqual([{ recordType: 'text', data: code }]);

    await dialog.locator('#nfc-card-label').fill('  Blue ID card  ');
    const posted = page.waitForRequest(isRegistration);
    await dialog.getByRole('button', { name: 'Register card' }).click();
    await posted;

    expect(api.registrations).toEqual([
      { user_id: MEMBER_ID, tag_uid: code, credential_type: 'written', label: 'Blue ID card' },
    ]);
    await expect(dialog).toBeHidden();
    await expect(page.getByText('ID card issued')).toBeVisible();
    await expect(panel.getByText('Blue ID card')).toBeVisible();
    await expect(panel.getByText('Written')).toBeVisible();
    await expect(panel.getByText(`…${code.slice(-4)}`)).toBeVisible();
    await expect(panel.getByText('1 active of 1')).toBeVisible();
  });

  test("reads a printed card's serial and registers it normalized", async ({ page }) => {
    const api = await mockCardApi(page);
    const { panel, dialog } = await openIssueDialog(page);

    await dialog.getByRole('button', { name: "Read a printed card's serial" }).click();
    await expect.poll(async () => (await nfc(page)).scanArmed).toBe(true);

    await page.evaluate(() => window.__nfc?.tap('04:a2:24:5b:7c:11:80'));
    await expect(dialog.locator('#nfc-card-credential')).toHaveValue('04A2245B7C1180');
    await expect(dialog.getByRole('status')).toHaveText('Card read.');

    const posted = page.waitForRequest(isRegistration);
    await dialog.getByRole('button', { name: 'Register card' }).click();
    await posted;

    // A blank label is omitted, not sent as "".
    expect(api.registrations).toEqual([{ user_id: MEMBER_ID, tag_uid: '04A2245B7C1180', credential_type: 'serial' }]);
    await expect(dialog).toBeHidden();
    await expect(panel.getByText('…1180')).toBeVisible();
    await expect(panel.getByText('Written')).toHaveCount(0);
    // Leaving the dialog disarms the radio.
    await expect.poll(async () => (await nfc(page)).scanArmed).toBe(false);
  });

  test('a failed write binds nothing and cannot be registered', async ({ page }) => {
    const api = await mockCardApi(page);
    const { dialog } = await openIssueDialog(page);

    await dialog.getByRole('button', { name: 'Write a code to a blank card' }).click();
    await expect.poll(async () => (await nfc(page)).writeArmed).toBe(true);
    await page.evaluate(() => window.__nfc?.failWrite('NetworkError'));

    await expect(
      dialog.getByText('The tag moved away before the transfer finished. Hold the phone still against the tag.')
    ).toBeVisible();
    await expect(dialog.locator('#nfc-card-credential')).toHaveValue('');
    await expect(dialog.getByRole('status')).toHaveCount(0);

    await dialog.getByRole('button', { name: 'Register card' }).click();
    await expect(dialog.getByText(/No card has been read yet/)).toBeVisible();
    expect(api.registrations).toHaveLength(0);
  });

  test('cancelling while the writer is armed disarms it and registers nothing', async ({ page }) => {
    const api = await mockCardApi(page);
    const { dialog } = await openIssueDialog(page);

    await dialog.getByRole('button', { name: 'Write a code to a blank card' }).click();
    await expect.poll(async () => (await nfc(page)).writeArmed).toBe(true);

    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    // An orphaned write would silently overwrite the next tag near the phone.
    await expect.poll(async () => (await nfc(page)).writeAborted).toBe(true);
    expect(api.registrations).toHaveLength(0);
  });

  test('a card the server refuses keeps the dialog open with the reason', async ({ page }) => {
    const reason = 'This card is already registered to another member';
    const api = await mockCardApi(page, { rejectWith: reason });
    const { panel, dialog } = await openIssueDialog(page);

    await dialog.getByRole('button', { name: "Read a printed card's serial" }).click();
    await expect.poll(async () => (await nfc(page)).scanArmed).toBe(true);
    await page.evaluate(() => window.__nfc?.tap('04A2245B7C1180'));
    await expect(dialog.locator('#nfc-card-credential')).toHaveValue('04A2245B7C1180');

    const posted = page.waitForRequest(isRegistration);
    await dialog.getByRole('button', { name: 'Register card' }).click();
    await posted;

    await expect(dialog.getByText(reason)).toBeVisible();
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('#nfc-card-credential')).toHaveValue('04A2245B7C1180');
    expect(api.registrations).toHaveLength(1);
    await expect(panel.getByText('No ID cards issued')).toBeVisible();
  });
});

test.describe('issuing an NFC ID card from members administration', () => {
  test.beforeEach(async ({ page }) => {
    await installFakeNfc(page);
    await signIn(page, { permissions: OFFICER_PERMISSIONS });
  });

  test('writes and registers a card from the admin edit page', async ({ page }) => {
    const api = await mockCardApi(page);
    const { panel, dialog } = await openIssueDialog(page, ADMIN_EDIT_PATH);
    await expect(page.getByRole('heading', { name: `Edit Member: ${MEMBER_NAME}` })).toBeVisible();

    await dialog.getByRole('button', { name: 'Write a code to a blank card' }).click();
    await expect.poll(async () => (await nfc(page)).writeArmed).toBe(true);
    await page.evaluate(() => window.__nfc?.completeWrite());
    const code = await dialog.locator('#nfc-card-credential').inputValue();
    expect(code).toMatch(ISSUED_CODE);

    const posted = page.waitForRequest(isRegistration);
    await dialog.getByRole('button', { name: 'Register card' }).click();
    await posted;

    expect(api.registrations).toEqual([{ user_id: MEMBER_ID, tag_uid: code, credential_type: 'written' }]);
    await expect(dialog).toBeHidden();
    await expect(panel.getByText(`…${code.slice(-4)}`)).toBeVisible();
  });

  test('a profile editor without the card permission gets no ID Cards section', async ({ page }) => {
    await signIn(page, { permissions: ['members.view', 'members.manage'] });
    await mockCardApi(page);
    await page.goto(ADMIN_EDIT_PATH);

    await expect(page.getByRole('heading', { name: `Edit Member: ${MEMBER_NAME}` })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('heading', { name: 'ID Cards' })).toHaveCount(0);
  });
});

test.describe('issuing an NFC ID card from a desktop without Web NFC', () => {
  test.beforeEach(async ({ page }) => {
    await signIn(page, { permissions: OFFICER_PERMISSIONS });
  });

  test('offers only the typed field, which a USB reader fills', async ({ page }) => {
    const api = await mockCardApi(page);
    const { panel, dialog } = await openIssueDialog(page);

    await expect(dialog.getByRole('button', { name: 'Write a code to a blank card' })).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: "Read a printed card's serial" })).toHaveCount(0);
    await expect(dialog.getByText('This device cannot read or write tags itself.')).toBeVisible();

    // A USB reader types like a keyboard, separators and all.
    await dialog.locator('#nfc-card-credential').pressSequentially('04-a2-24-5b-7c-11-80');
    await expect(dialog.locator('#nfc-card-credential')).toHaveValue('04A2245B7C1180');

    const posted = page.waitForRequest(isRegistration);
    await dialog.getByRole('button', { name: 'Register card' }).click();
    await posted;

    expect(api.registrations).toEqual([{ user_id: MEMBER_ID, tag_uid: '04A2245B7C1180', credential_type: 'serial' }]);
    await expect(dialog).toBeHidden();
    await expect(panel.getByText('…1180')).toBeVisible();
  });

  test('refuses to register before any card is captured', async ({ page }) => {
    const api = await mockCardApi(page);
    const { dialog } = await openIssueDialog(page);

    await dialog.getByRole('button', { name: 'Register card' }).click();
    await expect(dialog.getByText(/No card has been read yet/)).toBeVisible();
    await expect(dialog).toBeVisible();
    expect(api.registrations).toHaveLength(0);
  });
});
