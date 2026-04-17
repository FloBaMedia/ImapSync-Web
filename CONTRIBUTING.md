# Contributing to ImapSync Web

Thanks for your interest in contributing! This document covers how to set up the project locally, propose changes, and get them merged.

## Code of Conduct

Be respectful. Discriminatory, harassing, or hostile behavior is not tolerated in issues, PRs, or discussions.

## Quick development setup

```bash
# 1. Fork & clone
git clone https://github.com/<your-username>/ImapSync-Web.git
cd ImapSync-Web

# 2. Install dependencies (pnpm 10+)
corepack enable
pnpm install

# 3. Start the database
docker compose up db -d

# 4. Configure environment
cp .env.example .env
# Set DATABASE_URL=postgresql://imapsync:<your-DB_PASSWORD>@localhost:5432/imapsync
# Generate ENCRYPTION_KEY and JWT_SECRET (see .env.example)

# 5. Apply migrations & generate Prisma client
pnpm exec prisma migrate dev
pnpm exec prisma generate

# 6. Start the dev server
pnpm dev
```

The UI is at http://localhost:3000.

To exercise the runner locally without Docker, in a second terminal:

```bash
ENCRYPTION_KEY=<your-key> DATABASE_URL=postgresql://... LOG_DIR=./logs \
  node_modules/.bin/tsx scripts/runner.mjs
```

## Branching & commits

- Branch from `main`: `git checkout -b feat/short-description` or `fix/short-description`
- Use [conventional commit](https://www.conventionalcommits.org/) prefixes:
  - `feat:` new feature
  - `fix:` bug fix
  - `refactor:` non-behavioral change
  - `docs:`, `chore:`, `test:`, `ci:`
- Keep commits focused. One logical change per commit.

## Pull requests

1. **Open an issue first** for non-trivial changes so the design can be discussed before you spend time coding.
2. Make sure `pnpm build` passes locally.
3. Update the README or relevant docs if you change behavior, env vars, or the schema.
4. If you change the Prisma schema, include the generated migration in `prisma/migrations/`.
5. Describe the change, the motivation, and how to test it in the PR body.

## Code style

- TypeScript strict mode is on — no `any` unless you have a real reason.
- Prefer small, composable React components and server-side data loading via Next.js App Router conventions.
- API routes return `NextResponse.json(...)` with HTTP-appropriate status codes.
- Errors surfaced to the UI should be in **English** (the project is open-source and English-only for now).
- Don't introduce new dependencies without justifying the size/maintenance cost in the PR.

## Database changes

Always create migrations through Prisma:

```bash
pnpm exec prisma migrate dev --name describe_your_change
```

Never edit existing migration SQL after it's been merged.

## Testing changes that touch the runner

There are no automated tests for the IMAP sync flow yet (real IMAP servers required). When changing `scripts/runner.mjs`:

1. Spin up a local sync against test mailboxes (e.g. two free mail.tm accounts).
2. Verify graceful shutdown by sending `SIGTERM` mid-sync — the affected accounts must reset to `PENDING`.
3. Verify recovery: kill the runner process, restart it, and confirm stuck `RUNNING` accounts are reset.

## Reporting bugs

Use the GitHub issue tracker. Include:

- Version (commit SHA or release tag)
- How you deployed (Docker Compose / Coolify / bare metal)
- Steps to reproduce
- Relevant logs from the `app` and `runner` containers

For security issues, see [SECURITY.md](SECURITY.md) instead — do not open a public issue.
