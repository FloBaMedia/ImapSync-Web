FROM ubuntu:24.04 AS base

# Install Node.js 22 and imapsync
RUN apt-get update && \
    DEBIAN_FRONTEND=noninteractive apt-get install -y curl gnupg && \
    curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
    DEBIAN_FRONTEND=noninteractive apt-get install -y nodejs imapsync && \
    rm -rf /var/lib/apt/lists/*

# Enable pnpm via corepack
RUN corepack enable && corepack prepare pnpm@latest --activate

# ── Build stage ─────────────────────────────────────────────────────────────
FROM base AS builder
WORKDIR /app

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm exec prisma generate
RUN pnpm build

# ── Runner stage ─────────────────────────────────────────────────────────────
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production

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
