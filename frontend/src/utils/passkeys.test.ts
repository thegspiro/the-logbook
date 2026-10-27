import { describe, it, expect } from 'vitest';
import { WebAuthnError } from '@simplewebauthn/browser';
import { isPasskeyCancelled, isPasskeyPromptError, passkeyPromptError } from './passkeys';

const named = (name: string) => Object.assign(new Error(name), { name });

const webAuthnError = (code: WebAuthnError['code'], name = 'Error') =>
  new WebAuthnError({ message: code, code, cause: named(name), name });

describe('passkey prompt errors', () => {
  it('treats a closed or timed-out prompt as a cancellation', () => {
    expect(isPasskeyCancelled(named('NotAllowedError'))).toBe(true);
    expect(isPasskeyCancelled(webAuthnError('ERROR_CEREMONY_ABORTED', 'AbortError'))).toBe(true);
    expect(passkeyPromptError(named('NotAllowedError'))).toMatch(/cancelled or timed out/);
  });

  it('names a device that is already registered', () => {
    expect(passkeyPromptError(webAuthnError('ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED', 'InvalidStateError'))).toMatch(
      /already has a passkey/
    );
  });

  it('names a device that cannot check a biometric or PIN', () => {
    expect(
      passkeyPromptError(webAuthnError('ERROR_AUTHENTICATOR_MISSING_USER_VERIFICATION_SUPPORT', 'ConstraintError'))
    ).toMatch(/fingerprint, face or PIN/);
  });

  it('tells a browser prompt failure from a server error', () => {
    expect(isPasskeyPromptError(named('NotAllowedError'))).toBe(true);
    expect(isPasskeyPromptError(webAuthnError('ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY'))).toBe(true);
    expect(isPasskeyPromptError(new Error('Request failed with status code 400'))).toBe(false);
  });
});
