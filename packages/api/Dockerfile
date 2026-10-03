# Taro API. Build from the repository root so the workspace is available:
#   docker build -f packages/api/Dockerfile -t taro-api .

FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable

FROM base AS build
WORKDIR /repo
# Manifests first so dependency installs are cached across code changes
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/api/package.json packages/api/
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @taro/api...

COPY packages/shared packages/shared
COPY packages/api packages/api
# Bundle the server, then assemble a standalone folder with production
# dependencies only (no native transcription module, no TypeScript sources).
RUN pnpm --filter @taro/api build \
 && pnpm --filter @taro/api deploy --prod --no-optional /out \
 && rm -rf /out/src /out/build.mjs /out/tsconfig.json /out/test.env

FROM node:22-slim AS runtime
ENV NODE_ENV=production \
    PORT=4000
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=30s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||4000)+'/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "--enable-source-maps", "dist/index.js"]
