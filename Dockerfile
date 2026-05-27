FROM node:20-alpine AS base

RUN npm install -g pnpm

WORKDIR /app

# Install root dependencies
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --no-frozen-lockfile

# Install client dependencies
COPY client/package.json ./client/
RUN cd client && pnpm install --no-frozen-lockfile

# Copy all source
COPY . .

# Build server (TypeScript)
RUN pnpm run build:server

# Build client (Vite)
RUN cd client && pnpm run build

# Production stage
FROM node:20-alpine AS production
WORKDIR /app

COPY --from=base /app/dist ./dist
COPY --from=base /app/client/dist ./client/dist
COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/package.json ./

ENV NODE_ENV=production

EXPOSE 3000

CMD ["node", "dist/server/index.js"]
