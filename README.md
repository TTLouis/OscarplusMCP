# OSCARplus MCP

This service stores normalized OscarPlus postings in SQLite and exposes them through a LAN-oriented Streamable HTTP MCP endpoint. Agent search, get, new-jobs, and status requests read SQLite only; they do not search OSCARplus. The live provider enters through `/secure/ssoStudent.htm`, reads every Engineering Co-op active-term page and the Applied To list, and captures full visible posting fields in a headless browser. If the saved sign-in state expires, the next sync can request Microsoft phone verification and wait up to two minutes for approval. It never logs passwords, phone numbers, cookies, or tokens.

Independent, unofficial project; not affiliated with or endorsed by McMaster University or Orbis Communications. The repository contains code and synthetic tests, with no portal content or account state. Review [the terms review](docs/TERMS_REVIEW.md) before enabling live ingestion. Publishing source code does not grant permission to automate portal access or redistribute postings.

## Architecture

`OscarPlus provider → sequential rate-limited sync → normalization/hash → SQLite → MCP tools`

The fixture provider supports the complete local flow. The live adapter is isolated in `src/provider.ts`. `SyncService` keeps syncs from overlapping, fetches details for new postings and for summaries without a matching revision, records attempts, and commits posting changes in one transaction. A successful sync then prunes unsubmitted postings more than three days after their deadline, and submitted postings more than one calendar month after the OSCARplus submission timestamp. Jobs with no usable deadline remain stored. A failed sync leaves existing jobs untouched. Set `AUTO_SYNC=true` to sync at startup when the previous successful sync is due, then run every `SYNC_INTERVAL_HOURS` (four by default) after each attempt.

Every successful complete crawl sets `listing_state` to `listed` for discovered records and `not_listed` for retained records absent from the account's active/applied lists. Absence can reflect term access restrictions or other visibility changes; it does **not** prove the employer closed the posting. `last_listing_check_at` records this check; `last_seen_at` and the source capture remain unchanged for absent records. Search and new-jobs tools default to listed records; pass `include_unlisted=true` to include retained and unchecked snapshots. Direct get-by-ID still returns retained snapshots. All three responses include cache status, and compact results include freshness timestamps.

Schema v4 starts legacy snapshots as `unknown` and schedules an immediate complete crawl after migration. Status reports listed, unlisted, and unchecked counts, last attempt status, discovered count, cache age, `cache_fresh`, and the next scheduled attempt. A failed attempt or a cache older than the configured interval is not fresh. After restart, an unfinished history entry remains visible as `running` in history while the live `running` flag indicates actual activity. `/health` is a process liveness check, not a guarantee of fresh postings.

Pagination follows actual page sizes and must match each advertised widget count. Empty, repeated, overfull, or incomplete results fail without changing the cache. Exceeding `OSCARPLUS_BATCH_LIMIT` fails as `listing_limit_exceeded` instead of silently truncating. A full listing crawl is not constrained by the former one-minute aggregate timeout; individual browser actions remain bounded. Provider cleanup failures cannot leave the sync locked or stop scheduling. Successful saved-session sign-ins refresh the persisted cookies. Authentication may still require human verification when the identity provider expires the session.

Applied To coverage includes every row, rather than filtering rows before validating pagination. `Application SUBMITTED` and `Selected for Interview` are submitted; `Expressed Intention to Apply` and `Application NOT SUBMITTED` are unsubmitted. Intention timestamps are not stored as submission timestamps. The exact portal label is saved as `application_status_label` for newly refreshed records. An unrecognized label fails the crawl as `application_status_unrecognized` so a new portal state cannot silently change retention behavior.

Stored fields include ID, source, title, employer, division, location, remote and position type, term, duration, openings, salary, full description, qualifications, application method and URL, deadline, posted date, targeted programs, work authorization, all visible detail label/value pairs, OSCARplus application status and submission timestamp, attachment metadata, seen/changed timestamps, content hash, and a deliberately restricted source metadata object. Each detail read also saves a source-faithful plain-text copy of every labeled posting field, with its capture time and SHA-256 hash in `job.source_capture`. `oscarplus_get_job` returns that copy and a history of distinct capture hashes. This is an OSCARplus posting snapshot as of the recorded time, not proof that an external employer site remains open. Missing fields remain null or empty. Attachment bytes are returned only when already cached for a known posting; the MCP service never fetches arbitrary URLs.

## Docker deployment

The repository is currently private; other users need GitHub read access or their own authorized copy. The following commands target a Linux Docker host with Docker Compose installed. Clone the repository and enter its directory first:

