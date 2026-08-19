# ============================================
# Dockerfile - Registro Kiko
# Node.js 20 Alpine para ARM64 (Orange Pi 5 Max)
# ============================================

FROM node:20-alpine

# Crear directorio de trabajo
WORKDIR /app

# Crear usuario no-root para seguridad
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Crear directorio de datos con permisos correctos
RUN mkdir -p /app/data && chown -R nodejs:nodejs /app/data

# Copiar dependencias primero (cache de capas Docker)
COPY --chown=nodejs:nodejs package.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copiar codigo de la aplicacion
COPY --chown=nodejs:nodejs server.js ./
COPY --chown=nodejs:nodejs public/ ./public/

# Cambiar a usuario no-root
USER nodejs

# El volumen data/ se monta desde el host
VOLUME ["/app/data"]

EXPOSE 3000

# Healthcheck para que Docker sepa si el servicio esta sano
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/api/health', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

CMD ["node", "server.js"]
