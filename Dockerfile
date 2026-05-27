FROM node:20-alpine AS base

WORKDIR /app

# Install dependencies
COPY package.json pnpm-lock.yaml* ./
COPY client/package.json ./client/
RUN npm install -g pnpm && pnpm install --frozen-lockfile || pnpm install

# Copy source
COPY . .

# Build client
RUN cd client && pnpm install && pnpm run build

# Build server
RUN pnpm run build:server

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