```sh
git clone https://github.com/TTLouis/OscarplusMCP.git
cd OscarplusMCP
```

Prepare the local environment and bind-mount directories. The container runs as UID/GID `1000:1000`; both directories must be writable by that user. On a fresh Linux deployment:

```sh
test -e .env || cp .env.example .env
chmod 600 .env
sudo install -d -m 700 -o 1000 -g 1000 data auth-profile
```

Edit `.env` locally. The example starts with live ingestion and automatic sync disabled. To enable scheduled ingestion for your own authorized account, populate `OSCARPLUS_USERNAME` and `OSCARPLUS_PASSWORD`, then set `LIVE_PROVIDER_ENABLED=true` and `AUTO_SYNC=true`. Keep `SYNC_INTERVAL_HOURS=4`, `OSCARPLUS_BATCH_LIMIT=500` unless your accessible listing count requires a larger supported limit, and `LAN_BIND_IP=127.0.0.1` for local use. Do not paste credentials into an agent chat or shell command history.

Be ready to answer the registered MFA phone when starting the first live sync:

```sh
docker compose up -d --build
docker compose ps
curl http://127.0.0.1:3100/health
```

`compose.yml` mounts `./data` at `/data` and `./auth-profile` at `/auth-profile`, so rebuilding preserves SQLite and the authorized browser state. Keep both directories private and back them up securely. The example binds to loopback by default; set `LAN_BIND_IP` to the VM's private LAN address for LAN/VPN clients. Do not port-forward this unauthenticated v0.1 service to the public internet. Nginx Proxy Manager can be configured later after a private hostname is chosen; restrict any proxy host to trusted LAN/VPN clients.

The `.env.example` contains empty credential placeholders. Your actual username and password are stored in your local `.env` and injected into the container environment by Compose. The application does not log them, write them to SQLite, or return them through MCP. Host/container administrators can still access those secrets; this is not a Docker Secrets integration. `.env`, `auth-profile`, database files, and HAR captures are excluded from Git and Docker build context. The saved `auth-profile/session.json` contains authenticated cookies and tokens; keep its directory at mode `700` and the file at mode `600`. The session file must be readable and writable by the container user (UID 1000) so it can renew the saved sign-in.

### Login and phone-call MFA

The live provider requires both credential environment variables at startup, even when a saved session exists. It first loads `auth-profile/session.json` if present and enters OSCARplus through the student SSO link. If Microsoft requires a sign-in, the provider enters the username and password, selects the visible **Call +…** option, and waits roughly two minutes for the account holder to answer and complete verification. No phone number is configured in `.env`; the call uses the method already registered with Microsoft.

Successful authentication saves or refreshes the session for later syncs. A valid saved session can avoid another password/MFA interaction. Expired sessions can require another call. The current adapter specifically implements the phone-call flow; accounts showing only authenticator approval, SMS, passkeys or another flow may fail with `authentication_required` and need an adapter change. It does not bypass MFA.

### Copyable deployment and skill setup prompt

Paste this into an agent with terminal access to your deployment host and permission to configure your MCP client. Replace the bracketed values. A skill supplies instructions; the running MCP service supplies tools. Both must be configured.

```text
Deploy OscarplusMCP from https://github.com/TTLouis/OscarplusMCP.git on
[local Linux host or SSH host] in [repository directory], then connect my
[MCP client name] and install the bundled oscarplus agent skill in
[the skills directory supported by my agent].

Read README.md, docs/TERMS_REVIEW.md, compose.yml and .env.example first.
Use my own authorized account and respect applicable portal terms. If the
private repository is inaccessible, report that rather than using someone
else's credentials. Preserve existing deployment data and configuration.

Check Docker/Compose availability and port 3100. Clone or update the source
without discarding local changes. Prepare data/ and auth-profile/ so the
container's UID/GID 1000:1000 can write to them, with private permissions.
Create .env from .env.example only if it does not already exist. Have me
enter OSCARPLUS_USERNAME and OSCARPLUS_PASSWORD directly into the local
file; never ask me to paste them into chat, print .env, run a command that
exposes resolved secrets, or commit secrets, sessions or cached postings.

Configure the live provider and automatic sync for this deployment, retain
the four-hour interval, and tell me when the first sync is about to start
so I can answer Microsoft's MFA phone call. This adapter needs a registered
Call +… method; stop and explain if my account uses an unsupported flow.
Keep the HTTP endpoint on loopback by default. For a remote server, prefer
an SSH tunnel or an existing trusted VPN; do not expose port 3100 publicly.

Build and start with Docker Compose. Check /health, then use
oscarplus_sync_status to verify a successful ingestion, fresh cache and
listing counts. Health alone is not proof of successful authentication or
fresh data. Diagnose categorized failures without dumping private state.
Do not repeatedly restart a failed login and trigger more MFA calls.

Register the Streamable HTTP URL http://127.0.0.1:3100/mcp with my MCP client
using its supported configuration, adjusted for where that client runs.
If the server is remote, explain that the client's 127.0.0.1 is its own
machine and configure the tunnel or trusted-network endpoint accordingly.
Discover the available OSCARplus tools and perform one small cached query.

Copy skills/oscarplus/ to the agent's supported skills directory as
oscarplus/, preserving SKILL.md. Confirm the agent discovers it, reload
the agent if needed, and show me a sample prompt to invoke it. If the agent
does not support skills, explain how to use the file as project instructions.
Do not claim the skill creates the MCP connection or grants portal access.

Report the repository version, service health, cache status, MCP URL,
skill installation path and any remaining blocker. Do not apply to jobs,
upload documents, modify my application tracker, or publish this repository.
```

