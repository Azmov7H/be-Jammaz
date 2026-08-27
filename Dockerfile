# ---- Stage 1: Install dependencies ----
FROM node:22-alpine AS deps
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ---- Stage 2: Production runner ----
FROM node:22-alpine AS runner
WORKDIR /app

RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 appuser

COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NODE_ENV=production

USER appuser

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:5000/ || exit 1

CMD ["node", "index.js"]
