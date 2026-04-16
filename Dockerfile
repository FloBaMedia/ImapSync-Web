# syntax=docker/dockerfile:1

# ── Builder ───────────────────────────────────────────────────────────────────
# node:22-bookworm = official Node.js 22 image (Debian) — no imapsync needed
FROM node:22-bookworm AS builder
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate

COPY package.json pnpm-lock.yaml ./

# Mount pnpm store as BuildKit cache — packages are reused across builds
RUN --mount=type=cache,id=pnpm,target=/pnpm-store \
    pnpm config set store-dir /pnpm-store && \
    pnpm install --frozen-lockfile

COPY . .
RUN pnpm exec prisma generate
RUN pnpm build

# ── Runner ────────────────────────────────────────────────────────────────────
# Ubuntu 24.04 for imapsync (not in Debian repos)
FROM ubuntu:24.04 AS runner
WORKDIR /app
ENV NODE_ENV=production

# Copy Node.js binary from builder — avoids nodesource setup in runner
COPY --from=builder /usr/local/bin/node /usr/local/bin/node

# Enable universe repo (imapsync lives there), then install
RUN apt-get update && \
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends software-properties-common && \
    add-apt-repository -y universe && \
    apt-get update && \
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends imapsync && \
    rm -rf /var/lib/apt/lists/*

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

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 3000
ENTRYPOINT ["/entrypoint.sh"]
