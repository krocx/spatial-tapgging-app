# ── Stage 1: Build ────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder
WORKDIR /app

# Install dependencies (including devDependencies for TypeScript compilation)
COPY package*.json ./
RUN npm ci

# Copy source and compile TypeScript → dist/
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

# ── Stage 2: Runtime ──────────────────────────────────────────────────────────
FROM node:20-alpine
WORKDIR /app

# Production dependencies only
COPY package*.json ./
RUN npm ci --omit=dev

# Copy compiled output from builder
COPY --from=builder /app/dist ./dist

# Persistent data directory — mount a Render disk at /data
# SIB writes .sib-data/ here so data survives container restarts and redeploys.
RUN mkdir -p /data/.sib-data
ENV SIB_DATA_DIR=/data/.sib-data

# Runtime configuration (override in Render environment variables)
ENV NODE_ENV=production
ENV PORT=3001
# SIB_API_KEY    — required in production (set in Render env vars)
# PASS_THRESHOLD — optional, defaults to 0.60

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3001/health || exit 1

CMD ["node", "dist/index.js"]
