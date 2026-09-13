# VenueIQ engine — the always-on socket.io service.
#
# This one does NOT belong on Vercel: it holds a live socket and a tick loop, so
# it needs a host that keeps a process running (Railway, Render, Fly, a VPS).
#
# IMPORTANT — the build context must be THIS directory, `mini-services/venue-engine`,
# not the repo root. The COPY paths below are relative to the context, so building
# from the repo root fails with "package.json not found". Render and Railway call
# this the service's Root Directory; Northflank calls it the build context.
#
# The port is bound from $PORT, which the platform injects. See src/config.ts.
FROM oven/bun:1-alpine

WORKDIR /app

# Dependencies first, so a source-only change does not reinstall them.
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY src ./src
COPY tsconfig.json ./

# The recorders write here; the platform mounts nothing, so keep it in the image.
RUN mkdir -p data

# Documentation only — the platform overrides this with its own $PORT.
EXPOSE 3003

CMD ["bun", "src/index.ts"]
