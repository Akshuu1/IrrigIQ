# Stage 1: Build
FROM node:22-alpine AS builder

WORKDIR /app
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# Install build dependencies for native compilation (e.g. bcrypt)
RUN apk add --no-cache python3 make g++

# Copy root configs and all workspace manifests
COPY package.json package-lock.json* tsconfig.base.json ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY apps/simulator/package.json ./apps/simulator/

# Install all dependencies
RUN npm ci

# Copy source code
COPY packages/shared ./packages/shared
COPY apps/api ./apps/api

# Build shared and api
RUN npm run build -w packages/shared
RUN npm run build -w apps/api

# Prune dev dependencies so node_modules contains only production deps with pre-compiled binaries
RUN npm prune --omit=dev

# Stage 2: Production Runner
FROM node:22-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
ENV CHROMIUM_PATH=/usr/bin/chromium-browser

# Install system Chromium, fonts, and dependencies for PDF generation
RUN apk add --no-cache chromium nss freetype harfbuzz ca-certificates ttf-freefont

# Copy root manifests
COPY package.json package-lock.json* ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/api/package.json ./apps/api/

# Copy pre-compiled production node_modules from builder
COPY --from=builder /app/node_modules ./node_modules

# Copy built code and assets
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/apps/api ./apps/api

# Use non-root node user (UID 1000 in official alpine node image)
USER node

EXPOSE 4000

HEALTHCHECK --interval=15s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4000/health').then(r=>r.ok?process.exit(0):process.exit(1)).catch(()=>process.exit(1))"

CMD ["node", "apps/api/dist/index.js"]
