# Connect your assistant and install the skill

[Back to the project overview](../../README.md)

Connect a Streamable HTTP MCP client to `http://127.0.0.1:3100/mcp` on the same host. For a remote deployment, use an SSH tunnel or trusted-network address reachable from the client; its loopback address refers to the client machine. Configure the endpoint using your MCP client's supported settings. The service has no authentication, so keep it on a trusted local/private network.

After connecting, discover the OSCARplus tools and call `oscarplus_sync_status` to check ingestion and freshness. See the [tool reference](../reference/mcp-tools.md) for the complete interface.

## Install the bundled skill

[skills/oscarplus/SKILL.md](../../skills/oscarplus/SKILL.md) teaches an agent to search the cache, inspect full posting captures, check freshness, and report evidence boundaries. Install the whole `skills/oscarplus/` directory under the skills directory supported by your agent; the resulting layout should be `<skills-directory>/oscarplus/SKILL.md`. Use your client's supported skill discovery/reload process. This repository does not install a skill globally or modify client configuration automatically.

After connecting the MCP and installing the skill, try:

```text
Use the oscarplus skill to find electrical or embedded engineering co-op
postings for [term]. Check cache freshness first, then show up to five
matches with posting IDs, employers, locations, deadlines and capture times.
Read the full details before assessing fit. Flag unknown eligibility and
stale or unlisted records. Do not apply or change my application tracker.
```
