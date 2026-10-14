# Deploy OSCARplus MCP

[Back to the project overview](../../README.md)

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

For credential storage, saved sessions and supported MFA, see [Authentication](authentication.md). Continue with [Agent setup](agent-setup.md) after the service is running. Check the [terms review](../project/terms-review.md) before enabling live ingestion.
