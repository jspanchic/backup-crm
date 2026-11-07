# core-api image for the test VPS. Build context = repository root:
#   docker build -f infra/vps/core-api.Dockerfile -t salvionix-crm/core-api:test .
# Node 24 runs the TypeScript files directly (no compile step). Layout matters: the migration scripts find
# the SQL at <scripts>/../../db, so core-api lives in /app/core-api and the migrations in /app/db.
ARG NODE_IMAGE=node:24.22.2-alpine

FROM ${NODE_IMAGE} AS deps
WORKDIR /app/core-api
COPY core-api/package.json core-api/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund

FROM ${NODE_IMAGE}
WORKDIR /app/core-api
COPY --from=deps /app/core-api/node_modules ./node_modules
COPY core-api/package.json ./
COPY core-api/src ./src
COPY core-api/scripts ./scripts
COPY core-api/templates ./templates
COPY db /app/db
# Private folder of generated PDFs. A named volume mounted here inherits this owner.
RUN mkdir -p /data/documents && chown -R node:node /data
USER node
EXPOSE 3000
CMD ["node", "src/server.ts"]
