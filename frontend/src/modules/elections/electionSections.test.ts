import { describe, it, expect } from 'vitest';
import { ELECTION_SECTIONS, electionSectionPath, isElectionSection, visibleElectionSections } from './electionSections';
import type { Election } from '../../types/election';

const election = (status: string, extra: Partial<Election> = {}) =>
  ({ status, results_visible_immediately: false, ballot_items: [], ...extra }) as unknown as Election;

const ids = (status: string, canManage: boolean, extra: Partial<Election> = {}) =>
  visibleElectionSections(election(status, extra), canManage).map((s) => s.id);

describe('election section paths', () => {
  it('addresses the Overview at the election and a section beneath it', () => {
    expect(electionSectionPath('e-1')).toBe('/elections/e-1');
    expect(electionSectionPath('e-1', null)).toBe('/elections/e-1');
    expect(electionSectionPath('e-1', 'results')).toBe('/elections/e-1/results');
  });

  it('knows its own sections and nothing else', () => {
    for (const section of ELECTION_SECTIONS) expect(isElectionSection(section)).toBe(true);
    expect(isElectionSection('overview')).toBe(false);
    expect(isElectionSection('settings')).toBe(false);
    expect(isElectionSection(undefined)).toBe(false);
  });
});

describe('visibleElectionSections', () => {
  it('gives a manager every setup section on a draft, and nothing to vote on or audit yet', () => {
    expect(ids('draft', true)).toEqual([
      'ballot',
      'nominations',
      'candidates',
      'eligibility',
      'attendance',
      'overrides',
      'proxies',
    ]);
  });

  it('adds voting and the audit to an open election', () => {
    expect(ids('open', true)).toEqual([
      'ballot',
      'candidates',
      'eligibility',
      'attendance',
      'overrides',
      'proxies',
      'voting',
      'integrity',
    ]);
  });

  it('keeps Attendance on a closed election, read-only, beside Results', () => {
    expect(ids('closed', true)).toEqual(expect.arrayContaining(['attendance', 'results', 'integrity']));
    expect(ids('closed', true)).not.toContain('voting');
  });

  it('gives a member only what they act on or read', () => {
    expect(ids('draft', false)).toEqual([]);
    expect(ids('nominations', false)).toEqual(['nominations']);
    expect(ids('open', false)).toEqual(['voting']);
    expect(ids('open', false, { results_visible_immediately: true })).toEqual(['voting', 'results']);
    expect(ids('closed', false)).toEqual(['results']);
  });

  it('leaves only Candidates on a cancelled election', () => {
    expect(ids('cancelled', true)).toEqual(['candidates']);
  });

  it('counts the ballot items and the nominees it is given', () => {
    const sections = visibleElectionSections(
      election('draft', { ballot_items: [{}, {}] as unknown as Election['ballot_items'] }),
      true,
      4
    );
    expect(sections.find((s) => s.id === 'ballot')?.badge).toBe(2);
    expect(sections.find((s) => s.id === 'candidates')?.badge).toBe(4);
  });
});
