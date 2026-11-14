import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  PROGRAM_WIZARD_DRAFT_VERSION,
  clearAllProgramWizardDrafts,
  clearProgramWizardDraft,
  loadProgramWizardDraft,
  saveProgramWizardDraft,
} from './programWizardDraft';

describe('programWizardDraft', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('reads back what it saved, per member', () => {
    expect(saveProgramWizardDraft('m1', { info: { name: 'Recruit School' } }, 1234)).toBe(true);
    saveProgramWizardDraft('m2', { info: { name: 'Driver' } }, 99);

    expect(loadProgramWizardDraft('m1')).toEqual({ savedAt: 1234, data: { info: { name: 'Recruit School' } } });
    expect(loadProgramWizardDraft('m2')).toEqual({ savedAt: 99, data: { info: { name: 'Driver' } } });
    expect(loadProgramWizardDraft('m3')).toBeNull();
  });

  it('discards a draft from another version, or one that is not JSON', () => {
    localStorage.setItem(
      'program-wizard-draft-m1',
      JSON.stringify({ version: PROGRAM_WIZARD_DRAFT_VERSION + 1, savedAt: 1, data: {} })
    );
    localStorage.setItem('program-wizard-draft-m2', '{not json');
    localStorage.setItem('program-wizard-draft-m3', JSON.stringify({ version: PROGRAM_WIZARD_DRAFT_VERSION }));

    expect(loadProgramWizardDraft('m1')).toBeNull();
    expect(loadProgramWizardDraft('m2')).toBeNull();
    expect(loadProgramWizardDraft('m3')).toBeNull();
  });

  it('reports a save the browser refused', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('quota', 'QuotaExceededError');
    });

    expect(saveProgramWizardDraft('m1', { info: {} })).toBe(false);
  });

  it('clears one member, or every member, leaving other keys alone', () => {
    saveProgramWizardDraft('m1', {});
    saveProgramWizardDraft('m2', {});
    saveProgramWizardDraft('m3', {});
    localStorage.setItem('store-cart-m1-w1', 'kept');

    clearProgramWizardDraft('m1');
    expect(loadProgramWizardDraft('m1')).toBeNull();
    expect(loadProgramWizardDraft('m2')).not.toBeNull();

    expect(clearAllProgramWizardDrafts()).toBe(2);
    expect(loadProgramWizardDraft('m2')).toBeNull();
    expect(loadProgramWizardDraft('m3')).toBeNull();
    expect(localStorage.getItem('store-cart-m1-w1')).toBe('kept');
  });
});
