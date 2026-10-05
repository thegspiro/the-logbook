import { describe, it, expect } from 'vitest';
import { toOrganizerOptions } from './useOrganizerOptions';
import type { User } from '../types/user';

const user = (over: Partial<User>): User => ({ id: 'u', username: 'user', status: 'active', ...over }) as User;

describe('toOrganizerOptions', () => {
  it('offers active and probationary members only, the set the API accepts', () => {
    const options = toOrganizerOptions([
      user({ id: 'a', first_name: 'Ann', last_name: 'Active', status: 'active' }),
      user({ id: 'p', first_name: 'Pat', last_name: 'Probie', status: 'probationary' }),
      user({ id: 'l', first_name: 'Lee', last_name: 'Leave', status: 'leave' }),
      user({ id: 'r', first_name: 'Ray', last_name: 'Retired', status: 'retired' }),
    ]);

    expect(options.map((o) => o.id)).toEqual(['a', 'p']);
  });

  it('sorts by last name and falls back to the username for a nameless member', () => {
    const options = toOrganizerOptions([
      user({ id: 'z', first_name: 'Zed', last_name: 'Young' }),
      user({ id: 'b', first_name: 'Bo', last_name: 'Adams' }),
      user({ id: 'g', username: 'ghost' }),
    ]);

    expect(options).toEqual([
      { id: 'g', name: 'ghost' },
      { id: 'b', name: 'Bo Adams' },
      { id: 'z', name: 'Zed Young' },
    ]);
  });
});
