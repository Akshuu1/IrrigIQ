# Stage 1: Build
FROM node:22-alpine AS builder

WORKDIR /app

# Copy root configurations and workspace manifests
COPY package.json package-lock.json* tsconfig.base.json ./
COPY packages/shared/package.json ./packages/shared/
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
COPY apps/simulator/package.json ./apps/simulator/

# Install all dependencies
RUN npm ci

# Copy source files
COPY packages/shared ./packages/shared
COPY apps/web ./apps/web

# Build shared package and web app
RUN npm run build -w packages/shared
RUN npm run build -w apps/web

# Stage 2: Serve with non-root Nginx
FROM nginxinc/nginx-unprivileged:alpine AS runner

# Copy custom Nginx configuration
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf

# Copy build artifacts
COPY --from=builder /app/apps/web/dist /usr/share/nginx/html

EXPOSE 8080

HEALTHCHECK --interval=15s --timeout=3s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
