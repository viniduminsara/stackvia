# Build the client bundle first; it is served by the Express process at runtime.
FROM node:20-alpine AS frontend-builder
WORKDIR /app
COPY package.json ./
COPY package-lock.json ./
COPY frontend/package.json ./frontend/package.json
COPY backend/package.json ./backend/package.json
RUN npm ci --workspace=@stackvia/frontend --include-workspace-root
COPY frontend ./frontend
COPY backend/tsconfig.json ./backend/tsconfig.json
RUN npm run build --workspace=@stackvia/frontend

# better-sqlite3 compiles a native binding in this build stage.
FROM node:20-alpine AS backend-builder
RUN apk add --no-cache python3 make g++
WORKDIR /app
COPY package.json ./
COPY package-lock.json ./
COPY backend/package.json ./backend/package.json
COPY frontend/package.json ./frontend/package.json
# Force a local source build so better-sqlite3 does not depend on a remote prebuild.
ENV npm_config_build_from_source=true
ENV npm_config_nodedir=/usr/local
RUN npm ci --workspace=@stackvia/backend --include-workspace-root
COPY backend ./backend
RUN npm run build --workspace=@stackvia/backend && npm prune --omit=dev

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV DATA_DIR=/app/data
RUN apk add --no-cache su-exec
COPY --from=backend-builder /app/node_modules ./node_modules
COPY --from=backend-builder /app/backend/package.json ./backend/package.json
COPY --from=backend-builder /app/backend/dist ./backend/dist
COPY --from=frontend-builder /app/frontend/dist ./frontend/dist
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN mkdir -p /app/data && chown -R node:node /app
RUN chmod +x /usr/local/bin/docker-entrypoint.sh
EXPOSE 3000
ENTRYPOINT ["/usr/local/bin/docker-entrypoint.sh"]
CMD ["node", "backend/dist/server.js"]
