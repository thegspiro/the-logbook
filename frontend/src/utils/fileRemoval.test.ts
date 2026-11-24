import { describe, expect, it } from 'vitest';

import { FileRemovalReason } from '../types/training';
import { fileRemovalText } from './fileRemoval';

describe('fileRemovalText', () => {
  it('names the retention policy and the day, in the department timezone', () => {
    // 03:00 UTC on the 24th is still the 23rd in New York.
    expect(fileRemovalText('2026-11-24T03:00:00+00:00', FileRemovalReason.RETENTION, 'America/New_York')).toBe(
      "Certificate file removed under the department's retention policy on 11/23/2026."
    );
    expect(fileRemovalText('2026-11-24T03:00:00+00:00', FileRemovalReason.RETENTION, 'UTC')).toBe(
      "Certificate file removed under the department's retention policy on 11/24/2026."
    );
  });

  it('says the malware scan removed it', () => {
    expect(fileRemovalText('2026-11-24T15:00:00+00:00', FileRemovalReason.MALWARE, 'UTC')).toBe(
      'Certificate file removed by the malware scan on 11/24/2026: it was found to be infected.'
    );
  });

  it('leaves the date out when there is none', () => {
    expect(fileRemovalText(null, FileRemovalReason.RETENTION, 'UTC')).toBe(
      "Certificate file removed under the department's retention policy."
    );
  });
});
