FROM node:20-bookworm-slim AS build

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack pnpm install --frozen-lockfile

COPY tsconfig.json vitest.config.ts ./
COPY src ./src
COPY scripts ./scripts
COPY keeperhub-first-reliable-tx ./keeperhub-first-reliable-tx
COPY app ./app
COPY data/.gitkeep ./data/.gitkeep

RUN corepack pnpm run build \
  && corepack pnpm run scenarios -- --small \
  && corepack pnpm run export:proof \
  && corepack pnpm run verify:proof

FROM node:20-bookworm-slim AS runtime

ENV NODE_ENV=production \
    PORT=3847 \
    PROOFOPS_OPERATOR_TOKEN_FILE=/app/data/.proofops-operator-token

WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN corepack pnpm install --frozen-lockfile --prod \
  && corepack pnpm store prune

COPY --from=build /app/dist ./dist
COPY --from=build /app/app ./app
COPY --from=build --chown=node:node /app/data ./data

USER node
EXPOSE 3847

HEALTHCHECK --interval=15s --timeout=4s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3847/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]

CMD ["node", "dist/scripts/demo-server.js"]
