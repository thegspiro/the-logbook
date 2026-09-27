import { describe, it, expect } from 'vitest';
import { DEFAULT_POST_LOGIN_PATH, postLoginRedirect } from './postLoginRedirect';

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
});
