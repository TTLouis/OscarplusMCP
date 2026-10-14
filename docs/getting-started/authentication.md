# Authentication and phone-call MFA

[Back to the project overview](../../README.md)

The live provider requires both credential environment variables at startup, even when a saved session exists. It first loads `auth-profile/session.json` if present and enters OSCARplus through the student SSO link. It waits for the sign-in flow to settle, rather than rejecting an intermediate redirect immediately. A logged-out OSCARplus response gets one retry after clearing only OSCARplus cookies; saved Microsoft cookies remain available.

If Microsoft requires sign-in, the provider handles account selection and the username/password screens that actually appear. It can open alternate verification methods, selects the visible **Call +…** or **Call me…** option at most once per attempt, then waits up to two minutes for the account holder to complete verification. No phone number is configured in `.env`; the call uses the method already registered with Microsoft.

Successful authentication saves or refreshes the session for later syncs. A valid saved session can avoid another password/MFA interaction. Expired sessions can require another call. The current adapter specifically implements the phone-call flow; accounts offering only authenticator approval, SMS, passkeys or another flow may need an adapter change. Required account setup or blocking notices stop the run without changing authentication settings. It does not bypass MFA.

## Diagnose a phone that does not ring

`oscarplus_sync_status` includes an `authentication` object with the current process's stage, outcome, `phone_call_requested_at`, update time and safe error category. Container logs record matching structured `oscarplus_authentication` events. A call timestamp means the automation successfully clicked the phone option; it does **not** prove Microsoft placed or delivered a call. A `not_attempted` stage after restart means the new process has not tried authentication yet, not that an earlier process never requested a call.

Fixed error categories distinguish redirect/flow timeouts, an unavailable phone option, a timeout after selecting the call option, explicit verification rejection, rejected credentials, required user action, and browser errors. Specific categories remain in sync history. Stage events contain no raw page text, identities, phone numbers, URLs, passwords, cookies, tokens, or raw browser exception messages.

## Credential and session storage

The `.env.example` contains empty credential placeholders. Your actual username and password are stored in your local `.env` and injected into the container environment by Compose. The application does not log them, write them to SQLite, or return them through MCP. Host/container administrators can still access those secrets; this is not a Docker Secrets integration. `.env`, `auth-profile`, database files, and HAR captures are excluded from Git and Docker build context. The saved `auth-profile/session.json` contains authenticated cookies and tokens; keep its directory at mode `700` and the file at mode `600`. The session file must be readable and writable by the container user (UID 1000) so it can renew the saved sign-in.
