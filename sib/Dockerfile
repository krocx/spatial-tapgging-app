# ── Monorepo-aware Dockerfile ──────────────────────────────────────────────────
# Build context must be the REPO ROOT (not sib/).
# Render: set "Root Directory" to blank (repo root) and "Dockerfile Path" to sib/Dockerfile.
#
# Why root context?
#   sib depends on @spatial/shared (a workspace sibling).
#   npm workspaces resolves it via the root node_modules symlink — the lock file
#   and shared/ source must both be present for the build to succeed.

# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

# Copy workspace manifests and the root lock file so `npm ci` can wire up
# workspace symlinks correctly (including @spatial/shared → sib/node_modules).
COPY package*.json ./
COPY shared/package.json ./shared/
COPY sib/package.json    ./sib/
COPY ar-client/package.json ./ar-client/

# Install all workspace deps (dev deps included for TypeScript compilation).
RUN npm ci

# Copy source needed to compile sib (shared types + sib source + tsconfigs).
COPY tsconfig.base.json ./
COPY shared/src/        ./shared/src/
COPY shared/tsconfig.json ./shared/
COPY sib/tsconfig.json  ./sib/
COPY sib/src/           ./sib/src/

# Compile sib TypeScript → sib/dist/
RUN npm run build --workspace=sib

# ── Stage 2: Runtime ──────────────────────────────────────────────────────────
FROM node:20-alpine
WORKDIR /app

# Copy workspace manifests + lock file, then install production deps only.
COPY package*.json ./
COPY shared/package.json ./shared/
COPY sib/package.json    ./sib/
COPY ar-client/package.json ./ar-client/
RUN npm ci --omit=dev

# Copy compiled sib output from builder.
COPY --from=builder /app/sib/dist ./sib/dist

# Copy static portal files (served at /portal, no auth required).
COPY sib/portal/ ./sib/portal/

# Persistent data directory — mount a Render disk at /data.
# SIB writes anchor/tag data here so it survives container restarts and redeploys.
RUN mkdir -p /data/.sib-data
ENV SIB_DATA_DIR=/data/.sib-data

# Runtime config (override in Render environment variables)
ENV NODE_ENV=production
ENV PORT=3001
# SIB_API_KEY    — set in Render env vars (required in production)
# PASS_THRESHOLD — optional, defaults to 0.60

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3001/health || exit 1

# --max-old-space-size caps the V8 JS heap at 384MB, leaving ~128MB of headroom
# on the 512MB Render Starter instance for native/off-heap memory (Buffers from
# world-map uploads, Jimp image decoding, etc., which V8's own heap limit does
# not account for). Without this, V8 sizes its default heap off total system
# memory, which can leave too little headroom for that off-heap usage and lets
# RSS creep right up to the container's hard 512MB OOM kill with no warning.
CMD ["node", "--max-old-space-size=384", "sib/dist/index.js"]
