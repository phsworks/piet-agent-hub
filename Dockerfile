# Piet's Brain for the VPS. Not a slim standalone build on purpose: the local
# embedding model (onnxruntime) and the migrations need the full node_modules.
FROM node:24-bookworm-slim

# pg_dump for the nightly backup must match the server version (pg17), which
# Debian bookworm doesn't ship; take it from the PostgreSQL apt repo.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && install -d /usr/share/postgresql-common/pgdg \
  && curl -fsSo /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc https://www.postgresql.org/media/keys/ACCC4CF8.asc \
  && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends postgresql-client-17 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 TZ=Europe/Amsterdam

COPY package.json package-lock.json ./
# Not `npm ci`: npm's lockfile check trips over optional wasm packages that
# are only listed for other platforms (@emnapi/*). install still follows the lock.
RUN npm install --no-audit --no-fund

# Bake the embedding model into the image, so the first search after a deploy
# doesn't wait for a download.
RUN node -e "import('@huggingface/transformers').then((t) => t.pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2'))"

COPY . .
# The db client checks DATABASE_URL on import; it doesn't connect during the build.
RUN DATABASE_URL=postgres://build:build@localhost:5432/build npm run build

ENV NODE_ENV=production
EXPOSE 3210
# Migrations first (idempotent), then the server. Port 3210 is only published
# on the VPS's localhost; Tailscale serves it to Piet's devices.
CMD ["sh", "-c", "npx tsx src/lib/db/migrate.ts && npx next start -H 0.0.0.0 -p 3210"]
