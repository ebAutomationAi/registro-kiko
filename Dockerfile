FROM node:20-alpine

WORKDIR /app

RUN mkdir -p /app/data

COPY package.json package-lock.json* ./
RUN npm ci --only=production

COPY server.js ./
COPY public/ ./public/

VOLUME ["/app/data"]

EXPOSE 3000

CMD ["node", "server.js"]
