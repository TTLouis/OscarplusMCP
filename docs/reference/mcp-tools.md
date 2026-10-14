# MCP tools

[Back to the project overview](../../README.md)

Connect a Streamable HTTP MCP client to `http://127.0.0.1:3100/mcp` from the trusted network. Available tools:

- `oscarplus_search_jobs`: compact listed records filtered by text, employer, location, position type, term, deadline/posted/first-seen dates, and limit; `include_unlisted=true` includes retained snapshots.
- `oscarplus_get_job`: full normalized record, original posting text snapshot, and capture-history hashes by posting ID.
- `oscarplus_new_jobs`: records first seen after an ISO timestamp, with optional search filters.
- `oscarplus_sync_jobs`: report `scheduled_only` (or `provider_not_configured`) and local sync status. It does not visit OSCARplus; only the server scheduler ingests postings.
- `oscarplus_sync_status`: provider state, current-process authentication stage and call-option timestamp, cache freshness, listed/unlisted/unchecked counts, sync history summary, discovered count, next scheduled attempt, and last-sync deletion count. New/changed counts exclude records immediately removed by retention. See [authentication diagnostics](../getting-started/authentication.md#diagnose-a-phone-that-does-not-ring).
- `oscarplus_get_attachment`: cached attachment content by known posting and attachment ID; returns `not_cached` when only metadata exists.

`GET /health` returns a minimal health response. There are no debug, environment, proxy, filesystem, or shell endpoints.
