# syntax=docker/dockerfile:1

# ── Builder ───────────────────────────────────────────────────────────────────
# node:22-bookworm = official Node.js 22 image (Debian) — no imapsync needed
FROM node:22-bookworm AS builder
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate

COPY package.json pnpm-lock.yaml ./

# Mount pnpm store as BuildKit cache — packages are reused across builds
# --shamefully-hoist: create real directories instead of symlinks so
# Docker COPY picks up actual files (not broken symlinks) in the runner stage
RUN --mount=type=cache,id=pnpm,target=/pnpm-store \
    pnpm config set store-dir /pnpm-store && \
    pnpm install --frozen-lockfile --shamefully-hoist

COPY . .
RUN pnpm build

# ── Runner ────────────────────────────────────────────────────────────────────
# Use the official imapsync image — imapsync + all Perl deps included out of the box
FROM gilleslamiral/imapsync:latest AS runner
WORKDIR /app
ENV NODE_ENV=production

# Copy Node.js binary from builder — the imapsync image has no Node.js
COPY --from=builder /usr/local/bin/node /usr/local/bin/node

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static     ./.next/static
COPY --from=builder /app/public           ./public
COPY --from=builder /app/prisma           ./prisma
COPY --from=builder /app/scripts          ./scripts

# Prisma 7 generated client (custom output path)
COPY --from=builder /app/src/generated/prisma ./src/generated/prisma

# Prisma CLI (for migrate deploy in entrypoint)
COPY --from=builder /app/node_modules/prisma          ./node_modules/prisma
COPY --from=builder /app/node_modules/.bin/prisma     ./node_modules/.bin/

# Prisma runtime + adapter
COPY --from=builder /app/node_modules/@prisma         ./node_modules/@prisma
COPY --from=builder /app/node_modules/@prisma/adapter-pg ./node_modules/@prisma/adapter-pg

# PostgreSQL driver and bcrypt (needed by init script)
COPY --from=builder /app/node_modules/pg              ./node_modules/pg
COPY --from=builder /app/node_modules/bcryptjs        ./node_modules/bcryptjs

COPY --chmod=755 entrypoint.sh /entrypoint.sh

EXPOSE 3000
ENTRYPOINT ["/entrypoint.sh"]
