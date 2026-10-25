/**
 * Thin wrapper over @simplewebauthn/browser for the passkey ceremonies.
 *
 * The server hands over ready-made options (py_webauthn's JSON shape, which
 * is the WebAuthn Level 3 JSON this library takes) and verifies whatever comes
 * back, so this file only runs the browser prompt and turns the ways it can
 * fail into words a member can act on.
 *
 * Safari only shows the prompt from a direct tap. Callers fetch the options
 * first and call these functions straight from the click handler, never after
 * another network round trip.
 */

import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration,
  WebAuthnError,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from '@simplewebauthn/browser';

export type PasskeyRequestOptions = PublicKeyCredentialRequestOptionsJSON;
export type PasskeyCreationOptions = PublicKeyCredentialCreationOptionsJSON;
export type PasskeyAssertion = AuthenticationResponseJSON;
export type PasskeyRegistration = RegistrationResponseJSON;

export function passkeysSupported(): boolean {
  return browserSupportsWebAuthn();
}

export function createPasskey(options: PasskeyCreationOptions): Promise<PasskeyRegistration> {
  return startRegistration({ optionsJSON: options });
}

export function getPasskeyAssertion(options: PasskeyRequestOptions): Promise<PasskeyAssertion> {
  return startAuthentication({ optionsJSON: options });
}

/** True when the member closed the prompt or let it time out. */
export function isPasskeyCancelled(err: unknown): boolean {
  if (err instanceof WebAuthnError) {
    return err.code === 'ERROR_CEREMONY_ABORTED' || err.name === 'NotAllowedError';
  }
  return err instanceof Error && (err.name === 'NotAllowedError' || err.name === 'AbortError');
}

/**
 * A message for a failed passkey prompt. Server errors are not handled here;
 * they go through getErrorMessage like any other request.
 */
export function passkeyPromptError(err: unknown): string {
  if (isPasskeyCancelled(err)) {
    return 'The passkey request was cancelled or timed out. Try again.';
  }
  if (err instanceof WebAuthnError && err.code === 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED') {
    return 'This device already has a passkey for your account.';
  }
  if (err instanceof WebAuthnError && err.code === 'ERROR_AUTHENTICATOR_MISSING_USER_VERIFICATION_SUPPORT') {
    return 'This device cannot check your fingerprint, face or PIN, which a passkey needs here.';
  }
  return 'Your device could not complete the passkey request. Try again, or use another sign-in method.';
}

/** Whether a thrown value came from the browser prompt rather than the server. */
export function isPasskeyPromptError(err: unknown): boolean {
  return (
    err instanceof WebAuthnError ||
    (err instanceof Error &&
      ['NotAllowedError', 'AbortError', 'InvalidStateError', 'NotSupportedError', 'SecurityError'].includes(err.name))
  );
}
