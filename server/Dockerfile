# Match server for Fly.io. Runs the TypeScript directly with tsx: the engine
# is shared with the web client, so there is no separate build step.
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts
COPY src/engine ./src/engine
COPY src/net ./src/net
COPY src/render/kits.ts ./src/render/kits.ts
COPY server ./server
EXPOSE 8787
CMD ["npx", "tsx", "server/index.ts"]
