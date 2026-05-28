# 1. Base Image
FROM node:20-slim AS base
WORKDIR /app

# Install native system dependencies required for canvas and PDF processing
RUN apt-get update && apt-get install -y \
    fontconfig \
    libfreetype6 \
    openssl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# 2. Install Dependencies
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps

# 3. Build Application
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Generate Prisma Client
RUN npx prisma generate

# Compile Next.js with memory optimization
ENV NODE_OPTIONS="--max-old-space-size=1536"
RUN npm run build

# 4. Production Runner
FROM base AS runner
ENV NODE_ENV=production
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma

EXPOSE 3000
CMD ["npm", "start"]
