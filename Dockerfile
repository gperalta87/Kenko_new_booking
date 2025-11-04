FROM node:20-bookworm-slim
ENV DEBIAN_FRONTEND=noninteractive

# Install Chromium and common fonts/libs Puppeteer needs
RUN apt-get update && apt-get install -y \
    chromium \
    chromium-sandbox \
    xvfb \
    ca-certificates \
    fonts-liberation \
    fonts-noto-color-emoji \
    libasound2 \
    libatk-bridge2.0-0 \
    libatspi2.0-0 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnss3 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxrandr2 \
    libxshmfence1 \
    libxss1 \
    libxtst6 \
    wget \
  && rm -rf /var/lib/apt/lists/* \
  && ln -s /usr/bin/chromium /usr/bin/chromium-browser || true

# Use system Chromium (don't download Chrome)
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Disable X11 and D-Bus for headless mode
ENV DISPLAY=:99
ENV DEBIAN_FRONTEND=noninteractive

# Railway-specific environment
ENV NODE_ENV=production
ENV PORT=3000

WORKDIR /app

# Copy package files first for better caching
COPY package.json ./

# Install dependencies
# Note: If you add package-lock.json to your repo, you can use 'npm ci --only=production' for faster, reproducible builds
RUN npm install --only=production

# Copy source code
COPY . .

# Expose port
EXPOSE 3000

# Start the application
CMD ["node", "server.js"]
