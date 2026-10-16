# Multi-stage build: compile the React client, then run the Express server.
FROM node:24-alpine AS build
WORKDIR /app

# Install dependencies first (better layer caching).
COPY server/package.json server/package-lock.json ./server/
COPY client/package.json client/package-lock.json ./client/
RUN cd server && npm ci --omit=dev --ignore-scripts && cd ../client && npm ci --include=dev --ignore-scripts

# Copy source and build the frontend.
COPY server/ ./server/
COPY client/ ./client/
RUN cd client && npm run build

# ---- Runtime image ----
FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app

# Only what's needed at runtime: server deps, server code, built client.
COPY --from=build /app/server/node_modules ./server/node_modules
COPY --from=build /app/server/package.json ./server/
COPY --from=build /app/server/src ./server/src
COPY --from=build /app/server/data/changelog.json ./server/src/data/changelog.json
COPY --from=build /app/client/dist ./client/dist

WORKDIR /app/server
EXPOSE 4000
# The in-process scheduler runs here; use an external cron to hit /api/cron/trigger
# if the platform sleeps the container (e.g. free-tier Idle).
CMD ["node", "src/index.js"]
