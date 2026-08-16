FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.base.json eslint.config.mjs .prettierrc.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/database/package.json packages/database/package.json
COPY packages/shared/package.json packages/shared/package.json
RUN npm ci
COPY apps/api apps/api
COPY packages packages
RUN npm run build -w @cwp/shared && npm run build -w @cwp/database && npm run build -w @cwp/api && npm prune --omit=dev

FROM node:24-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates git ripgrep && rm -rf /var/lib/apt/lists/* \
  && npm install --global @openai/codex@0.145.0 \
  && useradd --create-home --uid 10001 app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/packages/database/dist ./packages/database/dist
COPY --from=build /app/packages/database/migrations ./packages/database/migrations
COPY --from=build /app/packages/database/package.json ./packages/database/package.json
COPY --from=build /app/packages/shared/dist ./packages/shared/dist
COPY --from=build /app/packages/shared/package.json ./packages/shared/package.json
RUN mkdir -p /data/orgs /data/codex-home && chown -R app:app /app /data
USER app
EXPOSE 4100
CMD ["sh", "-c", "node packages/database/dist/migrate.js && node apps/api/dist/index.js"]
