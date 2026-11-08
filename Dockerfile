FROM oven/bun:1.4.4 AS base
# Keep Debian security fixes when rebuilding the pinned Bun image.
RUN sed -i 's|http://deb.debian.org/|https://deb.debian.org/|g' /etc/apt/sources.list.d/debian.sources \
 && apt-get update \
 && apt-get install -y --no-install-recommends --only-upgrade apt zlib1g \
 && dpkg --compare-versions "$(dpkg-query -W -f='${Version}' apt)" ge '3.0.4' \
 && dpkg --compare-versions "$(dpkg-query -W -f='${Version}' zlib1g)" ge '1:1.3.dfsg+really1.3.1-1+deb13u1' \
 && rm -rf /var/lib/apt/lists/*
WORKDIR /app

FROM base AS build
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile
COPY index.html vite.config.ts tsconfig.json ./
COPY src ./src
COPY public ./public
RUN bun --bun run build

FROM base AS production-dependencies
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

FROM base AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 DATA_DIR=/data
COPY --from=production-dependencies /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY src ./src
RUN mkdir /data && chown bun:bun /data
USER bun
EXPOSE 3000
CMD ["bun", "src/server.ts"]
