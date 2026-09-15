import { describe, it, expect } from 'vitest';

import { SMTP_PROVIDER_PRESETS, findSmtpProviderPreset } from './smtpProviders';

/**
 * These presets fill in a host, port and encryption that the backend then
 * connects to for real. A preset that cannot complete that connection is
 * worse than no preset — it reads as a supported provider and fails with an
 * error the administrator has no way to act on.
 */
describe('SMTP provider presets', () => {
  it('has a unique id per provider', () => {
    const ids = SMTP_PROVIDER_PRESETS.map((p) => p.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  it('finds every preset by its own id, and nothing by an unknown one', () => {
    expect(SMTP_PROVIDER_PRESETS.map((p) => findSmtpProviderPreset(p.id))).toEqual(SMTP_PROVIDER_PRESETS);
    expect(findSmtpProviderPreset('not-a-provider')).toBeUndefined();
  });

  // The sender's STARTTLS/SSL uses ssl.create_default_context() —
  // check_hostname=True, verify_mode=CERT_REQUIRED — with no per-connection
  // trust override anywhere in the settings model. A service on loopback or
  // a private address cannot present a certificate that passes, so its
  // handshake fails every time. This is why Proton Mail Bridge
  // (127.0.0.1:1025) is not in the list, and it is stated as a rule rather
  // than a ban on one id so the next such provider fails here too.
  it('points only at hosts that can present a verifiable certificate', () => {
    const unverifiable = /^(localhost$|127\.|0\.0\.0\.0$|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?$)/;

    const unreachable = SMTP_PROVIDER_PRESETS.filter((p) => unverifiable.test(p.host)).map(
      (p) => `${p.label} (${p.host})`
    );

    expect(unreachable).toEqual([]);
  });

  it('pairs each well-known port with the encryption that port expects', () => {
    const expected: Record<number, 'ssl' | 'tls'> = { 465: 'ssl', 587: 'tls' };

    const mismatched = SMTP_PROVIDER_PRESETS.filter(
      (p) => expected[p.port] !== undefined && p.encryption !== expected[p.port]
    ).map((p) => `${p.label}: ${p.port} paired with ${p.encryption}`);

    expect(mismatched).toEqual([]);
  });

  it('tells the administrator which credential the provider wants', () => {
    // The reason the list exists: most of these refuse an account password
    // and want an app password generated in their own settings.
    const unexplained = SMTP_PROVIDER_PRESETS.filter(
      (p) => p.usernameHint.trim() === '' || p.credentialHint.trim() === ''
    ).map((p) => p.label);

    expect(unexplained).toEqual([]);
  });
});
