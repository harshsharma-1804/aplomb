FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json ./
RUN npm install --frozen-lockfile 2>/dev/null || npm install

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 appuser

COPY --from=builder --chown=appuser:nodejs /app/dist ./dist
COPY --from=deps --chown=appuser:nodejs /app/node_modules ./node_modules
COPY --chown=appuser:nodejs package.json ./

USER appuser
EXPOSE 3002

HEALTHCHECK --interval=10s --timeout=5s --start-period=45s --retries=6 \
  CMD node -e "require('http').get('http://localhost:3002/__health', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

CMD ["node", "dist/index.js"]
