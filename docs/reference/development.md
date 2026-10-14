# Development and fixture tests

[Back to the project overview](../../README.md)

Use Node 22+ and `npm ci`, then `npm test`, `npm run check`, and `npm run build`. Tests construct `FixtureOscarPlusProvider` with a separate in-memory or test SQLite database and exercise sync through the HTTP MCP endpoint. Production does not expose fixture mode, preventing sample jobs from appearing as real postings.

Authentication tests use simulated sign-in screens and a deterministic clock. They cover delayed redirects, expired portal sessions, skipped passwords, alternate verification methods, one call selection per attempt, rejection, timeout, and sanitized diagnostics. These tests do not place phone calls or establish real call delivery.
