# Deployment and skill setup prompt

[Back to the project overview](../../README.md)

Paste this into an agent with terminal access to your deployment host and permission to configure your MCP client. Replace the bracketed values. A skill supplies instructions; the running MCP service supplies tools. Both must be configured.

```text
Deploy OscarplusMCP from https://github.com/TTLouis/OscarplusMCP.git on
[local Linux host or SSH host] in [repository directory], then connect my
[MCP client name] and install the bundled oscarplus agent skill in
[the skills directory supported by my agent].

Read README.md, docs/getting-started/deployment.md,
docs/getting-started/authentication.md, docs/getting-started/agent-setup.md,
docs/project/terms-review.md, compose.yml and .env.example first.
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
