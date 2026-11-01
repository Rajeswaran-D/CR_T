# ---------------------------------------------------------------------------
# Stage 1: Build Frontend Assets
# ---------------------------------------------------------------------------
FROM node:20-alpine AS builder

WORKDIR /app

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
