# Multi-stage Dockerfile for Phala Cloud Intel TDX CVM Service
# Stage 1: Build TypeScript into JavaScript
FROM node:22-slim AS builder

WORKDIR /app

# Copy dependency manifests
COPY package.json package-lock.json tsconfig.json ./

# Install all dependencies (including devDependencies for tsc)
RUN npm ci

# Copy source files
COPY src/ ./src/

# Compile TypeScript to dist/
RUN npm run build

# Prune devDependencies to keep container footprint minimal
RUN npm prune --production

# Stage 2: Production TEE Container
FROM node:22-slim AS runner

WORKDIR /app

# Install ca-certificates and curl for healthchecks
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Set node production environment
ENV NODE_ENV=production
ENV PORT=3000

# Copy node_modules and built dist from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/dist ./dist

# Expose HTTP port for Proof screen and client keys
EXPOSE 3000

# Health check endpoint
HEALTHCHECK --interval=15s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

# Start CVM autonomous daemon
CMD ["node", "dist/index.js"]