## Bundled agent skill

[skills/oscarplus/SKILL.md](skills/oscarplus/SKILL.md) teaches an agent to search the cache, inspect full posting captures, check freshness, and report evidence boundaries. Install the whole `skills/oscarplus/` directory under the skills directory supported by your agent; the resulting layout should be `<skills-directory>/oscarplus/SKILL.md`. Use your client's supported skill discovery/reload process. This repository does not install a skill globally or modify client configuration automatically.

After connecting the MCP and installing the skill, try:

```text
Use the oscarplus skill to find electrical or embedded engineering co-op
postings for [term]. Check cache freshness first, then show up to five
matches with posting IDs, employers, locations, deadlines and capture times.
Read the full details before assessing fit. Flag unknown eligibility and
stale or unlisted records. Do not apply or change my application tracker.
```

## MCP connection

Connect a Streamable HTTP MCP client to `http://127.0.0.1:3100/mcp` from the trusted network. Available tools:

- `oscarplus_search_jobs`: compact listed records filtered by text, employer, location, position type, term, deadline/posted/first-seen dates, and limit; `include_unlisted=true` includes retained snapshots.
- `oscarplus_get_job`: full normalized record, original posting text snapshot, and capture-history hashes by posting ID.
- `oscarplus_new_jobs`: records first seen after an ISO timestamp, with optional search filters.
- `oscarplus_sync_jobs`: report `scheduled_only` (or `provider_not_configured`) and local sync status. It does not visit OSCARplus; only the server scheduler ingests postings.
- `oscarplus_sync_status`: provider state, cache freshness, listed/unlisted/unchecked counts, sync history summary, discovered count, next scheduled attempt, and last-sync deletion count. New/changed counts exclude records immediately removed by retention.
- `oscarplus_get_attachment`: cached attachment content by known posting and attachment ID; returns `not_cached` when only metadata exists.

`GET /health` returns a minimal health response. There are no debug, environment, proxy, filesystem, or shell endpoints.

## Development and fixture mode

Use Node 22+ and `npm ci`, then `npm test`, `npm run check`, and `npm run build`. Tests construct `FixtureOscarPlusProvider` with a separate in-memory or test SQLite database and exercise sync through the HTTP MCP endpoint. Production does not expose fixture mode, preventing sample jobs from appearing as real postings.

## Live provider scope

The provider uses the correct site at `https://www.oscarplusmcmaster.ca/`, enters through the SSO link, follows all active-term list pages including pagination, and reads the Applied To list. `OSCARPLUS_BATCH_LIMIT` caps records fetched in one run; set it above the full active and applied count. `detail_fields` preserves every visible labeled field from the posting detail, including the expanded targeted-program list, alongside normalized searchable fields. The text capture preserves those fields in source order. Distinct versions remain in SQLite until the posting reaches its retention cutoff; the current version is returned through MCP. OSCARplus Applied To is the sole source of submitted status; applications made only on external employer sites are treated as unsubmitted for retention. The provider does not download submitted application packages, apply to postings, or expose browser/session data through MCP.

The login depends on the saved browser state or a live Microsoft phone verification. A scheduled run may require human action if the state expires. The page structure can change; a failed scrape records a categorized sync failure and does not replace existing SQLite jobs. HAR captures can contain cookies, CSRF values, passwords, or tokens: keep them outside Git and sanitize before sharing.
