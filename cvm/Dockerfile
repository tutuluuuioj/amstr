# Multi-stage build for AMSTR Autonomous Keeper Daemon & Health Server
FROM node:22-slim AS builder

WORKDIR /app

# Copy manifests
COPY package.json package-lock.json tsconfig.json ./

# Install dependencies
RUN npm ci

# Copy source files
COPY src/ ./src/

# Compile TypeScript to dist/
RUN npm run build

# Prune devDependencies to keep image size small
RUN npm prune --production

# Stage 2: Minimal Production Runtime
FROM node:22-slim AS runner

WORKDIR /app

# Install ca-certificates and curl for healthchecks
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV PORT=8080

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/dist ./dist

EXPOSE 8080

HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:8080/health || exit 1

CMD ["node", "dist/autonomous-runner.js"]
