# Multi-stage build for React/Vite app
FROM node:22-slim AS builder
WORKDIR /app

# Install dependencies
COPY package*.json tsconfig*.json vite.config.ts index.html ./
RUN npm ci

# Copy source and static assets
COPY src/ ./src/
COPY public/ ./public/
COPY tailwind.config.js postcss.config.js ./

# Build production bundle
RUN npm run build

# Stage 2: High-performance Caddy static server
FROM caddy:alpine
COPY --from=builder /app/dist /usr/share/caddy
COPY Caddyfile /etc/caddy/Caddyfile

EXPOSE 8080
CMD ["caddy", "run", "--config", "/etc/caddy/Caddyfile", "--adapter", "caddyfile"]
