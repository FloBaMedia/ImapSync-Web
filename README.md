# ImapSync Web

A modern, self-hosted web UI for managing IMAP email migrations powered by [imapsync](https://imapsync.lamiral.info/). Built with Next.js 16, PostgreSQL 18, and Prisma 7.

> **Status:** beta. Battle-tested on small-to-medium migrations (dozens of mailboxes) but pre-1.0 — expect occasional breaking changes until then.

---

## Features

- **Migration jobs** — group multiple email accounts into a single migration
- **Server presets** — reusable IMAP server configs with built-in defaults for IONOS, Gmail, Outlook, GMX, Web.de, Strato, and more
- **Live log streaming** — watch `imapsync` output line-by-line via Server-Sent Events
- **Parallel migrations** — configurable per-job concurrency (1–10) and a global runner cap
- **Per-account overrides** — different `--subfolder2`, `--exclude`, `--regextrans2`, or extra args per account in the same job
- **Scheduling** — start now, schedule for a specific time, queue (sequential within a queue group), or save as draft
- **CSV import** — `source;sourcePass;dest;destPass` import directly from the new-migration page
- **Retry failed accounts** — re-run only failed/skipped accounts within a completed job
- **Encryption at rest** — IMAP passwords stored with AES-256-GCM
- **Single-user auth** — JWT session in an httpOnly cookie, bcrypt-hashed admin password
- **Crash recovery** — runner resets stuck accounts on restart; `imapsync` itself resumes safely (skips already-synced messages)

---

## Architecture

Three Docker services:

```
┌────────────────────┐     ┌────────────────────┐     ┌────────────────────┐
│   app (Next.js)    │     │   runner (Node)    │     │  db (PostgreSQL)   │
│   UI + REST API    │◀───▶│   spawns imapsync  │◀───▶│                    │
└────────────────────┘     └────────────────────┘     └────────────────────┘
         │                          │                          ▲
         └──────────── shared-logs volume ────────┘            │
                              │                                │
                       /shared/logs/{accountId}.log ───────────┘
```

- **app** owns the database schema (runs `prisma migrate deploy` on boot) and the HTTP API.
- **runner** polls the DB every ~1s, promotes scheduled jobs, spawns one `imapsync` child per pending account (respecting per-job and global concurrency), and writes per-account log files to a shared volume.
- **app** streams those log files to the browser via SSE.

State and orchestration are entirely DB-mediated — runner crashes, restarts, and SIGTERMs are recovered on next boot without manual cleanup.

---

## Tech stack

| Layer        | Technology                |
|--------------|---------------------------|
| Frontend     | Next.js 16 (App Router)   |
| Styling      | Tailwind CSS 3            |
| Database     | PostgreSQL 18             |
| ORM          | Prisma 7 (`prisma-client`) |
| Auth         | `jose` JWT                |
| Sync engine  | `imapsync` binary         |
| Runtime      | Node.js 22                |
| Package mgr  | pnpm 10                   |

---

## Quick start (Docker Compose)

```bash
# 1. Clone
git clone https://github.com/<your-org>/imapsync-web.git
cd imapsync-web

# 2. Generate secrets and create .env
cat > .env <<EOF
DB_PASSWORD=$(openssl rand -hex 16)
JWT_SECRET=$(openssl rand -base64 32)
ENCRYPTION_KEY=$(openssl rand -hex 32)
ADMIN_EMAIL=you@example.com
ADMIN_PASSWORD=$(openssl rand -base64 16)
PORT=3000
EOF

# 3. Build and start
docker compose up -d --build

# 4. Open the UI
open http://localhost:3000
```

The app refuses to start without `JWT_SECRET`, `ENCRYPTION_KEY`, `DB_PASSWORD`, `ADMIN_EMAIL`, and `ADMIN_PASSWORD`. Read the values you generated above to log in.

On first boot the `app` container will:
1. Apply all pending database migrations
2. Create the admin user from `ADMIN_EMAIL` / `ADMIN_PASSWORD` (rejects passwords shorter than 8 chars or equal to `admin`/`password`)
3. Seed default `imapsync` settings

---

## Configuration

All configuration is via environment variables. Copy `.env.example` to `.env` and fill it in.

| Variable           | Required | Default        | Description |
|--------------------|----------|----------------|-------------|
| `DB_PASSWORD`      | yes      | —              | PostgreSQL password |
| `JWT_SECRET`       | yes      | —              | Session JWT signing secret (≥32 chars). `openssl rand -base64 32` |
| `ENCRYPTION_KEY`   | yes      | —              | AES-256-GCM key for IMAP passwords (64 hex chars). `openssl rand -hex 32` |
| `ADMIN_EMAIL`      | yes      | —              | Initial admin login |
| `ADMIN_PASSWORD`   | yes      | —              | Initial admin password (≥8 chars) |
| `PORT`             | no       | `3000`         | Host port the UI is exposed on |
| `POLL_INTERVAL_MS` | no       | `1000`         | Runner DB poll interval |
| `MAX_PARALLEL`     | no       | `50`           | Global cap on concurrent `imapsync` processes |

> **Rotating `ENCRYPTION_KEY` invalidates all stored IMAP passwords.** If you need to rotate it, plan re-encryption (decrypt with old key → encrypt with new key) or wipe and recreate accounts.

---

## Development

```bash
# Install dependencies
corepack enable
pnpm install

# Start PostgreSQL
docker compose up db -d

# Configure env
cp .env.example .env
# Add: DATABASE_URL=postgresql://imapsync:<DB_PASSWORD>@localhost:5432/imapsync
# Generate JWT_SECRET and ENCRYPTION_KEY (commands in .env.example)

# Apply migrations + generate Prisma client
pnpm exec prisma migrate dev
pnpm exec prisma generate

# Start the dev server
pnpm dev
```

The runner can be started locally too (requires `imapsync` on PATH):

```bash
ENCRYPTION_KEY=<your-key> DATABASE_URL=postgresql://... LOG_DIR=./logs \
  node_modules/.bin/tsx scripts/runner.mjs
```

### Database management

```bash
pnpm db:studio                                          # Prisma Studio UI
pnpm exec prisma migrate dev --name your_change_name    # new migration
pnpm db:migrate                                         # apply migrations (production)
```

---

## CSV import format

The CSV importer on the "New migration" page accepts semicolon-separated files:

```
sourceEmail;sourcePassword;destEmail;destPassword
user@old-domain.com;secret123;user@new-domain.com;newsecret456
```

- Lines starting with `#` are treated as comments and skipped.
- Quoted values and Windows line endings (CRLF) are handled automatically.

---

## Deployment notes

- The `app` container builds in Next.js **standalone** mode — no separate Node.js install needed on the host.
- `entrypoint-app.sh` runs `prisma migrate deploy` on every container start (idempotent and safe on a live DB).
- Put a reverse proxy (Nginx, Traefik, Caddy) in front for HTTPS. SSE responses **must not be buffered** — see the snippet below.
- Only the `pgdata` volume needs backups. Per-account log files in `shared-logs` are reconstructable.
- The runner spawns child processes — give it CPU and memory headroom proportional to `MAX_PARALLEL`.

### Nginx snippet (HTTPS + SSE-friendly)

```nginx
server {
    listen 443 ssl http2;
    server_name imapsync.example.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;

        # Required for SSE log streaming
        proxy_buffering off;
        proxy_cache off;
        proxy_set_header Connection '';
        chunked_transfer_encoding on;
        proxy_read_timeout 24h;
    }
}
```

### Coolify

The included `docker-compose.yml` works as-is on Coolify. Set all five required env vars in the Coolify UI before the first deploy. Pinning `PORT: 3000` and `HOSTNAME: 0.0.0.0` in compose overrides Coolify's injected `PORT` and ensures Traefik finds the upstream.

---

## Security

See [SECURITY.md](SECURITY.md) for the security model, threat boundaries, and how to report vulnerabilities.

Short version: **deploy behind a trusted boundary** (private network or auth-proxied HTTPS). The single-admin design is intentional but means the admin login is equivalent to root on the runner.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). PRs welcome — please open an issue first for non-trivial changes.

---

## License

MIT — see [LICENSE](LICENSE).

`imapsync` itself is licensed separately under the NOLIMIT license by Gilles Lamiral.
