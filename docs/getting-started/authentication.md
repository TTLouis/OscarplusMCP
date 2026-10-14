# Authentication and phone-call MFA

[Back to the project overview](../../README.md)

The live provider requires both credential environment variables at startup, even when a saved session exists. It first loads `auth-profile/session.json` if present and enters OSCARplus through the student SSO link. If Microsoft requires a sign-in, the provider enters the username and password, selects the visible **Call +…** option, and waits roughly two minutes for the account holder to answer and complete verification. No phone number is configured in `.env`; the call uses the method already registered with Microsoft.

Successful authentication saves or refreshes the session for later syncs. A valid saved session can avoid another password/MFA interaction. Expired sessions can require another call. The current adapter specifically implements the phone-call flow; accounts showing only authenticator approval, SMS, passkeys or another flow may fail with `authentication_required` and need an adapter change. It does not bypass MFA.

## Credential and session storage

The `.env.example` contains empty credential placeholders. Your actual username and password are stored in your local `.env` and injected into the container environment by Compose. The application does not log them, write them to SQLite, or return them through MCP. Host/container administrators can still access those secrets; this is not a Docker Secrets integration. `.env`, `auth-profile`, database files, and HAR captures are excluded from Git and Docker build context. The saved `auth-profile/session.json` contains authenticated cookies and tokens; keep its directory at mode `700` and the file at mode `600`. The session file must be readable and writable by the container user (UID 1000) so it can renew the saved sign-in.
