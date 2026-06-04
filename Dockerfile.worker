FROM node:24-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY app ./app
COPY components ./components
COPY core ./core
COPY db ./db
COPY lib ./lib
COPY scripts ./scripts
COPY next.config.ts package.json tsconfig.json ./

CMD ["sh", "-c", "npm run ${WORKER_COMMAND:?set WORKER_COMMAND to worker:managed, worker:production, worker:email-projectors, worker:signal-projectors, or worker:restate-workflows}"]
