import { describe, it, expect } from 'vitest';
import { DEFAULT_POST_LOGIN_PATH, loginPathReturningTo, postLoginRedirect, signInLanding } from './postLoginRedirect';

describe('postLoginRedirect', () => {
  it('returns to the page, its query and its anchor', () => {
    // Workflow review W02-1: the query used to be dropped.
    expect(postLoginRedirect({ from: { pathname: '/events', search: '?view=calendar', hash: '#today' } })).toBe(
      '/events?view=calendar#today'
    );
  });

  it('returns to a page with no query unchanged', () => {
    expect(postLoginRedirect({ from: { pathname: '/members' } })).toBe('/members');
  });

  it('goes to the dashboard when nothing was saved', () => {
    expect(postLoginRedirect(null)).toBe(DEFAULT_POST_LOGIN_PATH);
    expect(postLoginRedirect({})).toBe(DEFAULT_POST_LOGIN_PATH);
  });

  it('refuses anything that would leave the app', () => {
    expect(postLoginRedirect({ from: { pathname: '//evil.example/x' } })).toBe(DEFAULT_POST_LOGIN_PATH);
    expect(postLoginRedirect({ from: { pathname: 'https://evil.example/x' } })).toBe(DEFAULT_POST_LOGIN_PATH);
    expect(postLoginRedirect({ from: { pathname: 42 } })).toBe(DEFAULT_POST_LOGIN_PATH);
  });

  it('ignores a query or anchor that is not one', () => {
    expect(postLoginRedirect({ from: { pathname: '/events', search: '//evil.example', hash: 'x' } })).toBe('/events');
  });

  it('refuses a path a browser would read as another host', () => {
    expect(postLoginRedirect({ from: { pathname: '/\\evil.example/x' } })).toBe(DEFAULT_POST_LOGIN_PATH);
    expect(postLoginRedirect({ from: { pathname: '/\t/evil.example/x' } })).toBe(DEFAULT_POST_LOGIN_PATH);
  });
});

// LOC-37: an expired session is found by the API client, which leaves with a
// full page load and so can only carry the page in the login URL.
describe('postLoginRedirect from the login URL', () => {
  const room = '/locations/room-7/check-in?tag=door#top';

  it('returns to the page the expired session left', () => {
    expect(
      postLoginRedirect(
        null,
        loginPathReturningTo({ pathname: '/locations/room-7/check-in', search: '?tag=door', hash: '#top' }).slice(
          '/login'.length
        )
      )
    ).toBe(room);
  });

  it('prefers the router state, which never left the app', () => {
    expect(postLoginRedirect({ from: { pathname: '/events' } }, `?from=${encodeURIComponent(room)}`)).toBe('/events');
  });

  it('refuses a from that would leave the app', () => {
    for (const target of [
      '//evil.example/x',
      'https://evil.example/x',
      '/\\evil.example/x',
      '/\t/evil.example/x',
      'javascript:alert(1)',
      'evil.example',
      '',
    ]) {
      expect(postLoginRedirect(null, `?from=${encodeURIComponent(target)}`)).toBe(DEFAULT_POST_LOGIN_PATH);
    }
  });

  it('goes to the dashboard with no from at all', () => {
    expect(postLoginRedirect(null, '')).toBe(DEFAULT_POST_LOGIN_PATH);
    expect(postLoginRedirect(null, '?error=access_denied')).toBe(DEFAULT_POST_LOGIN_PATH);
  });
});

describe('loginPathReturningTo', () => {
  it('names the page, its query and its anchor', () => {
    expect(loginPathReturningTo({ pathname: '/locations/room-7/check-in', search: '?tag=door', hash: '#top' })).toBe(
      '/login?from=%2Flocations%2Froom-7%2Fcheck-in%3Ftag%3Ddoor%23top'
    );
  });

  it('adds nothing for the login page itself or the bare root', () => {
    expect(loginPathReturningTo({ pathname: '/login', search: '?from=%2Fevents' })).toBe('/login');
    expect(loginPathReturningTo({ pathname: '/' })).toBe('/login');
  });
});

describe('signInLanding', () => {
  const ordinary = { must_change_password: false, password_expired: false, mfa_enrollment_required: false };

  it('sends a member who must change their password straight to /account (forms review F-10)', () => {
    expect(signInLanding({ ...ordinary, must_change_password: true }, { from: { pathname: '/events' } })).toEqual({
      to: '/account',
      state: { forcePasswordChange: true },
    });
  });

  it('treats an expired password the same way', () => {
    expect(signInLanding({ ...ordinary, password_expired: true }, null)).toEqual({
      to: '/account',
      state: { forcePasswordChange: true },
    });
  });

  it('sends a member who must enrol in MFA to /account, after any password change', () => {
    expect(signInLanding({ ...ordinary, mfa_enrollment_required: true }, null)).toEqual({
      to: '/account',
      state: { forceMfaSetup: true },
    });
    expect(signInLanding({ ...ordinary, must_change_password: true, mfa_enrollment_required: true }, null)).toEqual({
      to: '/account',
      state: { forcePasswordChange: true },
    });
  });

  it('otherwise returns where the member was going', () => {
    expect(signInLanding(ordinary, { from: { pathname: '/events' } })).toEqual({ to: '/events' });
    expect(signInLanding(null, null)).toEqual({ to: DEFAULT_POST_LOGIN_PATH });
  });
});
