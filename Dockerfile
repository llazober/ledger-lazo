# Stage 1: Build stage
FROM node:20-slim AS builder
WORKDIR /app

# Install native system dependencies required for canvas and PDF processing
RUN apt-get update && apt-get install -y \
    fontconfig \
    libfreetype6 \
    openssl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install dependencies (runs in place)
COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps

# Copy source files
COPY . .

# Generate Prisma Client
RUN npx prisma generate

# Compile Next.js with memory optimization in standalone mode
ENV NODE_OPTIONS="--max-old-space-size=1536"
RUN npm run build

# Stage 2: Production runner stage
FROM node:20-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

# Install native system dependencies required for canvas and PDF processing at runtime
RUN apt-get update && apt-get install -y \
    fontconfig \
    libfreetype6 \
    openssl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Copy standalone build outputs
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma

EXPOSE 3000
CMD ["node", "server.js"]
