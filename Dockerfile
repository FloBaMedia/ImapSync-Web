# syntax=docker/dockerfile:1

# ── Builder ───────────────────────────────────────────────────────────────────
FROM node:22-bookworm AS builder
WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate

COPY package.json pnpm-lock.yaml .npmrc ./

# .npmrc has node-linker=hoisted -> flat node_modules with real files (no symlinks, no .pnpm store)
RUN --mount=type=cache,id=pnpm,target=/pnpm-store \
    pnpm config set store-dir /pnpm-store && \
    pnpm install --frozen-lockfile

COPY . .
RUN pnpm exec prisma generate
RUN pnpm build

# Drop devDependencies — not needed at runtime in either container
RUN pnpm prune --prod

# Drop Prisma WASM engines for unused databases (keep only postgresql)
RUN find node_modules/@prisma/client/runtime node_modules/prisma/build \
        -type f \( -name '*cockroachdb*' -o -name '*mysql*' -o -name '*sqlite*' -o -name '*sqlserver*' \) \
        -delete

# ── App (Next.js — no imapsync) ───────────────────────────────────────────────
FROM node:22-alpine AS app
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static     ./.next/static
COPY --from=builder /app/public           ./public
COPY --from=builder /app/prisma           ./prisma
COPY --from=builder /app/scripts          ./scripts
COPY --from=builder /app/src/generated/prisma ./src/generated/prisma
COPY --from=builder /app/node_modules     ./node_modules

COPY --chmod=755 entrypoint-app.sh /entrypoint.sh

EXPOSE 3000
ENTRYPOINT ["/entrypoint.sh"]

# ── Runner (imapsync + Node.js worker) ────────────────────────────────────────
FROM gilleslamiral/imapsync:latest AS runner
USER root
WORKDIR /app
ENV NODE_ENV=production

# Node.js binary from the bookworm builder (alpine has musl, this is glibc — match imapsync image)
COPY --from=builder /usr/local/bin/node /usr/local/bin/node

COPY --from=builder /app/scripts          ./scripts
COPY --from=builder /app/src/generated/prisma ./src/generated/prisma
COPY --from=builder /app/node_modules     ./node_modules

COPY --chmod=755 entrypoint-runner.sh /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
