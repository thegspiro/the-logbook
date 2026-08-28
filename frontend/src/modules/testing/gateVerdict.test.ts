import { describe, it, expect } from 'vitest';
import { gateVerdict, isGateMismatch, needsGateConfirmation, tallyGateVerdicts } from './gateVerdict';

describe('gateVerdict', () => {
  it('counts a refusal that happened as predicted', () => {
    expect(gateVerdict({ status: 'blocked', expectedAccess: 'denied' })).toBe('refusal-verified');
    expect(gateVerdict({ status: 'blocked', expectedAccess: 'module-off' })).toBe('refusal-verified');
  });

  it('flags a page that opened for an account it should have refused', () => {
    expect(gateVerdict({ status: 'pass', expectedAccess: 'denied' })).toBe('opened-when-refused');
    expect(gateVerdict({ status: 'pass', expectedAccess: 'module-off' })).toBe('opened-when-refused');
  });

  it('asks for confirmation, rather than asserting a defect, when a page this account should open is blocked', () => {
    // "Blocked" also covers a page the tester could not reach — no sample
    // record, no data yet — so calling it a refusal would report permissions
    // failures that never happened.
    expect(gateVerdict({ status: 'blocked', expectedAccess: 'allowed' })).toBe('blocked-where-expected-open');
    expect(gateVerdict({ status: 'blocked', expectedAccess: 'open' })).toBe('blocked-where-expected-open');
    expect(isGateMismatch('blocked-where-expected-open')).toBe(false);
    expect(needsGateConfirmation('blocked-where-expected-open')).toBe(true);
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
    // Only one direction is unambiguous: the tester got into a page the app
    // predicted would refuse them, which missing data cannot explain.
    expect(isGateMismatch('opened-when-refused')).toBe(true);
    expect(isGateMismatch('refusal-verified')).toBe(false);
    expect(isGateMismatch('none')).toBe(false);
    expect(needsGateConfirmation('none')).toBe(false);
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
    ).toEqual({ verified: 2, mismatches: 1, needsConfirmation: 1 });
  });
});
