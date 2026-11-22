import { test, type Page, type Route } from '@playwright/test';

import { signIn } from '../../../frontend/src/e2e/helpers';
import { SCALE, SCREEN, centre, decoyQr, prepare, recordShots, settle, tap } from '../../lib/recorder';

/**
 * Short 8G — "Setting Up Two-Factor Authentication".
 *
 * Serves the authenticator enrolment and passkey endpoints from in-memory
 * state, so enabling either one changes what the next status read returns.
 * Nothing here is a working credential: the setup key is not valid base32,
 * the QR code is replaced by a decoy before it is painted, the recovery codes
 * are fixed strings this mock invents, and the passkey is made by Chromium's
 * virtual authenticator and accepted without verification.
 */

const SETUP_KEY = 'DEMO0KEY0NOT0VALID';

const RECOVERY_CODES = [
  '3f9a1-c07e4-8b2d6-15e90',
  '7c2e8-41b9a-d6f03-9e7c1',
  'a05d3-e8c17-2f94b-6d0a8',
  '19b7e-5a3c0-c8e26-f417d',
  'e6d40-b2f89-073a5-c1e98',
  '58c1f-9d6e2-a4b70-3e5c9',
  'b3e07-16a4d-f9c82-0d7b5',
  '0d8f6-c3b51-7e29a-a46e0',
  'c74a2-0f5e8-b1d39-68c3f',
  '92e5b-d7a06-4c1f8-e3b27',
];

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

const b64url = (text: string) => Buffer.from(text).toString('base64url');

// Registered after signIn's fixtures, so these answer first for their URLs.
async function mockSecurity(page: Page) {
  const state = {
    mfaEnabled: false,
    recoveryRemaining: 0,
    passkeys: [] as { id: string; name: string; created_at: string; last_used_at: null; backed_up: boolean }[],
  };

  await page.route('**/api/v1/auth/mfa/status', (route) =>
    json(route, {
      mfa_enabled: state.mfaEnabled,
      passkey_count: state.passkeys.length,
      recovery_codes_remaining: state.recoveryRemaining,
    })
  );
  await page.route('**/api/v1/auth/mfa/policy', (route) =>
    json(route, { mfa_required: false, passkeys_enabled: true })
  );
  await page.route('**/api/v1/auth/mfa/setup', (route) =>
    json(route, {
      secret: SETUP_KEY,
      qr_code_url: `otpauth://totp/The%20Logbook:demo?secret=${SETUP_KEY}&issuer=demo.invalid`,
    })
  );
  await page.route('**/api/v1/auth/mfa/verify-setup**', (route) => {
    state.mfaEnabled = true;
    state.recoveryRemaining = RECOVERY_CODES.length;
    return json(route, { recovery_codes: RECOVERY_CODES });
  });
  await page.route('**/api/v1/auth/passkeys', (route) =>
    json(route, { passkeys: state.passkeys, max_passkeys: 10, available: true, allowed: true })
  );
  await page.route('**/api/v1/auth/passkeys/register-options', (route) =>
    json(route, {
      rp: { id: 'localhost', name: 'The Logbook' },
      user: { id: b64url('demo-user-1'), name: 'demo', displayName: 'Demo Member' },
      challenge: b64url('video-capture-challenge-not-verified'),
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },
        { type: 'public-key', alg: -257 },
      ],
      timeout: 60000,
      attestation: 'none',
      authenticatorSelection: { residentKey: 'required', userVerification: 'preferred' },
      excludeCredentials: [],
    })
  );
  await page.route('**/api/v1/auth/passkeys/register', (route) => {
    const { name } = route.request().postDataJSON() as { name: string };
    const passkey = {
      id: `passkey-${state.passkeys.length + 1}`,
      name,
      created_at: new Date().toISOString(),
      last_used_at: null,
      backed_up: true,
    };
    state.passkeys.push(passkey);
    return json(route, { passkey, recovery_codes: [] });
  });
}

// A platform authenticator that answers at once, standing in for Face ID.
async function addVirtualAuthenticator(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', {
    options: {
      protocol: 'ctap2',
      transport: 'internal',
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
}

test.use({ viewport: SCREEN, deviceScaleFactor: SCALE, timezoneId: 'America/Chicago' });

test('capture 8g-two-factor', async ({ page }) => {
  if (process.env.VIDEO_DEBUG) {
    page.on('request', (r) => {
      if (r.url().includes('/api/v1/')) console.log('REQ', r.method(), r.url().replace(/^.*\/api\/v1/, ''));
    });
    page.on('console', (m) => {
      if (m.type() === 'error') console.log('CONSOLE', m.text().slice(0, 300));
    });
  }
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  await prepare(page);
  await signIn(page, { memberRecord: true });
  await mockSecurity(page);
  await addVirtualAuthenticator(page);
  await page.goto('/account');
  await settle(page);

  const main = page.getByRole('main');
  await recordShots(page, '8g-two-factor', async (shot) => {
    await shot('hook', async () => {
      await page.waitForTimeout(600);
    });
    await shot('security', async () => {
      await tap(
        page,
        main
          .getByRole('button', { name: /^Security/ })
          .locator('visible=true')
          .first()
      );
      await settle(page);
    });
    await shot('enable', async () => {
      const enable = main.getByRole('button', { name: 'Enable two-factor authentication' });
      await tap(page, enable);
      await decoyQr(main.locator('svg[role="img"]').locator('xpath=..'));
    });
    await shot('scan', async () => {
      await centre(page, main.locator('svg[data-decoy-qr]'));
    });
    await shot('verify', async () => {
      const field = main.locator('#mfa-setup-code');
      await tap(page, field);
      await field.pressSequentially('428913', { delay: 90 });
      await page.waitForTimeout(300);
      await tap(page, main.getByRole('button', { name: 'Verify & enable' }));
      await main.getByText('Save your recovery codes').first().waitFor();
      await page.waitForTimeout(300);
    });
    await shot('recovery', async () => {
      await centre(page, main.getByText(RECOVERY_CODES[0] ?? '').first());
      await page.waitForTimeout(600);
      await tap(page, main.getByRole('button', { name: 'Copy codes' }).first());
      await page.waitForTimeout(700);
      await tap(page, main.getByRole('button', { name: 'Done', exact: true }).first());
      await settle(page);
    });
    await shot('on', async () => {
      await centre(page, main.getByText(/Authenticator app is/));
    });
    await shot('passkey', async () => {
      await tap(page, main.getByRole('button', { name: 'Add a passkey' }));
      const name = main.locator('#passkey-name');
      await name.waitFor();
      await tap(page, name);
      await name.fill('');
      await name.pressSequentially('My phone', { delay: 45 });
      await tap(page, main.getByRole('button', { name: 'Create passkey' }));
      await main.getByText('My phone', { exact: true }).waitFor();
      await settle(page);
    });
    await shot('outro', async () => {
      await page.waitForTimeout(300);
    });
  });
});
