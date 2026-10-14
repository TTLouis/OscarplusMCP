export type AuthStage = 'not_attempted' | 'redirect' | 'session_retry' | 'account_picker' | 'username' | 'password' | 'phone_options' | 'phone_requested' | 'stay_signed_in' | 'authenticated';
export type AuthCategory = 'authentication_redirect_timeout' | 'authentication_flow_timeout' | 'authentication_phone_unavailable' | 'authentication_phone_timeout' | 'authentication_phone_rejected' | 'authentication_credentials_rejected' | 'authentication_action_required' | 'authentication_browser_error';
export class AuthenticationError extends Error {
  constructor(category: AuthCategory) { super(category); }
}
export interface AuthenticationStatus {
  stage: AuthStage;
  outcome: 'not_attempted' | 'pending' | 'success' | 'failed';
  phone_call_requested_at: string | null;
  updated_at: string | null;
  error_category: AuthCategory | null;
}
export interface AuthSnapshot {
  route: 'account' | 'microsoft' | 'oscarplus' | 'other';
  loggedOut?: boolean; accountPicker?: boolean; username?: boolean; password?: boolean;
  phoneOption?: boolean; otherMethods?: boolean; staySignedIn?: boolean;
  credentialsRejected?: boolean; verificationRejected?: boolean; actionRequired?: boolean;
}
export type AuthAction = 'retry_sso' | 'choose_account' | 'enter_username' | 'enter_password' | 'choose_phone' | 'other_methods' | 'stay_signed_in';
export interface AuthDriver {
  snapshot(): Promise<AuthSnapshot>;
  act(action: AuthAction): Promise<void>;
  pause(ms: number): Promise<void>;
  now(): number;
}
export const initialAuthenticationStatus = (): AuthenticationStatus => ({ stage: 'not_attempted', outcome: 'not_attempted', phone_call_requested_at: null, updated_at: null, error_category: null });

// Only fixed enums, timestamps and a call-request marker leave this state machine.
export async function authenticate(driver: AuthDriver, report: (status: AuthenticationStatus) => void): Promise<void> {
  let status = initialAuthenticationStatus();
  let deadline = driver.now() + 60_000;
  const actions = new Set<AuthAction>();
  const update = (stage: AuthStage, outcome: AuthenticationStatus['outcome'] = 'pending', error_category: AuthCategory | null = null) => {
    if (status.stage === stage && status.outcome === outcome && status.error_category === error_category) return;
    status = { ...status, stage, outcome, error_category, updated_at: new Date(driver.now()).toISOString() };
    report({ ...status });
  };
  const actOnce = async (action: AuthAction, stage: AuthStage) => {
    if (actions.has(action)) return;
    update(stage);
    await driver.act(action);
    actions.add(action);
  };
  const fail = (category: AuthCategory): never => {
    update(status.stage, 'failed', category);
    throw new AuthenticationError(category);
  };
  update('redirect');
  try {
    while (driver.now() < deadline) {
      const screen = await driver.snapshot();
      if (screen.route === 'account') { update('authenticated', 'success'); return; }
      if (screen.route === 'oscarplus' && screen.loggedOut) {
        await actOnce('retry_sso', 'session_retry');
      } else if (screen.route === 'microsoft') {
        if (screen.credentialsRejected) fail('authentication_credentials_rejected');
        if (screen.actionRequired) fail('authentication_action_required');
        if (screen.verificationRejected) fail(status.phone_call_requested_at ? 'authentication_phone_rejected' : 'authentication_action_required');
        if (screen.staySignedIn) await actOnce('stay_signed_in', 'stay_signed_in');
        else if (screen.accountPicker) await actOnce('choose_account', 'account_picker');
        else if (screen.username) await actOnce('enter_username', 'username');
        else if (screen.password) await actOnce('enter_password', 'password');
        else if (screen.phoneOption && !actions.has('choose_phone')) {
          update('phone_options');
          await driver.act('choose_phone');
          actions.add('choose_phone');
          status.phone_call_requested_at = new Date(driver.now()).toISOString();
          deadline = driver.now() + 120_000;
          update('phone_requested');
        } else if (screen.otherMethods && !actions.has('choose_phone')) {
          await actOnce('other_methods', 'phone_options');
        }
      }
      await driver.pause(1000);
    }
  } catch (error) {
    if (error instanceof AuthenticationError) throw error;
    fail('authentication_browser_error');
  }
  if (status.phone_call_requested_at) fail('authentication_phone_timeout');
  if (actions.has('other_methods')) fail('authentication_phone_unavailable');
  if (status.stage === 'redirect' || status.stage === 'session_retry') fail('authentication_redirect_timeout');
  fail('authentication_flow_timeout');
}
