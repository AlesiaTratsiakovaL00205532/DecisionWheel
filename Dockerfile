ARG NODE_VERSION=26.13.1

FROM node:${NODE_VERSION}-alpine3.24 AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

FROM node:${NODE_VERSION}-alpine3.24 AS runtime
RUN apk upgrade --no-cache zlib \
    && rm -rf /usr/local/lib/node_modules/npm /usr/local/bin/npm /usr/local/bin/npx
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000
WORKDIR /app
COPY --from=dependencies /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY src ./src
COPY public ./public
USER node
EXPOSE 3000
CMD ["node", "src/server.js"]
