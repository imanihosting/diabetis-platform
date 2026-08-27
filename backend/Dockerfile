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

# The engine's copy of the target range, so target-range.spec.ts can check that
# it still agrees with the shared contract. One file, not the engine: this image
# has no business running Python, only reading two numbers out of it.
COPY metabolic-engine/app/engines/thresholds.py ./metabolic-engine/app/engines/thresholds.py
CMD ["npm", "run", "test", "--workspace", "backend"]
