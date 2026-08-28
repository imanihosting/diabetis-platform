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

# Whether this image is meant to serve the public.
#
# Off by default so a developer's build is unaffected. On, the launch blocker
# check runs and the build fails while `[LEGAL ENTITY]` or any of the other
# four placeholders is still in a user-facing page — which makes shipping one
# impossible rather than merely discouraged. That check cannot run inside a
# container at boot, because by then the page is compiled; the build is the
# last moment it can be caught.
ARG PUBLIC_LAUNCH=false
COPY scripts/check-launch-blockers.mjs ./scripts/
RUN if [ "$PUBLIC_LAUNCH" = "true" ]; then \
      echo "PUBLIC_LAUNCH=true — checking for launch blockers" \
      && node scripts/check-launch-blockers.mjs; \
    else \
      echo "PUBLIC_LAUNCH=false — launch blocker check skipped"; \
    fi

# The site URL is baked in, so a wrong one is invisible until it is expensive.
#
# It reaches every canonical link, every og:url, robots.txt and the whole
# sitemap. Wrong, the site serves perfectly and simply never ranks — there is
# no error, no warning and nothing on the page to look at.
#
# It is easy to get wrong from outside this file, and that is why the check is
# here rather than in a comment. `docker compose build --build-arg NAME`, with
# the value taken from the environment, OVERRIDES the `args:` block in a
# compose file — so a deployment platform that forwards its environment as
# build arguments will silently replace this one. Coolify does exactly that,
# and did.
RUN if [ "$PUBLIC_LAUNCH" = "true" ]; then \
      case "$NEXT_PUBLIC_SITE_URL" in \
        https://*) \
          echo "Site URL: $NEXT_PUBLIC_SITE_URL" ;; \
        *) \
          echo "Refusing to build: PUBLIC_LAUNCH=true with NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL" >&2; \
          echo "" >&2; \
          echo "This value is compiled into every canonical URL, every og:url," >&2; \
          echo "robots.txt and the sitemap. A launch build must use the public" >&2; \
          echo "https:// origin, or the site ships pointing at somewhere nobody" >&2; \
          echo "can reach and nothing anywhere reports a problem." >&2; \
          echo "" >&2; \
          echo "If a deployment platform is forwarding its environment as build" >&2; \
          echo "arguments, set NEXT_PUBLIC_SITE_URL there too — a CLI build" >&2; \
          echo "argument overrides the value in the compose file." >&2; \
          exit 1 ;; \
      esac; \
    fi

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
