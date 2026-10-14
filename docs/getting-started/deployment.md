# Deploy OSCARplus MCP

[Back to the project overview](../../README.md)

Run the service on your own **Windows PC with Docker Desktop**, or on a Linux Docker host. A separate server is optional. The repository is currently private; other users need GitHub read access or their own authorized copy.

## Choose your platform

### Windows with Docker Desktop

Install Git and follow the official [Docker Desktop for Windows guide](https://docs.docker.com/desktop/setup/install/windows-install/) for current supported Windows versions, hardware virtualization and WSL requirements. Use the **WSL 2 backend** and **Linux containers** for this project's Linux image. Docker's [WSL backend guide](https://docs.docker.com/desktop/features/wsl/) explains the settings. Docker Desktop can run Docker commands from PowerShell without a separately installed Ubuntu distribution.

Complete any required Windows feature setup, installer terms and reboot yourself, then start Docker Desktop from the Start menu and wait for its engine to be ready. In a new PowerShell terminal, check:

```powershell
wsl --version
docker version
docker compose version
docker info --format '{{.OSType}}'
```

The last command must report `linux`. If the CLI cannot reach the engine, check that Docker Desktop is running. If it reports `windows`, switch Docker Desktop to Linux containers. If a machine is managed by your school or employer, follow its software installation policy.

Use a private local project directory. Keep credentials, saved sessions and the database out of shared or cloud-synced folders. You can use PowerShell for the whole setup; do not run the Linux `sudo` or `chmod` commands below in PowerShell.

### Linux

Install Docker Engine and the Docker Compose plugin using the instructions for your distribution. Confirm `docker version` and `docker compose version` work before continuing. If you choose to keep your project inside a Linux WSL distribution instead of a native Windows directory, enable Docker Desktop's integration for that distribution and use the Linux shell instructions for its filesystem.

## Clone the repository

From your chosen project directory, run these commands in PowerShell or a Linux terminal:

```sh
git clone https://github.com/TTLouis/OscarplusMCP.git
cd OscarplusMCP
```

## Prepare local files

The container runs as UID/GID `1000:1000`; both bind-mount directories must be writable by that user. Choose the commands for your filesystem.

### PowerShell with native Windows paths

```powershell
if (-not (Test-Path -LiteralPath '.env')) {
    Copy-Item -LiteralPath '.env.example' -Destination '.env'
}
New-Item -ItemType Directory -Force -Path 'data', 'auth-profile' | Out-Null
notepad.exe .env
```

Use Windows file/folder permissions to keep `.env`, `data` and `auth-profile` private. Linux mode bits are not a substitute for Windows access controls on these host paths. The mount check below verifies whether the container user can write to them; it does not verify privacy permissions.

### Linux shell with a Linux filesystem

```sh
test -e .env || cp .env.example .env
chmod 600 .env
sudo install -d -m 700 -o 1000 -g 1000 data auth-profile
```

## Configure your account

Edit `.env` locally with your text editor. The example starts with live ingestion and automatic sync disabled. To enable scheduled ingestion for your own authorized account, populate `OSCARPLUS_USERNAME` and `OSCARPLUS_PASSWORD`, then set `LIVE_PROVIDER_ENABLED=true` and `AUTO_SYNC=true`. Keep `SYNC_INTERVAL_HOURS=4`, `OSCARPLUS_BATCH_LIMIT=500` unless your accessible listing count requires a larger supported limit, and `LAN_BIND_IP=127.0.0.1` for local use. Do not paste credentials into an agent chat or shell command history.

## Build and check storage access

These Docker commands work in PowerShell and Linux shells:

```sh
docker compose build
docker compose run --rm --no-deps --entrypoint sh oscarplus-mcp -c 'test -w /data && test -w /auth-profile'
```

The storage check uses the image's normal non-root user and should exit with code 0. It does not start ingestion. If it fails, resolve host-folder access or Docker Desktop file-sharing restrictions before starting the service. Do not switch the service to root to hide a permissions problem.

## Start the service

Be ready to answer the registered MFA phone when starting the first live sync:

```sh
docker compose up -d
docker compose ps
```

On Windows, check health in PowerShell:

```powershell
Invoke-RestMethod -Uri 'http://127.0.0.1:3100/health'
```

On Linux:

```sh
curl http://127.0.0.1:3100/health
```

On a Windows PC, keep Docker Desktop running and the PC awake for scheduled syncs. A sleeping or powered-off PC cannot perform background ingestion. Health confirms the process is running; check `oscarplus_sync_status` after connecting your assistant to confirm ingestion and cache freshness.

`compose.yml` mounts `./data` at `/data` and `./auth-profile` at `/auth-profile`, so rebuilding preserves SQLite and the authorized browser state. Keep both directories private and back them up securely. The example binds to loopback by default; set `LAN_BIND_IP` to the VM's private LAN address for LAN/VPN clients. Do not port-forward this unauthenticated v0.1 service to the public internet. Nginx Proxy Manager can be configured later after a private hostname is chosen; restrict any proxy host to trusted LAN/VPN clients.

For credential storage, saved sessions and supported MFA, see [Authentication](authentication.md). Continue with [Agent setup](agent-setup.md) after the service is running. Check the [terms review](../project/terms-review.md) before enabling live ingestion.
