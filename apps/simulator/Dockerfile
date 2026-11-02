# Stage 1: Build
FROM node:22-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json* tsconfig.base.json ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/simulator/package.json ./apps/simulator/
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/

RUN npm ci

COPY packages/shared ./packages/shared
COPY apps/simulator ./apps/simulator

RUN npm run build -w packages/shared
RUN npm run build -w apps/simulator

# Stage 2: Runner
FROM node:22-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json* ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/simulator/package.json ./apps/simulator/

RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/apps/simulator/dist ./apps/simulator/dist

USER node

CMD ["node", "apps/simulator/dist/index.js"]
