# Build context is the repository root — the frontend depends on the
# @wellovue/types workspace.
#
#   docker build -f frontend/Dockerfile .

FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/types/package.json ./packages/types/
COPY backend/package.json ./backend/
COPY frontend/package.json ./frontend/
RUN npm ci --include-workspace-root \
      --workspace @wellovue/types \
      --workspace frontend

FROM deps AS build
COPY packages/types ./packages/types
COPY frontend ./frontend

# NEXT_PUBLIC_* values are inlined at build time, so anything the browser needs
# must be present here rather than at run time.
#
# The site's public origin is one of them, and it is not only a browser
# concern: it is baked into every canonical URL, the Open Graph tags,
# robots.txt and the sitemap. Setting it in `environment:` instead would do
# nothing at all — the value is already compiled in by then — so it is a build
# argument, and the default is localhost rather than a guessed domain. See
# `frontend/src/lib/seo.ts`.
ARG NEXT_PUBLIC_SITE_URL=http://localhost:3000
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL

RUN npm run build --workspace @wellovue/types \
 && npm run build --workspace frontend

FROM node:22-slim AS runtime
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
WORKDIR /app

# The standalone output already contains the traced node_modules it needs.
COPY --from=build /app/frontend/.next/standalone ./
COPY --from=build /app/frontend/.next/static ./frontend/.next/static

USER node
EXPOSE 3000

CMD ["node", "frontend/server.js"]
