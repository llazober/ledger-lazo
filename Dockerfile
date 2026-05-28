FROM node:20-slim
WORKDIR /app

# Install native system dependencies required for canvas and PDF processing
RUN apt-get update && apt-get install -y \
    fontconfig \
    libfreetype6 \
    openssl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install dependencies (runs in place, no staging/copying required)
COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps

# Copy the rest of the application files
COPY . .

# Generate Prisma Client
RUN npx prisma generate

# Compile Next.js with memory optimization
ENV NODE_OPTIONS="--max-old-space-size=1536"
RUN npm run build

EXPOSE 3000
CMD ["npm", "start"]
