FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
ENV VITE_API_ENABLED=true
RUN npm run build && npm run build:api
FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-api ./dist-api
COPY server/migrations ./server/migrations
USER node
EXPOSE 3001
CMD ["node", "dist-api/phase-main.js"]
