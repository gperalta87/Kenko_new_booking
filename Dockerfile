FROM node:20-bookworm-slim
ENV DEBIAN_FRONTEND=noninteractive

# Install only fonts/libs Puppeteer needs (no Chromium, no xvfb)
# Puppeteer will use its bundled Chromium which has better headless support
RUN apt-get update && apt-get install -y \
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
    wget \
  && rm -rf /var/lib/apt/lists/*

# Use Puppeteer's bundled Chromium (better headless support, no X11 dependencies)
# Don't set PUPPETEER_SKIP_CHROMIUM_DOWNLOAD - let Puppeteer use its bundled version

# Railway-specific environment
ENV NODE_ENV=production
ENV PORT=3000
ENV DEBIAN_FRONTEND=noninteractive
# Note: We don't set DISPLAY/XAUTHORITY/DBUS vars here - let the code delete them if they exist
# Setting them to empty strings still creates the variables, which Chromium can detect

WORKDIR /app

# Copy package files first for better caching
COPY package.json ./

# Install dependencies (this will download Puppeteer's bundled Chromium)
RUN npm install --only=production

# Copy source code
COPY . .

# Expose port
EXPOSE 3000

# Start the application directly (no entrypoint script needed)
CMD ["node", "server.js"]
