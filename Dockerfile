# ── Build ────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ── Runtime ──────────────────────────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist

# Le bot n'écrit que dans /tmp : aucun droit sur /app n'est nécessaire.
USER node

# Vivant = passerelle Discord connectée, pas seulement process en vie : le job
# « heartbeat » (30 s) réécrit le fichier tant que le client est prêt.
HEALTHCHECK --interval=60s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "const{statSync}=require('node:fs'),{tmpdir}=require('node:os'),{join}=require('node:path');process.exit(Date.now()-statSync(join(tmpdir(),'clover-bot.alive')).mtimeMs<180000?0:1)"

CMD ["node", "dist/index.js"]
