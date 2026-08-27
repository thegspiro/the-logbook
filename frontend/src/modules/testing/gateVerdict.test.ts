import { describe, it, expect } from 'vitest';
import { gateVerdict, isGateMismatch, tallyGateVerdicts } from './gateVerdict';

describe('gateVerdict', () => {
  it('counts a refusal that happened as predicted', () => {
    expect(gateVerdict({ status: 'blocked', expectedAccess: 'denied' })).toBe('refusal-verified');
    expect(gateVerdict({ status: 'blocked', expectedAccess: 'module-off' })).toBe('refusal-verified');
  });

  it('flags a page that opened for an account it should have refused', () => {
    expect(gateVerdict({ status: 'pass', expectedAccess: 'denied' })).toBe('opened-when-refused');
    expect(gateVerdict({ status: 'pass', expectedAccess: 'module-off' })).toBe('opened-when-refused');
  });

  it('flags a page that refused an account it should have let in', () => {
    expect(gateVerdict({ status: 'blocked', expectedAccess: 'allowed' })).toBe('refused-when-allowed');
    expect(gateVerdict({ status: 'blocked', expectedAccess: 'open' })).toBe('refused-when-allowed');
  });

  it('says nothing about the gate for an ordinary defect', () => {
    // The tester got in and something else was broken. That is a bug on the
    // page, not evidence about who may open it.
    expect(gateVerdict({ status: 'fail', expectedAccess: 'denied' })).toBe('none');
    expect(gateVerdict({ status: 'fail', expectedAccess: 'allowed' })).toBe('none');
  });

  it('says nothing when there is nothing to compare', () => {
    expect(gateVerdict({ status: 'pass' })).toBe('none');
    expect(gateVerdict({ status: 'untested', expectedAccess: 'denied' })).toBe('none');
  });

  it('separates findings from confirmations', () => {
    expect(isGateMismatch('opened-when-refused')).toBe(true);
    expect(isGateMismatch('refused-when-allowed')).toBe(true);
    expect(isGateMismatch('refusal-verified')).toBe(false);
    expect(isGateMismatch('none')).toBe(false);
  });

  it('tallies a run', () => {
    expect(
      tallyGateVerdicts([
        { status: 'blocked', expectedAccess: 'denied' },
        { status: 'blocked', expectedAccess: 'denied' },
        { status: 'pass', expectedAccess: 'denied' },
        { status: 'blocked', expectedAccess: 'allowed' },
        { status: 'pass', expectedAccess: 'allowed' },
        { status: 'untested' },
      ])
    ).toEqual({ verified: 2, mismatches: 2 });
  });
});
