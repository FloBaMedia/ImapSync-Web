# ImapSync Web

A modern, self-hosted web UI for managing IMAP email migrations powered by [imapsync](https://imapsync.lamiral.info/). Built with Next.js 15, PostgreSQL 18, and Prisma.

---

## Features

- **Migration jobs** — Group multiple email accounts into a single migration job
- **Server management** — Save reusable IMAP server configs with presets for IONOS, Gmail, Outlook, GMX, Web.de, Strato, MidWive, and more
- **Live log streaming** — Watch imapsync output in real-time via Server-Sent Events (SSE), per account
- **Parallel migrations** — Run up to 10 accounts concurrently with a configurable concurrency slider
- **CSV import** — Import existing `user;pass;destUser;destPass` CSV files directly
- **Full imapsync control** — Configure SSL, automap, subfolder prefix, folder exclusions, `--regextrans2` rules, and arbitrary extra args
- **Retry failed accounts** — Re-run only failed/skipped accounts within a completed job
- **Password encryption** — All IMAP passwords stored with AES-256-GCM encryption
- **Authentication** — Single-user session-based login with JWT (httpOnly cookie)
- **Dashboard** — Live statistics across all jobs and accounts with auto-refresh

---

## Tech stack

| Layer       | Technology                 |
|-------------|---------------------------|
| Frontend    | Next.js 15 (App Router)   |
| Styling     | Tailwind CSS 3            |
| Database    | PostgreSQL 18             |
| ORM         | Prisma 6                  |
| Auth        | JWT via `jose`            |
| Sync engine | imapsync (system binary)  |
| Runtime     | Node.js 22                |
| Package mgr | pnpm 10                   |

---

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) and [Docker Compose](https://docs.docker.com/compose/install/)
- That's it — imapsync, Node.js, and PostgreSQL all run inside containers

---

## Quick start

```bash
# 1. Clone the repository
git clone https://github.com/your-org/imapsync-web.git
cd imapsync-web

# 2. Create your environment file
cp .env.example .env

# 3. Edit .env — at minimum change the secrets:
#    ENCRYPTION_KEY=$(openssl rand -hex 32)
#    JWT_SECRET=$(openssl rand -base64 32)
#    ADMIN_EMAIL=you@example.com
#    ADMIN_PASSWORD=a-strong-password

# 4. Build and start
docker compose up -d --build

# 5. Open the UI
open http://localhost:3000
```

On first boot the container will:
1. Apply all database migrations automatically
2. Create the admin user from `ADMIN_EMAIL` / `ADMIN_PASSWORD`
3. Seed default imapsync settings

---

## Configuration

All configuration is done via environment variables. Copy `.env.example` to `.env` and adjust.

| Variable           | Default                     | Description |
|--------------------|-----------------------------|-------------|
| `DB_PASSWORD`      | `changeme`                  | PostgreSQL password |
| `JWT_SECRET`       | *(insecure default)*        | Secret for signing session JWTs — **change in production** |
| `ENCRYPTION_KEY`   | *(insecure default)*        | 64-char hex key (32 bytes) for AES-256-GCM password encryption — **change in production** |
| `ADMIN_EMAIL`      | `admin@example.com`         | Login email for the web UI |
| `ADMIN_PASSWORD`   | `admin`                     | Login password — **change in production** |
| `PORT`             | `3000`                      | Host port the UI is exposed on |

Generate secure secrets:

```bash
# ENCRYPTION_KEY (64 hex chars = 32 bytes)
openssl rand -hex 32

# JWT_SECRET
openssl rand -base64 32
```

---

## Development

```bash
# Install dependencies
pnpm install

# Start PostgreSQL (requires Docker)
docker compose up db -d

# Copy and configure env
cp .env.example .env
# Set DATABASE_URL=postgresql://imapsync:changeme@localhost:5432/imapsync

# Apply migrations and generate Prisma client
pnpm exec prisma migrate dev
pnpm exec prisma generate

# Start the dev server
pnpm dev
```

The app is available at `http://localhost:3000`.

### Database management

```bash
# Open Prisma Studio (database GUI)
pnpm db:studio

# Create a new migration after schema changes
pnpm exec prisma migrate dev --name your_migration_name

# Apply migrations (production)
pnpm db:migrate
```

---

## CSV import format

The CSV importer on the "New migration" page accepts semicolon-separated files (compatible with the legacy `users.csv` format):

```
sourceEmail;sourcePassword;destEmail;destPassword
user@old-domain.com;secret123;user@new-domain.com;newsecret456
```

- Lines starting with `#` are treated as comments and skipped
- Quoted values and Windows line endings (CRLF) are handled automatically

---

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                  Docker Compose                      │
│                                                      │
│  ┌──────────────────┐      ┌──────────────────────┐  │
│  │   app (Next.js)  │─────▶│  db (PostgreSQL 18)  │  │
│  │   Node.js 22     │      └──────────────────────┘  │
│  │   imapsync bin   │                                 │
│  └──────────────────┘                                │
└─────────────────────────────────────────────────────┘
```

**Request flow for a migration:**

1. User creates a job via the UI → API stores job + encrypted accounts in PostgreSQL
2. User clicks "Start" → `POST /api/migrations/:id/start` fires `startJob()` in the background
3. `startJob()` spawns one `imapsync` child process per account (respecting concurrency limit)
4. stdout/stderr lines are emitted to an in-memory `EventEmitter` keyed by `accountId`
5. Log lines are flushed to PostgreSQL in batches every 2 seconds
6. The log viewer connects to `GET /api/migrations/:id/accounts/:accountId/stream` (SSE), which subscribes to the EventEmitter and streams lines to the browser in real-time
7. On process exit, account status (`SUCCESS` / `FAILED`) is written to the database

**Security notes:**

- IMAP passwords are encrypted with AES-256-GCM before being stored; the key never leaves the server
- Sessions are short-lived JWTs stored in httpOnly cookies (7-day expiry)
- All routes except `/login` are protected by middleware

---

## Deployment notes

- The container runs as a **standalone Next.js** build (`output: 'standalone'`), so no separate Node.js install is needed on the host
- The `entrypoint.sh` script runs `prisma migrate deploy` on every container start — safe to run on a live database
- **Reverse proxy**: put Nginx or Traefik in front for HTTPS and domain routing. Pass `X-Forwarded-Proto` and set `secure: true` for cookies in production
- **Backups**: only the `pgdata` volume needs to be backed up; all migration logs and config live in PostgreSQL

### Example Nginx config snippet

```nginx
server {
    listen 443 ssl;
    server_name imapsync.yourdomain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        # Required for SSE (live logs)
        proxy_buffering off;
        proxy_cache off;
        proxy_set_header Connection '';
        chunked_transfer_encoding on;
    }
}
```

---

## Contributing

Contributions are welcome! Please open an issue first to discuss what you'd like to change.

1. Fork the repository
2. Create a feature branch: `git checkout -b feat/your-feature`
3. Commit your changes: `git commit -m 'feat: add your feature'`
4. Push and open a pull request

---

## License

MIT — see [LICENSE](LICENSE) for details.
