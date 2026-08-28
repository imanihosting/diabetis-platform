# Build context is the repository root — the backend depends on the
# @wellovue/types workspace, so it cannot be built from its own directory.
#
#   docker build -f backend/Dockerfile .

FROM node:22-slim AS deps
WORKDIR /app
# Manifests first, so a dependency-free code change reuses the install layer.
COPY package.json package-lock.json ./
COPY packages/types/package.json ./packages/types/
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/
RUN npm ci --include-workspace-root \
      --workspace @wellovue/types \
      --workspace backend

FROM deps AS build
COPY packages/types ./packages/types
COPY backend ./backend
RUN npm run build --workspace @wellovue/types \
 && npm run build --workspace backend

FROM node:22-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app

# Reinstall without dev dependencies rather than pruning, so native modules
# (argon2) are resolved for this stage's platform.
COPY package.json package-lock.json ./
COPY packages/types/package.json ./packages/types/
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/
RUN npm ci --omit=dev --include-workspace-root \
      --workspace @wellovue/types \
      --workspace backend \
 && npm cache clean --force

COPY --from=build /app/packages/types/dist ./packages/types/dist
COPY --from=build /app/backend/dist ./backend/dist

# Run unprivileged: this process handles health records.
USER node
EXPOSE 4000

# The compose stack injects environment directly; main.ts only reads a .env
# file when one is present, so nothing is required here.
CMD ["node", "backend/dist/main.js"]

# --- test -------------------------------------------------------------------
# Reuses the build stage, which already has dev dependencies and the test
# sources. Used by infra/docker/docker-compose.test.yml.
FROM build AS test
ENV NODE_ENV=test

# The engine sources that the contract-drift specs read. Still not the engine:
# this image has no business running Python, only reading declarations out of it.
#
#   thresholds.py  - the target range, checked against the shared contract by
#                    target-range.spec.ts
#   findings.py    - the wire names of PostMealMetrics and GroupMeasure
#   post_meal.py   - the shape words the engine can emit
#
# Both of the latter are read by post-meal-metrics.spec.ts. Named file by file
# rather than copying the tree, so adding a spec that reads a new one fails
# loudly here instead of the spec quietly finding nothing to check.
COPY metabolic-engine/app/engines/thresholds.py ./metabolic-engine/app/engines/thresholds.py
COPY metabolic-engine/app/engines/post_meal.py ./metabolic-engine/app/engines/post_meal.py
COPY metabolic-engine/app/models/findings.py ./metabolic-engine/app/models/findings.py

# The deployment description that launch-hardening.spec.ts reads.
#
# Same reason as the engine sources above, and the same rule: named file by
# file rather than copying trees, so a spec that starts reading a new one fails
# loudly here instead of quietly finding nothing to check. These are the files
# that say how the thing is actually deployed — the proxy that owns the
# forwarding headers, the overlay that turns the launch switches on, and the
# frontend's half of the forwarding chain — and a test asserting the shape of a
# deployment has to be able to see it.
COPY infra/proxy/Caddyfile ./infra/proxy/Caddyfile
COPY infra/docker/docker-compose.production.yml ./infra/docker/docker-compose.production.yml
COPY frontend/Dockerfile ./frontend/Dockerfile
COPY frontend/src/app/api ./frontend/src/app/api
CMD ["npm", "run", "test", "--workspace", "backend"]
