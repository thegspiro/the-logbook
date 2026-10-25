/**
 * W08-6: while a member must change their password, the account screen and
 * the app shell sent ~15 requests the server refuses, and every refusal was
 * then reported to /errors/log, which is refused too.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import axios from 'axios';
import type { AxiosError, InternalAxiosRequestConfig } from 'axios';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PASSWORD_CHANGE_ALLOWED_SUFFIXES,
  PASSWORD_CHANGE_REQUIRED_CODE,
  holdDuringPasswordChange,
  isPasswordChangeRefusal,
  setPasswordChangePending,
} from './passwordChangeGate';

/** A client whose network adapter records what was actually sent. */
const clientWithRecorder = (baseURL: string) => {
  const sent: string[] = [];
  const client = axios.create({ baseURL });
  client.defaults.adapter = (config: InternalAxiosRequestConfig) => {
    sent.push(`${config.baseURL ?? ''}${config.url ?? ''}`);
    return Promise.resolve({ data: {}, status: 200, statusText: 'OK', headers: {}, config });
  };
  client.interceptors.request.use(holdDuringPasswordChange);
  return { client, sent };
};

afterEach(() => setPasswordChangePending(false));

describe('passwordChangeGate', () => {
  it('lists exactly the paths the server allows', () => {
    const source = readFileSync(resolve(__dirname, '../../../backend/app/api/dependencies.py'), 'utf8');
    const block = /_MUST_CHANGE_PW_ALLOWED_SUFFIXES = \(([^)]*)\)/.exec(source)?.[1] ?? '';
    const serverPaths = [...block.matchAll(/"([^"]+)"/g)].map((match) => match[1]);

    expect(serverPaths.length).toBeGreaterThan(0);
    expect([...PASSWORD_CHANGE_ALLOWED_SUFFIXES].sort()).toEqual([...serverPaths].sort());
  });

  it('holds a refused request without sending it, and answers with the server’s 403', async () => {
    setPasswordChangePending(true);
    const { client, sent } = clientWithRecorder('/api/v1');

    const error = (await client.get('/notifications/my/unread-count').catch((e: unknown) => e)) as AxiosError;

    expect(sent).toEqual([]);
    expect(error.response?.status).toBe(403);
    expect((error.response?.data as { code?: string }).code).toBe(PASSWORD_CHANGE_REQUIRED_CODE);
    expect(isPasswordChangeRefusal(error)).toBe(true);
  });

  it('lets the change itself, and the session paths, through', async () => {
    setPasswordChangePending(true);
    const { client, sent } = clientWithRecorder('/api/v1');

    await client.post('/auth/change-password', {});
    await client.get('/auth/me/');
    await client.get('/auth/session-settings?x=1');

    expect(sent).toEqual(['/api/v1/auth/change-password', '/api/v1/auth/me/', '/api/v1/auth/session-settings?x=1']);
  });

  it('holds a module client’s request by its full path', async () => {
    setPasswordChangePending(true);
    const { client, sent } = clientWithRecorder('/api/v1/finance');

    await expect(client.get('/my-budgets/summary')).rejects.toMatchObject({ response: { status: 403 } });
    expect(sent).toEqual([]);
  });

  it('sends everything once no change is pending', async () => {
    const { client, sent } = clientWithRecorder('/api/v1');

    await client.get('/notifications/my/unread-count');

    expect(sent).toEqual(['/api/v1/notifications/my/unread-count']);
  });

  it('does not take an ordinary 403 for this refusal', () => {
    const forbidden = { response: { status: 403, data: { code: 'LB-AUTH-002' } } } as unknown as AxiosError;
    expect(isPasswordChangeRefusal(forbidden)).toBe(false);
  });
});

describe('the auth store keeps the gate in step', () => {
  it('sets it for a member who must change their password, and clears it on sign-out', async () => {
    vi.resetModules();
    const gate = await import('./passwordChangeGate');
    const { useAuthStore } = await import('../stores/authStore');

    useAuthStore.setState({ user: { must_change_password: true } as never });
    expect(gate.isPasswordChangePending()).toBe(true);

    useAuthStore.setState({ user: null });
    expect(gate.isPasswordChangePending()).toBe(false);
  });
});
