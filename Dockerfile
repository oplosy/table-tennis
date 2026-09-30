FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY server/package.json server/
COPY web/package.json web/
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8080 STATIC_DIR=/app/web/dist
COPY --from=build /app/server/dist/server.mjs server/dist/server.mjs
COPY --from=build /app/web/dist web/dist
RUN npm init -y >/dev/null && npm install ws@8 --omit=dev
EXPOSE 8080
CMD ["node", "server/dist/server.mjs"]
