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
COPY sib/roadmap-client/package.json ./sib/roadmap-client/

# Install all workspace deps (dev deps included for TypeScript compilation).
RUN npm ci

# Copy source needed to compile sib (shared types + sib source + tsconfigs).
COPY tsconfig.base.json ./
COPY shared/src/        ./shared/src/
COPY shared/tsconfig.json ./shared/
COPY sib/tsconfig.json  ./sib/
COPY sib/src/           ./sib/src/

# Compile sib TypeScript → sib/dist/
# NOTE: use the exact package NAME, not the path. `--workspace=sib` matches by
# path prefix and would also select the nested sib/roadmap-client workspace,
# whose source is intentionally not copied into this image (its prebuilt
# bundle ships via sib/roadmap/ instead).
RUN npm run build --workspace=@spatial/sib

# ── Boot smoke test ───────────────────────────────────────────────────────────
# Run the compiled output with plain node — exactly as production does — and
# hit /health. Catches the compiles-clean-but-crashes-on-boot class of failure
# at BUILD time instead of on deploy. Real incident this guards against: the
# first-ever runtime VALUE import of @spatial/shared resolved to .ts source and
# crashed the container with ERR_MODULE_NOT_FOUND, while `tsc --noEmit` was
# green the whole time (type imports are erased; only booting executes resolution).
# IMPORTANT: stdio must be redirected and the process must be killed, or the
# backgrounded server holds the RUN step's pipes open and the build hangs
# indefinitely at layer commit (observed: a 20-minute "deploy" that was really
# a healthy server running forever inside the builder).
RUN SIB_DATA_DIR=/tmp/smoke PORT=3999 node sib/dist/index.js > /tmp/smoke.log 2>&1 & \
    SMOKE_PID=$!; \
    i=0; until wget -qO /dev/null http://127.0.0.1:3999/health 2>/dev/null || [ $i -ge 20 ]; do i=$((i+1)); sleep 1; done; \
    wget -qO- http://127.0.0.1:3999/health && wget -qO- http://127.0.0.1:3999/config; \
    STATUS=$?; \
    kill $SMOKE_PID 2>/dev/null; \
    echo '--- smoke boot log ---'; cat /tmp/smoke.log; \
    exit $STATUS

# ── Stage 2: Runtime ──────────────────────────────────────────────────────────
FROM node:20-alpine
WORKDIR /app

# Copy workspace manifests + lock file, then install production deps only.
COPY package*.json ./
COPY shared/package.json ./shared/
COPY sib/package.json    ./sib/
COPY ar-client/package.json ./ar-client/
COPY sib/roadmap-client/package.json ./sib/roadmap-client/
RUN npm ci --omit=dev

# Copy compiled sib output from builder.
COPY --from=builder /app/sib/dist ./sib/dist

# Copy static portal files (served at /portal, no auth required).
COPY sib/portal/ ./sib/portal/

# Copy the prebuilt Roadmap Mind-Mapper bundle (served at /roadmap).
# The bundle is committed to git (built via `npm run build:roadmap`), so no
# frontend build step is needed inside the image.
COPY sib/roadmap/ ./sib/roadmap/

# Roadmap dictionary — served at GET /mindmap/glossary.
COPY docs/roadmap-glossary.md ./docs/roadmap-glossary.md

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
  CMD wget -qO- http://127.0.0.1:3001/health || exit 1

# --max-old-space-size caps the V8 JS heap at 384MB, leaving ~128MB of headroom
# on the 512MB Render Starter instance for native/off-heap memory (Buffers from
# world-map uploads, Jimp image decoding, etc., which V8's own heap limit does
# not account for). Without this, V8 sizes its default heap off total system
# memory, which can leave too little headroom for that off-heap usage and lets
# RSS creep right up to the container's hard 512MB OOM kill with no warning.
CMD ["node", "--max-old-space-size=384", "sib/dist/index.js"]
