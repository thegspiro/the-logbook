import { describe, expect, it } from 'vitest';
import { errorAction, errorPage, requestAction } from './errorContext';

describe('error context formatting', () => {
  it('describes the resource without retaining IDs', () => {
    expect(requestAction('PATCH', '/api/v1/events/2f4b93d8-50b8-4ce0-9c06-1819dce76a3f')).toBe('Updating events');
    expect(requestAction('POST', '/api/v1/training-sessions')).toBe('Creating or submitting training sessions');
  });

  it('uses recognized endpoint operations when they are more specific than the HTTP method', () => {
    expect(requestAction('POST', '/api/v1/events/42/cancel')).toBe('Cancelling events');
    expect(requestAction('POST', '/api/v1/finance/approvals/[REDACTED]/approve')).toBe('Approving finance');
  });

  it('does not copy arbitrary endpoint segments into the action', () => {
    expect(requestAction('POST', '/api/v1/events/42/some-member-supplied-value')).toBe('Creating or submitting events');
  });

  it('uses the endpoint as the page for server-only reports', () => {
    const context = { source: 'backend', method: 'DELETE', path: '/inventory/items/42' };
    expect(errorPage(context)).toBe('/inventory/items/42');
    expect(errorAction(context)).toBe('Deleting inventory');
  });

  it('prefers explicitly recorded browser context', () => {
    const context = { page: '/admin/members', action: 'Importing members', method: 'POST', path: '/members/import' };
    expect(errorPage(context)).toBe('/admin/members');
    expect(errorAction(context)).toBe('Importing members');
  });
});
