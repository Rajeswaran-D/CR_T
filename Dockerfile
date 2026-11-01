# ---------------------------------------------------------------------------
# Stage 1: Build Frontend Assets
# ---------------------------------------------------------------------------
FROM node:20-alpine AS builder

WORKDIR /app

# VITE_* vars are baked into the client bundle at BUILD time — runtime
# `environment:` entries in docker-compose never reach them. Defaults match
# local `.env` values so plain `docker compose up --build` keeps working;
# docker-compose.prod.yml overrides them as build args (deterministic even
# when .env.production is absent from a clean git clone — it is git-ignored).
ARG VITE_STORAGE_PROVIDER=local
ARG VITE_STORAGE_API_BASE_URL=/api
ARG VITE_ORGANIZATION_ID=local-development
ENV VITE_STORAGE_PROVIDER=${VITE_STORAGE_PROVIDER} \
    VITE_STORAGE_API_BASE_URL=${VITE_STORAGE_API_BASE_URL} \
    VITE_ORGANIZATION_ID=${VITE_ORGANIZATION_ID}

# Install dependencies with clean cache
COPY package*.json ./
RUN npm ci

# Copy source code and build client bundle
COPY . .
RUN npm run build

# ---------------------------------------------------------------------------
# Stage 2: Ultra-Lightweight Production Runtime
# ---------------------------------------------------------------------------
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3001

# Copy only production dependencies and built assets
COPY package*.json ./
RUN npm ci --only=production && npm install tsx

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/server ./server
COPY --from=builder /app/database ./database

EXPOSE 3001

# High performance Node.js server with in-memory caching & compression
CMD ["npx", "tsx", "server/server.ts"]
