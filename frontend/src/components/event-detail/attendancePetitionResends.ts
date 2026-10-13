/**
 * The note a reviewer sees on a request the member withdrew and sent again.
 * Each resend notifies the reviewer afresh, so without it a second or third
 * notification about the same member reads like a duplicate.
 */
export const resendNote = (withdrawalCount: number | undefined): string | null => {
  if (!withdrawalCount || withdrawalCount < 1) return null;
  const times = withdrawalCount === 1 ? 'once' : withdrawalCount === 2 ? 'twice' : `${withdrawalCount} times`;
  return `Withdrawn and sent again ${times}`;
};
