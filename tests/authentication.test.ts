import { expect, it } from 'vitest';
import { authenticate, type AuthAction, type AuthSnapshot, type AuthenticationStatus } from '../src/authentication.js';

function scenario(screens: AuthSnapshot[], actionError?: Error) {
  let now = Date.parse('2026-10-14T17:00:00Z'), index = 0;
  const actions: AuthAction[] = [], reports: AuthenticationStatus[] = [];
  const run = () => authenticate({
    now: () => now,
    async snapshot() { return screens[Math.min(index++, screens.length - 1)]!; },
    async act(action) { actions.push(action); if (actionError) throw actionError; },
    async pause(ms) { now += ms; },
  }, status => reports.push(status));
  return { run, actions, reports };
}

it('waits through a delayed SSO redirect and succeeds without requesting a phone call', async () => {
  const flow = scenario([{ route: 'oscarplus' }, { route: 'oscarplus' }, { route: 'account' }]);
  await flow.run();
  expect(flow.actions).toEqual([]);
  expect(flow.reports.at(-1)).toMatchObject({ stage: 'authenticated', outcome: 'success', phone_call_requested_at: null });
});
it('retries a logged-out portal once and allows the password screen to be skipped', async () => {
  const flow = scenario([{ route: 'oscarplus', loggedOut: true }, { route: 'oscarplus', loggedOut: true },
    { route: 'microsoft', phoneOption: true }, { route: 'account' }]);
  await flow.run();
  expect(flow.actions).toEqual(['retry_sso', 'choose_phone']);
  expect(flow.reports.at(-1)?.phone_call_requested_at).toBeTruthy();
});
it('handles account, username, password, alternate method and remember-device screens', async () => {
  const flow = scenario([{ route: 'microsoft', accountPicker: true }, { route: 'microsoft', username: true },
    { route: 'microsoft', password: true }, { route: 'microsoft', password: true },
    { route: 'microsoft', otherMethods: true }, { route: 'microsoft', phoneOption: true },
    { route: 'microsoft', phoneOption: true }, { route: 'microsoft', staySignedIn: true }, { route: 'account' }]);
  await flow.run();
  expect(flow.actions).toEqual(['choose_account', 'enter_username', 'enter_password', 'other_methods', 'choose_phone', 'stay_signed_in']);
});
it('reports a redirect failure with no call requested', async () => {
  const flow = scenario([{ route: 'oscarplus', loggedOut: true }]);
  await expect(flow.run()).rejects.toThrow('authentication_redirect_timeout');
  expect(flow.actions).toEqual(['retry_sso']);
  expect(flow.reports.at(-1)).toMatchObject({ outcome: 'failed', phone_call_requested_at: null });
});
it('reports a missing phone option without claiming a call was requested', async () => {
  const flow = scenario([{ route: 'microsoft', otherMethods: true }]);
  await expect(flow.run()).rejects.toThrow('authentication_phone_unavailable');
  expect(flow.actions).toEqual(['other_methods']);
  expect(flow.reports.at(-1)?.phone_call_requested_at).toBeNull();
});
it('requests a call once and waits the full two minutes before reporting timeout', async () => {
  const flow = scenario([{ route: 'microsoft', phoneOption: true }]);
  await expect(flow.run()).rejects.toThrow('authentication_phone_timeout');
  expect(flow.actions).toEqual(['choose_phone']);
  const last = flow.reports.at(-1)!;
  expect(Date.parse(last.updated_at!) - Date.parse(last.phone_call_requested_at!)).toBe(120_000);
});
it('recognizes explicit verification rejection after a requested call', async () => {
  const flow = scenario([{ route: 'microsoft', phoneOption: true }, { route: 'microsoft', verificationRejected: true }]);
  await expect(flow.run()).rejects.toThrow('authentication_phone_rejected');
  expect(flow.reports.at(-1)?.phone_call_requested_at).toBeTruthy();
});
it.each([
  [{ credentialsRejected: true }, 'authentication_credentials_rejected'],
  [{ actionRequired: true }, 'authentication_action_required'],
])('distinguishes sign-in rejection and required setup before requesting a call', async (screen, category) => {
  const flow = scenario([{ route: 'microsoft', ...screen }]);
  await expect(flow.run()).rejects.toThrow(category);
  expect(flow.actions).toEqual([]);
  expect(flow.reports.at(-1)?.phone_call_requested_at).toBeNull();
});
it('does not act on credential-like controls at an unexpected host', async () => {
  const flow = scenario([{ route: 'other', username: true, password: true, phoneOption: true }]);
  await expect(flow.run()).rejects.toThrow('authentication_redirect_timeout');
  expect(flow.actions).toEqual([]);
});
it('does not publish credentials, page text or exception messages on browser failure', async () => {
  const flow = scenario([{ route: 'microsoft', password: true }], new Error('PRIVATE_CREDENTIAL_AND_URL'));
  await expect(flow.run()).rejects.toThrow('authentication_browser_error');
  expect(flow.reports.at(-1)).toMatchObject({ stage: 'password', outcome: 'failed', phone_call_requested_at: null });
  expect(JSON.stringify(flow.reports)).not.toContain('PRIVATE_CREDENTIAL_AND_URL');
});
